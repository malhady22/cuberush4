/**
 * =====================================================================
 * PowerUpManager.js — Cube Rush
 * =====================================================================
 * Owns power-up pickup spawning/pooling and activation for the 4
 * in-run powers: Coin Magnet, Shield, Slow Motion, Double Coins.
 *
 * ACTIVATION MODEL
 *  - Magnet / Shield are delegated to Player.js (it owns the visual
 *    rings + collision/attraction radius logic).
 *  - Double Coins is delegated to CoinManager.js (it owns value math).
 *  - Slow Motion is owned directly here via
 *    scene.physics.world.timeScale + scene.time.timeScale, paired with
 *    EffectsManager.slowMoVignette() for the cool blue screen tint.
 *
 * DURATION TRACKING
 *  - Active power-up countdowns are decremented using the RAW,
 *    unscaled frame delta (not affected by time.timeScale), so a
 *    Slow-Motion power's own duration reads as real-world seconds
 *    rather than being stretched by the slowdown it creates.
 *  - Collecting the same power-up again while it's active EXTENDS the
 *    remaining time (capped at a sane max) rather than restarting or
 *    stacking multiplicatively.
 *
 * EVENTS EMITTED
 *  - 'powerUpCollected' ({ type, x, y })
 *  - 'powerUpActivated' ({ type, duration })
 *  - 'powerUpExpired'   ({ type })
 * =====================================================================
 */

