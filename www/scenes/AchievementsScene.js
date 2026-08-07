/**
 * =====================================================================
 * AchievementsScene.js — Cube Rush
 * =====================================================================
 * A read-only, scrollable progress browser for the 50-mission system
 * and the 30-achievement system, both defined in MissionManager.js.
 *
 * IMPORTANT: Missions/Achievements are NOT claimed manually here —
 * MissionManager auto-completes and grants rewards the instant a
 * threshold is crossed during live gameplay (event-driven, see
 * MissionManager._evaluateAll()). This scene purely reflects current
 * progress via MissionManager's static query API:
 *   - MissionManager.buildMissionStatusList()
 *   - MissionManager.buildAchievementStatusList()
 *   - MissionManager.getCompletedMissionCount() / getTotalMissionCount()
 *   - MissionManager.getUnlockedAchievementCount() / getTotalAchievementCount()
 *
 * LAYOUT
 *  - Header: back button, title, two-tab switcher (MISSIONS / TROPHIES)
 *    each showing a live "x / y" completion counter.
 *  - Scrollable list (reuses the masked-container + drag-vs-tap
 *    disambiguation pattern established in ShopScene.js) of rows, each
 *    with a category/trophy icon, name, description, animated progress
 *    bar (missions) or lock/unlock state (achievements), and reward
 *    preview (coins/XP/chest).
 * =====================================================================
 */

