/**
 * Player.js
 * ---------------------------------------------------------------------------
 * The player-controlled "energy core" cube for Cube Rush.
 *
 * Responsibilities:
 *   - Lane-based left/right movement (3-lane track, smooth tween slide)
 *   - Jump / gravity arc with coyote-time-friendly ground checks
 *   - Visual composition: beveled cube body + rotating internal gradient
 *     + outer bloom/glow ring (driven by EffectsManager.comboGlowPulse)
 *   - Skin application (color/glow swap from Shop selection)
 *   - Power-up state machine: Shield, Coin Magnet, Slow-Motion, Double Coins
 *   - Collision surface (hitbox) that GameScene / ObstacleManager query
 *
 * Depends on:
 *   - Phaser 3
 *   - window.CONFIG (Config.js)            — lane geometry, physics tuning
 *   - window.EffectsManager (Effects.js)   — trail, glow, jump dust, bursts
 *   - window.CubeRushAudio (AudioManager.js) — jump/crash/powerup SFX
 *
 * Usage (inside GameScene):
 *   this.player = new Player(this, { skinId: Storage.getSelectedSkin() });
 *   this.player.moveLeft();
 *   this.player.moveRight();
 *   this.player.jump();
 *   this.player.update(delta);
 * ---------------------------------------------------------------------------
 */

