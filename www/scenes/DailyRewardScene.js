/**
 * =====================================================================
 * DailyRewardScene.js — Cube Rush
 * =====================================================================
 * A 7-day escalating login-reward cycle. Responsibilities:
 *  - Render a horizontal 7-day reward strip showing claimed / current /
 *    locked (future) days.
 *  - If a reward is available: big animated "CLAIM" button that grants
 *    coins/XP/gems/chest depending on the day, with a full chest-open
 *    style celebration.
 *  - If already claimed today: show a live countdown to the next
 *    available claim (HH:MM:SS), refreshed every second.
 *  - Streak logic: claiming within 24-48h of the last claim continues
 *    the streak; missing the 48h window resets to Day 1.
 *  - All persistence goes through Storage.js where available, with a
 *    fully self-contained localStorage-backed fallback (mirroring the
 *    defensive pattern used in MissionManager.js) so this scene never
 *    throws regardless of the exact Storage.js method names.
 *
 * NOTE: Reward types are intentionally limited to coins / XP / gem-
 * equivalent bonus coins / reward chests — NOT power-up grants —
 * since activating a power-up requires a live GameScene+PowerUpManager
 * instance that doesn't exist while browsing menus. This keeps the
 * reward pipeline simple and 100% reliable.
 * =====================================================================
 */

