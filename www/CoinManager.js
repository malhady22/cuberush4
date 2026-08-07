/**
 * =====================================================================
 * CoinManager.js — Cube Rush
 * =====================================================================
 * Owns coin/gem spawning, pooling, magnet attraction, collection, and
 * the Combo Multiplier system.
 *
 * COMBO MODEL
 *  - Collecting a coin within `comboWindowMs` of the previous collect
 *    increments the combo counter; letting the window lapse (or
 *    crashing) resets it to 0.
 *  - Multiplier = 1 + floor(combo / comboStep), capped at
 *    maxComboMultiplier. The multiplier is applied to coin value AND
 *    reported to Player.setComboIntensity() so the energy-core glow
 *    ring pulses faster/brighter as the player chains pickups.
 *  - Fires 'comboChanged' on every multiplier tier change (not every
 *    single pickup) so UIScene/AudioManager only react to meaningful
 *    milestones (combo popup + rising pitch jingle).
 *
 * COORDINATION WITH OBSTACLEMANAGER
 *  - Before choosing a spawn lane, this manager asks
 *    `obstacleManager.getOpenLanes()` for lanes not currently occupied
 *    by a freshly-spawned hazard, biasing (not guaranteeing — hazards
 *    move) coin placement toward safe, reachable paths.
 *
 * MAGNET POWER
 *  - Every frame, if `player.getMagnetRadius() > 0`, any active coin
 *    within that radius is smoothly pulled toward the player's
 *    position instead of continuing its normal downward scroll.
 *
 * EVENTS EMITTED
 *  - 'coinCollected' ({ value, x, y, isGem, comboCount, multiplier })
 *  - 'comboChanged'  (multiplier:number)
 *  - 'comboBroken'   ()
 * =====================================================================
 */

