/**
 * =====================================================================
 * UIScene.js — Cube Rush
 * =====================================================================
 * Runs IN PARALLEL with GameScene (launched via scene.launch()) and
 * renders the gameplay HUD + pause overlay. Contains NO gameplay logic
 * — it only reads live values from GameScene's public getters each
 * frame and calls GameScene's public control methods
 * (pauseGame/resumeGame/restartRun/quitToMenu).
 *
 * LAYOUT
 *  - Top bar: coins (left), score (center, animated count-up), pause
 *    button (right, inside GameScene's reserved top safe-zone so it
 *    never conflicts with swipe/tap gameplay input).
 *  - Combo badge: appears above the score once multiplier > 1x.
 *  - Power-up row: below the top bar, one icon + radial countdown ring
 *    per currently active power-up.
 *  - Pause overlay: full-screen dim + panel with RESUME / RESTART /
 *    QUIT, current run stats, and a mute toggle. Shown both from the
 *    manual pause button AND automatically when GameScene emits
 *    'game:paused' (e.g. app backgrounded).
 * =====================================================================
 */

(function (window) {
  'use strict';

  class UIScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.UI) || 'UIScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { GAME: 'GameScene', UI: 'UIScene', MENU: 'MenuScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };
      this.POWERUP_META = {
        magnet: { icon: 'pu-icon-magnet', color: this.COLORS.gold, label: 'MAGNET' },
        shield: { icon: 'pu-icon-shield', color: this.COLORS.cyan, label: 'SHIELD' },
        slowmo: { icon: 'pu-icon-slowmo', color: this.COLORS.magenta, label: 'SLOW-MO' },
        doubleCoins: { icon: 'pu-icon-doublecoins', color: this.COLORS.mint, label: 'x2 COINS' }
      };

      this._displayScore = 0; // smoothed/animated value shown to the player
      this._lastComboMultiplier = 1;
      this._powerUpIcons = {}; // type -> { container, ring, graphics }
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;
      this.gameScene = this.scene.get(this.SCENES.GAME);
      this.audio = window.CubeRushAudio || null;

      this._buildTopBar(width, height);
      this._buildComboBadge(width, height);
      this._buildPowerUpRow(width, height);
      this._buildPauseOverlay(width, height);

      this._wireGameSceneEvents();

      this.events.once('shutdown', () => this._cleanup());
    }

    _wireGameSceneEvents() {
      if (!this.gameScene) return;
      this.gameScene.events.on('game:paused', () => this._showPauseOverlay());
      this.gameScene.events.on('game:resumed', () => this._hidePauseOverlay());
    }

    // =====================================================================
    // TOP BAR: coins, score, pause button
    // =====================================================================
    _buildTopBar(width, height) {
      const pad = 16;

      // ---- Coins pill (top-left) -----------------------------------------
      const pillW = 110, pillH = 36;
      const pillBg = this.add.graphics().setDepth(10);
      pillBg.fillStyle(0x141a33, 0.8);
      pillBg.fillRoundedRect(pad, pad, pillW, pillH, pillH / 2);
      pillBg.lineStyle(1.5, this.COLORS.gold, 0.5);
      pillBg.strokeRoundedRect(pad, pad, pillW, pillH, pillH / 2);

      this._coinIcon = this.add.circle(pad + 20, pad + pillH / 2, 8, this.COLORS.gold).setDepth(11);
      this.coinsText = this.add.text(pad + 36, pad + pillH / 2, '0', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '15px', fontStyle: '700', color: '#FFD23F'
      }).setOrigin(0, 0.5).setDepth(11);

      // ---- Score (top-center, large & prominent) ---------------------------
      this.scoreText = this.add.text(width / 2, pad + 14, '0', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: '30px',
        fontStyle: '700',
        color: '#FFFFFF',
        stroke: '#0B0E1A',
        strokeThickness: 4
      }).setOrigin(0.5, 0).setDepth(11);

      this.scoreLabel = this.add.text(width / 2, pad + 46, 'SCORE', {
        fontFamily: 'Rubik, sans-serif', fontSize: '10px', color: '#8892b0'
      }).setOrigin(0.5, 0).setDepth(11);

      // ---- Pause button (top-right) -----------------------------------------
      const btnR = 20;
      this.pauseBtn = this.add.container(width - pad - btnR, pad + btnR).setDepth(12);
      const circle = this.add.circle(0, 0, btnR, 0x141a33, 0.85).setStrokeStyle(1.5, 0xffffff, 0.25);
      const bar1 = this.add.rectangle(-4, 0, 4, 14, 0xffffff);
      const bar2 = this.add.rectangle(4, 0, 4, 14, 0xffffff);
      this.pauseBtn.add([circle, bar1, bar2]);
      this.pauseBtn.setSize(btnR * 2, btnR * 2);
      this.pauseBtn.setInteractive({ useHandCursor: true });

      this.pauseBtn.on('pointerdown', () => this._pressBtn(this.pauseBtn));
      this.pauseBtn.on('pointerup', () => {
        this._releaseBtn(this.pauseBtn);
        this._onPauseButtonPressed();
      });
      this.pauseBtn.on('pointerout', () => this._releaseBtn(this.pauseBtn));
    }

    _onPauseButtonPressed() {
      if (!this.gameScene || this.gameScene.isGameOverState()) return;
      if (this.audio && this.audio.playButton) this.audio.playButton();
      if (this.gameScene.isPausedState()) {
        this.gameScene.resumeGame();
      } else {
        this.gameScene.pauseGame();
      }
    }

    // =====================================================================
    // COMBO BADGE
    // =====================================================================
    _buildComboBadge(width, height) {
      const y = 74;
      this.comboContainer = this.add.container(width / 2, y).setDepth(11).setAlpha(0).setScale(0.7);

      const bg = this.add.graphics();
      bg.fillGradientStyle(this.COLORS.mint, this.COLORS.cyan, this.COLORS.mint, this.COLORS.cyan, 0.9);
      bg.fillRoundedRect(-60, -14, 120, 28, 14);

      this.comboText = this.add.text(0, 0, 'COMBO x1', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '14px', fontStyle: '700', color: '#0B0E1A'
      }).setOrigin(0.5);

      this.comboContainer.add([bg, this.comboText]);
    }

    _updateComboBadge(multiplier) {
      if (multiplier === this._lastComboMultiplier) return;
      this._lastComboMultiplier = multiplier;

      if (multiplier > 1) {
        this.comboText.setText(`COMBO x${multiplier}`);
        this.tweens.killTweensOf(this.comboContainer);
        this.comboContainer.setVisible(true);
        this.tweens.add({
          targets: this.comboContainer,
          alpha: 1,
          scale: { from: 0.6, to: 1.05 },
          duration: 200,
          ease: 'Back.Out',
          onComplete: () => {
            this.tweens.add({ targets: this.comboContainer, scale: 1, duration: 100 });
          }
        });
      } else {
        this.tweens.add({
          targets: this.comboContainer,
          alpha: 0,
          scale: 0.7,
          duration: 200,
          ease: 'Quad.In'
        });
      }
    }

    // =====================================================================
    // POWER-UP ROW (icons with radial countdown rings)
    // =====================================================================
    _buildPowerUpRow(width, height) {
      this._powerUpRowY = 112;
      this._powerUpRowStartX = width / 2;
      this._powerUpIcons = {};
    }

    _updatePowerUpRow(activePowerUps) {
      const activeTypes = new Set(activePowerUps.map((p) => p.type));

      // Remove icons for expired power-ups.
      Object.keys(this._powerUpIcons).forEach((type) => {
        if (!activeTypes.has(type)) {
          const entry = this._powerUpIcons[type];
          this.tweens.add({
            targets: entry.container,
            alpha: 0,
            scale: 0.6,
            duration: 150,
            onComplete: () => entry.container.destroy()
          });
          delete this._powerUpIcons[type];
        }
      });

      // Layout: center the row based on how many are active.
      const count = activePowerUps.length;
      const spacing = 56;
      const totalWidth = (count - 1) * spacing;
      const startX = this._powerUpRowStartX - totalWidth / 2;

      activePowerUps.forEach((p, i) => {
        const x = startX + i * spacing;
        let entry = this._powerUpIcons[p.type];

        if (!entry) {
          entry = this._createPowerUpIcon(p.type);
          this._powerUpIcons[p.type] = entry;
          entry.container.setPosition(x, this._powerUpRowY);
        } else {
          this.tweens.add({ targets: entry.container, x, duration: 200, ease: 'Quad.Out' });
        }

        this._drawPowerUpRing(entry, p.progress);
      });
    }

    _createPowerUpIcon(type) {
      const meta = this.POWERUP_META[type] || { icon: 'fx-dot', color: 0xffffff };
      const container = this.add.container(this._powerUpRowStartX, this._powerUpRowY).setDepth(11).setAlpha(0).setScale(0.5);

      const bg = this.add.circle(0, 0, 20, 0x141a33, 0.85);
      const ring = this.add.graphics();
      const iconKey = this.textures.exists(meta.icon) ? meta.icon : 'fx-dot';
      const icon = this.add.image(0, 0, iconKey).setDisplaySize(24, 24);

      container.add([bg, ring, icon]);

      this.tweens.add({
        targets: container,
        alpha: 1,
        scale: 1,
        duration: 220,
        ease: 'Back.Out'
      });

      return { container, ring, meta };
    }

    _drawPowerUpRing(entry, progress) {
      const r = 20;
      entry.ring.clear();
      entry.ring.lineStyle(3, entry.meta.color || 0xffffff, 0.95);

      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + Math.PI * 2 * Phaser.Math.Clamp(progress, 0, 1);
      entry.ring.beginPath();
      entry.ring.arc(0, 0, r, startAngle, endAngle, false);
      entry.ring.strokePath();
    }

    // =====================================================================
    // PAUSE OVERLAY
    // =====================================================================
    _buildPauseOverlay(width, height) {
      const container = this.add.container(width / 2, height / 2).setDepth(100).setVisible(false);
      this._pauseOverlay = container;

      const overlay = this.add.rectangle(0, 0, width * 3, height * 3, 0x0b0e1a, 0.85).setInteractive();

      const panelW = width * 0.8;
      const panelH = height * 0.5;
      const panel = this.add.graphics();
      panel.fillStyle(0x141a33, 0.97);
      panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);
      panel.lineStyle(2, this.COLORS.cyan, 0.5);
      panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);

      const title = this.add.text(0, -panelH / 2 + 34, 'PAUSED', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '24px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5);

      this.pauseStatsText = this.add.text(0, -panelH / 2 + 74, '', {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', color: '#8892b0', align: 'center', lineSpacing: 4
      }).setOrigin(0.5);

      const resumeBtn = this._createOverlayButton(0, -panelH / 2 + 130, panelW * 0.7, 50, 'RESUME', true, () => {
        this.gameScene.resumeGame();
      });

      const restartBtn = this._createOverlayButton(0, -panelH / 2 + 192, panelW * 0.7, 46, 'RESTART', false, () => {
        this._hidePauseOverlay();
        this.gameScene.restartRun();
      });

      const quitBtn = this._createOverlayButton(0, -panelH / 2 + 250, panelW * 0.7, 46, 'QUIT TO MENU', false, () => {
        this._hidePauseOverlay();
        this.scene.stop();
        this.gameScene.quitToMenu();
      }, this.COLORS.danger);

      const muteToggle = this._createMuteToggle(0, panelH / 2 - 30);

      container.add([overlay, panel, title, this.pauseStatsText, resumeBtn, restartBtn, quitBtn, muteToggle]);
    }

    _createOverlayButton(x, y, w, h, label, primary, onClick, accentColor) {
      const container = this.add.container(x, y);
      const bg = this.add.graphics();

      if (primary) {
        bg.fillGradientStyle(this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      } else {
        bg.fillStyle(0x1c2348, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        bg.lineStyle(1.5, accentColor || 0xffffff, 0.4);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      }

      const text = this.add.text(0, 0, label, {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: primary ? '18px' : '15px',
        fontStyle: '700',
        color: primary ? '#0B0E1A' : (accentColor ? '#FF3B3B' : '#FFFFFF')
      }).setOrigin(0.5);

      container.add([bg, text]);
      container.setSize(w, h);
      container.setInteractive({ useHandCursor: true });

      container.on('pointerdown', () => this._pressBtn(container));
      container.on('pointerup', () => {
        this._releaseBtn(container);
        if (this.audio && this.audio.playButton) this.audio.playButton();
        onClick();
      });
      container.on('pointerout', () => this._releaseBtn(container));

      return container;
    }

    _createMuteToggle(x, y) {
      const container = this.add.container(x, y);
      const settings = this._getSettings();
      const icon = this.add.text(0, 0, settings.muted ? '🔇 Sound Off' : '🔊 Sound On', {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', color: '#8892b0'
      }).setOrigin(0.5);

      container.add(icon);
      container.setSize(140, 30);
      container.setInteractive({ useHandCursor: true });
      container.iconText = icon;

      container.on('pointerup', () => {
        if (this.audio && typeof this.audio.toggleMuteAll === 'function') {
          const nowMuted = this.audio.toggleMuteAll();
          icon.setText(nowMuted ? '🔇 Sound Off' : '🔊 Sound On');
        }
      });

      return container;
    }

    _getSettings() {
      const s = window.CubeRushStorage;
      if (s && typeof s.getSettings === 'function') return s.getSettings();
      return { muted: false };
    }

    _showPauseOverlay() {
      if (!this._pauseOverlay) return;
      const gs = this.gameScene;
      if (gs) {
        this.pauseStatsText.setText(
          `Score: ${Math.floor(gs.getScore())}   Coins: ${gs.getRunCoins()}`
        );
      }
      this._pauseOverlay.setVisible(true).setScale(0.85).setAlpha(0);
      this.tweens.add({
        targets: this._pauseOverlay,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: 'Back.Out'
      });
    }

    _hidePauseOverlay() {
      if (!this._pauseOverlay) return;
      this.tweens.add({
        targets: this._pauseOverlay,
        alpha: 0,
        scale: 0.9,
        duration: 150,
        onComplete: () => this._pauseOverlay.setVisible(false)
      });
    }

    // =====================================================================
    // BUTTON JUICE HELPERS
    // =====================================================================
    _pressBtn(container) {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scale: 0.93, duration: 80, ease: 'Quad.Out' });
    }

    _releaseBtn(container) {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scale: 1, duration: 120, ease: 'Back.Out' });
    }

    // =====================================================================
    // MAIN UPDATE LOOP — polls GameScene's public getters
    // =====================================================================
    update(time, delta) {
      const gs = this.gameScene;
      if (!gs || !gs.hasRunStarted() || gs.isGameOverState()) return;

      // ---- Score: smoothed count-up toward the real value -----------------
      const targetScore = Math.floor(gs.getScore());
      if (this._displayScore < targetScore) {
        const diff = targetScore - this._displayScore;
        this._displayScore += Math.max(1, Math.ceil(diff * 0.18));
        if (this._displayScore > targetScore) this._displayScore = targetScore;
        this.scoreText.setText(this._formatNum(this._displayScore));
      } else if (this._displayScore > targetScore) {
        // Defensive: score should never decrease mid-run, but guard anyway.
        this._displayScore = targetScore;
        this.scoreText.setText(this._formatNum(this._displayScore));
      }

      // ---- Coins --------------------------------------------------------------
      this.coinsText.setText(this._formatNum(gs.getRunCoins()));

      // ---- Combo badge --------------------------------------------------------
      this._updateComboBadge(gs.getComboMultiplier());

      // ---- Power-up row ---------------------------------------------------------
      this._updatePowerUpRow(gs.getActivePowerUps());
    }

    _formatNum(n) {
      n = Math.floor(n || 0);
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    // =====================================================================
    // RESIZE
    // =====================================================================
    onGameResize() {
      this.scene.restart();
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    _cleanup() {
      if (this.gameScene && this.gameScene.events) {
        this.gameScene.events.off('game:paused');
        this.gameScene.events.off('game:resumed');
      }
    }
  }

  window.UIScene = UIScene;
})(window);