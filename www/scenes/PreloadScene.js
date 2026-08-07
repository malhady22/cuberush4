/**
 * =====================================================================
 * PreloadScene.js — Cube Rush
 * =====================================================================
 * Since this game uses ZERO binary image/audio assets (all textures are
 * generated at runtime via Canvas/Graphics, all audio is synthesized
 * via Web Audio API), "preloading" here is repurposed to do the things
 * that actually matter for a smooth first-frame experience on mobile:
 *
 *  1. Warm up the SHARED fx-* texture atlas (used by EffectsManager in
 *     every scene) up front, so MenuScene/GameScene never pay a
 *     texture-generation hitch the first time a particle burst fires.
 *  2. Block (with a timeout safety net) on web font readiness for
 *     Orbitron + Rubik so text doesn't flash in a system font.
 *  3. Sanity-check the Storage.js and AudioManager singletons set up
 *     in BootScene are actually alive.
 *  4. Drive a Phaser-rendered loading screen visually matching the
 *     HTML splash screen (index.html/style.css), so when we call
 *     `hideSplash`, the transition from HTML -> Canvas is seamless.
 *  5. Hand off to MenuScene once everything above resolves (with a
 *     minimum display time so the splash never feels like a flash).
 * =====================================================================
 */

(function (window) {
  'use strict';

  const MIN_DISPLAY_MS = 1100; // never show the loader for less than this

  class PreloadScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.PRELOAD) || 'PreloadScene' });
    }

    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { PRELOAD: 'PreloadScene', MENU: 'MenuScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        background: 0x0b0e1a, white: 0xffffff
      };
      this._startTime = Date.now();
      this._steps = {
        fonts: false,
        textures: false,
        storage: false,
        audio: false
      };
      this._progress = 0; // 0..1 smoothed display progress
      this._targetProgress = 0;
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      this._buildLoadingUI();
      this._runLoadSequence();
    }

    // =====================================================================
    // LOADING UI (mirrors the HTML splash screen's visual language)
    // =====================================================================
    _buildLoadingUI() {
      const { width, height } = this.scale;
      const cx = width / 2;
      const cy = height / 2;

      // Background gradient (deep navy -> near-black), matching the
      // game's signature "deep-space lane" background.
      const bg = this.add.graphics();
      bg.fillGradientStyle(0x0b0e1a, 0x0b0e1a, 0x11162b, 0x0b0e1a, 1);
      bg.fillRect(0, 0, width, height);

      // Soft ambient glow blobs behind the logo for depth.
      this._makeAmbientGlow(cx - width * 0.2, cy - height * 0.15, this.COLORS.cyan, 220, 0.12);
      this._makeAmbientGlow(cx + width * 0.22, cy + height * 0.1, this.COLORS.magenta, 240, 0.1);

      // Spinning "energy core" logo mark — a simple beveled square with
      // a rotating inner diamond, echoing Player.js's visual identity
      // without needing Player.js itself loaded here.
      this.logoCube = this.add.rectangle(cx, cy - height * 0.12, 64, 64, 0xffffff, 0.08)
        .setStrokeStyle(3, this.COLORS.cyan, 0.9);
      this.logoInner = this.add.rectangle(cx, cy - height * 0.12, 36, 36, this.COLORS.magenta, 0.55);

      this.tweens.add({
        targets: this.logoCube,
        angle: 360,
        duration: 3200,
        repeat: -1,
        ease: 'Linear'
      });
      this.tweens.add({
        targets: this.logoInner,
        angle: -360,
        duration: 2000,
        repeat: -1,
        ease: 'Linear'
      });
      this.tweens.add({
        targets: [this.logoCube, this.logoInner],
        scale: { from: 0.9, to: 1.08 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });

      // Title text.
      this.add.text(cx, cy - height * 0.02, 'CUBE RUSH', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: `${Math.round(width * 0.09)}px`,
        fontStyle: '700',
        color: '#FFFFFF'
      }).setOrigin(0.5);

      // Progress bar track + fill.
      const barWidth = width * 0.62;
      const barHeight = 10;
      const barY = cy + height * 0.14;

      this.add.rectangle(cx, barY, barWidth, barHeight, 0xffffff, 0.08)
        .setStrokeStyle(1, 0xffffff, 0.15);

      this.progressFillMask = new Phaser.Geom.Rectangle(cx - barWidth / 2, barY - barHeight / 2, 0, barHeight);
      this.progressFill = this.add.graphics();
      this._barX = cx - barWidth / 2;
      this._barY = barY - barHeight / 2;
      this._barW = barWidth;
      this._barH = barHeight;
      this._drawProgressBar(0);

      // Status label underneath.
      this.statusText = this.add.text(cx, barY + 26, 'Loading assets...', {
        fontFamily: 'Rubik, sans-serif',
        fontSize: '13px',
        color: '#8892b0'
      }).setOrigin(0.5);
    }

    _makeAmbientGlow(x, y, color, radius, alpha) {
      const g = this.add.graphics();
      g.fillStyle(color, alpha);
      g.fillCircle(x, y, radius);
      g.setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: g,
        alpha: { from: alpha, to: alpha * 1.6 },
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
      return g;
    }

    _drawProgressBar(t) {
      const clamped = Phaser.Math.Clamp(t, 0, 1);
      this.progressFill.clear();
      if (clamped <= 0) return;

      const w = this._barW * clamped;
      this.progressFill.fillGradientStyle(
        this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1
      );
      this.progressFill.fillRoundedRect(this._barX, this._barY, w, this._barH, this._barH / 2);
    }

    // =====================================================================
    // LOAD SEQUENCE (real readiness checks, not fake timers)
    // =====================================================================
    _runLoadSequence() {
      this._updateStatus('Loading fonts...');
      this._loadFonts().then(() => {
        this._steps.fonts = true;
        this._recomputeProgress();

        this._updateStatus('Preparing visuals...');
        this._warmTextures();
        this._steps.textures = true;
        this._recomputeProgress();

        this._updateStatus('Checking save data...');
        this._verifyStorage();
        this._steps.storage = true;
        this._recomputeProgress();

        this._updateStatus('Priming audio engine...');
        this._verifyAudio();
        this._steps.audio = true;
        this._recomputeProgress();

        this._finishLoading();
      }).catch((e) => {
        // Even if fonts fail entirely, never block the player from
        // playing — just proceed with system font fallback.
        console.warn('[PreloadScene] Font loading issue, continuing anyway:', e);
        this._steps.fonts = true;
        this._warmTextures();
        this._steps.textures = true;
        this._verifyStorage();
        this._steps.storage = true;
        this._verifyAudio();
        this._steps.audio = true;
        this._finishLoading();
      });
    }

    _updateStatus(msg) {
      if (this.statusText) this.statusText.setText(msg);
    }

    _recomputeProgress() {
      const total = Object.keys(this._steps).length;
      const done = Object.values(this._steps).filter(Boolean).length;
      this._targetProgress = done / total;
    }

    // ---------------------------------------------------------------------
    // Fonts — race real font-loading against a timeout so a flaky/offline
    // font CDN can never hang the game indefinitely.
    // ---------------------------------------------------------------------
    _loadFonts() {
      if (!document.fonts || typeof document.fonts.load !== 'function') {
        return Promise.resolve();
      }

      const fontChecks = [
        document.fonts.load('700 32px Orbitron'),
        document.fonts.load('400 16px Rubik'),
        document.fonts.load('500 16px Rubik')
      ];

      const timeout = new Promise((resolve) => window.setTimeout(resolve, 2500));

      return Promise.race([
        Promise.all(fontChecks).then(() => document.fonts.ready).catch(() => null),
        timeout
      ]);
    }

    // ---------------------------------------------------------------------
    // Texture warm-up — generates the SHARED fx-* atlas used by
    // EffectsManager in every scene, so it's a no-op (tm.exists check)
    // the first time any scene creates its own EffectsManager instance.
    // ---------------------------------------------------------------------
    _warmTextures() {
      const tm = this.textures;

      if (!tm.exists('fx-dot')) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(8, 8, 8);
        g.generateTexture('fx-dot', 16, 16);
        g.destroy();
      }

      if (!tm.exists('fx-square')) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(0, 0, 14, 14, 3);
        g.generateTexture('fx-square', 14, 14);
        g.destroy();
      }

      if (!tm.exists('fx-spark')) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.beginPath();
        g.moveTo(10, 0);
        g.lineTo(14, 10);
        g.lineTo(10, 20);
        g.lineTo(6, 10);
        g.closePath();
        g.fillPath();
        g.generateTexture('fx-spark', 20, 20);
        g.destroy();
      }

      if (!tm.exists('fx-star')) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        this._drawStar(g, 12, 12, 4, 12, 5);
        g.generateTexture('fx-star', 24, 24);
        g.destroy();
      }

      if (!tm.exists('fx-ring')) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.lineStyle(3, 0xffffff, 1);
        g.strokeCircle(20, 20, 18);
        g.generateTexture('fx-ring', 40, 40);
        g.destroy();
      }

      if (!tm.exists('fx-glow-soft')) {
        const size = 128;
        const canvasTex = this.textures.createCanvas('fx-glow-soft', size, size);
        const ctx = canvasTex.getContext();
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        canvasTex.refresh();
      }

      // A generic 1x1 white pixel — handy for tinted rectangles/masks
      // used by various UI scenes (progress bars, flash overlays) that
      // don't want to allocate a Graphics object every time.
      if (!tm.exists('fx-pixel')) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(0, 0, 4, 4);
        g.generateTexture('fx-pixel', 4, 4);
        g.destroy();
      }
    }

    _drawStar(g, cx, cy, innerR, outerR, points) {
      const step = Math.PI / points;
      g.beginPath();
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = i * step - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
    }

    // ---------------------------------------------------------------------
    // Storage / Audio sanity checks
    // ---------------------------------------------------------------------
    _verifyStorage() {
      if (!window.CubeRushStorage) {
        console.warn('[PreloadScene] CubeRushStorage not found — save/load will be unavailable.');
        return;
      }
      try {
        if (typeof window.CubeRushStorage.getCoins === 'function') {
          window.CubeRushStorage.getCoins(); // touch it to confirm no throw
        }
      } catch (e) {
        console.warn('[PreloadScene] Storage verification failed:', e);
      }
    }

    _verifyAudio() {
      if (!window.CubeRushAudio) {
        console.warn('[PreloadScene] CubeRushAudio not found — game will run silently.');
        return;
      }
      // Do NOT attempt to resume/play here — mobile browsers require a
      // genuine user gesture, which AudioManager itself listens for.
      // This step just confirms the object graph is intact.
    }

    // =====================================================================
    // PROGRESS ANIMATION (smoothed toward _targetProgress every frame)
    // =====================================================================
    update() {
      if (this._progress < this._targetProgress) {
        this._progress = Math.min(this._targetProgress, this._progress + 0.04);
        this._drawProgressBar(this._progress);
      }
    }

    // =====================================================================
    // FINISH — respect minimum display time, hide HTML splash, go to Menu
    // =====================================================================
    _finishLoading() {
      this._targetProgress = 1;

      const elapsed = Date.now() - this._startTime;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

      this._updateStatus('Ready!');

      this.time.delayedCall(remaining, () => {
        // Ensure the bar visually reaches 100% before transitioning.
        this._progress = 1;
        this._drawProgressBar(1);

        // Tell main.js it's safe to remove the native HTML splash overlay.
        window.dispatchEvent(new Event('cuberush:hideSplash'));

        this.cameras.main.fadeOut(280, 11, 14, 26);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start(this.SCENES.MENU || 'MenuScene');
        });
      });
    }
  }

  window.PreloadScene = PreloadScene;
})(window);