(function (window) {
  'use strict';

  const FALLBACK_KEY = 'cubeRush_dailyReward_v1';
  const CYCLE_LENGTH = 7;
  const STREAK_RESET_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h grace window
  const CLAIM_COOLDOWN_MS = 20 * 60 * 60 * 1000; // must wait 20h between claims

  // 7-day reward roster. Escalates toward a big Day-7 chest.
  const REWARD_DEFS = [
    { day: 1, type: 'coins', amount: 50, icon: '🪙' },
    { day: 2, type: 'coins', amount: 100, icon: '🪙' },
    { day: 3, type: 'xp', amount: 80, icon: '⚡' },
    { day: 4, type: 'coins', amount: 200, icon: '🪙' },
    { day: 5, type: 'chest', amount: 1, icon: '🎁' },
    { day: 6, type: 'coins', amount: 350, icon: '🪙' },
    { day: 7, type: 'bigchest', amount: 1, icon: '👑' }
  ];

  class DailyRewardScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.DAILYREWARD) || 'DailyRewardScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { DAILYREWARD: 'DailyRewardScene', MENU: 'MenuScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };
      this._countdownEvent = null;
    }

    // =====================================================================
    // DEFENSIVE STORAGE / FALLBACK STREAK LOGIC
    // =====================================================================
    _storage() { return window.CubeRushStorage || null; }

    _loadFallbackState() {
      try {
        const raw = window.localStorage.getItem(FALLBACK_KEY);
        return raw ? JSON.parse(raw) : { streak: 0, lastClaimTs: 0 };
      } catch (e) {
        return { streak: 0, lastClaimTs: 0 };
      }
    }

    _saveFallbackState(state) {
      try { window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }

    /**
     * @returns {{available:boolean, streak:number, msUntilNext:number}}
     */
    _getStatus() {
      const s = this._storage();

      if (s && typeof s.getDailyRewardStatus === 'function') {
        const result = s.getDailyRewardStatus();
        if (result && typeof result.available === 'boolean') return result;
      }

      // Fallback implementation.
      const state = this._loadFallbackState();
      const now = Date.now();
      const elapsed = now - state.lastClaimTs;

      if (state.lastClaimTs === 0) {
        return { available: true, streak: state.streak, msUntilNext: 0 };
      }

      if (elapsed >= STREAK_RESET_WINDOW_MS) {
        // Missed the window — streak will reset on next claim, but a
        // claim is available right now.
        return { available: true, streak: 0, msUntilNext: 0 };
      }

      if (elapsed >= CLAIM_COOLDOWN_MS) {
        return { available: true, streak: state.streak, msUntilNext: 0 };
      }

      return { available: false, streak: state.streak, msUntilNext: CLAIM_COOLDOWN_MS - elapsed };
    }

    /**
     * Performs the claim, applies the reward via Storage.js, and returns
     * the reward definition + resulting day number (1-7) for UI display.
     */
    _claim() {
      const s = this._storage();

      if (s && typeof s.claimDailyReward === 'function') {
        const result = s.claimDailyReward(REWARD_DEFS);
        if (result && result.reward) return result;
      }

      // Fallback implementation.
      const state = this._loadFallbackState();
      const now = Date.now();
      const elapsed = now - state.lastClaimTs;

      let newStreak;
      if (state.lastClaimTs === 0 || elapsed >= STREAK_RESET_WINDOW_MS) {
        newStreak = 1;
      } else {
        newStreak = state.streak + 1;
        if (newStreak > CYCLE_LENGTH) newStreak = 1;
      }

      state.streak = newStreak;
      state.lastClaimTs = now;
      this._saveFallbackState(state);

      const dayIndex = ((newStreak - 1) % CYCLE_LENGTH);
      const reward = REWARD_DEFS[dayIndex];

      this._applyReward(reward);

      return { reward, day: dayIndex + 1, streak: newStreak };
    }

    _applyReward(reward) {
      const s = this._storage();
      switch (reward.type) {
        case 'coins':
          if (s && typeof s.addCoins === 'function') s.addCoins(reward.amount);
          break;
        case 'xp':
          if (s && typeof s.addXP === 'function') {
            const curve = (window.Config && window.Config.XP && window.Config.XP.xpForLevel)
              || ((level) => Math.round(100 * Math.pow(level, 1.5)));
            s.addXP(reward.amount, curve);
          }
          break;
        case 'chest':
          if (s && typeof s.addChest === 'function') s.addChest(1);
          else if (s && typeof s.addCoins === 'function') s.addCoins(150); // fallback value
          break;
        case 'bigchest':
          if (s && typeof s.addChest === 'function') s.addChest(2);
          else if (s && typeof s.addCoins === 'function') s.addCoins(400); // fallback value
          break;
        default:
          break;
      }
    }

    _getCoins() {
      const s = this._storage();
      return s && typeof s.getCoins === 'function' ? s.getCoins() : 0;
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;
      this.fx = new window.EffectsManager(this);
      this.audio = window.CubeRushAudio || null;

      this.status = this._getStatus();

      this._buildBackground(width, height);
      this._buildHeader(width, height);
      this._buildDayStrip(width, height);
      this._buildClaimArea(width, height);
      this._buildCoinsFooter(width, height);

      this.cameras.main.fadeIn(220, 11, 14, 26);
      this.events.once('shutdown', () => this._cleanup());
    }

    _cleanup() {
      if (this._countdownEvent) { this._countdownEvent.remove(false); this._countdownEvent = null; }
      if (this.fx) { this.fx.destroy(); this.fx = null; }
    }

    // =====================================================================
    // BACKGROUND / HEADER
    // =====================================================================
    _buildBackground(width, height) {
      const bg = this.add.graphics().setDepth(-2);
      bg.fillGradientStyle(0x0b0e1a, 0x0b0e1a, 0x1a1633, 0x0b0e1a, 1);
      bg.fillRect(0, 0, width, height);

      this._ambientGlow = this.add.image(width / 2, height * 0.2, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.gold).setScale(3.2).setAlpha(0.12).setDepth(-1);
      this.tweens.add({
        targets: this._ambientGlow, alpha: { from: 0.08, to: 0.18 }, duration: 1800,
        yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });
    }

    _buildHeader(width, height) {
      const pad = 16;
      this._createIconButton(pad + 20, pad + 20, 20, '←', () => this._goBack());

      this.add.text(width / 2, pad + 20, 'DAILY REWARD', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '19px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(11);

      const streakLabel = this.status.streak > 0
        ? `🔥 ${this.status.streak} Day Streak`
        : 'Start your streak!';
      this.streakText = this.add.text(width / 2, pad + 46, streakLabel, {
        fontFamily: 'Rubik, sans-serif', fontSize: '12px', color: '#FFD23F'
      }).setOrigin(0.5).setDepth(11);
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
    // 7-DAY STRIP
    // =====================================================================
    _buildDayStrip(width, height) {
      const y = height * 0.32;
      const currentDayInCycle = this.status.streak > 0
        ? ((this.status.streak - 1) % CYCLE_LENGTH) + 1
        : 1;

      // The day about to be claimed (if available) or just claimed.
      const activeDay = this.status.available
        ? (this.status.streak === 0 ? 1 : (currentDayInCycle % CYCLE_LENGTH) + 1)
        : currentDayInCycle;

      const cols = 4;
      const rows = 2;
      const cardW = Math.min(78, (width - 48) / cols - 8);
      const cardH = 88;
      const gapX = 10;
      const gapY = 12;
      const totalRowWidth = cols * cardW + (cols - 1) * gapX;
      const startX = width / 2 - totalRowWidth / 2 + cardW / 2;

      this._dayCards = [];

      REWARD_DEFS.forEach((reward, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (cardW + gapX);
        const yy = y + row * (cardH + gapY);

        const dayNum = reward.day;
        const isPast = this.status.available
          ? dayNum < activeDay
          : dayNum < activeDay;
        const isActive = dayNum === activeDay;

        const card = this._createDayCard(reward, x, yy, cardW, cardH, isPast, isActive);
        this._dayCards.push(card);
      });

      this._dayStripBottomY = y + rows * (cardH + gapY) - gapY + cardH / 2;
    }

    _createDayCard(reward, x, y, w, h, isPast, isActive) {
      const container = this.add.container(x, y).setDepth(10);

      const bg = this.add.graphics();
      const borderColor = isActive ? this.COLORS.gold : (isPast ? this.COLORS.mint : 0xffffff);
      const borderAlpha = isActive ? 0.9 : (isPast ? 0.5 : 0.08);
      bg.fillStyle(0x141a33, isActive ? 0.95 : 0.75);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      bg.lineStyle(isActive ? 2.5 : 1.5, borderColor, borderAlpha);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);

      const dayLabel = this.add.text(0, -h / 2 + 14, `DAY ${reward.day}`, {
        fontFamily: 'Rubik, sans-serif', fontSize: '9px', fontStyle: '600',
        color: isActive ? '#FFD23F' : '#8892b0'
      }).setOrigin(0.5);

      const icon = this.add.text(0, -4, isPast ? '✔' : reward.icon, {
        fontSize: isPast ? '22px' : '24px', color: isPast ? '#39FF88' : '#ffffff'
      }).setOrigin(0.5);

      const amountLabel = this.add.text(0, h / 2 - 16,
        reward.type === 'chest' || reward.type === 'bigchest' ? 'CHEST' : `${reward.amount}`, {
        fontFamily: 'Orbitron, sans-serif', fontSize: '11px', fontStyle: '700',
        color: isPast ? '#39FF88' : (isActive ? '#FFD23F' : '#e6e9f5')
      }).setOrigin(0.5);

      container.add([bg, dayLabel, icon, amountLabel]);

      if (isActive && this.status.available) {
        this.tweens.add({
          targets: container, scale: { from: 1, to: 1.06 }, duration: 700,
          yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });
        const glow = this.add.image(x, y, 'fx-glow-soft')
          .setBlendMode('ADD').setTint(this.COLORS.gold).setScale(1.4).setAlpha(0.4).setDepth(9);
        this.tweens.add({
          targets: glow, alpha: { from: 0.25, to: 0.5 }, duration: 700,
          yoyo: true, repeat: -1, ease: 'Sine.InOut'
        });
      }

      if (isPast) container.setAlpha(0.7);

      return { container, reward, isActive, isPast };
    }

    // =====================================================================
    // CLAIM AREA (button OR countdown)
    // =====================================================================
    _buildClaimArea(width, height) {
      const y = this._dayStripBottomY + 56;

      if (this.status.available) {
        this._buildClaimButton(width, y);
      } else {
        this._buildCountdown(width, y);
      }
    }

    _buildClaimButton(width, y) {
      const w = width * 0.7;
      const h = 62;
      const container = this.add.container(width / 2, y).setDepth(12);

      const glow = this.add.image(0, 0, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.gold).setScale(w / 90, h / 40).setAlpha(0.5);
      const bg = this.add.graphics();
      bg.fillGradientStyle(this.COLORS.gold, 0xffb347, this.COLORS.gold, 0xffb347, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      const label = this.add.text(0, 0, '🎁 CLAIM REWARD', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#0B0E1A'
      }).setOrigin(0.5);

      container.add([glow, bg, label]);
      container.setSize(w, h);
      container.setInteractive({ useHandCursor: true });

      this.tweens.add({
        targets: glow, alpha: { from: 0.4, to: 0.7 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });

      container.on('pointerdown', () => this._pressBtn(container));
      container.on('pointerup', () => {
        this._releaseBtn(container);
        this._onClaimPressed(container, label);
      });
      container.on('pointerout', () => this._releaseBtn(container));

      this.claimButton = container;
    }

    _buildCountdown(width, y) {
      this.add.text(width / 2, y - 14, 'NEXT REWARD IN', {
        fontFamily: 'Rubik, sans-serif', fontSize: '12px', color: '#8892b0'
      }).setOrigin(0.5).setDepth(11);

      this.countdownText = this.add.text(width / 2, y + 12, this._formatCountdown(this.status.msUntilNext), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '28px', fontStyle: '700', color: '#00F0FF'
      }).setOrigin(0.5).setDepth(11);

      this._countdownRemaining = this.status.msUntilNext;
      this._countdownEvent = this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          this._countdownRemaining = Math.max(0, this._countdownRemaining - 1000);
          this.countdownText.setText(this._formatCountdown(this._countdownRemaining));
          if (this._countdownRemaining <= 0) {
            this._countdownEvent.remove(false);
            this.scene.restart(); // refresh into claimable state
          }
        }
      });
    }

    _formatCountdown(ms) {
      const totalSec = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // =====================================================================
    // CLAIM LOGIC
    // =====================================================================
    _onClaimPressed(container, label) {
      if (this._claimed) return;
      this._claimed = true;

      const result = this._claim();
      const reward = result.reward;

      container.disableInteractive();
      this.tweens.killTweensOf(container);

      if (this.audio && this.audio.playChestOpen) this.audio.playChestOpen();
      else if (this.audio && this.audio.playAchievement) this.audio.playAchievement();

      if (this.fx) {
        this.fx.chestOpenBurst(container.x, container.y);
        this.fx.screenShake(0.01, 180);
      }

      let rewardLabel = '';
      switch (reward.type) {
        case 'coins': rewardLabel = `+${reward.amount} COINS`; break;
        case 'xp': rewardLabel = `+${reward.amount} XP`; break;
        case 'chest': rewardLabel = `+1 REWARD CHEST`; break;
        case 'bigchest': rewardLabel = `+2 REWARD CHESTS`; break;
        default: rewardLabel = 'REWARD CLAIMED'; break;
      }

      label.setText(`✔ ${rewardLabel}`);

      this.tweens.add({
        targets: container,
        scale: { from: 1, to: 1.1 },
        duration: 200,
        yoyo: true,
        ease: 'Quad.Out'
      });

      if (this.fx) {
        this.fx.floatingText(container.x, container.y - 50, rewardLabel, {
          color: this.COLORS.gold, fontSize: 22
        });
      }

      // Refresh the streak label + coins footer + day strip highlight.
      this.streakText.setText(`🔥 ${result.streak} Day Streak`);
      if (this.coinsFooterText) {
        this.time.delayedCall(300, () => {
          this.coinsFooterText.setText(this._formatNum(this._getCoins()));
        });
      }

      // Mark the active day card as claimed visually.
      const activeCard = this._dayCards.find((c) => c.isActive);
      if (activeCard) {
        this.tweens.add({ targets: activeCard.container, alpha: 0.7, duration: 300 });
      }

      // After a short beat, auto-return to menu so the flow feels complete.
      this.time.delayedCall(1600, () => this._goBack());
    }

    // =====================================================================
    // COINS FOOTER
    // =====================================================================
    _buildCoinsFooter(width, height) {
      const y = height - 40;
      this.add.text(width / 2 - 12, y, '🪙', { fontSize: '16px' }).setOrigin(1, 0.5).setDepth(11);
      this.coinsFooterText = this.add.text(width / 2 + 6, y, this._formatNum(this._getCoins()), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '15px', fontStyle: '700', color: '#FFD23F'
      }).setOrigin(0, 0.5).setDepth(11);
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
  }

  window.DailyRewardScene = DailyRewardScene;
})(window);