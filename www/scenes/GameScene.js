/**
 * =====================================================================
 * GameScene.js — Cube Rush
 * =====================================================================
 * The core gameplay orchestrator. Does NOT implement gameplay rules
 * itself — those live in Player.js, ObstacleManager.js, CoinManager.js,
 * PowerUpManager.js, and MissionManager.js. This scene's job is to:
 *
 *  1. Instantiate and wire all gameplay managers together.
 *  2. Detect swipe-left / swipe-right / tap gestures and translate them
 *     into Player method calls.
 *  3. Run a brief "3-2-1-GO" countdown before spawning begins.
 *  4. Track run-level state: score, elapsed survival time, coins/gems
 *     collected this run.
 *  5. Render the scrolling lane-divider track background (visual only
 *     — lane logic itself lives in Player.js).
 *  6. Launch UIScene in parallel (Phaser multi-scene pattern) for the
 *     HUD/pause overlay — this scene draws NO HUD of its own.
 *  7. Handle pause/resume (including auto-pause when the app is
 *     backgrounded, via main.js -> pauseForBackground()) and the
 *     transition to GameOverScene on death.
 *
 * COMMUNICATION WITH UISCENE
 *  - UIScene pulls numeric HUD values (score, coins, combo, active
 *    power-ups) each frame via public getters on this scene
 *    (`this.scene.get('GameScene')`), rather than firing an event per
 *    coin — simpler and cheap enough at 60fps.
 *  - Lifecycle moments (pause/resume) ARE emitted via this.events
 *    ('game:paused' / 'game:resumed') so UIScene's pause overlay stays
 *    in sync regardless of whether pause was triggered by the UI pause
 *    button or by the app being backgrounded.
 *  - UIScene's pause button calls `gameScene.pauseGame()` directly;
 *    its Resume/Restart/Quit buttons call `resumeGame()` /
 *    `restartRun()` / `quitToMenu()` directly.
 * =====================================================================
 */

