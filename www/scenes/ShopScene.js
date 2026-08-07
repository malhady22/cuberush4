/**
 * =====================================================================
 * ShopScene.js — Cube Rush
 * =====================================================================
 * Browsable, scrollable grid of all 20 cube skins. Responsibilities:
 *  - Render a 2-column scrollable card grid (custom-built masked
 *    scroll container — Phaser has no built-in scroll view).
 *  - Each card shows a live mini "energy core" preview matching the
 *    exact visual (gradient/flat tint + glow) the skin will have on
 *    the actual Player cube.
 *  - Card states: LOCKED (shows price + lock icon), AFFORDABLE
 *    (purchasable), OWNED (tap to equip), EQUIPPED (highlighted,
 *    non-interactive).
 *  - Purchases deduct coins and persist via Storage.js; equipping
 *    persists the selected skin id so GameScene/MenuScene pick it up
 *    automatically on next read.
 *  - Header: coins balance + a small rewarded-ad "+coins" button as an
 *    additional monetization touchpoint (AdMob-ready via
 *    window.CubeRushAds.showRewarded).
 *  - Back button returns to MenuScene.
 * =====================================================================
 */

(function (window) {
  'use strict';

  class ShopScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.SHOP) || 'ShopScene' });
    }

    // =====================================================================
    // INIT
    // =====================================================================
    init() {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { SHOP: 'ShopScene', MENU: 'MenuScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };
      this.REWARDED_BONUS_COINS = (C.MONETIZATION && C.MONETIZATION.rewardedShopBonusCoins) || 100;

      this.skins = this._resolveSkins();

      this._scrollY = 0;
      this._maxScrollY = 0;
      this._dragStart = null;
      this._dragTotalDist = 0;
      this._isDragging = false;
    }

    // =====================================================================
    // SKIN RESOLUTION (defensive — builds 20 varied defaults if Config
    // doesn't provide a full roster, so this scene never shows fewer
    // than the promised 20 skins)
    // =====================================================================
    _resolveSkins() {
      const C = window.Config || {};
      if (C.SKINS && C.SKINS.length >= 20) return C.SKINS.slice(0, 20);

      const skins = [];
      skins.push({
        id: 0, name: 'Default Core', price: 0, gradient: true,
        primaryColor: 0x00f0ff, secondaryColor: 0xff2e9a, glowColor: 0x00f0ff
      });

      const names = [
        'Solar Flare', 'Toxic Slime', 'Deep Ocean', 'Blood Ruby', 'Golden King',
        'Arctic Frost', 'Neon Grape', 'Emerald Blade', 'Sunset Blaze', 'Void Walker',
        'Rose Quartz', 'Electric Lime', 'Cosmic Teal', 'Magma Core', 'Silver Bullet',
        'Plasma Storm', 'Crimson Shard', 'Aqua Pulse', 'Amber Glow', 'Galaxy Drift'
      ];

      for (let i = 1; i <= 19; i++) {
        const hue = ((i - 1) * 47) % 360; // spread hues evenly-ish
        const primary = this._hslToHex(hue, 85, 55);
        const secondary = this._hslToHex((hue + 40) % 360, 85, 45);
        skins.push({
          id: i,
          name: names[i - 1] || `Skin ${i}`,
          price: 200 + i * 180,
          gradient: false,
          primaryColor: primary,
          secondaryColor: secondary,
          glowColor: primary
        });
      }
      return skins;
    }

    _hslToHex(h, s, l) {
      s /= 100; l /= 100;
      const k = (n) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      const toHex = (x) => Math.round(x * 255);
      return (toHex(f(0)) << 16) | (toHex(f(8)) << 8) | toHex(f(4));
    }

    // =====================================================================
    // DEFENSIVE STORAGE HELPERS
    // =====================================================================
    _storage() { return window.CubeRushStorage || null; }

    _getCoins() {
      const s = this._storage();
      return s && typeof s.getCoins === 'function' ? s.getCoins() : 0;
    }

    _spendCoins(amount) {
      const s = this._storage();
      if (s && typeof s.spendCoins === 'function') return s.spendCoins(amount);
      if (s && typeof s.getCoins === 'function' && typeof s.setCoins === 'function') {
        const current = s.getCoins();
        if (current < amount) return false;
        s.setCoins(current - amount);
        return true;
      }
      return false;
    }

    _addCoins(amount) {
      const s = this._storage();
      if (s && typeof s.addCoins === 'function') s.addCoins(amount);
    }

    _getUnlockedSkins() {
      const s = this._storage();
      if (s && typeof s.getUnlockedSkins === 'function') return s.getUnlockedSkins();
      return [0];
    }

    _unlockSkin(id) {
      const s = this._storage();
      if (s && typeof s.unlockSkin === 'function') { s.unlockSkin(id); return; }
      if (s && typeof s.getUnlockedSkins === 'function' && typeof s.setUnlockedSkins === 'function') {
        const list = s.getUnlockedSkins();
        if (!list.includes(id)) { list.push(id); s.setUnlockedSkins(list); }
      }
    }

    _getSelectedSkin() {
      const s = this._storage();
      return s && typeof s.getSelectedSkin === 'function' ? s.getSelectedSkin() : 0;
    }

    _setSelectedSkin(id) {
      const s = this._storage();
      if (s && typeof s.setSelectedSkin === 'function') s.setSelectedSkin(id);
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;
      this.fx = new window.EffectsManager(this);
      this.audio = window.CubeRushAudio || null;

      this._ensureCardTextures();
      this._buildBackground(width, height);
      this._buildHeader(width, height);
      this._buildScrollGrid(width, height);

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

      // Back button.
      this.backBtn = this._createIconButton(pad + 20, pad + 20, 20, '←', () => this._goBack());

      // Title.
      this.add.text(width / 2, pad + 20, 'SKIN SHOP', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '20px', fontStyle: '700', color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(11);

      // Coins pill (top-right).
      const pillW = 108, pillH = 36;
      const pillX = width - pad - pillW;
      const pillY = pad + 2;
      const pillBg = this.add.graphics().setDepth(11);
      pillBg.fillStyle(0x141a33, 0.9);
      pillBg.fillRoundedRect(pillX, pillY, pillW, pillH, pillH / 2);
      pillBg.lineStyle(1.5, this.COLORS.gold, 0.5);
      pillBg.strokeRoundedRect(pillX, pillY, pillW, pillH, pillH / 2);

      this.add.circle(pillX + 18, pillY + pillH / 2, 8, this.COLORS.gold).setDepth(12);
      this.coinsText = this.add.text(pillX + 32, pillY + pillH / 2, this._formatNum(this._getCoins()), {
        fontFamily: 'Orbitron, sans-serif', fontSize: '15px', fontStyle: '700', color: '#FFD23F'
      }).setOrigin(0, 0.5).setDepth(12);

      // Small "+" rewarded-ad bonus coins button under the pill.
      const addBtnY = pillY + pillH + 22;
      this.addCoinsBtn = this._createTextPillButton(
        pillX + pillW / 2, addBtnY, '🎬 +' + this.REWARDED_BONUS_COINS, this.COLORS.mint,
        () => this._watchAdForCoins()
      );

      this._headerBottomY = addBtnY + 26;
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

    _createTextPillButton(x, y, label, color, onClick) {
      const container = this.add.container(x, y).setDepth(12);
      const w = Math.max(110, label.length * 8);
      const h = 26;
      const bg = this.add.graphics();
      bg.fillStyle(0x141a33, 0.9);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      bg.lineStyle(1.5, color, 0.6);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      const text = this.add.text(0, 0, label, {
        fontFamily: 'Rubik, sans-serif', fontSize: '11px', fontStyle: '600', color: '#e6e9f5'
      }).setOrigin(0.5);
      container.add([bg, text]);
      container.setSize(w, h);
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
    // REWARDED AD — BONUS COINS
    // =====================================================================
    _watchAdForCoins() {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      if (!window.CubeRushAds || typeof window.CubeRushAds.showRewarded !== 'function') return;

      window.CubeRushAds.showRewarded(
        () => {
          this._addCoins(this.REWARDED_BONUS_COINS);
          this.coinsText.setText(this._formatNum(this._getCoins()));
          if (this.fx) {
            this.fx.chestOpenBurst(this.addCoinsBtn.x, this.addCoinsBtn.y);
            this.fx.floatingText(this.addCoinsBtn.x, this.addCoinsBtn.y, `+${this.REWARDED_BONUS_COINS}`, {
              color: this.COLORS.gold, fontSize: 22
            });
          }
          if (this.audio && this.audio.playCoin) this.audio.playCoin();
        },
        () => { /* ad failed/skipped — no-op */ }
      );
    }

    // =====================================================================
    // CARD TEXTURE GENERATION (shared mini energy-core preview shapes)
    // =====================================================================
    _ensureCardTextures() {
      const tm = this.textures;
      const size = 56;

      if (!tm.exists('shop-cube-base')) {
        const canvasTex = tm.createCanvas('shop-cube-base', size, size);
        const ctx = canvasTex.getContext();
        const r = size * 0.22;
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
        grad.addColorStop(1, 'rgba(255,255,255,0.6)');
        this._roundRectPath(ctx, 3, 3, size - 6, size - 6, r);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        this._roundRectPath(ctx, 3, 3, size - 6, size - 6, r);
        ctx.stroke();
        canvasTex.refresh();
      }

      if (!tm.exists('shop-cube-inner')) {
        const innerSize = Math.round(size * 0.6);
        const canvasTex = tm.createCanvas('shop-cube-inner', innerSize, innerSize);
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

    // =====================================================================
    // SCROLLABLE GRID
    // =====================================================================
    _buildScrollGrid(width, height) {
      const viewportTop = this._headerBottomY + 8;
      const viewportBottom = height - 12;
      const viewportHeight = viewportBottom - viewportTop;

      this._viewportTop = viewportTop;
      this._viewportHeight = viewportHeight;

      // Mask so cards don't render outside the grid viewport.
      const maskGfx = this.make.graphics({ x: 0, y: 0, add: false });
      maskGfx.fillStyle(0xffffff, 1);
      maskGfx.fillRect(0, viewportTop, width, viewportHeight);
      const mask = maskGfx.createGeometryMask();

      this.contentContainer = this.add.container(0, viewportTop).setDepth(5);
      this.contentContainer.setMask(mask);

      const cols = 2;
      const cardW = (width - 48) / cols;
      const cardH = 190;
      const gapX = 16;
      const gapY = 16;

      this._cards = [];

      this.skins.forEach((skin, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 16 + col * (cardW + gapX) + cardW / 2;
        const y = row * (cardH + gapY) + cardH / 2;
        const card = this._createCard(skin, x, y, cardW, cardH);
        this.contentContainer.add(card.container);
        this._cards.push(card);
      });

      const rows = Math.ceil(this.skins.length / cols);
      const contentHeight = rows * (cardH + gapY);
      this._maxScrollY = Math.max(0, contentHeight - viewportHeight);

      this._setupScrollInput(width, viewportTop, viewportHeight);

      // Scroll indicator track (subtle, right edge).
      if (this._maxScrollY > 0) {
        this._scrollTrack = this.add.rectangle(width - 6, viewportTop + viewportHeight / 2, 3, viewportHeight * 0.9, 0xffffff, 0.08).setDepth(6);
        this._scrollThumb = this.add.rectangle(width - 6, viewportTop + 20, 3, viewportHeight * (viewportHeight / contentHeight), 0xffffff, 0.35).setDepth(6);
        this._updateScrollThumb();
      }
    }

    _createCard(skin, x, y, w, h) {
      const container = this.add.container(x, y);

      const panelBg = this.add.graphics();
      panelBg.fillStyle(0x141a33, 0.85);
      panelBg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      panelBg.lineStyle(2, 0xffffff, 0.08);
      panelBg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

      const glow = this.add.image(0, -h * 0.15, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(skin.glowColor || skin.primaryColor).setScale(1.6).setAlpha(0.5);

      const base = this.add.image(0, -h * 0.15, 'shop-cube-base');
      const innerA = this.add.image(0, -h * 0.15, 'shop-cube-inner').setBlendMode('ADD');
      const innerB = this.add.image(0, -h * 0.15, 'shop-cube-inner').setBlendMode('ADD').setAlpha(0);

      if (skin.gradient) {
        innerA.setTint(this.COLORS.cyan);
        innerB.setTint(this.COLORS.magenta);
        innerB.setAlpha(0.6);
      } else {
        innerA.setTint(skin.primaryColor);
        innerB.setTint(skin.secondaryColor || skin.primaryColor).setAlpha(0);
      }

      const nameText = this.add.text(0, h * 0.14, skin.name, {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', fontStyle: '600', color: '#e6e9f5', align: 'center',
        wordWrap: { width: w - 20 }
      }).setOrigin(0.5);

      const statusText = this.add.text(0, h * 0.32, '', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '13px', fontStyle: '700', color: '#FFD23F'
      }).setOrigin(0.5);

      const lockOverlay = this.add.rectangle(0, 0, w, h, 0x000000, 0).setVisible(false);
      const equippedBadge = this.add.rectangle(-w / 2 + 10, -h / 2 + 10, 0, 0, 0, 0).setVisible(false);

      const badgeRing = this.add.graphics().setVisible(false);
      badgeRing.lineStyle(3, this.COLORS.mint, 1);
      badgeRing.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

      container.add([panelBg, glow, base, innerA, innerB, nameText, statusText, lockOverlay, badgeRing]);

      const card = {
        container, skin, glow, base, innerA, innerB, nameText, statusText, badgeRing,
        rotT: Math.random() * 10, crossFadeT: Math.random() * 10, w, h
      };

      this._refreshCardState(card);
      return card;
    }

    _refreshCardState(card) {
      const unlocked = this._getUnlockedSkins();
      const isOwned = unlocked.includes(card.skin.id) || card.skin.price === 0;
      const isEquipped = this._getSelectedSkin() === card.skin.id;
      const coins = this._getCoins();

      card.isOwned = isOwned;
      card.isEquipped = isEquipped;

      if (isEquipped) {
        card.statusText.setText('EQUIPPED').setColor('#39FF88');
        card.badgeRing.setVisible(true);
      } else if (isOwned) {
        card.statusText.setText('TAP TO EQUIP').setColor('#8892b0');
        card.badgeRing.setVisible(false);
      } else {
        const affordable = coins >= card.skin.price;
        card.statusText.setText(`🪙 ${this._formatNum(card.skin.price)}`);
        card.statusText.setColor(affordable ? '#FFD23F' : '#FF6B6B');
        card.badgeRing.setVisible(false);
      }

      // Dim locked cards slightly for clear visual hierarchy.
      const dim = isOwned ? 1 : 0.75;
      card.base.setAlpha(dim);
      card.glow.setAlpha(isOwned ? 0.5 : 0.25);
    }

    _updateScrollThumb() {
      if (!this._scrollThumb) return;
      const t = this._maxScrollY > 0 ? this._scrollY / this._maxScrollY : 0;
      const trackHeight = this._scrollTrack.height;
      const thumbHeight = this._scrollThumb.height;
      const travel = trackHeight - thumbHeight;
      this._scrollThumb.y = this._viewportTop + thumbHeight / 2 + travel * t;
    }

    // =====================================================================
    // SCROLL + TAP INPUT (unified drag-to-scroll / tap-to-select handling)
    // =====================================================================
    _setupScrollInput(width, viewportTop, viewportHeight) {
      const hitZone = this.add.rectangle(width / 2, viewportTop + viewportHeight / 2, width, viewportHeight, 0x000000, 0.001)
        .setDepth(4).setInteractive();

      hitZone.on('pointerdown', (pointer) => {
        this._dragStart = { y: pointer.y, scrollYAtStart: this._scrollY, x: pointer.x };
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

      hitZone.on('pointerup', (pointer) => {
        if (this._isDragging && this._dragTotalDist < 12) {
          // Treat as a tap — find which card is under the pointer.
          this._handleCardTap(pointer);
        }
        this._isDragging = false;
        this._dragStart = null;
      });

      hitZone.on('pointerout', () => {
        this._isDragging = false;
        this._dragStart = null;
      });
    }

    _handleCardTap(pointer) {
      // Convert pointer position into content-local space (undo scroll offset).
      const localY = pointer.y - this.contentContainer.y;
      const localX = pointer.x;

      for (const card of this._cards) {
        const left = card.container.x - card.w / 2;
        const right = card.container.x + card.w / 2;
        const top = card.container.y - card.h / 2;
        const bottom = card.container.y + card.h / 2;

        if (localX >= left && localX <= right && localY >= top && localY <= bottom) {
          this._onCardTapped(card);
          break;
        }
      }
    }

    // =====================================================================
    // CARD TAP LOGIC — buy / equip
    // =====================================================================
    _onCardTapped(card) {
      if (card.isEquipped) return; // already equipped, nothing to do

      if (card.isOwned) {
        this._equipSkin(card);
        return;
      }

      // Locked — attempt purchase.
      const coins = this._getCoins();
      if (coins < card.skin.price) {
        this._denyPurchase(card);
        return;
      }

      this._purchaseSkin(card);
    }

    _purchaseSkin(card) {
      const success = this._spendCoins(card.skin.price);
      if (!success) { this._denyPurchase(card); return; }

      this._unlockSkin(card.skin.id);
      this._setSelectedSkin(card.skin.id);

      this.coinsText.setText(this._formatNum(this._getCoins()));

      if (this.audio && this.audio.playAchievement) this.audio.playAchievement();
      if (this.fx) {
        this.fx.powerUpBurst(card.container.x, card.container.y - card.h * 0.15, card.skin.glowColor || card.skin.primaryColor);
        this.fx.floatingText(card.container.x, card.container.y, 'UNLOCKED!', {
          color: this.COLORS.mint, fontSize: 20
        });
      }

      // Refresh all cards since the equipped state moved.
      this._cards.forEach((c) => this._refreshCardState(c));

      this.tweens.add({
        targets: card.container, scale: { from: 0.92, to: 1 }, duration: 220, ease: 'Back.Out'
      });
    }

    _equipSkin(card) {
      this._setSelectedSkin(card.skin.id);
      if (this.audio && this.audio.playButton) this.audio.playButton();

      this._cards.forEach((c) => this._refreshCardState(c));

      this.tweens.add({
        targets: card.container, scale: { from: 0.94, to: 1 }, duration: 180, ease: 'Back.Out'
      });
      if (this.fx) {
        this.fx.floatingText(card.container.x, card.container.y - card.h * 0.3, 'EQUIPPED', {
          color: this.COLORS.mint, fontSize: 16
        });
      }
    }

    _denyPurchase(card) {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.tweens.add({
        targets: card.container,
        x: { from: card.container.x - 6, to: card.container.x + 6 },
        duration: 60,
        yoyo: true,
        repeat: 3
      });
      if (this.fx) {
        this.fx.floatingText(card.container.x, card.container.y, 'NOT ENOUGH COINS', {
          color: this.COLORS.danger, fontSize: 14
        });
      }
    }

    // =====================================================================
    // PER-FRAME PREVIEW ANIMATION (rotation + gradient cross-fade)
    // =====================================================================
    update(time, delta) {
      if (!this._cards) return;
      this._cards.forEach((card) => {
        card.rotT += delta * 0.05;
        card.innerA.setAngle(card.rotT);
        card.innerB.setAngle(-card.rotT * 0.8);

        if (card.skin.gradient) {
          card.crossFadeT += delta * 0.0016;
          const wave = (Math.sin(card.crossFadeT) + 1) / 2;
          card.innerA.setAlpha(0.35 + wave * 0.5);
          card.innerB.setAlpha(0.85 - wave * 0.5);
        }
      });
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

  window.ShopScene = ShopScene;
})(window);