(function (window) {
  'use strict';

  const CATEGORY_ICONS = {
    coins: '🪙', gems: '💎', distance: '🏃', combo: '🔥', dodge: '🛡',
    survive: '⏱', powerups: '⚡', jumps: '⬆', skins: '🎨', games: '🎮'
  };

  class AchievementsScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.ACHIEVEMENTS) || 'AchievementsScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { ACHIEVEMENTS: 'AchievementsScene', MENU: 'MenuScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };

      this.activeTab = 'missions'; // 'missions' | 'achievements'
      this._scrollY = 0;
      this._maxScrollY = 0;
      this._dragStart = null;
      this._dragTotalDist = 0;
      this._isDragging = false;
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;
      this.fx = new window.EffectsManager(this);
      this.audio = window.CubeRushAudio || null;

      this._buildBackground(width, height);
      this._buildHeader(width, height);
      this._buildTabs(width, height);
      this._buildScrollViewport(width, height);
      this._renderActiveTab();

      this.cameras.main.fadeIn(220, 11, 14, 26);
      this.events.once('shutdown', () => this._cleanup());
    }

    _cleanup() {
      if (this.fx) { this.fx.destroy(); this.fx = null; }
    }

    // =====================================================================
    // BACKGROUND / HEADER
    // =====================================================================
    _buildBackground(width, height) {
      const bg = this.add.graphics().setDepth(-2);
      bg.fillGradientStyle(0x0b0e1a, 0x0b0e1a, 0x141a33, 0x0b0e1a, 1);
      bg.fillRect(0, 0, width, height);
    }

    _buildHeader(width, height) {
      const pad = 16;
      this._createIconButton(pad + 20, pad + 20, 20, '←', () => this._goBack());

      this.add.text(width / 2, pad + 20, 'PROGRESS', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(11);

      this._headerBottomY = pad + 20 + 24;
    }

    _createIconButton(x, y, radius, iconChar, onClick) {
      const container = this.add.container(x, y).setDepth(12);
      const circle = this.add.circle(0, 0, radius, 0x141a33, 0.85).setStrokeStyle(1.5, 0xffffff, 0.2);
      const icon = this.add.text(0, -1, iconChar, { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
      container.add([circle, icon]);
      container.setSize(radius * 2, radius * 2);
      container.setInteractive({ useHandCursor: true });
      container.on('pointerdown', () => this._pressBtn(container));
      container.on('pointerup', () => { this._releaseBtn(container); onClick(); });
      container.on('pointerout', () => this._releaseBtn(container));
      return container;
    }

    _pressBtn(c) { this.tweens.killTweensOf(c); this.tweens.add({ targets: c, scale: 0.92, duration: 80 }); }
    _releaseBtn(c) { this.tweens.killTweensOf(c); this.tweens.add({ targets: c, scale: 1, duration: 120, ease: 'Back.Out' }); }

    _goBack() {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.cameras.main.fadeOut(200, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(this.SCENES.MENU));
    }

    // =====================================================================
    // TABS
    // =====================================================================
    _buildTabs(width, height) {
      const y = this._headerBottomY + 28;
      const tabW = width * 0.42;
      const tabH = 44;
      const gap = 10;
      const totalW = tabW * 2 + gap;
      const startX = width / 2 - totalW / 2;

      const MM = window.MissionManager;
      const missionCount = MM ? `${MM.getCompletedMissionCount()}/${MM.getTotalMissionCount()}` : '0/50';
      const achCount = MM ? `${MM.getUnlockedAchievementCount()}/${MM.getTotalAchievementCount()}` : '0/30';

      this.missionsTab = this._createTab(startX + tabW / 2, y, tabW, tabH, '🎯 MISSIONS', missionCount, () => this._switchTab('missions'));
      this.achievementsTab = this._createTab(startX + tabW + gap + tabW / 2, y, tabW, tabH, '🏆 TROPHIES', achCount, () => this._switchTab('achievements'));

      this._tabBottomY = y + tabH / 2 + 14;
      this._updateTabVisuals();
    }

    _createTab(x, y, w, h, label, countLabel, onClick) {
      const container = this.add.container(x, y).setDepth(11);
      const bg = this.add.graphics();
      const border = this.add.graphics();
      const text = this.add.text(0, -7, label, {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', fontStyle: '700', color: '#e6e9f5'
      }).setOrigin(0.5);
      const count = this.add.text(0, 11, countLabel, {
        fontFamily: 'Orbitron, sans-serif', fontSize: '11px', color: '#8892b0'
      }).setOrigin(0.5);

      container.add([bg, border, text, count]);
      container.setSize(w, h);
      container.setInteractive({ useHandCursor: true });
      container.bg = bg;
      container.border = border;
      container.labelText = text;
      container.countText = count;
      container.w = w;
      container.h = h;

      container.on('pointerup', () => { if (this.audio && this.audio.playButton) this.audio.playButton(); onClick(); });

      return container;
    }

    _switchTab(tab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      this._scrollY = 0;
      this._updateTabVisuals();
      this._renderActiveTab();
    }

    _updateTabVisuals() {
      [this.missionsTab, this.achievementsTab].forEach((tab, i) => {
        const key = i === 0 ? 'missions' : 'achievements';
        const active = this.activeTab === key;
        tab.bg.clear();
        tab.border.clear();
        tab.bg.fillStyle(active ? 0x1c2348 : 0x141a33, active ? 1 : 0.7);
        tab.bg.fillRoundedRect(-tab.w / 2, -tab.h / 2, tab.w, tab.h, 12);
        tab.border.lineStyle(1.5, active ? this.COLORS.cyan : 0xffffff, active ? 0.8 : 0.1);
        tab.border.strokeRoundedRect(-tab.w / 2, -tab.h / 2, tab.w, tab.h, 12);
        tab.labelText.setColor(active ? '#00F0FF' : '#8892b0');
      });
    }

    // =====================================================================
    // SCROLL VIEWPORT (shared for both tabs — content rebuilt on switch)
    // =====================================================================
    _buildScrollViewport(width, height) {
      const viewportTop = this._tabBottomY;
      const viewportBottom = height - 12;
      const viewportHeight = viewportBottom - viewportTop;

      this._viewportTop = viewportTop;
      this._viewportHeight = viewportHeight;

      const maskGfx = this.make.graphics({ x: 0, y: 0, add: false });
      maskGfx.fillStyle(0xffffff, 1);
      maskGfx.fillRect(0, viewportTop, width, viewportHeight);
      this._mask = maskGfx.createGeometryMask();

      this.contentContainer = this.add.container(0, viewportTop).setDepth(5);
      this.contentContainer.setMask(this._mask);

      const hitZone = this.add.rectangle(width / 2, viewportTop + viewportHeight / 2, width, viewportHeight, 0x000000, 0.001)
        .setDepth(4).setInteractive();

      hitZone.on('pointerdown', (pointer) => {
        this._dragStart = { y: pointer.y, scrollYAtStart: this._scrollY };
        this._dragTotalDist = 0;
        this._isDragging = true;
      });
      hitZone.on('pointermove', (pointer) => {
        if (!this._isDragging || !this._dragStart) return;
        const dy = pointer.y - this._dragStart.y;
        this._dragTotalDist = Math.max(this._dragTotalDist, Math.abs(dy));
        let newScroll = this._dragStart.scrollYAtStart - dy;
        newScroll = Phaser.Math.Clamp(newScroll, 0, this._maxScrollY);
        this._scrollY = newScroll;
        this.contentContainer.y = this._viewportTop - this._scrollY;
        this._updateScrollThumb();
      });
      hitZone.on('pointerup', () => { this._isDragging = false; this._dragStart = null; });
      hitZone.on('pointerout', () => { this._isDragging = false; this._dragStart = null; });

      this._scrollTrack = this.add.rectangle(width - 6, viewportTop + viewportHeight / 2, 3, viewportHeight * 0.9, 0xffffff, 0.08).setDepth(6).setVisible(false);
      this._scrollThumb = this.add.rectangle(width - 6, viewportTop + 20, 3, 40, 0xffffff, 0.35).setDepth(6).setVisible(false);
    }

    _updateScrollThumb() {
      if (!this._scrollThumb || this._maxScrollY <= 0) return;
      const t = this._scrollY / this._maxScrollY;
      const trackHeight = this._scrollTrack.height;
      const thumbHeight = this._scrollThumb.height;
      const travel = trackHeight - thumbHeight;
      this._scrollThumb.y = this._viewportTop + thumbHeight / 2 + travel * t;
    }

    // =====================================================================
    // RENDER ACTIVE TAB
    // =====================================================================
    _renderActiveTab() {
      this.contentContainer.removeAll(true);
      this.contentContainer.y = this._viewportTop;
      this._scrollY = 0;

      const width = this.scale.width;
      const rowW = width - 32;
      const rowGap = 12;
      let rowY = 0;

      const MM = window.MissionManager;
      const items = this.activeTab === 'missions'
        ? (MM ? MM.buildMissionStatusList() : [])
        : (MM ? MM.buildAchievementStatusList() : []);

      // Sort: incomplete first (so progress feels actionable), then by
      // completion recency isn't tracked, so fall back to definition order.
      const sorted = items.slice().sort((a, b) => {
        const aDone = this.activeTab === 'missions' ? a.completed : a.unlocked;
        const bDone = this.activeTab === 'missions' ? b.completed : b.unlocked;
        if (aDone === bDone) return 0;
        return aDone ? 1 : -1;
      });

      sorted.forEach((item) => {
        const rowH = this.activeTab === 'missions' ? 92 : 84;
        const row = this.activeTab === 'missions'
          ? this._createMissionRow(item, width / 2, rowY + rowH / 2, rowW, rowH)
          : this._createAchievementRow(item, width / 2, rowY + rowH / 2, rowW, rowH);
        this.contentContainer.add(row);
        rowY += rowH + rowGap;
      });

      this._maxScrollY = Math.max(0, rowY - this._viewportHeight);
      const hasScroll = this._maxScrollY > 0;
      this._scrollTrack.setVisible(hasScroll);
      this._scrollThumb.setVisible(hasScroll);
      if (hasScroll) {
        this._scrollThumb.height = this._viewportHeight * (this._viewportHeight / rowY);
        this._updateScrollThumb();
      }
    }

    // =====================================================================
    // MISSION ROW
    // =====================================================================
    _createMissionRow(mission, x, y, w, h) {
      const container = this.add.container(x, y);
      const completed = mission.completed;

      const bg = this.add.graphics();
      bg.fillStyle(0x141a33, completed ? 0.55 : 0.85);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      bg.lineStyle(1.5, completed ? this.COLORS.mint : 0xffffff, completed ? 0.5 : 0.08);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);

      const iconChar = CATEGORY_ICONS[mission.category] || '⭐';
      const iconBg = this.add.circle(-w / 2 + 34, 0, 22, completed ? 0x1a3d2b : 0x1c2348)
        .setStrokeStyle(1.5, completed ? this.COLORS.mint : this.COLORS.cyan, 0.6);
      const icon = this.add.text(-w / 2 + 34, 0, iconChar, { fontSize: '20px' }).setOrigin(0.5);

      const nameText = this.add.text(-w / 2 + 66, -h / 2 + 16, mission.name, {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', fontStyle: '700',
        color: completed ? '#39FF88' : '#e6e9f5'
      }).setOrigin(0, 0.5);

      const descText = this.add.text(-w / 2 + 66, -h / 2 + 36, mission.description, {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#8892b0',
        wordWrap: { width: w - 150 }
      }).setOrigin(0, 0.5);

      // Progress bar.
      const barW = w - 100;
      const barX = -w / 2 + 66;
      const barY = h / 2 - 20;
      const barTrack = this.add.rectangle(barX, barY, barW, 8, 0xffffff, 0.08).setOrigin(0, 0.5)
        .setStrokeStyle(1, 0xffffff, 0.1);
      const barFill = this.add.graphics();
      const fillW = barW * Phaser.Math.Clamp(mission.progress, 0, 1);
      barFill.fillGradientStyle(this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1);
      barFill.fillRoundedRect(barX, barY - 4, Math.max(2, fillW), 8, 4);

      const progressLabel = this.add.text(barX + barW, barY, `${mission.currentValue}/${mission.target}`, {
        fontFamily: 'Rubik, sans-serif', fontSize: '10px', color: '#8892b0'
      }).setOrigin(1, 0.5);

      // Reward preview (top-right).
      const rewardText = this.add.text(w / 2 - 14, -h / 2 + 16,
        `🪙${mission.rewardCoins} ⚡${mission.rewardXp}${mission.grantsChest ? ' 🎁' : ''}`, {
        fontFamily: 'Rubik, sans-serif', fontSize: '10px', color: '#FFD23F'
      }).setOrigin(1, 0.5);

      const checkMark = this.add.text(w / 2 - 14, 0, completed ? '✔' : '', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '18px', color: '#39FF88'
      }).setOrigin(1, 0.5);

      container.add([bg, iconBg, icon, nameText, descText, barTrack, barFill, progressLabel, rewardText, checkMark]);
      return container;
    }

    // =====================================================================
    // ACHIEVEMENT ROW
    // =====================================================================
    _createAchievementRow(ach, x, y, w, h) {
      const container = this.add.container(x, y);
      const unlocked = ach.unlocked;

      const bg = this.add.graphics();
      bg.fillStyle(0x141a33, unlocked ? 0.55 : 0.85);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      bg.lineStyle(1.5, unlocked ? this.COLORS.gold : 0xffffff, unlocked ? 0.6 : 0.08);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);

      const iconBg = this.add.circle(-w / 2 + 34, 0, 24, unlocked ? 0x3d2f0f : 0x1c2348)
        .setStrokeStyle(2, unlocked ? this.COLORS.gold : 0x4a5080, 0.8);
      const icon = this.add.text(-w / 2 + 34, 0, unlocked ? '🏆' : '🔒', { fontSize: '20px' }).setOrigin(0.5);

      if (!unlocked) {
        icon.setAlpha(0.6);
        iconBg.setAlpha(0.6);
      }

      const nameText = this.add.text(-w / 2 + 68, -h / 2 + 20, ach.name, {
        fontFamily: 'Rubik, sans-serif', fontSize: '14px', fontStyle: '700',
        color: unlocked ? '#FFD23F' : '#7a8099'
      }).setOrigin(0, 0.5);

      const descText = this.add.text(-w / 2 + 68, -h / 2 + 42, ach.description, {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#8892b0',
        wordWrap: { width: w - 100 }
      }).setOrigin(0, 0.5);

      const rewardText = this.add.text(-w / 2 + 68, h / 2 - 16,
        `🪙${ach.rewardCoins}${ach.rewardXp ? ` ⚡${ach.rewardXp}` : ''}`, {
        fontFamily: 'Rubik, sans-serif', fontSize: '10px', color: unlocked ? '#FFD23F' : '#5a5f7a'
      }).setOrigin(0, 0.5);

      const statusIcon = this.add.text(w / 2 - 14, 0, unlocked ? '✔' : '', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '18px', color: '#39FF88'
      }).setOrigin(1, 0.5);

      container.add([bg, iconBg, icon, nameText, descText, rewardText, statusIcon]);
      if (!unlocked) container.setAlpha(0.85);
      return container;
    }

    // =====================================================================
    // RESIZE
    // =====================================================================
    onGameResize() {
      this.scene.restart();
    }
  }

  window.AchievementsScene = AchievementsScene;
})(window);