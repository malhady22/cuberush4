/**
 * =====================================================================
 * LuckySpinScene.js — Cube Rush
 * =====================================================================
 * A weighted prize wheel the player can spin once per cooldown window
 * (default 24h) for a chance at coins, XP, or reward chests.
 *
 * WHEEL MODEL
 *  - 8 segments, each with a reward definition + spin weight (mirrors
 *    the weighted-random pattern used in ObstacleManager/PowerUpManager
 *    for type selection).
 *  - A reward is chosen FIRST (server-authoritative style, even though
 *    this is client-only) via weighted random selection, THEN the
 *    wheel's target rotation is computed so the chosen segment lands
 *    exactly under the fixed top pointer — this guarantees the visual
 *    result always matches the actual granted reward (no possibility
 *    of a "lying wheel").
 *  - Spin animation: several full rotations + the precise offset needed
 *    to land on the chosen segment, eased out over ~4.2s so the wheel
 *    visibly decelerates into its result.
 *
 * NOTE: Like DailyRewardScene, rewards are limited to coins / XP /
 * reward chests — no power-up grants — since activating a power-up
 * requires a live GameScene+PowerUpManager instance that doesn't exist
 * while browsing menus.
 *
 * PERSISTENCE: Uses Storage.js typed methods where available, with a
 * fully self-contained localStorage-backed fallback (same defensive
 * pattern as MissionManager.js / DailyRewardScene.js) so this scene
 * never throws regardless of exact Storage.js method names.
 * =====================================================================
 */

