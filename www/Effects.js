/**
 * Effects.js
 * ---------------------------------------------------------------------------
 * Centralized visual "juice" system for Cube Rush.
 *
 * Every scene that needs particles, screen shake, glow pulses, floating
 * combat/score text, or trail effects goes through this single manager
 * instead of hand-rolling Phaser particle emitters inline. That keeps all
 * visual tuning (colors, durations, easing) in one place and in sync with
 * the palette defined in Config.js.
 *
 * Usage:
 *   const fx = new EffectsManager(scene);
 *   fx.screenShake(6, 200);
 *   fx.floatingText(x, y, '+10', { color: '#FFD23F' });
 *   fx.coinBurst(x, y);
 *   fx.crashBurst(x, y);
 *   fx.jumpDust(x, y);
 *   fx.trailStart(playerSprite);
 *   fx.comboGlowPulse(playerSprite, comboCount);
 *
 * Depends on:
 *   - Phaser 3 (particles, tweens, cameras)
 *   - window.CONFIG (Config.js) for palette + timing constants (optional —
 *     falls back to sane defaults if Config.js hasn't loaded yet)
 * ---------------------------------------------------------------------------
 */

class EffectsManager {
  constructor(scene) {
    this.scene = scene;

    // Pull palette from Config.js if available, otherwise fall back to the
    // Cube Rush "deep-space lane" defaults so this file never hard-crashes
    // if load order changes.
    const palette = (window.CONFIG && window.CONFIG.COLORS) || {};
    this.colors = {
      background: palette.BACKGROUND || 0x0b0e1a,
      cyan: palette.PRIMARY_A || 0x00f0ff,
      magenta: palette.PRIMARY_B || 0xff2e9a,
      gold: palette.COIN || 0xffd23f,
      danger: palette.DANGER || 0xff3b3b,
      mint: palette.SUCCESS || 0x39ff88,
      white: 0xffffff,
    };

    // Registry of active emitters/trails so we can clean them up on
    // scene shutdown and avoid leaking GPU/CPU particle work between runs.
    this._activeEmitters = new Set();
    this._activeTrails = new Map(); // sprite -> { emitter, updateFn }
    this._activeGlowTweens = new Map(); // sprite -> tween

    // Reusable floating-text pool to avoid GC churn on hyper-casual runs
    // where score text spawns constantly (every coin, every combo tick).
    this._textPool = [];
    this._textPoolMax = 24;

    // Track a single default particle texture key; created lazily the
    // first time it's needed since the scene's texture manager must be
    // ready first.
    this._particleTextureKey = 'fx_particle_soft';
    this._ensureParticleTexture();

    // Clean everything up automatically when the scene shuts down/restarts
    // so effects don't leak across Game Over -> Restart cycles.
    this.scene.events.once('shutdown', () => this.destroy());
    this.scene.events.once('destroy', () => this.destroy());
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /**
   * Generates a small soft-edged white circle texture once per scene,
   * used as the base sprite for every particle emitter (tinted per call).
   * Doing this procedurally avoids needing an image asset for glow dots.
   */
  _ensureParticleTexture() {
    const key = this._particleTextureKey;
    if (this.scene.textures.exists(key)) return;

    const size = 32;
    const gfx = this.scene.make.graphics({ x: 0, y: 0, add: false });

    // Soft radial falloff built from concentric alpha-stepped circles —
    // cheap to generate once, cheap to tint/scale per particle at runtime.
    const steps = 8;
    for (let i = steps; i >= 0; i--) {
      const radius = (size / 2) * (i / steps);
      const alpha = 1 - i / steps;
      gfx.fillStyle(0xffffff, alpha * 0.9 + 0.1);
      gfx.fillCircle(size / 2, size / 2, radius);
    }

    gfx.generateTexture(key, size, size);
    gfx.destroy();
  }

  /** Converts a hex number or CSS hex string to a Phaser-safe hex number. */
  _toHex(color) {
    if (typeof color === 'number') return color;
    if (typeof color === 'string') {
      return Phaser.Display.Color.HexStringToColor(color).color;
    }
    return this.colors.white;
  }

  /** Registers an emitter for lifecycle tracking + auto-cleanup timing. */
  _trackEmitter(emitter, autoDestroyMs) {
    this._activeEmitters.add(emitter);
    if (autoDestroyMs) {
      this.scene.time.delayedCall(autoDestroyMs, () => {
        emitter.stop();
        this.scene.time.delayedCall(1500, () => {
          if (emitter && emitter.manager) emitter.remove();
          this._activeEmitters.delete(emitter);
        });
      });
    }
    return emitter;
  }

  // ---------------------------------------------------------------------
  // Screen shake
  // ---------------------------------------------------------------------

  /**
   * Shakes the main camera. Used on crashes, big obstacle hits, and
   * (lighter) on high-combo landings for extra juice.
   * @param {number} intensity 0..~0.02 typical range; treated as camera %
   * @param {number} duration ms
   */
  screenShake(intensity = 0.01, duration = 200) {
    if (!this.scene.cameras || !this.scene.cameras.main) return;
    this.scene.cameras.main.shake(duration, intensity, false);
  }

  /** Convenience preset for a crash/death hit. */
  crashShake() {
    this.screenShake(0.018, 260);
  }

  /** Convenience preset for a small combo-tier bump. */
  comboShake(comboCount) {
    const intensity = Math.min(0.004 + comboCount * 0.0006, 0.012);
    this.screenShake(intensity, 120);
  }

  /** Brief red vignette flash on damage/shield-break for readability. */
  damageFlash() {
    if (!this.scene.cameras || !this.scene.cameras.main) return;
    this.scene.cameras.main.flash(180, 255, 59, 59, false);
  }

  /** Brief white flash for level-up / big reward moments. */
  rewardFlash() {
    if (!this.scene.cameras || !this.scene.cameras.main) return;
    this.scene.cameras.main.flash(220, 255, 255, 255, false);
  }

  // ---------------------------------------------------------------------
  // Floating text (score pops, "+10", "COMBO x5", "SHIELD!", etc.)
  // ---------------------------------------------------------------------

  /**
   * Spawns a floating text label that rises and fades out.
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {object} opts { color, fontSize, rise, duration, scale, stroke }
   */
  floatingText(x, y, text, opts = {}) {
    const {
      color = '#FFFFFF',
      fontSize = 28,
      rise = 70,
      duration = 700,
      scale = 1,
      stroke = '#0B0E1A',
      strokeThickness = 4,
      fontFamily = (window.CONFIG && window.CONFIG.FONTS && window.CONFIG.FONTS.DISPLAY) || 'Orbitron',
    } = opts;

    let label = this._textPool.pop();
    if (!label || label.scene !== this.scene) {
      label = this.scene.add.text(0, 0, '', {
        fontFamily,
        fontSize: `${fontSize}px`,
        color,
        stroke,
        strokeThickness,
      });
      label.setOrigin(0.5);
      label.setDepth(1000);
    }

    label.setText(text);
    label.setColor(color);
    label.setFontSize(fontSize);
    label.setPosition(x, y);
    label.setScale(0.6 * scale);
    label.setAlpha(1);
    label.setActive(true);
    label.setVisible(true);

    // Punchy scale-in then rise-and-fade, matching hyper-casual "juice"
    // conventions: overshoot on entry, linger, fade on exit.
    this.scene.tweens.add({
      targets: label,
      scale: { from: 0.6 * scale, to: 1.05 * scale },
      duration: 120,
      ease: 'Back.Out',
      onComplete: () => {
        this.scene.tweens.add({
          targets: label,
          y: y - rise,
          alpha: { from: 1, to: 0 },
          duration: duration - 120,
          ease: 'Cubic.Out',
          onComplete: () => {
            label.setVisible(false);
            label.setActive(false);
            if (this._textPool.length < this._textPoolMax) {
              this._textPool.push(label);
            } else {
              label.destroy();
            }
          },
        });
      },
    });

    return label;
  }

  /** Preset: coin pickup "+N" popup in gold. */
  coinPopup(x, y, amount) {
    this.floatingText(x, y - 10, `+${amount}`, {
      color: '#FFD23F',
      fontSize: 24,
      rise: 55,
      duration: 600,
    });
  }

  /** Preset: combo multiplier callout, scales up with combo tier. */
  comboPopup(x, y, comboCount) {
    const scale = 1 + Math.min(comboCount * 0.05, 0.6);
    this.floatingText(x, y - 30, `COMBO x${comboCount}`, {
      color: '#39FF88',
      fontSize: 22,
      rise: 60,
      duration: 650,
      scale,
    });
  }

  /** Preset: XP gain callout. */
  xpPopup(x, y, amount) {
    this.floatingText(x, y - 10, `+${amount} XP`, {
      color: '#00F0FF',
      fontSize: 20,
      rise: 50,
      duration: 600,
    });
  }

  // ---------------------------------------------------------------------
  // Particle bursts
  // ---------------------------------------------------------------------

  /** Generic one-shot radial burst, tinted, used as the base for presets. */
  _burst(x, y, {
    color = this.colors.white,
    count = 14,
    speedMin = 80,
    speedMax = 220,
    scaleStart = 0.9,
    scaleEnd = 0,
    lifespan = 500,
    gravityY = 0,
    blendMode = Phaser.BlendModes.ADD,
  } = {}) {
    const emitter = this.scene.add.particles(x, y, this._particleTextureKey, {
      tint: this._toHex(color),
      speed: { min: speedMin, max: speedMax },
      angle: { min: 0, max: 360 },
      scale: { start: scaleStart, end: scaleEnd },
      alpha: { start: 1, end: 0 },
      lifespan,
      gravityY,
      blendMode,
      quantity: count,
      emitting: false,
    });
    emitter.setDepth(900);
    emitter.explode(count, x, y);

    return this._trackEmitter(emitter, lifespan + 100);
  }

  /** Coin collect: small tight gold sparkle burst. */
  coinBurst(x, y) {
    this._burst(x, y, {
      color: this.colors.gold,
      count: 10,
      speedMin: 60,
      speedMax: 160,
      lifespan: 420,
      scaleStart: 0.7,
    });
  }

  /** Crash/death: bigger, redder, slower-fading burst + shake + flash. */
  crashBurst(x, y) {
    this._burst(x, y, {
      color: this.colors.danger,
      count: 22,
      speedMin: 120,
      speedMax: 320,
      lifespan: 650,
      scaleStart: 1.1,
      gravityY: 180,
    });
    this._burst(x, y, {
      color: this.colors.white,
      count: 8,
      speedMin: 40,
      speedMax: 120,
      lifespan: 300,
      scaleStart: 0.6,
    });
    this.crashShake();
    this.damageFlash();
  }

  /** Jump: small dust puff at the player's feet. */
  jumpDust(x, y) {
    this._burst(x, y, {
      color: 0xaaaaaa,
      count: 8,
      speedMin: 30,
      speedMax: 90,
      lifespan: 350,
      scaleStart: 0.5,
      gravityY: 260,
      blendMode: Phaser.BlendModes.NORMAL,
    });
  }

  /** Landing: soft mint puff, used after a clean dodge/landing. */
  landDust(x, y) {
    this._burst(x, y, {
      color: this.colors.mint,
      count: 6,
      speedMin: 20,
      speedMax: 70,
      lifespan: 300,
      scaleStart: 0.45,
      gravityY: 200,
    });
  }

  /** Power-up activation: expanding ring-like burst in the given color. */
  powerUpBurst(x, y, colorHex) {
    this._burst(x, y, {
      color: colorHex || this.colors.cyan,
      count: 26,
      speedMin: 100,
      speedMax: 260,
      lifespan: 550,
      scaleStart: 1.0,
    });
    this.rewardFlash();
  }

  /** Achievement/level-up: celebratory burst + gold confetti-ish spread. */
  celebrationBurst(x, y) {
    this._burst(x, y, {
      color: this.colors.gold,
      count: 30,
      speedMin: 100,
      speedMax: 300,
      lifespan: 800,
      scaleStart: 1.0,
      gravityY: 140,
    });
    this._burst(x, y, {
      color: this.colors.cyan,
      count: 16,
      speedMin: 80,
      speedMax: 220,
      lifespan: 700,
      scaleStart: 0.8,
      gravityY: 100,
    });
    this.rewardFlash();
  }

  // ---------------------------------------------------------------------
  // Continuous trail (player cube motion trail)
  // ---------------------------------------------------------------------

  /**
   * Attaches a continuously-emitting trail to a sprite (typically the
   * player cube). Call trailStop() / trailSetColor() to control it.
   */
  trailStart(sprite, opts = {}) {
    if (this._activeTrails.has(sprite)) return this._activeTrails.get(sprite).emitter;

    const {
      color = this.colors.cyan,
      frequency = 30,
      lifespan = 260,
      scaleStart = 0.55,
    } = opts;

    const emitter = this.scene.add.particles(0, 0, this._particleTextureKey, {
      tint: this._toHex(color),
      speed: { min: 4, max: 16 },
      scale: { start: scaleStart, end: 0 },
      alpha: { start: 0.55, end: 0 },
      lifespan,
      frequency,
      blendMode: Phaser.BlendModes.ADD,
      follow: sprite,
      followOffset: { x: 0, y: 0 },
    });
    emitter.setDepth((sprite.depth || 0) - 1);

    this._activeTrails.set(sprite, { emitter, color });
    this._activeEmitters.add(emitter);
    return emitter;
  }

  /** Updates trail tint on the fly (e.g. when skin or power-up changes). */
  trailSetColor(sprite, colorHex) {
    const entry = this._activeTrails.get(sprite);
    if (!entry) return;
    entry.emitter.setParticleTint(this._toHex(colorHex));
    entry.color = colorHex;
  }

  /** Temporarily intensifies the trail (e.g. during Slow-Motion power). */
  trailBoost(sprite, durationMs = 1000) {
    const entry = this._activeTrails.get(sprite);
    if (!entry) return;
    const originalFreq = entry.emitter.frequency;
    entry.emitter.setFrequency(Math.max(8, originalFreq / 2));
    this.scene.time.delayedCall(durationMs, () => {
      if (entry.emitter && entry.emitter.manager) {
        entry.emitter.setFrequency(originalFreq);
      }
    });
  }

  /** Stops and removes a sprite's trail emitter. */
  trailStop(sprite) {
    const entry = this._activeTrails.get(sprite);
    if (!entry) return;
    entry.emitter.stop();
    this.scene.time.delayedCall(400, () => {
      if (entry.emitter && entry.emitter.manager) entry.emitter.remove();
      this._activeEmitters.delete(entry.emitter);
    });
    this._activeTrails.delete(sprite);
  }

  // ---------------------------------------------------------------------
  // Glow pulse (the player cube's combo-reactive bloom ring)
  // ---------------------------------------------------------------------

  /**
   * Pulses a target's scale/alpha to simulate a glowing bloom ring that
   * reacts to combo count. Intended for a dedicated "glow ring" game
   * object layered behind the player cube (see Player.js), not the cube
   * sprite itself, so the cube's own art stays crisp.
   */
  comboGlowPulse(glowTarget, comboCount = 1) {
    // Kill any existing pulse tween on this target before starting a new
    // one so rapid combo increments don't stack conflicting tweens.
    const existing = this._activeGlowTweens.get(glowTarget);
    if (existing) existing.stop();

    const intensity = Math.min(1 + comboCount * 0.08, 2.2);
    const speed = Math.max(650 - comboCount * 20, 220);

    const tween = this.scene.tweens.add({
      targets: glowTarget,
      scale: { from: 1, to: intensity },
      alpha: { from: 0.55, to: 0.15 },
      duration: speed,
      ease: 'Sine.InOut',
      yoyo: true,
      repeat: -1,
    });

    this._activeGlowTweens.set(glowTarget, tween);
    return tween;
  }

  /** Stops a glow pulse and resets the target to a neutral idle state. */
  stopGlowPulse(glowTarget) {
    const tween = this._activeGlowTweens.get(glowTarget);
    if (tween) {
      tween.stop();
      this._activeGlowTweens.delete(glowTarget);
    }
    if (glowTarget && glowTarget.setScale) {
      glowTarget.setScale(1);
      glowTarget.setAlpha(0.35);
    }
  }

  /** One-shot "shield hit" ring flash — quick expand + fade, not looping. */
  shieldHitPulse(x, y) {
    const ring = this.scene.add.circle(x, y, 24, this._toHex(this.colors.cyan), 0.35);
    ring.setStrokeStyle(3, this._toHex(this.colors.cyan), 0.9);
    ring.setDepth(950);
    this.scene.tweens.add({
      targets: ring,
      radius: 60,
      alpha: 0,
      duration: 350,
      ease: 'Cubic.Out',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy(),
    });
  }

  // ---------------------------------------------------------------------
  // Button / UI micro-juice
  // ---------------------------------------------------------------------

  /** Standard "press" bounce for animated buttons across all menus. */
  buttonPress(button) {
    this.scene.tweens.add({
      targets: button,
      scale: { from: button.scale, to: button.scale * 0.9 },
      duration: 70,
      yoyo: true,
      ease: 'Quad.Out',
    });
  }

  /** Idle "breathing" loop for primary CTA buttons (e.g. big Play button). */
  buttonIdlePulse(button) {
    return this.scene.tweens.add({
      targets: button,
      scale: { from: button.scale, to: button.scale * 1.04 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  // ---------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------

  /** Stops and removes every active emitter/trail/tween owned by this manager. */
  destroy() {
    this._activeEmitters.forEach((emitter) => {
      if (emitter && emitter.manager) {
        emitter.stop();
        emitter.remove();
      }
    });
    this._activeEmitters.clear();

    this._activeTrails.forEach((entry) => {
      if (entry.emitter && entry.emitter.manager) {
        entry.emitter.stop();
        entry.emitter.remove();
      }
    });
    this._activeTrails.clear();

    this._activeGlowTweens.forEach((tween) => tween.stop());
    this._activeGlowTweens.clear();

    this._textPool.forEach((label) => label.destroy());
    this._textPool = [];
  }
}

// Expose globally, consistent with Storage.js's window.CubeRushStorage
// pattern, so scenes can do: const fx = new window.EffectsManager(this);
window.EffectsManager = EffectsManager;
