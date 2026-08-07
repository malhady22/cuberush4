/**
 * =====================================================================
 * MenuScene.js — Cube Rush
 * =====================================================================
 * The main hub scene. Responsibilities:
 *  - Animated background + a live "energy core" cube preview reflecting
 *    the player's currently equipped skin (read from Storage.js).
 *  - HUD: coins, high score, level + XP progress bar.
 *  - Primary navigation: Play, Shop, Achievements (also houses the 50
 *    Missions tab), Daily Reward, Lucky Spin.
 *  - Secondary navigation: Settings + Credits, implemented as in-scene
 *    modal overlays (no dedicated scene files for these exist).
 *  - Notification badges on Daily Reward / Lucky Spin buttons when a
 *    reward/spin is available.
 *  - Mute toggle wired to AudioManager.
 *  - Monetization hook: shows the banner ad placeholder while idle in
 *    the menu (hidden during gameplay).
 *
 * All Storage.js reads go through defensive helper functions so this
 * scene never throws if an exact method name differs slightly from
 * what's assumed here.
 * =====================================================================
 */

(function (window) {
  'use strict';

  class MenuScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.MENU) || 'MenuScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || {
        MENU: 'MenuScene', GAME: 'GameScene', SHOP: 'ShopScene',
        ACHIEVEMENTS: 'AchievementsScene', DAILYREWARD: 'DailyRewardScene',
        LUCKYSPIN: 'LuckySpinScene'
      };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };
      this.SKINS = (C.SKINS && C.SKINS.length) ? C.SKINS : [
        { id: 0, name: 'Default Core', gradient: true, primaryColor: 0x00f0ff, secondaryColor: 0xff2e9a, glowColor: 0x00f0ff }
      ];
    }

    // =====================================================================
    // DEFENSIVE STORAGE HELPERS
    // =====================================================================
    _storage() { return window.CubeRushStorage || null; }

    _getCoins() {
      const s = this._storage();
      return s && typeof s.getCoins === 'function' ? s.getCoins() : 0;
    }

    _getHighScore() {
      const s = this._storage();
      return s && typeof s.getHighScore === 'function' ? s.getHighScore() : 0;
    }

    _getLevelInfo() {
      const s = this._storage();
      if (s && typeof s.getLevelInfo === 'function') return s.getLevelInfo();
      const level = s && typeof s.getLevel === 'function' ? s.getLevel() : 1;
      const xp = s && typeof s.getXP === 'function' ? s.getXP() : 0;
      const xpForNext = 100 * Math.pow(level, 1.5);
      return { level, xp, xpForNext: Math.round(xpForNext) };
    }

    _getSelectedSkinId() {
      const s = this._storage();
      if (s && typeof s.getSelectedSkin === 'function') return s.getSelectedSkin();
      return 0;
    }

    _getSettings() {
      const s = this._storage();
      if (s && typeof s.getSettings === 'function') return s.getSettings();
      return { musicEnabled: true, sfxEnabled: true, performanceMode: false, muted: false };
    }

    _setSetting(key, value) {
      const s = this._storage();
      if (s && typeof s.setSetting === 'function') { s.setSetting(key, value); return; }
      if (s && typeof s.updateSettings === 'function') { s.updateSettings({ [key]: value }); return; }
    }

    _isDailyRewardReady() {
      const s = this._storage();
      if (s && typeof s.isDailyRewardAvailable === 'function') return s.isDailyRewardAvailable();
      if (s && typeof s.canClaimDailyReward === 'function') return s.canClaimDailyReward();
      return true;
    }

    _isLuckySpinReady() {
      const s = this._storage();
      if (s && typeof s.isLuckySpinAvailable === 'function') return s.isLuckySpinAvailable();
      if (s && typeof s.canSpin === 'function') return s.canSpin();
      return true;
    }

    _resetAllProgress() {
      const s = this._storage();
      if (s && typeof s.resetAll === 'function') { s.resetAll(); return; }
      if (s && typeof s.reset === 'function') { s.reset(); return; }
      try { window.localStorage.clear(); } catch (e) { /* ignore */ }
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;
      this.fx = new window.EffectsManager(this);
      this.audio = window.CubeRushAudio || null;

      this._buildBackground(width, height);
      this._buildCubePreview(width, height);
      this._buildTitle(width, height);
      this._buildHUD(width, height);
      this._buildPlayButton(width, height);
      this._buildNavRow(width, height);
      this._buildSettingsModal(width, height);
      this._buildCreditsModal(width, height);

      this._refreshBadges();

      // Monetization hook: show banner while idle in the menu.
      if (window.CubeRushAds && typeof window.CubeRushAds.showBanner === 'function') {
        window.CubeRushAds.showBanner();
      }

      this.events.once('shutdown', () => this._onShutdown());

      // Fade in from Preload's fade-out.
      this.cameras.main.fadeIn(280, 11, 14, 26);
    }

    _onShutdown() {
      if (window.CubeRushAds && typeof window.CubeRushAds.hideBanner === 'function') {
        window.CubeRushAds.hideBanner();
      }
      if (this.fx) this.fx.destroy();
    }

    // =====================================================================
    // BACKGROUND
    // =====================================================================
    _buildBackground(width, height) {
      const bg = this.add.graphics();
      bg.fillGradientStyle(0x0b0e1a, 0x0b0e1a, 0x141a33, 0x0b0e1a, 1);
      bg.fillRect(0, 0, width, height);

      // Ambient drifting glow blobs for depth (cheap, additive).
      this._ambientA = this._makeAmbientGlow(width * 0.25, height * 0.2, this.COLORS.cyan, 200, 0.10);
      this._ambientB = this._makeAmbientGlow(width * 0.78, height * 0.75, this.COLORS.magenta, 220, 0.09);

      // Subtle scrolling starfield-like dot grid for motion parallax.
      this._starLayer = this.add.particles(0, 0, 'fx-dot', {
        x: { min: 0, max: width },
        y: { min: 0, max: height },
        lifespan: 6000,
        speedY: { min: 8, max: 22 },
        scale: { start: 0.18, end: 0.05 },
        alpha: { start: 0.35, end: 0 },
        tint: [this.COLORS.cyan, this.COLORS.white],
        quantity: 1,
        frequency: 220,
        blendMode: 'ADD'
      });
      this._starLayer.setDepth(0);
    }

    _makeAmbientGlow(x, y, color, radius, alpha) {
      const g = this.add.image(x, y, 'fx-glow-soft')
        .setBlendMode('ADD')
        .setTint(color)
        .setScale(radius / 64)
        .setAlpha(alpha)
        .setDepth(0);
      this.tweens.add({
        targets: g,
        x: x + Phaser.Math.Between(-40, 40),
        y: y + Phaser.Math.Between(-30, 30),
        alpha: { from: alpha, to: alpha * 1.5 },
        duration: 4000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });
      return g;
    }

    // =====================================================================
    // CUBE PREVIEW (lightweight visual — mirrors Player.js's "energy
    // core" identity without needing full physics/lane setup)
    // =====================================================================
    _buildCubePreview(width, height) {
      this._ensurePreviewTextures();

      const skinId = this._getSelectedSkinId();
      const skin = this.SKINS.find((s) => s.id === skinId) || this.SKINS[0];
      this._previewSkin = skin;

      const cx = width / 2;
      const cy = height * 0.28;
      this._previewCenter = { x: cx, y: cy };

      this.previewGlow = this.add.image(cx, cy, 'fx-glow-soft')
        .setBlendMode('ADD')
        .setTint(skin.glowColor || skin.primaryColor)
        .setScale(2.2)
        .setAlpha(0.55)
        .setDepth(1);

      this.previewBase = this.add.image(cx, cy, 'menu-cube-base').setDepth(3);
      this.previewInnerA = this.add.image(cx, cy, 'menu-cube-inner')
        .setBlendMode('ADD').setDepth(4);
      this.previewInnerB = this.add.image(cx, cy, 'menu-cube-inner')
        .setBlendMode('ADD').setDepth(4).setAlpha(0);

      this._applyPreviewSkin(skin);

      this.tweens.add({
        targets: this.previewGlow,
        scale: { from: 2.0, to: 2.5 },
        alpha: { from: 0.45, to: 0.7 },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });

      this.tweens.add({
        targets: [this.previewBase, this.previewInnerA, this.previewInnerB],
        y: cy - 10,
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });

      this._previewCrossFadeT = 0;
      this._previewRotation = 0;
    }

    _ensurePreviewTextures() {
      const tm = this.textures;
      const size = 92;

      if (!tm.exists('menu-cube-base')) {
        const canvasTex = tm.createCanvas('menu-cube-base', size, size);
        const ctx = canvasTex.getContext();
        const r = size * 0.22;
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
        grad.addColorStop(1, 'rgba(255,255,255,0.6)');
        this._roundRectPath(ctx, 3, 3, size - 6, size - 6, r);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        this._roundRectPath(ctx, 3, 3, size - 6, size - 6, r);
        ctx.stroke();
        canvasTex.refresh();
      }

      if (!tm.exists('menu-cube-inner')) {
        const innerSize = Math.round(size * 0.6);
        const canvasTex = tm.createCanvas('menu-cube-inner', innerSize, innerSize);
        const ctx = canvasTex.getContext();
        const cx = innerSize / 2, cy = innerSize / 2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerSize / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        this._roundRectPath(ctx, innerSize * 0.1, innerSize * 0.1, innerSize * 0.8, innerSize * 0.8, innerSize * 0.18);
        ctx.fill();
        canvasTex.refresh();
      }
    }

    _roundRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    _applyPreviewSkin(skin) {
      this._previewIsGradient = !!skin.gradient;
      if (this._previewIsGradient) {
        this.previewInnerA.setTint(this.COLORS.cyan);
        this.previewInnerB.setTint(this.COLORS.magenta);
      } else {
        this.previewInnerA.setTint(skin.primaryColor);
        this.previewInnerB.setTint(skin.secondaryColor || skin.primaryColor);
      }
      this.previewGlow.setTint(skin.glowColor || skin.primaryColor);
    }

    _updateCubePreview(time, delta) {
      this._previewRotation += delta * 0.05;
      this.previewInnerA.setAngle(this._previewRotation);
      this.previewInnerB.setAngle(-this._previewRotation * 0.8);

      if (this._previewIsGradient) {
        this._previewCrossFadeT += delta * 0.0016;
        const wave = (Math.sin(this._previewCrossFadeT) + 1) / 2;
        this.previewInnerA.setAlpha(0.35 + wave * 0.5);
        this.previewInnerB.setAlpha(0.85 - wave * 0.5);
      }
    }

    // =====================================================================
    // TITLE
    // =====================================================================
    _buildTitle(width, height) {
      this.add.text(width / 2, height * 0.44, 'CUBE RUSH', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: `${Math.round(width * 0.11)}px`,
        fontStyle: '700',
        color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(5);

      this.add.text(width / 2, height * 0.44 + width * 0.065, 'ENDLESS RUNNER', {
        fontFamily: 'Rubik, sans-serif',
        fontSize: '13px',
        letterSpacing: 4,
        color: '#8892b0'
      }).setOrigin(0.5).setDepth(5);
    }

    // =====================================================================
    // HUD (coins, high score, level/XP)
    // =====================================================================
    _buildHUD(width, height) {
      const pad = 16;

      // ---- Coins pill (top-left) -----------------------------------------
      this.coinsPill = this._createPill(pad, pad, 130, 40, this.COLORS.gold);
      this.coinsIcon = this.add.image(pad + 24, pad + 20, 'coin-standard' in this.textures.list ? 'coin-standard' : 'fx-dot')
        .setDisplaySize(22, 22).setDepth(11);
      if (!this.textures.exists('coin-standard')) this._drawFallbackCoinIcon();
      this.coinsText = this.add.text(pad + 42, pad + 20, this._formatNum(this._getCoins()), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '16px', fontStyle: '700', color: '#FFD23F'
      }).setOrigin(0, 0.5).setDepth(11);

      // ---- High score pill (top-right) -----------------------------------
      const hsWidth = 150;
      this.hsPill = this._createPill(width - pad - hsWidth, pad, hsWidth, 40, this.COLORS.cyan);
      this.add.text(width - pad - hsWidth + 14, pad + 20, 'BEST', {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#8892b0'
      }).setOrigin(0, 0.5).setDepth(11);
      this.hsText = this.add.text(width - pad - 14, pad + 20, this._formatNum(this._getHighScore()), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '16px', fontStyle: '700', color: '#00F0FF'
      }).setOrigin(1, 0.5).setDepth(11);

      // ---- Mute button (below high score pill) ---------------------------
      const settings = this._getSettings();
      this.muteBtn = this._createIconButton(
        width - pad - 22, pad + 56, 40,
        settings.muted ? '🔇' : '🔊',
        () => this._toggleMute()
      );

      // ---- Level badge + XP bar (below title area) ------------------------
      const levelInfo = this._getLevelInfo();
      const barY = height * 0.52;
      const barWidth = width * 0.62;

      this.levelBadge = this.add.container(width / 2 - barWidth / 2 - 26, barY);
      const badgeCircle = this.add.circle(0, 0, 22, 0x141a33).setStrokeStyle(2, this.COLORS.cyan);
      this.levelText = this.add.text(0, 0, String(levelInfo.level), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '16px', fontStyle: '700', color: '#00F0FF'
      }).setOrigin(0.5);
      this.levelBadge.add([badgeCircle, this.levelText]).setDepth(11);

      this.add.rectangle(width / 2, barY, barWidth, 12, 0xffffff, 0.08)
        .setStrokeStyle(1, 0xffffff, 0.15).setDepth(10);

      this._xpBarX = width / 2 - barWidth / 2;
      this._xpBarY = barY - 6;
      this._xpBarW = barWidth;
      this._xpBarH = 12;
      this.xpFillGfx = this.add.graphics().setDepth(11);
      this._drawXpBar(levelInfo.xp / levelInfo.xpForNext);

      this.xpLabel = this.add.text(width / 2, barY + 20, `${Math.floor(levelInfo.xp)} / ${levelInfo.xpForNext} XP`, {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#8892b0'
      }).setOrigin(0.5).setDepth(11);
    }

    _drawFallbackCoinIcon() {
      // If coin-standard texture (from CoinManager) hasn't been generated
      // yet this session (Menu loads before first GameScene run), draw a
      // simple gold circle inline so the HUD never shows a blank icon.
      this.coinsIcon.destroy();
      const g = this.add.graphics().setDepth(11);
      g.fillStyle(0xffd23f, 1);
      g.fillCircle(28, 30, 10);
      this.coinsIcon = g;
    }

    _drawXpBar(t) {
      const clamped = Phaser.Math.Clamp(t, 0, 1);
      this.xpFillGfx.clear();
      if (clamped <= 0) return;
      const w = this._xpBarW * clamped;
      this.xpFillGfx.fillGradientStyle(
        this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1
      );
      this.xpFillGfx.fillRoundedRect(this._xpBarX, this._xpBarY, w, this._xpBarH, this._xpBarH / 2);
    }

    _createPill(x, y, w, h, accentColor) {
      const g = this.add.graphics().setDepth(10);
      g.fillStyle(0x141a33, 0.85);
      g.fillRoundedRect(x, y, w, h, h / 2);
      g.lineStyle(1.5, accentColor, 0.5);
      g.strokeRoundedRect(x, y, w, h, h / 2);
      return g;
    }

    _formatNum(n) {
      n = Math.floor(n || 0);
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    // =====================================================================
    // PLAY BUTTON
    // =====================================================================
    _buildPlayButton(width, height) {
      const y = height * 0.66;
      const w = width * 0.56;
      const h = 74;

      const container = this.add.container(width / 2, y).setDepth(12);

      const glow = this.add.image(0, 0, 'fx-glow-soft')
        .setBlendMode('ADD')
        .setTint(this.COLORS.cyan)
        .setScale(w / 90, h / 40)
        .setAlpha(0.5);

      const bg = this.add.graphics();
      bg.fillGradientStyle(this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);

      const label = this.add.text(0, 0, 'PLAY', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: '30px',
        fontStyle: '700',
        color: '#0B0E1A'
      }).setOrigin(0.5);

      container.add([glow, bg, label]);
      container.setSize(w, h);
      container.setInteractive({ useHandCursor: true });

      this.tweens.add({
        targets: glow,
        alpha: { from: 0.4, to: 0.65 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut'
      });

      container.on('pointerdown', () => this._pressButton(container));
      container.on('pointerup', () => {
        this._releaseButton(container);
        this._startGame();
      });
      container.on('pointerout', () => this._releaseButton(container));

      this.playButton = container;
    }

    _startGame() {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.cameras.main.fadeOut(240, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start(this.SCENES.GAME || 'GameScene');
      });
    }

    // =====================================================================
    // NAV ROW (Shop, Achievements, Daily Reward, Lucky Spin, Settings, Credits)
    // =====================================================================
    _buildNavRow(width, height) {
      const y = height * 0.80;
      const items = [
        { key: 'shop', icon: '🛒', label: 'Shop', color: this.COLORS.gold, action: () => this._goTo(this.SCENES.SHOP) },
        { key: 'achievements', icon: '🏆', label: 'Missions', color: this.COLORS.mint, action: () => this._goTo(this.SCENES.ACHIEVEMENTS) },
        { key: 'daily', icon: '🎁', label: 'Daily', color: this.COLORS.cyan, action: () => this._goTo(this.SCENES.DAILYREWARD) },
        { key: 'spin', icon: '🎡', label: 'Spin', color: this.COLORS.magenta, action: () => this._goTo(this.SCENES.LUCKYSPIN) }
      ];

      const spacing = width / (items.length + 1);
      this._navButtons = {};

      items.forEach((item, i) => {
        const x = spacing * (i + 1);
        const btn = this._createNavButton(x, y, item);
        this._navButtons[item.key] = btn;
      });

      // Bottom mini row: Settings + Credits (text buttons, no badges needed).
      const miniY = height * 0.92;
      this._createTextButton(width * 0.32, miniY, 'SETTINGS', () => this._toggleSettingsModal(true));
      this._createTextButton(width * 0.68, miniY, 'CREDITS', () => this._toggleCreditsModal(true));
    }

    _createNavButton(x, y, item) {
      const container = this.add.container(x, y).setDepth(12);
      const radius = 30;

      const circle = this.add.circle(0, 0, radius, 0x141a33, 0.9).setStrokeStyle(2, item.color, 0.8);
      const icon = this.add.text(0, -2, item.icon, { fontSize: '24px' }).setOrigin(0.5);
      const label = this.add.text(0, radius + 14, item.label, {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#8892b0'
      }).setOrigin(0.5);

      // Notification badge (hidden by default, shown via _refreshBadges()).
      const badge = this.add.circle(radius * 0.7, -radius * 0.7, 7, 0xff3b3b).setVisible(false);
      const badgeGlow = this.add.circle(radius * 0.7, -radius * 0.7, 10, 0xff3b3b, 0.4).setVisible(false);

      container.add([badgeGlow, circle, icon, label, badge]);
      container.setSize(radius * 2, radius * 2 + 20);
      container.setInteractive({ useHandCursor: true });

      container.on('pointerdown', () => this._pressButton(container, 0.88));
      container.on('pointerup', () => { this._releaseButton(container); item.action(); });
      container.on('pointerout', () => this._releaseButton(container));

      container.badge = badge;
      container.badgeGlow = badgeGlow;
      container.circle = circle;
      return container;
    }

    _createTextButton(x, y, label, onClick) {
      const text = this.add.text(x, y, label, {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', fontStyle: '500', color: '#5865a8'
      }).setOrigin(0.5).setDepth(12).setInteractive({ useHandCursor: true });

      text.on('pointerover', () => text.setColor('#00F0FF'));
      text.on('pointerout', () => text.setColor('#5865a8'));
      text.on('pointerdown', () => text.setScale(0.94));
      text.on('pointerup', () => {
        text.setScale(1);
        if (this.audio && this.audio.playButton) this.audio.playButton();
        onClick();
      });
      return text;
    }

    _createIconButton(x, y, radius, iconChar, onClick) {
      const container = this.add.container(x, y).setDepth(12);
      const circle = this.add.circle(0, 0, radius, 0x141a33, 0.85).setStrokeStyle(1.5, 0xffffff, 0.2);
      const icon = this.add.text(0, 0, iconChar, { fontSize: '18px' }).setOrigin(0.5);
      container.add([circle, icon]);
      container.setSize(radius * 2, radius * 2);
      container.setInteractive({ useHandCursor: true });
      container.iconText = icon;

      container.on('pointerdown', () => this._pressButton(container, 0.85));
      container.on('pointerup', () => { this._releaseButton(container); onClick(); });
      container.on('pointerout', () => this._releaseButton(container));
      return container;
    }

    _pressButton(container, scale) {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scale: scale || 0.92, duration: 80, ease: 'Quad.Out' });
    }

    _releaseButton(container) {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scale: 1, duration: 120, ease: 'Back.Out' });
    }

    _goTo(sceneKey) {
      if (!sceneKey) return;
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.cameras.main.fadeOut(200, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start(sceneKey);
      });
    }

    _toggleMute() {
      if (this.audio && typeof this.audio.toggleMuteAll === 'function') {
        const nowMuted = this.audio.toggleMuteAll();
        if (this.muteBtn && this.muteBtn.iconText) {
          this.muteBtn.iconText.setText(nowMuted ? '🔇' : '🔊');
        }
      }
    }

    // =====================================================================
    // BADGES (Daily Reward / Lucky Spin availability indicators)
    // =====================================================================
    _refreshBadges() {
      const dailyReady = this._isDailyRewardReady();
      const spinReady = this._isLuckySpinReady();

      this._setBadgeVisible('daily', dailyReady);
      this._setBadgeVisible('spin', spinReady);
    }

    _setBadgeVisible(key, visible) {
      const btn = this._navButtons && this._navButtons[key];
      if (!btn) return;
      btn.badge.setVisible(visible);
      btn.badgeGlow.setVisible(visible);
      if (visible && !btn._pulseTween) {
        btn._pulseTween = this.tweens.add({
          targets: btn.badgeGlow,
          scale: { from: 0.9, to: 1.4 },
          alpha: { from: 0.5, to: 0.1 },
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut'
        });
      } else if (!visible && btn._pulseTween) {
        btn._pulseTween.stop();
        btn._pulseTween = null;
      }
    }

    // =====================================================================
    // SETTINGS MODAL
    // =====================================================================
    _buildSettingsModal(width, height) {
      const settings = this._getSettings();
      const panelW = width * 0.82;
      const panelH = height * 0.56;

      const container = this.add.container(width / 2, height / 2).setDepth(50).setVisible(false);
      this._settingsModal = container;

      const overlay = this.add.rectangle(0, 0, width * 3, height * 3, 0x000000, 0.6).setInteractive();
      const panel = this.add.graphics();
      panel.fillStyle(0x141a33, 0.97);
      panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);
      panel.lineStyle(2, this.COLORS.cyan, 0.5);
      panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);

      const title = this.add.text(0, -panelH / 2 + 30, 'SETTINGS', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5);

      const closeBtn = this._createIconButton(panelW / 2 - 30, -panelH / 2 + 30, 18, '✕', () => this._toggleSettingsModal(false));

      const toggles = [
        { key: 'musicEnabled', label: 'Music', value: settings.musicEnabled !== false },
        { key: 'sfxEnabled', label: 'Sound Effects', value: settings.sfxEnabled !== false },
        { key: 'performanceMode', label: 'Performance Mode', value: !!settings.performanceMode }
      ];

      const rowStartY = -panelH / 2 + 80;
      const rowSpacing = 56;
      const toggleSwitches = [];

      toggles.forEach((t, i) => {
        const rowY = rowStartY + i * rowSpacing;
        const label = this.add.text(-panelW / 2 + 24, rowY, t.label, {
          fontFamily: 'Rubik, sans-serif', fontSize: '15px', color: '#e6e9f5'
        }).setOrigin(0, 0.5);

        const sw = this._createToggleSwitch(panelW / 2 - 50, rowY, t.value, (newVal) => {
          this._setSetting(t.key, newVal);
          if (t.key === 'musicEnabled' && this.audio && this.audio.setMusicEnabled) {
            this.audio.setMusicEnabled(newVal);
          }
          if (t.key === 'sfxEnabled' && this.audio && this.audio.setSfxEnabled) {
            this.audio.setSfxEnabled(newVal);
          }
        });
        toggleSwitches.push(label, sw);
      });

      const resetBtn = this._createTextButton(0, panelH / 2 - 34, 'RESET PROGRESS', () => {
        this._confirmReset();
      });
      resetBtn.setColor('#FF3B3B');

      container.add([overlay, panel, title, closeBtn, resetBtn, ...toggleSwitches]);
      overlay.on('pointerdown', () => {}); // block clicks from passing through
    }

    _createToggleSwitch(x, y, initial, onChange) {
      const container = this.add.container(x, y);
      const trackW = 46, trackH = 24;
      const track = this.add.graphics();
      const knob = this.add.circle(initial ? trackW / 2 - 10 : -trackW / 2 + 10, 0, 9, 0xffffff);

      const draw = (on) => {
        track.clear();
        track.fillStyle(on ? this.COLORS.cyan : 0x2a3155, 1);
        track.fillRoundedRect(-trackW / 2, -trackH / 2, trackW, trackH, trackH / 2);
      };
      draw(initial);

      container.add([track, knob]);
      container.setSize(trackW, trackH);
      container.setInteractive({ useHandCursor: true });

      let state = initial;
      container.on('pointerup', () => {
        state = !state;
        draw(state);
        this.tweens.add({
          targets: knob,
          x: state ? trackW / 2 - 10 : -trackW / 2 + 10,
          duration: 140,
          ease: 'Quad.Out'
        });
        if (this.audio && this.audio.playButton) this.audio.playButton();
        onChange(state);
      });

      return container;
    }

    _toggleSettingsModal(show) {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this._settingsModal.setVisible(show);
      if (show) {
        this._settingsModal.setScale(0.85).setAlpha(0);
        this.tweens.add({ targets: this._settingsModal, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
      }
    }

    _confirmReset() {
      const { width, height } = this.scale;
      if (this._confirmDialog) return;

      const container = this.add.container(width / 2, height / 2).setDepth(60);
      const overlay = this.add.rectangle(0, 0, width * 3, height * 3, 0x000000, 0.75).setInteractive();
      const panelW = width * 0.7;
      const panel = this.add.graphics();
      panel.fillStyle(0x141a33, 1);
      panel.fillRoundedRect(-panelW / 2, -90, panelW, 180, 16);
      panel.lineStyle(2, this.COLORS.danger, 0.7);
      panel.strokeRoundedRect(-panelW / 2, -90, panelW, 180, 16);

      const msg = this.add.text(0, -30, 'Reset ALL progress?\nThis cannot be undone.', {
        fontFamily: 'Rubik, sans-serif', fontSize: '14px', color: '#ffffff', align: 'center'
      }).setOrigin(0.5);

      const yesBtn = this._createTextButton(-panelW / 4, 40, 'YES, RESET', () => {
        this._resetAllProgress();
        container.destroy();
        this._confirmDialog = null;
        this.scene.restart();
      });
      yesBtn.setColor('#FF3B3B');

      const noBtn = this._createTextButton(panelW / 4, 40, 'CANCEL', () => {
        container.destroy();
        this._confirmDialog = null;
      });

      container.add([overlay, panel, msg, yesBtn, noBtn]);
      this._confirmDialog = container;
    }

    // =====================================================================
    // CREDITS MODAL
    // =====================================================================
    _buildCreditsModal(width, height) {
      const panelW = width * 0.82;
      const panelH = height * 0.5;

      const container = this.add.container(width / 2, height / 2).setDepth(50).setVisible(false);
      this._creditsModal = container;

      const overlay = this.add.rectangle(0, 0, width * 3, height * 3, 0x000000, 0.6).setInteractive();
      const panel = this.add.graphics();
      panel.fillStyle(0x141a33, 0.97);
      panel.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);
      panel.lineStyle(2, this.COLORS.magenta, 0.5);
      panel.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 20);

      const title = this.add.text(0, -panelH / 2 + 30, 'CREDITS', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5);

      const body = this.add.text(0, -10,
        'CUBE RUSH\n\nDesign & Development\nCube Rush Studio\n\nBuilt with Phaser 3\nAll audio synthesized in-engine\n\nThank you for playing!',
        { fontFamily: 'Rubik, sans-serif', fontSize: '13px', color: '#c3c9e0', align: 'center', lineSpacing: 6 }
      ).setOrigin(0.5);

      const closeBtn = this._createIconButton(panelW / 2 - 30, -panelH / 2 + 30, 18, '✕', () => this._toggleCreditsModal(false));

      container.add([overlay, panel, title, body, closeBtn]);
    }

    _toggleCreditsModal(show) {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this._creditsModal.setVisible(show);
      if (show) {
        this._creditsModal.setScale(0.85).setAlpha(0);
        this.tweens.add({ targets: this._creditsModal, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
      }
    }

    // =====================================================================
    // UPDATE
    // =====================================================================
    update(time, delta) {
      this._updateCubePreview(time, delta);
    }

    // =====================================================================
    // RESIZE (called by main.js's global resize handler)
    // =====================================================================
    onGameResize() {
      // Simplest robust approach for a menu-weight scene: rebuild layout.
      this.scene.restart();
    }
  }

  window.MenuScene = MenuScene;
})(window);