(function (window) {
  'use strict';

  const FALLBACK_KEY = 'cubeRush_luckySpin_v1';
  const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h between spins

  // 8 weighted wheel segments. Weights favor small/medium coin rewards,
  // with rare jackpot and chest slots for excitement.
  const SEGMENT_DEFS = [
    { id: 'coins_30', type: 'coins', amount: 30, label: '30', icon: '🪙', weight: 24, color: 0x1c2348 },
    { id: 'coins_100', type: 'coins', amount: 100, label: '100', icon: '🪙', weight: 18, color: 0x141a33 },
    { id: 'xp_50', type: 'xp', amount: 50, label: '50 XP', icon: '⚡', weight: 16, color: 0x1c2348 },
    { id: 'coins_200', type: 'coins', amount: 200, label: '200', icon: '🪙', weight: 14, color: 0x141a33 },
    { id: 'chest_1', type: 'chest', amount: 1, label: 'CHEST', icon: '🎁', weight: 10, color: 0x1c2348 },
    { id: 'coins_50', type: 'coins', amount: 50, label: '50', icon: '🪙', weight: 12, color: 0x141a33 },
    { id: 'xp_150', type: 'xp', amount: 150, label: '150 XP', icon: '⚡', weight: 4, color: 0x1c2348 },
    { id: 'jackpot_500', type: 'coins', amount: 500, label: 'JACKPOT', icon: '👑', weight: 2, color: 0x3d2f0f }
  ];

  class LuckySpinScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.LUCKYSPIN) || 'LuckySpinScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { LUCKYSPIN: 'LuckySpinScene', MENU: 'MenuScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };
      this.segments = this._resolveSegments();
      this._isSpinning = false;
      this._countdownEvent = null;
    }

    _resolveSegments() {
      const C = window.Config || {};
      if (C.LUCKYSPIN && Array.isArray(C.LUCKYSPIN.segments) && C.LUCKYSPIN.segments.length >= 6) {
        return C.LUCKYSPIN.segments;
      }
      return SEGMENT_DEFS;
    }

    // =====================================================================
    // DEFENSIVE STORAGE / FALLBACK COOLDOWN LOGIC
    // =====================================================================
    _storage() { return window.CubeRushStorage || null; }

    _loadFallbackState() {
      try {
        const raw = window.localStorage.getItem(FALLBACK_KEY);
        return raw ? JSON.parse(raw) : { lastSpinTs: 0 };
      } catch (e) {
        return { lastSpinTs: 0 };
      }
    }

    _saveFallbackState(state) {
      try { window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }

    /** @returns {{available:boolean, msUntilNext:number}} */
    _getStatus() {
      const s = this._storage();
      if (s && typeof s.getLuckySpinStatus === 'function') {
        const result = s.getLuckySpinStatus();
        if (result && typeof result.available === 'boolean') return result;
      }

      const state = this._loadFallbackState();
      const elapsed = Date.now() - state.lastSpinTs;
      if (state.lastSpinTs === 0 || elapsed >= SPIN_COOLDOWN_MS) {
        return { available: true, msUntilNext: 0 };
      }
      return { available: false, msUntilNext: SPIN_COOLDOWN_MS - elapsed };
    }

    _markSpun() {
      const s = this._storage();
      if (s && typeof s.markLuckySpinUsed === 'function') { s.markLuckySpinUsed(); return; }
      const state = this._loadFallbackState();
      state.lastSpinTs = Date.now();
      this._saveFallbackState(state);
    }

    _applyReward(segment) {
      const s = this._storage();
      switch (segment.type) {
        case 'coins':
          if (s && typeof s.addCoins === 'function') s.addCoins(segment.amount);
          break;
        case 'xp':
          if (s && typeof s.addXP === 'function') {
            const curve = (window.Config && window.Config.XP && window.Config.XP.xpForLevel)
              || ((level) => Math.round(100 * Math.pow(level, 1.5)));
            s.addXP(segment.amount, curve);
          }
          break;
        case 'chest':
          if (s && typeof s.addChest === 'function') s.addChest(segment.amount);
          else if (s && typeof s.addCoins === 'function') s.addCoins(150);
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
    // WEIGHTED SELECTION (chosen BEFORE the wheel animates, so the visual
    // result is guaranteed to match the granted reward)
    // =====================================================================
    _pickWeightedSegmentIndex() {
      let total = 0;
      this.segments.forEach((s) => { total += s.weight; });
      let roll = Math.random() * total;
      for (let i = 0; i < this.segments.length; i++) {
        roll -= this.segments[i].weight;
        if (roll <= 0) return i;
      }
      return this.segments.length - 1;
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
      this._buildWheel(width, height);
      this._buildSpinArea(width, height);
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

      this._ambientGlow = this.add.image(width / 2, height * 0.4, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.magenta).setScale(3.4).setAlpha(0.1).setDepth(-1);
      this.tweens.add({
        targets: this._ambientGlow, alpha: { from: 0.06, to: 0.16 }, duration: 2000,
        yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });
    }

    _buildHeader(width, height) {
      const pad = 16;
      this._createIconButton(pad + 20, pad + 20, 20, '←', () => this._goBack());

      this.add.text(width / 2, pad + 20, 'LUCKY SPIN', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(11);

      this.add.text(width / 2, pad + 46, 'Spin once every 24 hours', {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', color: '#8892b0'
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
      if (this._isSpinning) return;
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.cameras.main.fadeOut(200, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(this.SCENES.MENU));
    }

    // =====================================================================
    // WHEEL CONSTRUCTION
    // =====================================================================
    _buildWheel(width, height) {
      const cx = width / 2;
      const cy = height * 0.4;
      const radius = Math.min(width * 0.4, height * 0.24);

      this._wheelCenter = { x: cx, y: cy };
      this._wheelRadius = radius;
      this._segmentAngle = 360 / this.segments.length;

      // Outer glow ring behind the wheel.
      this.wheelGlow = this.add.image(cx, cy, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.magenta).setScale((radius * 2.4) / 128).setAlpha(0.35).setDepth(4);
      this.tweens.add({
        targets: this.wheelGlow, alpha: { from: 0.25, to: 0.45 }, duration: 1200,
        yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });

      // Wheel container — rotating this rotates all segments together.
      this.wheelContainer = this.add.container(cx, cy).setDepth(5);

      const wheelGfx = this.add.graphics();
      this.segments.forEach((seg, i) => {
        const startAngle = Phaser.Math.DegToRad(i * this._segmentAngle - 90);
        const endAngle = Phaser.Math.DegToRad((i + 1) * this._segmentAngle - 90);

        wheelGfx.fillStyle(seg.color !== undefined ? seg.color : (i % 2 === 0 ? 0x1c2348 : 0x141a33), 1);
        wheelGfx.slice(0, 0, radius, startAngle, endAngle, false);
        wheelGfx.fillPath();
      });

      // Segment divider lines.
      wheelGfx.lineStyle(2, 0xffffff, 0.08);
      for (let i = 0; i < this.segments.length; i++) {
        const angle = Phaser.Math.DegToRad(i * this._segmentAngle - 90);
        wheelGfx.beginPath();
        wheelGfx.moveTo(0, 0);
        wheelGfx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        wheelGfx.strokePath();
      }

      // Outer rim.
      wheelGfx.lineStyle(4, this.COLORS.cyan, 0.6);
      wheelGfx.strokeCircle(0, 0, radius);

      this.wheelContainer.add(wheelGfx);

      // Segment labels (icon + text), rotated to align with their slice.
      this.segments.forEach((seg, i) => {
        const midAngle = Phaser.Math.DegToRad((i + 0.5) * this._segmentAngle - 90);
        const labelRadius = radius * 0.66;
        const lx = Math.cos(midAngle) * labelRadius;
        const ly = Math.sin(midAngle) * labelRadius;
        const rotationDeg = (i + 0.5) * this._segmentAngle;

        const labelContainer = this.add.container(lx, ly);
        labelContainer.setAngle(rotationDeg);

        const icon = this.add.text(0, -10, seg.icon, { fontSize: '18px' }).setOrigin(0.5);
        const text = this.add.text(0, 10, seg.label, {
          fontFamily: 'Orbitron, sans-serif', fontSize: '11px', fontStyle: '700', color: '#FFFFFF'
        }).setOrigin(0.5);

        labelContainer.add([icon, text]);
        this.wheelContainer.add(labelContainer);
      });

      // Hub cap in the center.
      const hub = this.add.circle(0, 0, radius * 0.14, 0x0b0e1a).setStrokeStyle(3, this.COLORS.gold, 1);
      const hubIcon = this.add.text(0, 0, '★', { fontSize: '16px', color: '#FFD23F' }).setOrigin(0.5);
      this.wheelContainer.add([hub, hubIcon]);

      // Fixed pointer at the top (does NOT rotate with the wheel).
      const pointer = this.add.triangle(
        cx, cy - radius - 6,
        -14, 0, 14, 0, 0, 24,
        this.COLORS.gold
      ).setDepth(6).setStrokeStyle(2, 0xffffff, 0.8);
      this.wheelPointer = pointer;
    }

    // =====================================================================
    // SPIN AREA (button OR countdown)
    // =====================================================================
    _buildSpinArea(width, height) {
      const y = height * 0.74;

      if (this.status.available) {
        this._buildSpinButton(width, y);
      } else {
        this._buildCountdown(width, y);
      }
    }

    _buildSpinButton(width, y) {
      const w = width * 0.62;
      const h = 62;
      const container = this.add.container(width / 2, y).setDepth(12);

      const glow = this.add.image(0, 0, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.magenta).setScale(w / 90, h / 40).setAlpha(0.5);
      const bg = this.add.graphics();
      bg.fillGradientStyle(this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      const label = this.add.text(0, 0, '🎡 SPIN NOW', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#0B0E1A'
      }).setOrigin(0.5);

      container.add([glow, bg, label]);
      container.setSize(w, h);
      container.setInteractive({ useHandCursor: true });

      this.tweens.add({
        targets: glow, alpha: { from: 0.4, to: 0.65 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });

      container.on('pointerdown', () => this._pressBtn(container));
      container.on('pointerup', () => { this._releaseBtn(container); this._onSpinPressed(container, label); });
      container.on('pointerout', () => this._releaseBtn(container));

      this.spinButton = container;
    }

    _buildCountdown(width, y) {
      this.add.text(width / 2, y - 16, 'NEXT SPIN IN', {
        fontFamily: 'Rubik, sans-serif', fontSize: '12px', color: '#8892b0'
      }).setOrigin(0.5).setDepth(11);

      this.countdownText = this.add.text(width / 2, y + 10, this._formatCountdown(this.status.msUntilNext), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '28px', fontStyle: '700', color: '#FF2E9A'
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
            this.scene.restart();
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
    // SPIN LOGIC
    // =====================================================================
    _onSpinPressed(container, label) {
      if (this._isSpinning) return;
      this._isSpinning = true;
      container.disableInteractive();
      this.tweens.killTweensOf(container);

      // 1. Choose the reward FIRST.
      const chosenIndex = this._pickWeightedSegmentIndex();
      const chosenSegment = this.segments[chosenIndex];

      // 2. Compute the exact rotation needed to land that segment under
      //    the fixed top pointer, plus several full spins for showmanship.
      const segMidAngle = (chosenIndex + 0.5) * this._segmentAngle;
      // The wheel's current visual rotation (mod 360) so we always spin
      // FORWARD from wherever it currently rests, never backward/jumping.
      const currentRotation = ((this.wheelContainer.angle % 360) + 360) % 360;
      // We need the segment's mid-angle to end up at -90deg (i.e. under
      // the top pointer) after rotation. Since segments are drawn
      // starting at -90deg offset already, the target absolute angle
      // for "segment under pointer" is simply -segMidAngle (mod 360).
      const targetRestAngle = ((-segMidAngle % 360) + 360) % 360;

      const extraSpins = 6; // full rotations for visual excitement
      let deltaToTarget = targetRestAngle - currentRotation;
      deltaToTarget = ((deltaToTarget % 360) + 360) % 360; // normalize 0-360 forward distance

      const finalRotation = this.wheelContainer.angle + extraSpins * 360 + deltaToTarget;

      if (this.audio && this.audio.playSpinTick) {
        // Fire a rapid tick sequence during the spin for tactile feedback.
        this._startSpinTicking();
      }

      this.tweens.add({
        targets: this.wheelContainer,
        angle: finalRotation,
        duration: 4200,
        ease: 'Cubic.Out',
        onComplete: () => {
          this._stopSpinTicking();
          this._onSpinComplete(chosenSegment, container, label);
        }
      });

      // Pointer "bounce" reaction as segments pass underneath (cosmetic).
      this.tweens.add({
        targets: this.wheelPointer,
        angle: { from: -8, to: 8 },
        duration: 90,
        yoyo: true,
        repeat: 46,
        ease: 'Sine.InOut'
      });

      label.setText('SPINNING...');
    }

    _startSpinTicking() {
      this._tickEvent = this.time.addEvent({
        delay: 90,
        repeat: 44,
        callback: () => { if (this.audio && this.audio.playSpinTick) this.audio.playSpinTick(); }
      });
    }

    _stopSpinTicking() {
      if (this._tickEvent) { this._tickEvent.remove(false); this._tickEvent = null; }
    }

    _onSpinComplete(segment, container, label) {
      this._markSpun();
      this._applyReward(segment);

      const isJackpot = segment.id === 'jackpot_500' || segment.weight <= 3;

      if (this.audio) {
        if (isJackpot && this.audio.playAchievement) this.audio.playAchievement();
        else if (this.audio.playChestOpen) this.audio.playChestOpen();
      }

      if (this.fx) {
        this.fx.chestOpenBurst(this._wheelCenter.x, this._wheelCenter.y);
        if (isJackpot) {
          this.fx.screenShake(0.018, 260);
          this.fx.levelUpBurst(this._wheelCenter.x, this._wheelCenter.y);
        } else {
          this.fx.screenShake(0.008, 150);
        }
      }

      let rewardLabel = '';
      switch (segment.type) {
        case 'coins': rewardLabel = `+${segment.amount} COINS`; break;
        case 'xp': rewardLabel = `+${segment.amount} XP`; break;
        case 'chest': rewardLabel = `+${segment.amount} CHEST`; break;
        default: rewardLabel = 'REWARD!'; break;
      }

      if (this.fx) {
        this.fx.floatingText(this._wheelCenter.x, this._wheelCenter.y - this._wheelRadius - 40,
          isJackpot ? `👑 JACKPOT! ${rewardLabel}` : rewardLabel,
          { color: isJackpot ? this.COLORS.gold : this.COLORS.mint, fontSize: isJackpot ? 26 : 22, duration: 1400 }
        );
      }

      label.setText(`✔ ${rewardLabel}`);
      this.tweens.add({ targets: container, scale: { from: 1, to: 1.08 }, duration: 200, yoyo: true });

      if (this.coinsFooterText) {
        this.time.delayedCall(200, () => this.coinsFooterText.setText(this._formatNum(this._getCoins())));
      }

      this._isSpinning = false;

      this.time.delayedCall(1800, () => this._goBack());
    }

    // =====================================================================
    // COINS FOOTER
    // =====================================================================
    _buildCoinsFooter(width, height) {
      const y = height - 30;
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
      if (!this._isSpinning) this.scene.restart();
    }
  }

  window.LuckySpinScene = LuckySpinScene;
})(window);