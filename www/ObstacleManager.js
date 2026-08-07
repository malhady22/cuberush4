/**
 * =====================================================================
 * ObstacleManager.js — Cube Rush
 * =====================================================================
 * Owns spawning, pooling, movement, and collision resolution for all
 * 8 obstacle types:
 *   Spikes | Moving Walls | Rotating Lasers | Falling Blocks | Holes |
 *   Rolling Balls | Fire Traps | Electric Gates
 *
 * DESIGN MODEL
 *  - The player cube stays on a fixed row (Player.groundY); the world
 *    scrolls toward the camera. Obstacles spawn above the screen and
 *    move straight down at the current difficulty's scroll speed,
 *    interacting with the player via one shared Arcade Physics overlap.
 *  - Every obstacle occupies 1+ of the 3 lanes. Multi-lane hazards
 *    (Moving Wall, Electric Gate) always leave at least one lane open
 *    so a run is never unfairly unwinnable.
 *  - Avoidance rule per type:
 *      Jump-to-avoid  : Spike, Rolling Ball, active Fire Trap
 *      Lane-to-avoid  : Moving Wall, active Electric Gate, Rotating Laser
 *      Jump-to-avoid  : Hole (must jump OVER it, opposite of spikes'
 *                       "must not be airborne" — see _resolveHazard)
 *      Timed telegraph: Falling Block (warning flash before impact)
 *
 * PERFORMANCE
 *  - All obstacle sprites are object-pooled per type (never destroyed
 *    mid-run, only deactivated + recycled).
 *  - All textures are generated ONCE at startup via Canvas/Graphics
 *    and cached on the texture manager.
 *  - No per-frame array allocations in the hot update loop.
 *
 * EVENTS EMITTED (ObstacleManager extends Phaser.Events.EventEmitter)
 *  - 'tierChanged'     (tier:number)
 *  - 'playerHit'       ({ type, survived, color })
 *  - 'playerDied'      ()
 *  - 'obstaclePassed'  (type:string)  — safely dodged, for missions
 * =====================================================================
 */