class Player extends Phaser.Events.EventEmitter {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} options { skinId, laneCount, startLane }
   */
  constructor(scene, options = {}) {
    super();
    this.scene = scene;

    const cfg = (window.CONFIG && window.CONFIG.PLAYER) || {};
    const trackCfg = (window.CONFIG && window.CONFIG.TRACK) || {};

    // ---- Lane / track geometry ------------------------------------------
    this.laneCount = options.laneCount || trackCfg.LANE_COUNT || 3;
    this.laneWidth = trackCfg.LANE_WIDTH || Math.floor(this.scene.scale.width / this.laneCount);
    this.laneCenterY = trackCfg.PLAYER_Y || Math.floor(this.scene.scale.height * 0.78);
    this.currentLane = options.startLane != null ? options.startLane : Math.floor(this.laneCount / 2);

    // ---- Physics tuning ---------------------------------------------------
    this.laneSlideDuration = cfg.LANE_SLIDE_MS || 140; // ms to tween between lanes
    this.jumpHeight = cfg.JUMP_HEIGHT || 160; // px
    this.jumpDuration = cfg.JUMP_DURATION_MS || 520; // ms, full up+down arc
    this.groundY = this.laneCenterY;
    this.cubeSize = cfg.CUBE_SIZE || 56;

    // ---- State --------------------------------------------------------
    this.isJumping = false;
    this.isSliding = false; // lane-change tween in progress
    this.isDead = false;
    this.isInvulnerable = false; // brief post-hit grace window
    this.rotationSpeed = cfg.CORE_ROTATION_SPEED || 0.0035; // radians/ms for internal gradient spin

    // Power-up state machine — each entry tracks whether it's active and
    // its remaining duration; PowerUpManager.js drives activate/expire.
    this.powerUps = {
      shield: { active: false, timer: 0 },
      magnet: { active: false, timer: 0, radius: cfg.MAGNET_RADIUS || 140 },
      slowMotion: { active: false, timer: 0 },
      doubleCoins: { active: false, timer: 0 },
    };

    this.skinId = options.skinId || 'classic';
    // CONFIG.SKINS is an array of skin objects (each with an .id field),
    // not a map keyed by id — see _findSkin() below for the lookup.
    this.skins = (window.CONFIG && window.CONFIG.SKINS) || [];

    this._buildVisuals();
    this._applySkin(this.skinId);

    // Effects: motion trail + combo-reactive glow ring
    this.fx = scene.fxManager || (scene.fxManager = new window.EffectsManager(scene));
    this.fx.trailStart(this.body, { color: this._currentColor() });
    this.fx.comboGlowPulse(this.glowRing, 1);

    // Physics body (arcade) for obstacle overlap checks in GameScene.
    scene.physics.add.existing(this.container);
    this.container.body.setSize(this.cubeSize * 0.7, this.cubeSize * 0.7);
    this.container.body.setOffset(-this.cubeSize * 0.35, -this.cubeSize * 0.35);
    this.container.body.setAllowGravity(false); // we hand-animate the jump arc
    this.container.body.setImmovable(true);
  }

  // -------------------------------------------------------------------
  // Visual construction
  // -------------------------------------------------------------------

  _laneX(laneIndex) {
    const trackLeft = (this.scene.scale.width - this.laneWidth * this.laneCount) / 2;
    return trackLeft + this.laneWidth * laneIndex + this.laneWidth / 2;
  }

  _buildVisuals() {
    const x = this._laneX(this.currentLane);
    const y = this.groundY;

    this.container = this.scene.add.container(x, y);
    this.container.setDepth(500);

    // Outer bloom ring — pulses with combo via EffectsManager.comboGlowPulse.
    this.glowRing = this.scene.add.circle(0, 0, this.cubeSize * 0.75, 0x00f0ff, 0.35);
    this.glowRing.setBlendMode(Phaser.BlendModes.ADD);

    // Beveled square body — built from a graphics texture so it can be
    // tinted per-skin without regenerating geometry each time.
    this.body = this.scene.add.rectangle(0, 0, this.cubeSize, this.cubeSize, 0x00f0ff, 1);
    this.body.setStrokeStyle(3, 0xffffff, 0.9);

    // Internal gradient core — a smaller inset square that rotates
    // continuously to sell the "energy core" look described in the
    // Cube Rush art direction (rotating internal gradient).
    this.core = this.scene.add.rectangle(0, 0, this.cubeSize * 0.55, this.cubeSize * 0.55, 0xff2e9a, 0.85);

    this.container.add([this.glowRing, this.body, this.core]);

    // Shield visual ring (hidden until Shield power-up activates).
    this.shieldRing = this.scene.add.circle(0, 0, this.cubeSize * 0.95, 0x00f0ff, 0);
    this.shieldRing.setStrokeStyle(3, 0x00f0ff, 0.9);
    this.shieldRing.setVisible(false);
    this.container.add(this.shieldRing);
  }

  /** CONFIG.SKINS is an array — look up by .id, not by array index. */
  _findSkin(skinId) {
    if (!Array.isArray(this.skins)) return null;
    return this.skins.find((s) => s.id === skinId) || null;
  }

  _currentColor() {
    const skin = this._findSkin(this.skinId);
    return (skin && skin.primaryColor) || 0x00f0ff;
  }

  /** Applies a skin's color + glow settings to the cube visuals. */
  _applySkin(skinId) {
    const skin = this._findSkin(skinId) || { primaryColor: 0x00f0ff, secondaryColor: 0xff2e9a, glowColor: 0x00f0ff };
    this.skinId = skinId;

    this.body.setFillStyle(skin.primaryColor, 1);
    this.core.setFillStyle(skin.secondaryColor, 0.85);
    this.glowRing.setFillStyle(skin.glowColor, 0.35);

    if (this.fx) {
      this.fx.trailSetColor(this.body, skin.glowColor);
    }
  }

  /** Public: swap skins mid-run isn't normally allowed, but exposed for Shop preview. */
  setSkin(skinId) {
    this._applySkin(skinId);
  }

  // -------------------------------------------------------------------
  // Movement — lanes
  // -------------------------------------------------------------------

  moveLeft() {
    if (this.isDead) return;
    this._changeLane(-1);
  }

  moveRight() {
    if (this.isDead) return;
    this._changeLane(1);
  }

  _changeLane(direction) {
    const targetLane = Phaser.Math.Clamp(this.currentLane + direction, 0, this.laneCount - 1);
    if (targetLane === this.currentLane) {
      // Bumped the track edge — small denied-move feedback.
      this._nudgeFeedback(direction);
      return;
    }

    this.currentLane = targetLane;
    this.isSliding = true;

    const targetX = this._laneX(this.currentLane);
    this.scene.tweens.add({
      targets: this.container,
      x: targetX,
      duration: this.laneSlideDuration,
      ease: 'Cubic.Out',
      onComplete: () => {
        this.isSliding = false;
      },
    });

    // Slight roll/tilt on the body for tactile feedback, settles back to 0.
    this.scene.tweens.add({
      targets: this.body,
      angle: direction * 12,
      duration: this.laneSlideDuration * 0.5,
      yoyo: true,
      ease: 'Sine.InOut',
    });
  }

  /** Tiny shake when the player tries to move past the track edge. */
  _nudgeFeedback(direction) {
    this.scene.tweens.add({
      targets: this.container,
      x: this.container.x + direction * 8,
      duration: 60,
      yoyo: true,
      ease: 'Quad.Out',
    });
  }

  // -------------------------------------------------------------------
  // Movement — jump
  // -------------------------------------------------------------------

  jump() {
    if (this.isDead || this.isJumping) return;
    this.isJumping = true;
    this.emit('jumped'); // GameScene listens for this to feed MissionManager's jump-count tracking

    if (window.CubeRushAudio) window.CubeRushAudio.playJump();
    if (this.fx) this.fx.jumpDust(this.container.x, this.groundY + this.cubeSize / 2);

    // Squash on takeoff, stretch mid-air, settle on landing — classic
    // hyper-casual squash & stretch for readability at a glance.
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1.15,
      scaleY: 0.8,
      duration: 80,
      yoyo: true,
      ease: 'Quad.Out',
    });

    this.scene.tweens.add({
      targets: this.container,
      y: this.groundY - this.jumpHeight,
      duration: this.jumpDuration / 2,
      ease: 'Quad.Out',
      yoyo: true,
      onYoyo: () => {
        // apex reached, now descending
      },
      onComplete: () => {
        this.isJumping = false;
        this.container.y = this.groundY;
        if (this.fx) this.fx.landDust(this.container.x, this.groundY + this.cubeSize / 2);

        this.scene.tweens.add({
          targets: this.container,
          scaleX: 1.1,
          scaleY: 0.9,
          duration: 70,
          yoyo: true,
          ease: 'Quad.Out',
        });
      },
    });
  }

  /** True while airborne — ObstacleManager uses this to let ground hazards pass under. */
  get isAirborne() {
    return this.isJumping;
  }

  // -------------------------------------------------------------------
  // Power-ups
  // -------------------------------------------------------------------

  /**
   * Activates a power-up for a duration (ms). Called by PowerUpManager
   * when the player collects a power-up pickup.
   */
  activatePowerUp(type, durationMs) {
    if (!this.powerUps[type]) return;

    this.powerUps[type].active = true;
    this.powerUps[type].timer = durationMs;

    if (window.CubeRushAudio) window.CubeRushAudio.playPowerUp();
    if (this.fx) {
      const colorMap = {
        shield: 0x00f0ff,
        magnet: 0xffd23f,
        slowMotion: 0x39ff88,
        doubleCoins: 0xff2e9a,
      };
      this.fx.powerUpBurst(this.container.x, this.container.y, colorMap[type]);
    }

    if (type === 'shield') {
      this.shieldRing.setVisible(true);
      this.scene.tweens.add({
        targets: this.shieldRing,
        alpha: { from: 0.9, to: 0.4 },
        duration: 450,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** Called every frame (or fixed step) by GameScene to tick down timers. */
  updatePowerUps(deltaMs) {
    Object.keys(this.powerUps).forEach((key) => {
      const p = this.powerUps[key];
      if (!p.active) return;
      p.timer -= deltaMs;
      if (p.timer <= 0) {
        this._deactivatePowerUp(key);
      }
    });
  }

  _deactivatePowerUp(type) {
    this.powerUps[type].active = false;
    this.powerUps[type].timer = 0;

    if (type === 'shield') {
      this.scene.tweens.killTweensOf(this.shieldRing);
      this.shieldRing.setVisible(false);
      this.shieldRing.setAlpha(0.9);
    }
  }

  hasShield() {
    return this.powerUps.shield.active;
  }

  hasMagnet() {
    return this.powerUps.magnet.active;
  }

  magnetRadius() {
    return this.powerUps.magnet.radius;
  }

  hasSlowMotion() {
    return this.powerUps.slowMotion.active;
  }

  hasDoubleCoins() {
    return this.powerUps.doubleCoins.active;
  }

  /**
   * Consumes the shield to absorb one hit instead of dying. Returns true
   * if the hit was absorbed (caller should skip death logic).
   */
  consumeShieldIfAvailable() {
    if (!this.powerUps.shield.active) return false;
    this._deactivatePowerUp('shield');
    if (this.fx) this.fx.shieldHitPulse(this.container.x, this.container.y);
    if (window.CubeRushAudio) window.CubeRushAudio.playCrash();
    this._grantInvulnerability(1000);
    return true;
  }

  _grantInvulnerability(durationMs) {
    this.isInvulnerable = true;
    this.scene.tweens.add({
      targets: this.container,
      alpha: { from: 1, to: 0.35 },
      duration: 90,
      yoyo: true,
      repeat: Math.floor(durationMs / 180),
    });
    this.scene.time.delayedCall(durationMs, () => {
      this.isInvulnerable = false;
      this.container.alpha = 1;
    });
  }

  // -------------------------------------------------------------------
  // Combo reaction (called by GameScene/CoinManager on combo change)
  // -------------------------------------------------------------------

  onComboChanged(comboCount) {
    if (this.fx) this.fx.comboGlowPulse(this.glowRing, comboCount);
  }

  // -------------------------------------------------------------------
  // Death
  // -------------------------------------------------------------------

  /**
   * Triggers death sequence: crash burst, camera shake, and a final
   * spin/scale-down animation. GameScene listens via the returned promise
   * (resolved through onComplete callback) before transitioning to
   * GameOverScene.
   */
  die(onComplete) {
    if (this.isDead) return;
    this.isDead = true;

    if (window.CubeRushAudio) window.CubeRushAudio.playCrash();
    if (this.fx) {
      this.fx.crashBurst(this.container.x, this.container.y);
      this.fx.trailStop(this.body);
      this.fx.stopGlowPulse(this.glowRing);
    }

    this.scene.tweens.add({
      targets: this.container,
      scale: 0,
      angle: 360,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.In',
      onComplete: () => {
        if (onComplete) onComplete();
      },
    });
  }

  // -------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------

  /**
   * @param {number} deltaMs time since last frame
   */
  update(deltaMs) {
    if (this.isDead) return;

    // Rotate the internal "energy core" square continuously for the
    // signature living-cube look, independent of lane/jump tweens.
    this.core.angle += this.rotationSpeed * deltaMs * 60;

    this.updatePowerUps(deltaMs);

    // Keep the arcade physics body's hitbox centered on the container
    // even while jump/lane tweens move it, since Phaser containers with
    // a physics body don't auto-sync child transforms.
    if (this.container.body) {
      this.container.body.x = this.container.x - this.container.body.width / 2;
      this.container.body.y = this.container.y - this.container.body.height / 2;
    }
  }

  /** World-space hitbox center, used by ObstacleManager for magnet range checks. */
  getPosition() {
    return { x: this.container.x, y: this.container.y };
  }

  destroy() {
    if (this.fx) {
      this.fx.trailStop(this.body);
      this.fx.stopGlowPulse(this.glowRing);
    }
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.killTweensOf(this.body);
    this.scene.tweens.killTweensOf(this.shieldRing);
    this.container.destroy();
  }
}

// Expose globally, consistent with EffectsManager / CubeRushStorage pattern.
window.Player = Player;