(function (window) {
  'use strict';

  class CoinManager extends Phaser.Events.EventEmitter {
    /**
     * @param {Phaser.Scene} scene
     * @param {Player} player
     * @param {EffectsManager} fx
     * @param {AudioManager} [audio]
     * @param {ObstacleManager} [obstacleManager] - optional, for lane coordination
     */
    constructor(scene, player, fx, audio, obstacleManager) {
      super();
      this.scene = scene;
      this.player = player;
      this.fx = fx;
      this.audio = audio || null;
      this.obstacleManager = obstacleManager || null;

      this.cfg = this._resolveConfig();

      this.laneCount = player.laneCount;
      this.laneX = player.laneX;

      this._pool = [];
      this._active = [];

      this.group = this.scene.physics.add.group({ allowGravity: false });

      this.scene.physics.add.overlap(
        this.player.sprite,
        this.group,
        this._onOverlap,
        this._overlapProcess,
        this
      );

      // Combo state
      this.comboCount = 0;
      this.comboMultiplier = 1;
      this._lastCollectTime = 0;

      // Double coins power-up
      this.doubleCoinsActive = false;
      this._doubleCoinsTimer = null;

      this.paused = false;
      this._spawnTimer = 0;
      this._nextSpawnDelay = 0;

      this._ensureTextures();
      this._scheduleNextSpawn();
    }

    // =====================================================================
    // CONFIG RESOLUTION
    // =====================================================================
    _resolveConfig() {
      const C = window.Config || {};
      const colors = C.COLORS || {};
      const coinCfg = C.COINS || {};

      return {
        baseValue: coinCfg.baseValue || 1,
        gemValue: coinCfg.gemValue || 5,
        gemChance: coinCfg.gemChance !== undefined ? coinCfg.gemChance : 0.12,
        comboWindowMs: coinCfg.comboWindowMs || 1400,
        comboStep: coinCfg.comboStep || 5,
        maxComboMultiplier: coinCfg.maxComboMultiplier || 5,
        magnetPullSpeed: coinCfg.magnetPullSpeed || 12, // lerp factor per update
        spawnIntervalRange: coinCfg.spawnIntervalRange || { min: 650, max: 1100 },
        lineLength: coinCfg.lineLength || { min: 3, max: 6 },
        coinSpacing: coinCfg.coinSpacing || 62,
        arcChance: coinCfg.arcChance !== undefined ? coinCfg.arcChance : 0.25,
        fallSpeedMultiplier: coinCfg.fallSpeedMultiplier || 1, // relative to obstacle scroll speed
        baseFallbackSpeed: coinCfg.baseFallbackSpeed || 380,
        colors: {
          gold: colors.gold || 0xffd23f,
          cyan: colors.cyan || 0x00f0ff,
          mint: colors.mint || 0x39ff88,
          white: 0xffffff
        }
      };
    }

    // =====================================================================
    // TEXTURE GENERATION (runtime, cached — zero binary assets)
    // =====================================================================
    _ensureTextures() {
      const tm = this.scene.textures;

      // ---- Standard coin (gold disc with shine + rim) --------------------
      if (!tm.exists('coin-standard')) {
        const s = 44;
        const canvasTex = tm.createCanvas('coin-standard', s, s);
        const ctx = canvasTex.getContext();
        const grad = ctx.createRadialGradient(s * 0.35, s * 0.32, 2, s * 0.5, s * 0.5, s * 0.5);
        grad.addColorStop(0, '#fff6d0');
        grad.addColorStop(0.35, '#ffd23f');
        grad.addColorStop(1, '#a8720a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
        ctx.stroke();

        // Inner star-ish glyph for a "coin" read at small sizes.
        ctx.fillStyle = 'rgba(168,114,10,0.85)';
        ctx.font = `bold ${Math.round(s * 0.5)}px Orbitron, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', s / 2, s / 2 + 1);

        canvasTex.refresh();
      }

      // ---- Gem (bonus, higher value) ---------------------------------------
      if (!tm.exists('coin-gem')) {
        const s = 46;
        const canvasTex = tm.createCanvas('coin-gem', s, s);
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, s, s);
        grad.addColorStop(0, '#baffea');
        grad.addColorStop(0.5, '#39ff88');
        grad.addColorStop(1, '#0a8f4a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(s * 0.5, 2);
        ctx.lineTo(s - 2, s * 0.4);
        ctx.lineTo(s * 0.5, s - 2);
        ctx.lineTo(2, s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Facet lines
        ctx.beginPath();
        ctx.moveTo(s * 0.5, 2); ctx.lineTo(s * 0.5, s - 2);
        ctx.moveTo(2, s * 0.4); ctx.lineTo(s - 2, s * 0.4);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        canvasTex.refresh();
      }

      // ---- Faint pickup ring flash used on collection ------------------------
      if (!tm.exists('coin-pickup-ring')) {
        const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
        g.lineStyle(3, 0xffffff, 1);
        g.strokeCircle(16, 16, 14);
        g.generateTexture('coin-pickup-ring', 32, 32);
        g.destroy();
      }
    }

    // =====================================================================
    // SPAWN SCHEDULING
    // =====================================================================
    _scheduleNextSpawn() {
      const r = this.cfg.spawnIntervalRange;
      this._nextSpawnDelay = Phaser.Math.Between(r.min, r.max);
    }

    _getScrollSpeed() {
      if (this.obstacleManager && this.obstacleManager.getScrollSpeed) {
        return this.obstacleManager.getScrollSpeed() * this.cfg.fallSpeedMultiplier;
      }
      return this.cfg.baseFallbackSpeed;
    }

    _getPreferredLanes() {
      if (this.obstacleManager && this.obstacleManager.getOpenLanes) {
        return this.obstacleManager.getOpenLanes();
      }
      const all = [];
      for (let i = 0; i < this.laneCount; i++) all.push(i);
      return all;
    }

    // =====================================================================
    // MAIN UPDATE LOOP
    // =====================================================================
    update(time, delta) {
      if (this.paused) return;

      this._spawnTimer += delta;
      if (this._spawnTimer >= this._nextSpawnDelay) {
        this._spawnTimer = 0;
        this._spawnPattern();
        this._scheduleNextSpawn();
      }

      this._checkComboExpiry(time);

      const magnetRadius = this.player.getMagnetRadius ? this.player.getMagnetRadius() : 0;
      const playerPos = this.player.getPosition();
      const bottomLimit = this.scene.scale.height + 100;

      for (let i = this._active.length - 1; i >= 0; i--) {
        const c = this._active[i];
        const sprite = c.sprite;

        if (magnetRadius > 0) {
          const dx = playerPos.x - sprite.x;
          const dy = playerPos.y - sprite.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= magnetRadius) {
            // Smoothly lerp toward the player instead of falling normally.
            const t = Math.min(1, (this.cfg.magnetPullSpeed * delta) / 1000);
            sprite.body.setVelocity(0, 0);
            sprite.x += dx * t * 4;
            sprite.y += dy * t * 4;

            if (dist < 26) {
              this._collect(c);
              continue;
            }
          }
        }

        // Gentle idle bob + rotation for readability/juice.
        c.bobT += delta * 0.006;
        sprite.y += Math.sin(c.bobT) * 0.15;
        sprite.angle += delta * (c.isGem ? 0.12 : 0.08);

        if (sprite.y > bottomLimit) {
          this._recycle(c);
        }
      }
    }

    // =====================================================================
    // COMBO SYSTEM
    // =====================================================================
    _checkComboExpiry(time) {
      if (this.comboCount > 0 && time - this._lastCollectTime > this.cfg.comboWindowMs) {
        this._breakCombo();
      }
    }

    _breakCombo() {
      if (this.comboCount === 0 && this.comboMultiplier === 1) return;
      this.comboCount = 0;
      const changed = this.comboMultiplier !== 1;
      this.comboMultiplier = 1;
      if (this.player.setComboIntensity) this.player.setComboIntensity(1);
      if (changed) this.emit('comboChanged', 1);
      this.emit('comboBroken');
    }

    _registerCollectForCombo(time) {
      this.comboCount++;
      this._lastCollectTime = time;

      const newMultiplier = Math.min(
        this.cfg.maxComboMultiplier,
        1 + Math.floor(this.comboCount / this.cfg.comboStep)
      );

      if (newMultiplier !== this.comboMultiplier) {
        this.comboMultiplier = newMultiplier;
        if (this.player.setComboIntensity) this.player.setComboIntensity(newMultiplier);
        this.emit('comboChanged', newMultiplier);
      }
    }

    /** Called externally (e.g. GameScene on obstacle hit) to break combo. */
    breakComboExternal() {
      this._breakCombo();
    }

    getComboMultiplier() {
      return this.comboMultiplier;
    }

    // =====================================================================
    // DOUBLE COINS POWER-UP
    // =====================================================================
    activateDoubleCoins(durationMs) {
      this.doubleCoinsActive = true;
      if (this._doubleCoinsTimer) this._doubleCoinsTimer.remove(false);
      this._doubleCoinsTimer = this.scene.time.delayedCall(durationMs, () => {
        this.doubleCoinsActive = false;
      });
    }

    deactivateDoubleCoins() {
      this.doubleCoinsActive = false;
      if (this._doubleCoinsTimer) { this._doubleCoinsTimer.remove(false); this._doubleCoinsTimer = null; }
    }

    // =====================================================================
    // POOLING
    // =====================================================================
    _acquire(isGem) {
      let c = this._pool.pop();
      if (!c) {
        const sprite = this.scene.physics.add.sprite(0, 0, isGem ? 'coin-gem' : 'coin-standard');
        sprite.setDepth(8);
        c = { sprite, isGem: false, bobT: Math.random() * Math.PI * 2 };
        c.sprite.coinRef = c;
      }
      c.isGem = isGem;
      c.sprite.setTexture(isGem ? 'coin-gem' : 'coin-standard');
      c.sprite.setActive(true).setVisible(true);
      c.sprite.body.enable = true;
      c.sprite.body.setSize(isGem ? 30 : 28, isGem ? 30 : 28);
      c.sprite.setAlpha(1).setAngle(0).setScale(1);
      c.collected = false;
      c.bobT = Math.random() * Math.PI * 2;
      this.group.add(c.sprite);
      this._active.push(c);
      return c;
    }

    _recycle(c) {
      const idx = this._active.indexOf(c);
      if (idx !== -1) this._active.splice(idx, 1);
      c.sprite.body.enable = false;
      c.sprite.body.setVelocity(0, 0);
      c.sprite.setActive(false).setVisible(false);
      this._pool.push(c);
    }

    // =====================================================================
    // SPAWN PATTERNS
    // =====================================================================
    _spawnPattern() {
      const roll = Math.random();
      if (roll < this.cfg.arcChance && this.laneCount >= 3) {
        this._spawnArcPattern();
      } else {
        this._spawnLinePattern();
      }
    }

    /** A vertical line of coins down a single (preferably open) lane. */
    _spawnLinePattern() {
      const openLanes = this._getPreferredLanes();
      const lane = openLanes[Phaser.Math.Between(0, openLanes.length - 1)];
      const x = this.laneX[lane];
      const speed = this._getScrollSpeed();
      const count = Phaser.Math.Between(this.cfg.lineLength.min, this.cfg.lineLength.max);
      const spacing = this.cfg.coinSpacing;
      const startY = -60;

      for (let i = 0; i < count; i++) {
        const isGem = Math.random() < this.cfg.gemChance;
        const c = this._acquire(isGem);
        c.sprite.setPosition(x, startY - i * spacing);
        c.sprite.body.setVelocity(0, speed);
      }
    }

    /** A smooth left-to-right (or right-to-left) arc across all lanes. */
    _spawnArcPattern() {
      const speed = this._getScrollSpeed();
      const startY = -60;
      const spacingY = 46;
      const leftToRight = Math.random() < 0.5;
      const laneOrder = leftToRight
        ? Array.from({ length: this.laneCount }, (_, i) => i)
        : Array.from({ length: this.laneCount }, (_, i) => this.laneCount - 1 - i);

      // Arc uses a simple parabolic Y offset so the middle lane's coins
      // sit slightly higher, reading as a graceful curve as it scrolls in.
      const mid = (laneOrder.length - 1) / 2;

      laneOrder.forEach((lane, i) => {
        const isGem = Math.random() < this.cfg.gemChance * 0.6;
        const c = this._acquire(isGem);
        const arcOffset = -Math.pow(i - mid, 2) * 10;
        c.sprite.setPosition(this.laneX[lane], startY - i * spacingY + arcOffset);
        c.sprite.body.setVelocity(0, speed);
      });
    }

    // =====================================================================
    // COLLISION / COLLECTION
    // =====================================================================
    _overlapProcess(playerSprite, coinSprite) {
      const c = coinSprite.coinRef;
      return !!c && !c.collected;
    }

    _onOverlap(playerSprite, coinSprite) {
      const c = coinSprite.coinRef;
      if (!c || c.collected) return;
      this._collect(c);
    }

    _collect(c) {
      if (c.collected) return;
      c.collected = true;

      const time = this.scene.time.now;
      this._registerCollectForCombo(time);

      let value = c.isGem ? this.cfg.gemValue : this.cfg.baseValue;
      value *= this.comboMultiplier;
      if (this.doubleCoinsActive) value *= 2;
      value = Math.round(value);

      const x = c.sprite.x;
      const y = c.sprite.y;
      const color = c.isGem ? this.cfg.colors.mint : this.cfg.colors.gold;

      // Persist coins immediately through Storage.js.
      if (window.CubeRushStorage && window.CubeRushStorage.addCoins) {
        window.CubeRushStorage.addCoins(value);
      }

      // Visual/audio feedback.
      if (this.fx) {
        this.fx.coinCollectEffect(x, y);
        this.fx.floatingText(x, y, `+${value}`, { color, fontSize: c.isGem ? 30 : 24 });

        const ring = this.scene.add.image(x, y, 'coin-pickup-ring')
          .setTint(color)
          .setBlendMode('ADD')
          .setScale(0.6)
          .setAlpha(0.9)
          .setDepth(9);
        this.scene.tweens.add({
          targets: ring,
          scale: 1.8,
          alpha: 0,
          duration: 300,
          ease: 'Cubic.Out',
          onComplete: () => ring.destroy()
        });

        if (this.comboMultiplier > 1 && this.comboCount % this.cfg.comboStep === 0) {
          this.fx.comboPopup(x, y - 30, this.comboMultiplier);
        }
      }

      if (this.audio) {
        if (this.audio.playCombo && this.comboMultiplier > 1) {
          this.audio.playCombo(this.comboMultiplier);
        } else if (this.audio.playCoin) {
          this.audio.playCoin();
        }
      }

      this.emit('coinCollected', {
        value,
        x,
        y,
        isGem: c.isGem,
        comboCount: this.comboCount,
        multiplier: this.comboMultiplier
      });

      this._recycle(c);
    }

    // =====================================================================
    // PAUSE / RESET
    // =====================================================================
    setPaused(paused) {
      this.paused = paused;
    }

    reset() {
      for (let i = this._active.length - 1; i >= 0; i--) {
        this._recycle(this._active[i]);
      }
      this.comboCount = 0;
      this.comboMultiplier = 1;
      this._lastCollectTime = 0;
      this.deactivateDoubleCoins();
      this._spawnTimer = 0;
      this._scheduleNextSpawn();
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    destroy() {
      if (this._doubleCoinsTimer) this._doubleCoinsTimer.remove(false);
      this._active.forEach((c) => c.sprite.destroy());
      this._pool.forEach((c) => c.sprite.destroy());
      this._active = [];
      this._pool = [];
      this.group.destroy(true, true);
      this.removeAllListeners();
    }
  }

  window.CoinManager = CoinManager;
})(window);