(function (window) {
  'use strict';

  class ObstacleManager extends Phaser.Events.EventEmitter {
    /**
     * @param {Phaser.Scene} scene
     * @param {Player} player
     * @param {EffectsManager} fx
     * @param {AudioManager} [audio]
     */
    constructor(scene, player, fx, audio) {
      super();
      this.scene = scene;
      this.player = player;
      this.fx = fx;
      this.audio = audio || null;

      this.cfg = this._resolveConfig();

      this.laneCount = player.laneCount;
      this.laneX = player.laneX;
      this.groundY = player.groundY;
      this.laneWidth = this.laneX.length > 1
        ? Math.abs(this.laneX[1] - this.laneX[0])
        : scene.scale.width / this.laneCount;

      // Pools: type -> array of inactive, ready-to-reuse wrapper objects.
      this._pools = {};
      Object.keys(this.cfg.typeDefs).forEach((t) => { this._pools[t] = []; });

      // Active hazards currently on screen.
      this._active = [];

      // Shared physics group — every obstacle sprite lives here so a
      // single overlap() call handles all collision detection.
      this.group = this.scene.physics.add.group({ allowGravity: false });

      this.scene.physics.add.overlap(
        this.player.sprite,
        this.group,
        this._onOverlap,
        this._overlapProcess,
        this
      );

      this.paused = false;
      this._elapsedMs = 0;
      this._spawnTimer = 0;
      this._currentTier = -1;
      this._nextSpawnDelay = 0;
      this._recentBlockedLanes = [];
      this._lastSpawnLane = -1; // avoid same-lane back-to-back spam

      this._ensureTextures();
      this._setTier(0);
      this._scheduleNextSpawn();
    }

    // =====================================================================
    // CONFIG RESOLUTION (defensive fallback if Config.js keys differ)
    // =====================================================================
    _resolveConfig() {
      const C = window.Config || {};
      const colors = C.COLORS || {};
      const diff = C.DIFFICULTY || {};
      const obs = C.OBSTACLES || {};

      const fallbackTypeDefs = {
        spike:       { unlockTier: 0, weight: 14 },
        hole:        { unlockTier: 0, weight: 10 },
        ball:        { unlockTier: 0, weight: 12 },
        wall:        { unlockTier: 1, weight: 12 },
        fire:        { unlockTier: 1, weight: 10 },
        fallingBlock:{ unlockTier: 2, weight: 10 },
        gate:        { unlockTier: 3, weight: 10 },
        laser:       { unlockTier: 4, weight: 10 }
      };

      return {
        tierDurationMs: diff.tierDurationMs || 30000,
        maxSpeedTier: diff.maxSpeedTier || 14,
        maxUnlockTier: diff.maxUnlockTier || 4,
        baseSpeed: obs.baseSpeed || 380,
        speedPerTier: obs.speedPerTier || 30,
        maxSpeed: obs.maxSpeed || 900,
        spawnIntervalBase: obs.spawnIntervalRange || { min: 1100, max: 1900 },
        spawnIntervalFloor: obs.spawnIntervalFloor || { min: 520, max: 850 },
        spawnIntervalReductionPerTier: obs.spawnIntervalReductionPerTier || 50,
        laneShiftIntervalMs: obs.laneShiftIntervalMs || 900,
        laserSweepIntervalMs: obs.laserSweepIntervalMs || 480,
        fireToggleIntervalMs: obs.fireToggleIntervalMs || 1100,
        gateToggleIntervalMs: obs.gateToggleIntervalMs || 1300,
        warningLeadMs: obs.warningLeadMs || 260,
        typeDefs: (obs.typeDefs && Object.keys(obs.typeDefs).length) ? obs.typeDefs : fallbackTypeDefs,
        colors: {
          danger: colors.danger || 0xff3b3b,
          cyan: colors.cyan || 0x00f0ff,
          magenta: colors.magenta || 0xff2e9a,
          gold: colors.gold || 0xffd23f,
          mint: colors.mint || 0x39ff88,
          white: 0xffffff,
          void: 0x05060c
        }
      };
    }

    // =====================================================================
    // TEXTURE GENERATION (runtime, cached — zero binary assets)
    // =====================================================================
    _ensureTextures() {
      const tm = this.scene.textures;
      const lw = Math.max(60, Math.round(this.laneWidth * 0.72));

      // ---- Spike cluster -------------------------------------------------
      if (!tm.exists('obs-spike')) {
        const w = lw, h = 70;
        const canvasTex = tm.createCanvas('obs-spike', w, h);
        const ctx = canvasTex.getContext();
        const teeth = 4;
        const toothW = w / teeth;
        for (let i = 0; i < teeth; i++) {
          const cx = i * toothW + toothW / 2;
          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, '#ff3b3b');
          grad.addColorStop(1, '#ffb3b3');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(cx - toothW * 0.42, h);
          ctx.lineTo(cx, h * 0.08);
          ctx.lineTo(cx + toothW * 0.42, h);
          ctx.closePath();
          ctx.fill();
        }
        canvasTex.refresh();
      }

      // ---- Moving wall panel ----------------------------------------------
      if (!tm.exists('obs-wall')) {
        const w = 100, h = 130;
        const canvasTex = tm.createCanvas('obs-wall', w, h);
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#ff2e9a');
        grad.addColorStop(1, '#7a0f4d');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 3;
        for (let i = -h; i < w; i += 18) {
          ctx.beginPath();
          ctx.moveTo(i, h);
          ctx.lineTo(i + h, 0);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        canvasTex.refresh();
      }

      // ---- Electric gate frame ---------------------------------------------
      if (!tm.exists('obs-gate')) {
        const w = 100, h = 150;
        const canvasTex = tm.createCanvas('obs-gate', w, h);
        const ctx = canvasTex.getContext();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 8;
        ctx.strokeRect(6, 6, w - 12, h - 12);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,240,255,0.5)';
        ctx.strokeRect(14, 14, w - 28, h - 28);
        canvasTex.refresh();
      }
      if (!tm.exists('obs-gate-bolt')) {
        const w = 70, h = 130;
        const canvasTex = tm.createCanvas('obs-gate-bolt', w, h);
        const ctx = canvasTex.getContext();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(w * 0.5, 0);
        ctx.lineTo(w * 0.2, h * 0.4);
        ctx.lineTo(w * 0.55, h * 0.45);
        ctx.lineTo(w * 0.3, h);
        ctx.lineTo(w * 0.8, h * 0.55);
        ctx.lineTo(w * 0.45, h * 0.5);
        ctx.lineTo(w * 0.7, 0);
        ctx.stroke();
        canvasTex.refresh();
      }

      // ---- Rotating laser beam (decorative) + hitbox core -----------------
      if (!tm.exists('obs-laser-beam')) {
        const w = 340, h = 14;
        const canvasTex = tm.createCanvas('obs-laser-beam', w, h);
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, 'rgba(255,59,59,0)');
        grad.addColorStop(0.5, 'rgba(255,59,59,1)');
        grad.addColorStop(1, 'rgba(255,59,59,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        canvasTex.refresh();
      }
      if (!tm.exists('obs-laser-core')) {
        const w = Math.round(lw * 0.5), h = 100;
        const canvasTex = tm.createCanvas('obs-laser-core', w, h);
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.2)');
        grad.addColorStop(0.5, 'rgba(255,80,80,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0.2)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        canvasTex.refresh();
      }

      // ---- Falling block ----------------------------------------------------
      if (!tm.exists('obs-fallblock')) {
        const s = 84;
        const canvasTex = tm.createCanvas('obs-fallblock', s, s);
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, s, s);
        grad.addColorStop(0, '#ffd23f');
        grad.addColorStop(1, '#a86a00');
        ctx.fillStyle = grad;
        ctx.fillRect(4, 4, s - 8, s - 8);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(4, 4, s - 8, s - 8);
        canvasTex.refresh();
      }
      if (!tm.exists('obs-warning-shadow')) {
        const s = 90;
        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xff3b3b, 1);
        g.fillEllipse(s / 2, s / 2, s * 0.85, s * 0.32);
        g.generateTexture('obs-warning-shadow', s, s);
        g.destroy();
      }

      // ---- Hole ---------------------------------------------------------------
      if (!tm.exists('obs-hole')) {
        const w = lw, h = 60;
        const canvasTex = tm.createCanvas('obs-hole', w, h);
        const ctx = canvasTex.getContext();
        const grad = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        grad.addColorStop(0, '#000000');
        grad.addColorStop(0.7, '#05060c');
        grad.addColorStop(1, 'rgba(255,59,59,0.5)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
        ctx.fill();
        canvasTex.refresh();
      }

      // ---- Rolling ball ---------------------------------------------------------
      if (!tm.exists('obs-ball')) {
        const s = 62;
        const canvasTex = tm.createCanvas('obs-ball', s, s);
        const ctx = canvasTex.getContext();
        const grad = ctx.createRadialGradient(s * 0.35, s * 0.35, 4, s * 0.5, s * 0.5, s * 0.5);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, '#ff8a3d');
        grad.addColorStop(1, '#a83200');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        // Spoke lines for visible rotation feedback.
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(6, s / 2); ctx.lineTo(s - 6, s / 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s / 2, 6); ctx.lineTo(s / 2, s - 6); ctx.stroke();
        canvasTex.refresh();
      }

      // ---- Fire trap (base scorch + flame) ---------------------------------------
      if (!tm.exists('obs-fire-base')) {
        const w = lw * 0.8, h = 26;
        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0x2a1408, 1);
        g.fillEllipse(w / 2, h / 2, w, h);
        g.lineStyle(2, 0xff8a3d, 0.8);
        g.strokeEllipse(w / 2, h / 2, w, h);
        g.generateTexture('obs-fire-base', w, h);
        g.destroy();
      }
      if (!tm.exists('obs-fire-flame')) {
        const w = 60, h = 110;
        const canvasTex = tm.createCanvas('obs-fire-flame', w, h);
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, '#ff3b3b');
        grad.addColorStop(0.5, '#ff8a3d');
        grad.addColorStop(1, '#ffe14d');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(w * 0.5, 0);
        ctx.bezierCurveTo(w * 0.9, h * 0.35, w * 0.75, h * 0.55, w * 0.85, h);
        ctx.lineTo(w * 0.15, h);
        ctx.bezierCurveTo(w * 0.25, h * 0.55, w * 0.1, h * 0.35, w * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        canvasTex.refresh();
      }
    }

    // =====================================================================
    // TIER / DIFFICULTY
    // =====================================================================
    _computeSpeedTier(elapsedMs) {
      return Math.min(this.cfg.maxSpeedTier, Math.floor(elapsedMs / this.cfg.tierDurationMs));
    }

    _setTier(tier) {
      if (tier === this._currentTier) return;
      this._currentTier = tier;
      this.emit('tierChanged', tier);

      // Re-speed anything already on screen so difficulty ramps feel
      // uniform rather than only affecting freshly spawned hazards.
      const newSpeed = this.getScrollSpeed();
      this._active.forEach((w) => {
        if (w.sprite && w.sprite.body) w.sprite.body.setVelocityY(newSpeed);
        w.speed = newSpeed;
      });
    }

    getScrollSpeed() {
      const s = this.cfg.baseSpeed + this._currentTier * this.cfg.speedPerTier;
      return Math.min(this.cfg.maxSpeed, s);
    }

    _getUnlockTier() {
      return Math.min(this.cfg.maxUnlockTier, this._currentTier);
    }

    _scheduleNextSpawn() {
      const unlockT = this._currentTier;
      const reduce = Math.min(
        this.cfg.spawnIntervalBase.max - this.cfg.spawnIntervalFloor.max,
        unlockT * this.cfg.spawnIntervalReductionPerTier
      );
      const min = Math.max(this.cfg.spawnIntervalFloor.min, this.cfg.spawnIntervalBase.min - reduce);
      const max = Math.max(this.cfg.spawnIntervalFloor.max, this.cfg.spawnIntervalBase.max - reduce);
      this._nextSpawnDelay = Phaser.Math.Between(Math.round(min), Math.round(max));
    }

    // =====================================================================
    // WEIGHTED TYPE SELECTION
    // =====================================================================
    _pickType() {
      const unlockTier = this._getUnlockTier();
      const defs = this.cfg.typeDefs;
      const pool = [];
      let totalWeight = 0;

      Object.keys(defs).forEach((type) => {
        const d = defs[type];
        if (d.unlockTier <= unlockTier) {
          totalWeight += d.weight;
          pool.push({ type, weight: d.weight });
        }
      });

      if (pool.length === 0) return 'spike';

      let roll = Math.random() * totalWeight;
      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) return pool[i].type;
      }
      return pool[pool.length - 1].type;
    }

    // =====================================================================
    // LANE HELPERS
    // =====================================================================
    _randomLane(avoid) {
      let lane;
      let tries = 0;
      do {
        lane = Phaser.Math.Between(0, this.laneCount - 1);
        tries++;
      } while (lane === avoid && this.laneCount > 1 && tries < 6);
      return lane;
    }

    /** Picks a contiguous block of `count` lanes, always leaving 1+ open. */
    _pickContiguousBlock(count) {
      const maxStart = this.laneCount - count;
      const start = Phaser.Math.Between(0, Math.max(0, maxStart));
      const lanes = [];
      for (let i = 0; i < count; i++) lanes.push(start + i);
      return lanes;
    }

    _laneCenterX(lanes) {
      const sum = lanes.reduce((acc, l) => acc + this.laneX[l], 0);
      return sum / lanes.length;
    }

    // =====================================================================
    // POOLING
    // =====================================================================
    _acquire(type, createFn) {
      const pool = this._pools[type];
      let wrapper = pool.pop();
      if (!wrapper) {
        wrapper = createFn();
        wrapper.type = type;
      }
      wrapper.processed = false;
      wrapper.hasHit = false;
      wrapper.timer = 0;
      wrapper.active = true;
      this.group.add(wrapper.sprite);
      wrapper.sprite.setActive(true).setVisible(true);
      wrapper.sprite.body.enable = true;
      wrapper.sprite.obstacleRef = wrapper;
      (wrapper.extras || []).forEach((e) => e.setVisible(true));
      this._active.push(wrapper);
      return wrapper;
    }

    _recycle(wrapper) {
      const idx = this._active.indexOf(wrapper);
      if (idx !== -1) this._active.splice(idx, 1);

      if (wrapper.sprite) {
        wrapper.sprite.body.enable = false;
        wrapper.sprite.setActive(false).setVisible(false);
        wrapper.sprite.body.setVelocity(0, 0);
      }
      (wrapper.extras || []).forEach((e) => e.setVisible(false));

      this._pools[wrapper.type].push(wrapper);
    }

    // =====================================================================
    // MAIN UPDATE LOOP
    // =====================================================================
    /**
     * @param {number} time
     * @param {number} delta
     * @param {number} elapsedRunMs - total elapsed time of the current run
     *                                (owned/tracked by GameScene).
     */
    update(time, delta, elapsedRunMs) {
      if (this.paused) return;

      this._elapsedMs = elapsedRunMs;
      const tier = this._computeSpeedTier(elapsedRunMs);
      if (tier !== this._currentTier) this._setTier(tier);

      this._spawnTimer += delta;
      if (this._spawnTimer >= this._nextSpawnDelay) {
        this._spawnTimer = 0;
        this._spawn();
        this._scheduleNextSpawn();
      }

      const bottomLimit = this.scene.scale.height + 120;
      // Iterate backwards so splicing during recycle is safe.
      for (let i = this._active.length - 1; i >= 0; i--) {
        const w = this._active[i];
        this._updateInstance(w, time, delta);

        if (w.sprite.y > bottomLimit) {
          if (!w.hasHit) this.emit('obstaclePassed', w.type);
          this._recycle(w);
        }
      }
    }

    _updateInstance(w, time, delta) {
      switch (w.type) {
        case 'ball':
          w.sprite.angle += delta * 0.6;
          break;

        case 'wall':
          w.timer += delta;
          if (w.timer >= this.cfg.laneShiftIntervalMs) {
            w.timer = 0;
            this._shiftContiguousBlock(w);
          }
          break;

        case 'gate':
          w.timer += delta;
          if (w.timer >= this.cfg.gateToggleIntervalMs) {
            w.timer = 0;
            w.active = !w.active;
            this._applyGateVisualState(w);
            if (this.audio && this.audio.playSpinTick) this.audio.playSpinTick();
          }
          break;

        case 'fire':
          w.timer += delta;
          if (w.timer >= this.cfg.fireToggleIntervalMs) {
            w.timer = 0;
            w.active = !w.active;
            this._applyFireVisualState(w);
          }
          break;

        case 'laser':
          w.timer += delta;
          if (w.timer >= this.cfg.laserSweepIntervalMs) {
            w.timer = 0;
            this._sweepLaser(w);
          }
          if (w.extras && w.extras[0]) w.extras[0].angle += delta * 0.25;
          if (w.extras && w.extras[0]) w.extras[0].setPosition(w.sprite.x, w.sprite.y);
          break;

        default:
          break;
      }

      // Keep decorative extras (non-laser types with extras) glued to
      // their main sprite's current transform.
      if (w.type !== 'laser' && w.extras) {
        w.extras.forEach((e) => e.setPosition(w.sprite.x, w.sprite.y));
      }
    }

    // =====================================================================
    // SPAWN DISPATCH
    // =====================================================================
    _spawn() {
      const type = this._pickType();
      const speed = this.getScrollSpeed();

      switch (type) {
        case 'spike': this._spawnSingleLaneHazard('spike', 'obs-spike', this.cfg.colors.danger, speed, 74, 60); break;
        case 'hole': this._spawnHole(speed); break;
        case 'ball': this._spawnBall(speed); break;
        case 'wall': this._spawnWall(speed); break;
        case 'fire': this._spawnFire(speed); break;
        case 'fallingBlock': this._spawnFallingBlock(speed); break;
        case 'gate': this._spawnGate(speed); break;
        case 'laser': this._spawnLaser(speed); break;
        default: this._spawnSingleLaneHazard('spike', 'obs-spike', this.cfg.colors.danger, speed, 74, 60); break;
      }
    }

    // ---------------------------------------------------------------------
    // SPIKES / generic single-lane static hazard (also used as a base for
    // simple type spawns to avoid duplicated boilerplate).
    // ---------------------------------------------------------------------
    _spawnSingleLaneHazard(type, textureKey, color, speed, bodyW, bodyH) {
      const lane = this._randomLane(this._lastSpawnLane);
      this._lastSpawnLane = lane;
      const x = this.laneX[lane];
      const y = -80;

      const w = this._acquire(type, () => {
        const sprite = this.scene.physics.add.sprite(x, y, textureKey);
        sprite.setDepth(6);
        return { sprite, extras: [], lanes: [lane], color };
      });

      w.sprite.setPosition(x, y);
      w.sprite.setTexture(textureKey);
      w.sprite.setAngle(0);
      w.sprite.setAlpha(1);
      w.sprite.body.setSize(bodyW, bodyH);
      w.sprite.body.setVelocity(0, speed);
      w.lanes = [lane];
      w.color = color;
      w.speed = speed;

      this._recentBlockedLanes = [lane];
    }

    // ---------------------------------------------------------------------
    // HOLE
    // ---------------------------------------------------------------------
    _spawnHole(speed) {
      const lane = this._randomLane(this._lastSpawnLane);
      this._lastSpawnLane = lane;
      const x = this.laneX[lane];
      const y = -60;

      const w = this._acquire('hole', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-hole');
        sprite.setDepth(2); // beneath player/track decoration
        return { sprite, extras: [], lanes: [lane], color: this.cfg.colors.void };
      });

      w.sprite.setPosition(x, y);
      w.sprite.setAlpha(1);
      w.sprite.body.setSize(this.laneWidth * 0.65, 40);
      w.sprite.body.setVelocity(0, speed);
      w.lanes = [lane];
      w.speed = speed;

      this._recentBlockedLanes = [lane];
    }

    // ---------------------------------------------------------------------
    // ROLLING BALL
    // ---------------------------------------------------------------------
    _spawnBall(speed) {
      const lane = this._randomLane(this._lastSpawnLane);
      this._lastSpawnLane = lane;
      const x = this.laneX[lane];
      const y = -70;

      const w = this._acquire('ball', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-ball');
        sprite.setDepth(6);
        return { sprite, extras: [], lanes: [lane], color: this.cfg.colors.danger };
      });

      w.sprite.setPosition(x, y);
      w.sprite.setAngle(0);
      w.sprite.body.setCircle(28);
      w.sprite.body.setVelocity(0, speed * 1.05);
      w.lanes = [lane];
      w.speed = speed;

      this._recentBlockedLanes = [lane];
    }

    // ---------------------------------------------------------------------
    // MOVING WALL (multi-lane, contiguous block, shifts over time)
    // ---------------------------------------------------------------------
    _spawnWall(speed) {
      const blockCount = this.laneCount > 2 ? Phaser.Math.Between(1, this.laneCount - 1) : 1;
      const lanes = this._pickContiguousBlock(blockCount);
      const x = this._laneCenterX(lanes);
      const y = -100;
      const width = this.laneWidth * blockCount * 0.86;

      const w = this._acquire('wall', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-wall');
        sprite.setDepth(6);
        return { sprite, extras: [], lanes, color: this.cfg.colors.magenta, dir: 1 };
      });

      w.sprite.setPosition(x, y);
      w.sprite.setDisplaySize(width, 130);
      w.sprite.body.setSize(width / w.sprite.scaleX, 130 / w.sprite.scaleY);
      w.sprite.body.setVelocity(0, speed);
      w.lanes = lanes.slice();
      w.blockCount = blockCount;
      w.dir = Math.random() < 0.5 ? -1 : 1;
      w.speed = speed;
      w.width = width;

      this._recentBlockedLanes = lanes.slice();
    }

    _shiftContiguousBlock(w) {
      const maxStart = this.laneCount - w.blockCount;
      if (maxStart <= 0) return; // nowhere to shift
      let start = w.lanes[0] + w.dir;
      if (start < 0 || start > maxStart) {
        w.dir *= -1;
        start = w.lanes[0] + w.dir;
      }
      start = Phaser.Math.Clamp(start, 0, maxStart);
      const newLanes = [];
      for (let i = 0; i < w.blockCount; i++) newLanes.push(start + i);
      w.lanes = newLanes;

      const targetX = this._laneCenterX(newLanes);
      this.scene.tweens.add({
        targets: w.sprite,
        x: targetX,
        duration: this.cfg.laneShiftIntervalMs * 0.8,
        ease: 'Sine.InOut'
      });
    }

    // ---------------------------------------------------------------------
    // ELECTRIC GATE (multi-lane, toggles active/inactive)
    // ---------------------------------------------------------------------
    _spawnGate(speed) {
      const blockCount = this.laneCount > 2 ? Phaser.Math.Between(1, this.laneCount - 1) : 1;
      const lanes = this._pickContiguousBlock(blockCount);
      const x = this._laneCenterX(lanes);
      const y = -110;
      const width = this.laneWidth * blockCount * 0.82;

      const w = this._acquire('gate', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-gate');
        sprite.setDepth(6);
        const bolt = this.scene.add.image(x, y, 'obs-gate-bolt')
          .setBlendMode('ADD')
          .setDepth(7)
          .setTint(0xffffff);
        return { sprite, extras: [bolt], lanes, color: this.cfg.colors.cyan };
      });

      w.sprite.setPosition(x, y);
      w.sprite.setDisplaySize(width, 150);
      w.sprite.body.setSize(width / w.sprite.scaleX, 150 / w.sprite.scaleY);
      w.sprite.body.setVelocity(0, speed);
      w.lanes = lanes.slice();
      w.blockCount = blockCount;
      w.speed = speed;
      w.active = true;
      w.extras[0].setPosition(x, y);
      this._applyGateVisualState(w);

      this._recentBlockedLanes = lanes.slice();
    }

    _applyGateVisualState(w) {
      if (w.active) {
        w.sprite.setTint(0xffffff);
        w.sprite.setAlpha(1);
        if (w.extras[0]) w.extras[0].setAlpha(1);
      } else {
        w.sprite.setTint(0x335566);
        w.sprite.setAlpha(0.35);
        if (w.extras[0]) w.extras[0].setAlpha(0);
      }
    }

    // ---------------------------------------------------------------------
    // ROTATING LASER (single sweeping lane hitbox + decorative beam)
    // ---------------------------------------------------------------------
    _spawnLaser(speed) {
      const lane = Phaser.Math.Between(0, this.laneCount - 1);
      const x = this.laneX[lane];
      const y = -90;

      const w = this._acquire('laser', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-laser-core');
        sprite.setDepth(7).setBlendMode('ADD');
        const beam = this.scene.add.image(x, y, 'obs-laser-beam')
          .setBlendMode('ADD')
          .setDepth(6)
          .setAlpha(0.55)
          .setDisplaySize(this.scene.scale.width * 0.9, 14);
        return { sprite, extras: [beam], lanes: [lane], color: this.cfg.colors.danger, sweepDir: 1 };
      });

      w.sprite.setPosition(x, y);
      w.sprite.body.setSize(this.laneWidth * 0.42, 90);
      w.sprite.body.setVelocity(0, speed);
      w.lanes = [lane];
      w.laneIdx = lane;
      w.sweepDir = Math.random() < 0.5 ? -1 : 1;
      w.speed = speed;
      w.extras[0].setPosition(x, y).setAlpha(0.55);

      this._recentBlockedLanes = [lane];
    }

    _sweepLaser(w) {
      let next = w.laneIdx + w.sweepDir;
      if (next < 0 || next >= this.laneCount) {
        w.sweepDir *= -1;
        next = w.laneIdx + w.sweepDir;
      }
      w.laneIdx = Phaser.Math.Clamp(next, 0, this.laneCount - 1);
      w.lanes = [w.laneIdx];
      const targetX = this.laneX[w.laneIdx];

      this.scene.tweens.add({
        targets: w.sprite,
        x: targetX,
        duration: this.cfg.laserSweepIntervalMs * 0.55,
        ease: 'Cubic.InOut'
      });

      if (this.fx) this.fx.obstacleWarningFlash(targetX, w.sprite.y, this.cfg.colors.danger);
    }

    // ---------------------------------------------------------------------
    // FALLING BLOCK (telegraphed with a warning flash at spawn time)
    // ---------------------------------------------------------------------
    _spawnFallingBlock(speed) {
      const lane = this._randomLane(this._lastSpawnLane);
      this._lastSpawnLane = lane;
      const x = this.laneX[lane];
      const y = -70;

      const w = this._acquire('fallingBlock', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-fallblock');
        sprite.setDepth(6);
        return { sprite, extras: [], lanes: [lane], color: this.cfg.colors.gold };
      });

      w.sprite.setPosition(x, y);
      w.sprite.setAngle(0);
      w.sprite.body.setSize(64, 64);
      w.sprite.body.setVelocity(0, speed * 1.15);
      w.lanes = [lane];
      w.speed = speed;

      // Telegraph: quick warning pulse at the ground-row landing point so
      // players get a readable cue before the block arrives.
      if (this.fx) {
        this.fx.obstacleWarningFlash(x, this.groundY, this.cfg.colors.gold);
      }

      this._recentBlockedLanes = [lane];
    }

    // ---------------------------------------------------------------------
    // FIRE TRAP (toggles active/inactive; hazardous only when active)
    // ---------------------------------------------------------------------
    _spawnFire(speed) {
      const lane = this._randomLane(this._lastSpawnLane);
      this._lastSpawnLane = lane;
      const x = this.laneX[lane];
      const y = -70;

      const w = this._acquire('fire', () => {
        const sprite = this.scene.physics.add.sprite(x, y, 'obs-fire-base');
        sprite.setDepth(5);
        const flame = this.scene.add.image(x, y, 'obs-fire-flame')
          .setOrigin(0.5, 1)
          .setDepth(6)
          .setBlendMode('ADD');
        return { sprite, extras: [flame], lanes: [lane], color: this.cfg.colors.danger };
      });

      w.sprite.setPosition(x, y);
      w.sprite.body.setSize(this.laneWidth * 0.55, 26);
      w.sprite.body.setVelocity(0, speed);
      w.lanes = [lane];
      w.speed = speed;
      w.active = Math.random() < 0.5;
      w.extras[0].setPosition(x, y - 6);
      this._applyFireVisualState(w);

      this._recentBlockedLanes = [lane];
    }

    _applyFireVisualState(w) {
      const flame = w.extras[0];
      if (!flame) return;
      if (w.active) {
        this.scene.tweens.add({
          targets: flame,
          scaleY: 1,
          alpha: 1,
          duration: 160,
          ease: 'Quad.Out'
        });
      } else {
        this.scene.tweens.add({
          targets: flame,
          scaleY: 0.15,
          alpha: 0.25,
          duration: 220,
          ease: 'Quad.In'
        });
      }
    }

    // =====================================================================
    // COLLISION RESOLUTION
    // =====================================================================
    /** Arcade overlap processCallback — filters out already-handled hazards. */
    _overlapProcess(playerSprite, obstacleSprite) {
      const w = obstacleSprite.obstacleRef;
      return !!w && !w.processed;
    }

    _onOverlap(playerSprite, obstacleSprite) {
      const w = obstacleSprite.obstacleRef;
      if (!w || w.processed) return;

      const grounded = this.player.isGrounded && !this.player.isJumping;
      let hazardous = false;

      switch (w.type) {
        case 'spike':
        case 'ball':
          // Must jump over — hazardous only while grounded.
          hazardous = grounded;
          break;

        case 'fire':
          // Must jump over, but only when the flame is currently active.
          hazardous = w.active && grounded;
          break;

        case 'hole':
          // Opposite rule: must be airborne (jumping) to survive.
          if (grounded) {
            w.processed = true;
            w.hasHit = true;
            this.emit('playerHit', { type: w.type, survived: false, color: w.color });
            this.player.fallDeath();
            this.emit('playerDied');
            this._recycle(w);
          }
          return; // handled separately — skip generic resolution below

        case 'wall':
          // Solid regardless of jump — must be lane-dodged.
          hazardous = true;
          break;

        case 'gate':
          hazardous = !!w.active;
          break;

        case 'laser':
          hazardous = true;
          break;

        case 'fallingBlock':
          hazardous = true;
          break;

        default:
          hazardous = true;
          break;
      }

      if (!hazardous) return; // safe pass (e.g. jumped over spike) — no state change

      w.processed = true;
      w.hasHit = true;

      const survived = this.player.hitObstacle(w.color);
      this.emit('playerHit', { type: w.type, survived, color: w.color });

      if (!survived) {
        this.emit('playerDied');
      }

      this._recycle(w);
    }

    // =====================================================================
    // EXTERNAL QUERY HOOKS (used by CoinManager to avoid hazard lanes)
    // =====================================================================
    getRecentBlockedLanes() {
      return this._recentBlockedLanes.slice();
    }

    getOpenLanes() {
      const blocked = new Set(this._recentBlockedLanes);
      const open = [];
      for (let i = 0; i < this.laneCount; i++) {
        if (!blocked.has(i)) open.push(i);
      }
      return open.length ? open : [Math.floor(this.laneCount / 2)];
    }

    getCurrentTier() {
      return this._currentTier;
    }

    // =====================================================================
    // PAUSE / RESET
    // =====================================================================
    setPaused(paused) {
      this.paused = paused;
    }

    /** Full reset for a fresh run — recycles everything and resets timers. */
    reset() {
      for (let i = this._active.length - 1; i >= 0; i--) {
        this._recycle(this._active[i]);
      }
      this._elapsedMs = 0;
      this._spawnTimer = 0;
      this._currentTier = -1;
      this._lastSpawnLane = -1;
      this._recentBlockedLanes = [];
      this._setTier(0);
      this._scheduleNextSpawn();
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    destroy() {
      this._active.forEach((w) => {
        (w.extras || []).forEach((e) => e.destroy());
        if (w.sprite) w.sprite.destroy();
      });
      Object.values(this._pools).forEach((pool) => {
        pool.forEach((w) => {
          (w.extras || []).forEach((e) => e.destroy());
          if (w.sprite) w.sprite.destroy();
        });
      });
      this._active = [];
      this._pools = {};
      this.group.destroy(true, true);
      this.removeAllListeners();
    }
  }

  window.ObstacleManager = ObstacleManager;
})(window);