(function (window) {
  'use strict';

  class GameScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.GAME) || 'GameScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || {
        GAME: 'GameScene', UI: 'UIScene', GAMEOVER: 'GameOverScene', MENU: 'MenuScene'
      };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };

      this.PIXELS_PER_METER = (C.GAMEPLAY && C.GAMEPLAY.pixelsPerMeter) || 50;

      // Gesture thresholds.
      this.SWIPE_MIN_DIST = (C.INPUT && C.INPUT.swipeMinDistance) || 40;
      this.TAP_MAX_TIME = (C.INPUT && C.INPUT.tapMaxTimeMs) || 250;
      this.TAP_MAX_DIST = (C.INPUT && C.INPUT.tapMaxDistance) || 20;
      this.TOP_UI_SAFE_ZONE = (C.INPUT && C.INPUT.topUiSafeZone) || 90;

      // Run state.
      this.hasStarted = false;
      this.isPaused = false;
      this.isGameOver = false;
      this.inputEnabled = false;

      this.score = 0;
      this.runCoins = 0;
      this.runGems = 0;
      this.elapsedRunMs = 0;
      this._distanceMeters = 0;

      this._touchStart = null;
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;

      // Reset any lingering time-scale from a previous run's Slow-Mo
      // power-up in case this scene was restarted mid-effect.
      this.physics.world.timeScale = 1;
      this.time.timeScale = 1;

      this.fx = new window.EffectsManager(this);
      this.audio = window.CubeRushAudio || null;

      const storage = window.CubeRushStorage;
      const selectedSkinId = (storage && typeof storage.getSelectedSkin === 'function')
        ? storage.getSelectedSkin() : 0;

      this._buildBackground(width, height);

      // Player's constructor signature is (scene, options) — it grabs its
      // own EffectsManager reference internally via scene.fxManager. Passing
      // this.fx as a second positional arg here previously shifted the real
      // options object out of range, so the equipped skin never applied.
      this.player = new window.Player(this, { skinId: selectedSkinId });
      this._buildLaneDividers(width, height);

      this.obstacleManager = new window.ObstacleManager(this, this.player, this.fx, this.audio);
      this.coinManager = new window.CoinManager(this, this.player, this.fx, this.audio, this.obstacleManager);
      this.powerUpManager = new window.PowerUpManager(this, this.player, this.fx, this.audio, this.coinManager, this.obstacleManager);
      this.missionManager = new window.MissionManager(this, this.fx, this.audio);

      // Managers spawn immediately on construction — freeze them until
      // the countdown finishes so the player isn't ambushed instantly.
      this.obstacleManager.setPaused(true);
      this.coinManager.setPaused(true);
      this.powerUpManager.setPaused(true);

      this.missionManager.startSession();

      this._wireManagerEvents();
      this._setupInput();

      this.scene.launch(this.SCENES.UI);

      if (this.audio && typeof this.audio.startMusic === 'function') {
        this.audio.startMusic();
      }

      this.events.once('shutdown', () => this._cleanup());
      this.events.once('destroy', () => this._cleanup());

      this.cameras.main.fadeIn(220, 11, 14, 26);
      this._startCountdown();
    }

    // =====================================================================
    // BACKGROUND / TRACK VISUALS
    // =====================================================================
    _buildBackground(width, height) {
      const bg = this.add.graphics().setDepth(-2);
      bg.fillGradientStyle(0x0b0e1a, 0x0b0e1a, 0x141a33, 0x0b0e1a, 1);
      bg.fillRect(0, 0, width, height);

      this._ensureTrackTexture();
      this.trackTile = this.add.tileSprite(width / 2, height / 2, width, height, 'track-tile')
        .setDepth(-1)
        .setAlpha(0.35);

      const quality = this.registry.get('quality') || 'high';
      if (quality !== 'low') {
        this._ambientA = this._makeAmbientGlow(width * 0.2, height * 0.15, this.COLORS.cyan, 180, 0.07);
        this._ambientB = this._makeAmbientGlow(width * 0.85, height * 0.8, this.COLORS.magenta, 200, 0.06);
      }
    }

    _ensureTrackTexture() {
      if (this.textures.exists('track-tile')) return;
      const w = 64, h = 48;
      const canvasTex = this.textures.createCanvas('track-tile', w, h);
      const ctx = canvasTex.getContext();
      ctx.strokeStyle = 'rgba(0,240,255,0.25)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.stroke();
      canvasTex.refresh();
    }

    _makeAmbientGlow(x, y, color, radius, alpha) {
      const g = this.add.image(x, y, 'fx-glow-soft')
        .setBlendMode('ADD')
        .setTint(color)
        .setScale(radius / 64)
        .setAlpha(alpha)
        .setDepth(-1);
      this.tweens.add({
        targets: g,
        alpha: { from: alpha, to: alpha * 1.6 },
        duration: 3600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
      return g;
    }

    /** Draws glowing vertical lane-boundary lines + a horizon accent line
     *  at the player's ground row, using the Player's authoritative lane
     *  geometry (so visuals always match actual collision lanes). */
    _buildLaneDividers(width, height) {
      if (this.laneDividerGfx) this.laneDividerGfx.destroy();
      if (this.horizonGfx) this.horizonGfx.destroy();

      this.laneDividerGfx = this.add.graphics().setDepth(-1).setBlendMode('ADD');
      const laneX = this.player.laneX;
      this.laneDividerGfx.lineStyle(2, this.COLORS.cyan, 0.18);
      for (let i = 0; i < laneX.length - 1; i++) {
        const x = (laneX[i] + laneX[i + 1]) / 2;
        this.laneDividerGfx.moveTo(x, 0);
        this.laneDividerGfx.lineTo(x, height);
      }
      this.laneDividerGfx.strokePath();

      this.horizonGfx = this.add.graphics().setDepth(3).setBlendMode('ADD');
      const groundY = this.player.groundY;
      this.horizonGfx.lineStyle(2, this.COLORS.cyan, 0.35);
      this.horizonGfx.moveTo(0, groundY + 34);
      this.horizonGfx.lineTo(width, groundY + 34);
      this.horizonGfx.strokePath();

      this.tweens.add({
        targets: this.horizonGfx,
        alpha: { from: 0.5, to: 0.9 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
    }

    // =====================================================================
    // MANAGER EVENT WIRING
    // =====================================================================
    _wireManagerEvents() {
      this.player.on('jumped', () => this.missionManager.recordEvent('jump'));

      this.obstacleManager.on('obstaclePassed', (type) => {
        this.missionManager.recordEvent('obstacleDodged', { type });
      });

      this.obstacleManager.on('playerHit', (payload) => {
        this.missionManager.recordEvent('playerHit', payload);
        if (payload.survived) {
          // Player survived via shield/invincibility — combo still
          // resets since the run's flow was interrupted.
          this.coinManager.breakComboExternal();
        }
      });

      this.obstacleManager.on('playerDied', () => this._triggerGameOver());

      this.obstacleManager.on('tierChanged', (tier) => this._onTierChanged(tier));

      this.coinManager.on('coinCollected', (payload) => {
        this.runCoins += payload.value;
        if (payload.isGem) this.runGems += 1;
        this.score += payload.value;
        this.missionManager.recordEvent('coinCollected', payload);
      });

      this.coinManager.on('comboChanged', (multiplier) => {
        this.missionManager.recordEvent('comboChanged', { multiplier });
      });

      this.powerUpManager.on('powerUpCollected', (payload) => {
        this.missionManager.recordEvent('powerUpUsed', { type: payload.type });
      });
    }

    _onTierChanged(tier) {
      if (tier <= 0) return; // don't announce the starting tier
      const { width, height } = this.scale;
      if (this.fx) {
        this.fx.floatingText(width / 2, height * 0.22, `SPEED UP!`, {
          color: this.COLORS.magenta, fontSize: 30, duration: 900, rise: 40
        });
      }
      if (this.audio && this.audio.playLevelUp) this.audio.playLevelUp();
      this.cameras.main.flash(150, 255, 46, 154, false);
    }

    // =====================================================================
    // INPUT (swipe left/right, tap/swipe-up to jump)
    // =====================================================================
    _setupInput() {
      this.input.on('pointerdown', this._onPointerDown, this);
      this.input.on('pointerup', this._onPointerUp, this);
      this.inputEnabled = false; // enabled once countdown finishes
    }

    _onPointerDown(pointer) {
      if (!this.inputEnabled || this.isPaused || this.isGameOver) return;
      if (pointer.y < this.TOP_UI_SAFE_ZONE) return; // reserved for UIScene's pause button
      this._touchStart = { x: pointer.x, y: pointer.y, t: this.time.now };
    }

    _onPointerUp(pointer) {
      const start = this._touchStart;
      this._touchStart = null;
      if (!start || !this.inputEnabled || this.isPaused || this.isGameOver) return;

      const dx = pointer.x - start.x;
      const dy = pointer.y - start.y;
      const dt = this.time.now - start.t;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= this.TAP_MAX_DIST && dt <= this.TAP_MAX_TIME) {
        this.player.jump();
        return;
      }

      if (Math.abs(dx) >= this.SWIPE_MIN_DIST && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) this.player.moveRight();
        else this.player.moveLeft();
        return;
      }

      if (dy <= -this.SWIPE_MIN_DIST) {
        this.player.jump(); // swipe up also jumps — friendlier on small screens
      }
    }

    // =====================================================================
    // COUNTDOWN ("3, 2, 1, GO!")
    // =====================================================================
    _startCountdown() {
      const { width, height } = this.scale;
      const steps = ['3', '2', '1', 'GO!'];
      let i = 0;

      const showNext = () => {
        if (i >= steps.length) {
          this._beginRun();
          return;
        }

        const isLast = i === steps.length - 1;
        const label = this.add.text(width / 2, height / 2, steps[i], {
          fontFamily: 'Orbitron, sans-serif',
          fontSize: isLast ? '52px' : '64px',
          fontStyle: '700',
          color: isLast ? '#39FF88' : '#FFFFFF',
          stroke: '#0B0E1A',
          strokeThickness: 6
        }).setOrigin(0.5).setDepth(200).setScale(0.3).setAlpha(0);

        this.tweens.add({
          targets: label,
          scale: 1.15,
          alpha: 1,
          duration: 200,
          ease: 'Back.Out',
          onComplete: () => {
            this.tweens.add({ targets: label, scale: 1, duration: 100 });
          }
        });

        if (this.audio) {
          if (!isLast && this.audio.playCountdownTick) this.audio.playCountdownTick();
          if (isLast && this.audio.playCountdownGo) this.audio.playCountdownGo();
        }

        this.time.delayedCall(650, () => {
          this.tweens.add({
            targets: label,
            alpha: 0,
            scale: 1.4,
            duration: 180,
            onComplete: () => label.destroy()
          });
          i += 1;
          showNext();
        });
      };

      showNext();
    }

    _beginRun() {
      this.hasStarted = true;
      this.inputEnabled = true;
      this.obstacleManager.setPaused(false);
      this.coinManager.setPaused(false);
      this.powerUpManager.setPaused(false);
    }

    // =====================================================================
    // MAIN UPDATE LOOP
    // =====================================================================
    update(time, delta) {
      if (!this.hasStarted || this.isGameOver) return;

      // Update visual track scroll regardless of pause state being driven
      // by managers (keeps things simple — pause fully freezes below).
      if (this.isPaused) return;

      this.elapsedRunMs += delta;

      const scrollSpeed = this.obstacleManager.getScrollSpeed();
      const deltaMeters = (scrollSpeed * (delta / 1000)) / this.PIXELS_PER_METER;
      this._distanceMeters += deltaMeters;
      this.score = Math.max(this.score, Math.floor(this._distanceMeters)) + this._coinScoreOffset();

      // Simpler, robust scoring: base score tracks distance; coin value
      // already accumulated additively in the coinCollected handler.
      // (Recomputed each frame via _baseDistanceScore + runCoins bucket.)
      this._baseDistanceScore = Math.floor(this._distanceMeters);
      this.score = this._baseDistanceScore + this._coinScoreAccum;

      if (this.trackTile) {
        this.trackTile.tilePositionY += scrollSpeed * (delta / 1000);
      }

      this.player.update(time, delta);
      this.obstacleManager.update(time, delta, this.elapsedRunMs);
      this.coinManager.update(time, delta);

      // IMPORTANT: raw, unscaled delta so power-up countdowns are not
      // stretched by Slow-Motion's own time.timeScale reduction.
      this.powerUpManager.update(time, delta);

      this.missionManager.tickDistance(deltaMeters);
    }

    // NOTE: coin score accumulation is tracked via a dedicated
    // accumulator (`_coinScoreAccum`) rather than folded into the
    // per-frame calculation above, to avoid double counting. See
    // _wireManagerEvents()'s coinCollected handler which increments it.
    _coinScoreOffset() { return 0; }

    // =====================================================================
    // PAUSE / RESUME
    // =====================================================================
    pauseGame() {
      if (this.isPaused || this.isGameOver || !this.hasStarted) return;
      this.isPaused = true;
      this.inputEnabled = false;
      this.physics.world.pause();
      this.obstacleManager.setPaused(true);
      this.coinManager.setPaused(true);
      this.powerUpManager.setPaused(true);
      if (this.audio && typeof this.audio.suspend === 'function') this.audio.suspend();
      this.events.emit('game:paused');
    }

    resumeGame() {
      if (!this.isPaused || this.isGameOver) return;
      this.isPaused = false;
      this.inputEnabled = true;
      this.physics.world.resume();
      this.obstacleManager.setPaused(false);
      this.coinManager.setPaused(false);
      this.powerUpManager.setPaused(false);
      if (this.audio && typeof this.audio.resume === 'function') this.audio.resume();
      this.events.emit('game:resumed');
    }

    /** Called by main.js when the app/tab is backgrounded. */
    pauseForBackground() {
      this.pauseGame();
    }

    // =====================================================================
    // RESTART (in-place — avoids a full scene teardown for snappier UX)
    // =====================================================================
    restartRun() {
      this.isGameOver = false;
      this.isPaused = false;
      this.inputEnabled = false;
      this.hasStarted = false;

      this.score = 0;
      this.runCoins = 0;
      this.runGems = 0;
      this._coinScoreAccum = 0;
      this._distanceMeters = 0;
      this.elapsedRunMs = 0;

      this.physics.world.resume();

      const storage = window.CubeRushStorage;
      const selectedSkinId = (storage && typeof storage.getSelectedSkin === 'function')
        ? storage.getSelectedSkin() : 0;

      this.player.reset(selectedSkinId);
      this.obstacleManager.reset();
      this.coinManager.reset();
      this.powerUpManager.reset();
      this.missionManager.startSession();

      this.obstacleManager.setPaused(true);
      this.coinManager.setPaused(true);
      this.powerUpManager.setPaused(true);

      this.events.emit('game:resumed');
      this._startCountdown();
    }

    // =====================================================================
    // QUIT TO MENU
    // =====================================================================
    quitToMenu() {
      if (window.CubeRushStorage && typeof window.CubeRushStorage.forceSave === 'function') {
        window.CubeRushStorage.forceSave();
      }
      this.scene.stop(this.SCENES.UI);
      this.cameras.main.fadeOut(220, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start(this.SCENES.MENU);
      });
    }

    // =====================================================================
    // GAME OVER
    // =====================================================================
    _triggerGameOver() {
      if (this.isGameOver) return;
      this.isGameOver = true;
      this.inputEnabled = false;

      this.obstacleManager.setPaused(true);
      this.coinManager.setPaused(true);
      this.powerUpManager.setPaused(true);

      const survivalMs = this.elapsedRunMs;
      const finalScore = this.score;
      const comboSnapshot = this.missionManager.getSessionSnapshot();

      this.missionManager.endRun({ survivalMs, score: finalScore });

      const isNewHighScore = this._updateHighScoreIfNeeded(finalScore);

      if (this.audio && typeof this.audio.stopMusic === 'function') {
        // Let the crash sting play without competing with music.
      }

      this.time.delayedCall(900, () => {
        this.scene.stop(this.SCENES.UI);
        this.cameras.main.fadeOut(320, 11, 14, 26);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start(this.SCENES.GAMEOVER, {
            score: finalScore,
            coins: this.runCoins,
            gems: this.runGems,
            survivalMs,
            comboMax: comboSnapshot.comboMultiplierPeak,
            isNewHighScore
          });
        });
      });
    }

    _updateHighScoreIfNeeded(score) {
      const storage = window.CubeRushStorage;
      if (!storage) return false;

      try {
        if (typeof storage.getHighScore === 'function' && typeof storage.setHighScore === 'function') {
          const current = storage.getHighScore();
          if (score > current) {
            storage.setHighScore(score);
            return true;
          }
          return false;
        }
        if (typeof storage.submitScore === 'function') {
          return !!storage.submitScore(score);
        }
      } catch (e) {
        console.warn('[GameScene] Failed to update high score:', e);
      }
      return false;
    }

    // =====================================================================
    // PUBLIC GETTERS (polled by UIScene each frame for HUD rendering)
    // =====================================================================
    getScore() { return this.score; }
    getRunCoins() { return this.runCoins; }
    getRunGems() { return this.runGems; }
    getComboMultiplier() { return this.coinManager ? this.coinManager.getComboMultiplier() : 1; }
    getActivePowerUps() { return this.powerUpManager ? this.powerUpManager.getActivePowerUps() : []; }
    getElapsedRunMs() { return this.elapsedRunMs; }
    isPausedState() { return this.isPaused; }
    isGameOverState() { return this.isGameOver; }
    hasRunStarted() { return this.hasStarted; }

    // =====================================================================
    // RESIZE HANDLING (called by main.js's global resize handler)
    // =====================================================================
    onGameResize(width, height) {
      if (this.player) this.player.handleResize();
      if (this.trackTile) {
        this.trackTile.setSize(width, height).setPosition(width / 2, height / 2);
      }
      this._buildLaneDividers(width, height);
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    _cleanup() {
      this.input.off('pointerdown', this._onPointerDown, this);
      this.input.off('pointerup', this._onPointerUp, this);

      if (this.player) { this.player.destroy(); this.player = null; }
      if (this.obstacleManager) { this.obstacleManager.destroy(); this.obstacleManager = null; }
      if (this.coinManager) { this.coinManager.destroy(); this.coinManager = null; }
      if (this.powerUpManager) { this.powerUpManager.destroy(); this.powerUpManager = null; }
      if (this.missionManager) { this.missionManager.destroy(); this.missionManager = null; }
      if (this.fx) { this.fx.destroy(); this.fx = null; }

      this.physics.world.timeScale = 1;
      this.time.timeScale = 1;
    }
  }

  // Coin-score accumulator initialized outside the class body's fields
  // (kept here for clarity, referenced via prototype default in init()).
  GameScene.prototype._coinScoreAccum = 0;

  window.GameScene = GameScene;
})(window);