(function (window) {
  'use strict';

  const TYPES = ['magnet', 'shield', 'slowmo', 'doubleCoins'];

  class PowerUpManager extends Phaser.Events.EventEmitter {
    /**
     * @param {Phaser.Scene} scene
     * @param {Player} player
     * @param {EffectsManager} fx
     * @param {AudioManager} [audio]
     * @param {CoinManager} coinManager
     * @param {ObstacleManager} [obstacleManager] - for open-lane coordination
     */
    constructor(scene, player, fx, audio, coinManager, obstacleManager) {
      super();
      this.scene = scene;
      this.player = player;
      this.fx = fx;
      this.audio = audio || null;
      this.coinManager = coinManager;
      this.obstacleManager = obstacleManager || null;

      this.cfg = this._resolveConfig();

      this.laneCount = player.laneCount;
      this.laneX = player.laneX;

      this._pool = [];
      this._active = []; // on-screen pickups
      this._activePowers = {}; // type -> { remaining, duration }

      this.group = this.scene.physics.add.group({ allowGravity: false });

      this.scene.physics.add.overlap(
        this.player.sprite,
        this.group,
        this._onOverlap,
        this._overlapProcess,
        this
      );

      this.paused = false;
      this._spawnTimer = 0;
      this._nextSpawnDelay = 0;
      this._slowMoActive = false;

      this._ensureTextures();
      this._scheduleNextSpawn();
    }

    // =====================================================================
    // CONFIG RESOLUTION
    // =====================================================================
    _resolveConfig() {
      const C = window.Config || {};
      const colors = C.COLORS || {};
      const pu = C.POWERUPS || {};

      return {
        spawnIntervalRange: pu.pickupSpawnIntervalRange || { min: 9000, max: 16000 },
        maxConcurrentOnScreen: pu.maxConcurrentOnScreen || 1,
        maxActiveExtend: pu.maxActiveExtendMs || 20000,
        fallSpeedMultiplier: pu.pickupFallSpeedMultiplier || 1,
        baseFallbackSpeed: pu.baseFallbackSpeed || 380,
        durations: {
          magnet: pu.magnetDurationMs || 8000,
          shield: pu.shieldDurationMs || 10000,
          slowmo: pu.slowMoDurationMs || 6000,
          doubleCoins: pu.doubleCoinsDurationMs || 10000
        },
        slowMoFactor: pu.slowMoFactor || 0.45,
        weights: pu.typeWeights || { magnet: 25, shield: 25, slowmo: 25, doubleCoins: 25 },
        colors: {
          magnet: colors.gold || 0xffd23f,
          shield: colors.cyan || 0x00f0ff,
          slowmo: colors.magenta || 0xff2e9a,
          doubleCoins: colors.mint || 0x39ff88,
          white: 0xffffff
        }
      };
    }

    // =====================================================================
    // TEXTURE GENERATION (runtime, cached — zero binary assets)
    // =====================================================================
    _ensureTextures() {
      const tm = this.scene.textures;
      const s = 56;

      // Shared pickup base: a soft rounded diamond badge behind each icon.
      if (!tm.exists('pu-badge')) {
        const canvasTex = tm.createCanvas('pu-badge', s, s);
        const ctx = canvasTex.getContext();
        const grad = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0.15)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();
        canvasTex.refresh();
      }

      // Magnet icon — horseshoe shape.
      if (!tm.exists('pu-icon-magnet')) {
        const canvasTex = tm.createCanvas('pu-icon-magnet', s, s);
        const ctx = canvasTex.getContext();
        ctx.strokeStyle = '#3a2a00';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(s / 2, s / 2 + 4, 14, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        // Red/blue tips
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(s / 2 - 18, s / 2 - 6, 8, 14);
        ctx.fillStyle = '#3a6bff';
        ctx.fillRect(s / 2 + 10, s / 2 - 6, 8, 14);
        canvasTex.refresh();
      }

      // Shield icon.
      if (!tm.exists('pu-icon-shield')) {
        const canvasTex = tm.createCanvas('pu-icon-shield', s, s);
        const ctx = canvasTex.getContext();
        ctx.fillStyle = '#00596b';
        ctx.beginPath();
        ctx.moveTo(s / 2, 8);
        ctx.bezierCurveTo(s * 0.75, 14, s * 0.82, 16, s * 0.82, 16);
        ctx.lineTo(s * 0.82, s * 0.55);
        ctx.bezierCurveTo(s * 0.82, s * 0.78, s / 2, s - 8, s / 2, s - 8);
        ctx.bezierCurveTo(s / 2, s - 8, s * 0.18, s * 0.78, s * 0.18, s * 0.55);
        ctx.lineTo(s * 0.18, 16);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Checkmark
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s * 0.34, s * 0.5);
        ctx.lineTo(s * 0.46, s * 0.62);
        ctx.lineTo(s * 0.68, s * 0.36);
        ctx.stroke();
        canvasTex.refresh();
      }

      // Slow-mo icon — clock/hourglass hybrid.
      if (!tm.exists('pu-icon-slowmo')) {
        const canvasTex = tm.createCanvas('pu-icon-slowmo', s, s);
        const ctx = canvasTex.getContext();
        ctx.strokeStyle = '#6b0038';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s / 2, s / 2);
        ctx.lineTo(s / 2, s / 2 - 11);
        ctx.moveTo(s / 2, s / 2);
        ctx.lineTo(s / 2 + 8, s / 2 + 4);
        ctx.stroke();
        // small motion arcs
        ctx.strokeStyle = 'rgba(107,0,56,0.5)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, 22, Math.PI * 1.15, Math.PI * 1.4);
        ctx.stroke();
        canvasTex.refresh();
      }

      // Double coins icon — "x2" over a coin stack.
      if (!tm.exists('pu-icon-doublecoins')) {
        const canvasTex = tm.createCanvas('pu-icon-doublecoins', s, s);
        const ctx = canvasTex.getContext();
        ctx.fillStyle = '#0a5c34';
        ctx.font = `bold ${Math.round(s * 0.42)}px Orbitron, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('x2', s / 2, s / 2 + 2);
        canvasTex.refresh();
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

    _pickType() {
      const weights = this.cfg.weights;
      let total = 0;
      TYPES.forEach((t) => { total += weights[t] || 0; });
      let roll = Math.random() * total;
      for (const t of TYPES) {
        roll -= (weights[t] || 0);
        if (roll <= 0) return t;
      }
      return TYPES[0];
    }

    // =====================================================================
    // MAIN UPDATE LOOP
    // =====================================================================
    /**
     * @param {number} time
     * @param {number} delta - RAW (unscaled) ms since last frame. GameScene
     *                         must pass the true delta here, not one
     *                         already multiplied by time.timeScale, so
     *                         power-up countdowns stay real-time accurate.
     */
    update(time, delta) {
      if (this.paused) return;

      this._spawnTimer += delta;
      if (this._spawnTimer >= this._nextSpawnDelay) {
        this._spawnTimer = 0;
        if (this._active.length < this.cfg.maxConcurrentOnScreen) {
          this._spawnPickup();
        }
        this._scheduleNextSpawn();
      }

      const bottomLimit = this.scene.scale.height + 100;
      for (let i = this._active.length - 1; i >= 0; i--) {
        const p = this._active[i];
        p.sprite.angle = Math.sin(time * 0.003 + p.seed) * 8;
        p.badge.setPosition(p.sprite.x, p.sprite.y);
        p.badge.angle += delta * 0.03;

        if (p.sprite.y > bottomLimit) {
          this._recycle(p);
        }
      }

      this._updateActivePowerTimers(delta);
    }

    _updateActivePowerTimers(rawDelta) {
      Object.keys(this._activePowers).forEach((type) => {
        const entry = this._activePowers[type];
        entry.remaining -= rawDelta;
        if (entry.remaining <= 0) {
          delete this._activePowers[type];
          this._deactivate(type);
          this.emit('powerUpExpired', { type });
        }
      });
    }

    // =====================================================================
    // POOLING
    // =====================================================================
    _acquire(type) {
      let p = this._pool.pop();
      if (!p) {
        const sprite = this.scene.physics.add.sprite(0, 0, `pu-icon-${type.toLowerCase()}`);
        sprite.setDepth(8);
        const badge = this.scene.add.image(0, 0, 'pu-badge')
          .setBlendMode('ADD')
          .setDepth(7);
        p = { sprite, badge, seed: Math.random() * 10 };
        p.sprite.powerUpRef = p;
      }
      p.type = type;
      p.sprite.setTexture(`pu-icon-${this._textureSuffix(type)}`);
      p.sprite.setActive(true).setVisible(true);
      p.sprite.body.enable = true;
      p.sprite.body.setSize(40, 40);
      p.sprite.setAlpha(1).setScale(1);
      p.badge.setVisible(true).setTint(this.cfg.colors[type] || 0xffffff);
      p.collected = false;
      this.group.add(p.sprite);
      this._active.push(p);
      return p;
    }

    _textureSuffix(type) {
      // Map camelCase config keys to the flat texture-key naming used above.
      const map = { magnet: 'magnet', shield: 'shield', slowmo: 'slowmo', doubleCoins: 'doublecoins' };
      return map[type] || 'magnet';
    }

    _recycle(p) {
      const idx = this._active.indexOf(p);
      if (idx !== -1) this._active.splice(idx, 1);
      p.sprite.body.enable = false;
      p.sprite.body.setVelocity(0, 0);
      p.sprite.setActive(false).setVisible(false);
      p.badge.setVisible(false);
      this._pool.push(p);
    }

    // =====================================================================
    // SPAWNING
    // =====================================================================
    _spawnPickup() {
      const type = this._pickType();
      const openLanes = this._getPreferredLanes();
      const lane = openLanes[Phaser.Math.Between(0, openLanes.length - 1)];
      const x = this.laneX[lane];
      const y = -70;
      const speed = this._getScrollSpeed();

      const p = this._acquire(type);
      p.sprite.setPosition(x, y);
      p.sprite.body.setVelocity(0, speed);
      p.badge.setPosition(x, y).setScale(1);

      if (this.fx) this.fx.obstacleWarningFlash(x, -20, this.cfg.colors[type]);
    }

    // =====================================================================
    // COLLISION / COLLECTION
    // =====================================================================
    _overlapProcess(playerSprite, pickupSprite) {
      const p = pickupSprite.powerUpRef;
      return !!p && !p.collected;
    }

    _onOverlap(playerSprite, pickupSprite) {
      const p = pickupSprite.powerUpRef;
      if (!p || p.collected) return;
      p.collected = true;

      const x = p.sprite.x;
      const y = p.sprite.y;
      const type = p.type;

      this.emit('powerUpCollected', { type, x, y });
      this.activate(type);
      this._recycle(p);
    }

    // =====================================================================
    // ACTIVATION / DEACTIVATION
    // =====================================================================
    /**
     * Activates (or extends) a power-up. Safe to call externally
     * (e.g. from LuckySpinScene / DailyRewardScene granting a free
     * power-up for the next run).
     */
    activate(type, overrideDurationMs) {
      const baseDuration = overrideDurationMs || this.cfg.durations[type] || 8000;

      if (this._activePowers[type]) {
        // Extend rather than restart, capped to avoid infinite stacking.
        this._activePowers[type].remaining = Math.min(
          this._activePowers[type].remaining + baseDuration,
          this.cfg.maxActiveExtend
        );
        this._activePowers[type].duration = this._activePowers[type].remaining;
      } else {
        this._activePowers[type] = { remaining: baseDuration, duration: baseDuration };
        this._applyActivation(type, baseDuration);
      }

      if (this.fx) {
        const pos = this.player.getPosition();
        this.fx.powerUpBurst(pos.x, pos.y, this.cfg.colors[type]);
      }
      if (this.audio && this.audio.playPowerUp) this.audio.playPowerUp();

      this.emit('powerUpActivated', { type, duration: this._activePowers[type].remaining });
    }

    _applyActivation(type, durationMs) {
      switch (type) {
        case 'magnet':
          this.player.activateMagnet(durationMs);
          break;
        case 'shield':
          this.player.activateShield(durationMs);
          break;
        case 'doubleCoins':
          if (this.coinManager) this.coinManager.activateDoubleCoins(durationMs);
          break;
        case 'slowmo':
          this._activateSlowMo();
          break;
        default:
          break;
      }
    }

    _deactivate(type) {
      switch (type) {
        case 'magnet':
          this.player.deactivateMagnet();
          break;
        case 'shield':
          this.player.deactivateShield();
          break;
        case 'doubleCoins':
          if (this.coinManager) this.coinManager.deactivateDoubleCoins();
          break;
        case 'slowmo':
          this._deactivateSlowMo();
          break;
        default:
          break;
      }
    }

    _activateSlowMo() {
      if (this._slowMoActive) return;
      this._slowMoActive = true;
      const factor = this.cfg.slowMoFactor;
      this.scene.physics.world.timeScale = factor;
      this.scene.time.timeScale = factor;
      if (this.fx) this.fx.slowMoVignette(true);
    }

    _deactivateSlowMo() {
      if (!this._slowMoActive) return;
      this._slowMoActive = false;
      this.scene.physics.world.timeScale = 1;
      this.scene.time.timeScale = 1;
      if (this.fx) this.fx.slowMoVignette(false);
    }

    // =====================================================================
    // EXTERNAL QUERY (for UIScene HUD power-up timer icons)
    // =====================================================================
    /**
     * @returns {Array<{type:string, remaining:number, duration:number, progress:number}>}
     */
    getActivePowerUps() {
      return Object.keys(this._activePowers).map((type) => {
        const e = this._activePowers[type];
        return {
          type,
          remaining: Math.max(0, e.remaining),
          duration: e.duration,
          progress: Phaser.Math.Clamp(e.remaining / e.duration, 0, 1)
        };
      });
    }

    isActive(type) {
      return !!this._activePowers[type];
    }

    /**
     * Grants a power-up immediately without requiring an on-screen
     * pickup — used by DailyRewardScene / LuckySpinScene rewards that
     * say "Start your next run with a Shield", etc. Should be called
     * right after GameScene starts (post player-creation).
     */
    grantStartupPowerUp(type, overrideDurationMs) {
      this.activate(type, overrideDurationMs);
    }

    // =====================================================================
    // PAUSE / RESET
    // =====================================================================
    setPaused(paused) {
      this.paused = paused;
    }

    /** Full reset for a fresh run — recycles pickups, clears active powers. */
    reset() {
      for (let i = this._active.length - 1; i >= 0; i--) {
        this._recycle(this._active[i]);
      }
      Object.keys(this._activePowers).forEach((type) => this._deactivate(type));
      this._activePowers = {};
      this._slowMoActive = false;
      this.scene.physics.world.timeScale = 1;
      this.scene.time.timeScale = 1;
      this._spawnTimer = 0;
      this._scheduleNextSpawn();
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    destroy() {
      this._active.forEach((p) => { p.sprite.destroy(); p.badge.destroy(); });
      this._pool.forEach((p) => { p.sprite.destroy(); p.badge.destroy(); });
      this._active = [];
      this._pool = [];
      this._activePowers = {};

      // Defensive reset in case the scene is torn down mid slow-mo.
      if (this.scene.physics && this.scene.physics.world) {
        this.scene.physics.world.timeScale = 1;
      }
      this.scene.time.timeScale = 1;

      this.group.destroy(true, true);
      this.removeAllListeners();
    }
  }

  window.PowerUpManager = PowerUpManager;
})(window);