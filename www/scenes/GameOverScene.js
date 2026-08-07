/**
 * =====================================================================
 * GameOverScene.js — Cube Rush
 * =====================================================================
 * Displayed after GameScene detects the player's death. Receives run
 * summary data via scene.start(key, data):
 *   { score, coins, gems, survivalMs, comboMax, isNewHighScore }
 *
 * RESPONSIBILITIES
 *  - Animated score reveal (count-up) with a celebratory "NEW BEST!"
 *    state when isNewHighScore is true.
 *  - Run summary stats: coins earned, gems earned, survival time,
 *    peak combo multiplier.
 *  - Monetization hooks:
 *      - Rewarded ad: "Watch Ad -> Double Coins Earned" (grants a
 *        ONE-TIME bonus equal to this run's coin total via
 *        Storage.addCoins — the base coins were already persisted
 *        live during gameplay by CoinManager, so this only ever ADDS
 *        the bonus, never re-grants the base amount).
 *      - Interstitial ad: shown probabilistically (not every death,
 *        to protect UX) before the Game Over panel appears.
 *  - Restart (straight back into GameScene) and Quit to Menu buttons.
 *  - Achievement/mission toasts that fired during MissionManager's
 *    endRun() evaluation are rendered by GameScene's own EffectsManager
 *    BEFORE the fade-to-black transition, so nothing needs to be
 *    replayed here.
 * =====================================================================
 */

(function (window) {
  'use strict';

  // Show an interstitial roughly every N deaths rather than every time,
  // to keep the experience from feeling ad-choked.
  const INTERSTITIAL_EVERY_N_DEATHS = 3;
  const DEATH_COUNTER_KEY = 'cubeRush_deathCounter_v1';

  class GameOverScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.GAMEOVER) || 'GameOverScene' });
    }

    // =====================================================================
    // INIT — receives run summary data from GameScene
    // =====================================================================
    init(data) {
      const C = window.Config || {};
      this.SCENES = C.SCENES || { GAME: 'GameScene', MENU: 'MenuScene', GAMEOVER: 'GameOverScene' };
      this.COLORS = C.COLORS || {
        cyan: 0x00f0ff, magenta: 0xff2e9a, gold: 0xffd23f,
        danger: 0xff3b3b, mint: 0x39ff88, background: 0x0b0e1a, white: 0xffffff
      };

      this.runData = Object.assign({
        score: 0, coins: 0, gems: 0, survivalMs: 0, comboMax: 1, isNewHighScore: false
      }, data || {});

      this._doubleCoinsClaimed = false;
      this._displayScore = 0;
    }

    // =====================================================================
    // CREATE
    // =====================================================================
    create() {
      const { width, height } = this.scale;
      this.fx = new window.EffectsManager(this);
      this.audio = window.CubeRushAudio || null;

      this._buildBackground(width, height);
      this._maybeShowInterstitial(() => {
        this._buildPanel(width, height);
        this._playEntranceSequence();
      });

      if (this.audio && typeof this.audio.stopMusic === 'function') {
        this.audio.stopMusic();
      }

      this.events.once('shutdown', () => this._cleanup());
    }

    // =====================================================================
    // BACKGROUND
    // =====================================================================
    _buildBackground(width, height) {
      const bg = this.add.graphics().setDepth(-2);
      bg.fillGradientStyle(0x0b0e1a, 0x0b0e1a, 0x1a0f26, 0x0b0e1a, 1);
      bg.fillRect(0, 0, width, height);

      this._ambientA = this.add.image(width * 0.2, height * 0.25, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.danger).setScale(3).setAlpha(0.1).setDepth(-1);
      this._ambientB = this.add.image(width * 0.8, height * 0.75, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.magenta).setScale(3).setAlpha(0.08).setDepth(-1);

      this.cameras.main.fadeIn(240, 11, 14, 26);
    }

    // =====================================================================
    // MONETIZATION — INTERSTITIAL (gated frequency)
    // =====================================================================
    _maybeShowInterstitial(onDone) {
      let deathCount = 0;
      try {
        deathCount = parseInt(window.localStorage.getItem(DEATH_COUNTER_KEY) || '0', 10) + 1;
        window.localStorage.setItem(DEATH_COUNTER_KEY, String(deathCount));
      } catch (e) { deathCount = 1; }

      const shouldShow = deathCount % INTERSTITIAL_EVERY_N_DEATHS === 0;

      if (shouldShow && window.CubeRushAds && typeof window.CubeRushAds.showInterstitial === 'function') {
        window.CubeRushAds.showInterstitial(() => onDone());
      } else {
        onDone();
      }
    }

    // =====================================================================
    // MAIN PANEL
    // =====================================================================
    _buildPanel(width, height) {
      const cx = width / 2;

      // ---- "GAME OVER" title -------------------------------------------------
      this.titleText = this.add.text(cx, height * 0.1, 'GAME OVER', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: `${Math.round(width * 0.1)}px`,
        fontStyle: '700',
        color: '#FF3B3B',
        stroke: '#0B0E1A',
        strokeThickness: 5
      }).setOrigin(0.5).setDepth(10).setScale(0.6).setAlpha(0);

      // ---- New Best banner (hidden unless isNewHighScore) --------------------
      this.newBestBanner = this.add.text(cx, height * 0.17, '🏆 NEW BEST SCORE!', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: '16px',
        fontStyle: '700',
        color: '#FFD23F'
      }).setOrigin(0.5).setDepth(10).setAlpha(0).setVisible(this.runData.isNewHighScore);

      // ---- Score readout --------------------------------------------------------
      this.add.text(cx, height * 0.26, 'FINAL SCORE', {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', color: '#8892b0'
      }).setOrigin(0.5).setDepth(10);

      this.scoreText = this.add.text(cx, height * 0.31, '0', {
        fontFamily: 'Orbitron, sans-serif',
        fontSize: `${Math.round(width * 0.14)}px`,
        fontStyle: '700',
        color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(10).setAlpha(0);

      // ---- Stats row (coins / gems / time / combo) -------------------------------
      this._buildStatsRow(width, height);

      // ---- Double Coins rewarded-ad button ---------------------------------------
      this._buildDoubleCoinsButton(width, height);

      // ---- Restart / Menu buttons ------------------------------------------------
      this._buildActionButtons(width, height);
    }

    _buildStatsRow(width, height) {
      const y = height * 0.48;
      const stats = [
        { icon: '🪙', value: this.runData.coins, label: 'COINS', color: this.COLORS.gold },
        { icon: '💎', value: this.runData.gems, label: 'GEMS', color: this.COLORS.mint },
        { icon: '⏱', value: this._formatTime(this.runData.survivalMs), label: 'TIME', color: this.COLORS.cyan },
        { icon: '🔥', value: `x${this.runData.comboMax}`, label: 'BEST COMBO', color: this.COLORS.magenta }
      ];

      const spacing = width / (stats.length + 1);
      this._statContainers = [];

      stats.forEach((s, i) => {
        const x = spacing * (i + 1);
        const container = this.add.container(x, y).setDepth(10).setAlpha(0).setScale(0.7);

        const bg = this.add.circle(0, 0, 30, 0x141a33, 0.85).setStrokeStyle(1.5, s.color, 0.6);
        const icon = this.add.text(0, -6, s.icon, { fontSize: '18px' }).setOrigin(0.5);
        const value = this.add.text(0, 46, String(s.value), {
          fontFamily: 'Orbitron, sans-serif', fontSize: '14px', fontStyle: '700', color: '#FFFFFF'
        }).setOrigin(0.5);
        const label = this.add.text(0, 64, s.label, {
          fontFamily: 'Rubik, sans-serif', fontSize: '9px', color: '#8892b0'
        }).setOrigin(0.5);

        container.add([bg, icon, value, label]);
        this._statContainers.push(container);
      });
    }

    _formatTime(ms) {
      const totalSec = Math.floor((ms || 0) / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;
    }

    // =====================================================================
    // DOUBLE COINS REWARDED AD BUTTON
    // =====================================================================
    _buildDoubleCoinsButton(width, height) {
      const y = height * 0.64;
      const w = width * 0.72;
      const h = 58;

      const container = this.add.container(width / 2, y).setDepth(10).setAlpha(0).setScale(0.8);

      const glow = this.add.image(0, 0, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.gold).setScale(w / 90, h / 40).setAlpha(0.4);

      const bg = this.add.graphics();
      bg.fillStyle(0x1c2348, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      bg.lineStyle(2, this.COLORS.gold, 0.8);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);

      const label = this.add.text(0, -9, `🎬 WATCH AD: DOUBLE +${this.runData.coins} COINS`, {
        fontFamily: 'Rubik, sans-serif', fontSize: '13px', fontStyle: '600', color: '#FFD23F'
      }).setOrigin(0.5);

      const sublabel = this.add.text(0, 11, 'Tap to claim bonus', {
        fontFamily: 'Rubik, sans-serif', fontSize: '10px', color: '#8892b0'
      }).setOrigin(0.5);

      container.add([glow, bg, label, sublabel]);
      container.setSize(w, h);

      if (this.runData.coins <= 0) {
        // Nothing to double — hide the button entirely rather than
        // showing a "double +0 coins" offer.
        container.setVisible(false);
      } else {
        container.setInteractive({ useHandCursor: true });
        container.on('pointerdown', () => this._pressBtn(container));
        container.on('pointerup', () => {
          this._releaseBtn(container);
          this._claimDoubleCoins(container, label, sublabel);
        });
        container.on('pointerout', () => this._releaseBtn(container));

        this.tweens.add({
          targets: glow,
          alpha: { from: 0.3, to: 0.55 },
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut'
        });
      }

      this.doubleCoinsContainer = container;
      this.doubleCoinsLabel = label;
      this.doubleCoinsSublabel = sublabel;
    }

    _claimDoubleCoins(container, label, sublabel) {
      if (this._doubleCoinsClaimed) return;

      if (this.audio && this.audio.playButton) this.audio.playButton();

      if (!window.CubeRushAds || typeof window.CubeRushAds.showRewarded !== 'function') {
        return;
      }

      window.CubeRushAds.showRewarded(
        () => {
          // Reward granted.
          this._doubleCoinsClaimed = true;
          const bonus = this.runData.coins;

          if (window.CubeRushStorage && typeof window.CubeRushStorage.addCoins === 'function') {
            window.CubeRushStorage.addCoins(bonus);
          }

          label.setText(`✔ +${bonus} BONUS COINS CLAIMED`);
          sublabel.setText('Thanks for watching!');
          container.disableInteractive();
          this.tweens.add({ targets: container, alpha: 0.75, duration: 200 });

          if (this.fx) {
            this.fx.chestOpenBurst(container.x, container.y);
            this.fx.floatingText(container.x, container.y - 40, `+${bonus}`, {
              color: this.COLORS.gold, fontSize: 28
            });
          }
          if (this.audio && this.audio.playCoin) this.audio.playCoin();

          this._refreshCoinsHUDIfPresent();
        },
        () => {
          // Ad failed/skipped — no penalty, button remains available.
          sublabel.setText('Ad unavailable — try again later');
        }
      );
    }

    _refreshCoinsHUDIfPresent() {
      // No persistent HUD on this scene beyond the stat row (which shows
      // the run's original coin count intentionally, as a record of the
      // run) — this hook exists for future extensibility (e.g. a total
      // coins readout) without needing structural changes.
    }

    // =====================================================================
    // ACTION BUTTONS: RESTART / MENU
    // =====================================================================
    _buildActionButtons(width, height) {
      const y = height * 0.80;

      // ---- Restart (primary, gradient) -------------------------------------------
      const restartW = width * 0.72;
      const restartH = 62;
      this.restartBtn = this.add.container(width / 2, y).setDepth(10).setAlpha(0).setScale(0.8);

      const rGlow = this.add.image(0, 0, 'fx-glow-soft')
        .setBlendMode('ADD').setTint(this.COLORS.cyan).setScale(restartW / 90, restartH / 40).setAlpha(0.5);
      const rBg = this.add.graphics();
      rBg.fillGradientStyle(this.COLORS.cyan, this.COLORS.magenta, this.COLORS.cyan, this.COLORS.magenta, 1);
      rBg.fillRoundedRect(-restartW / 2, -restartH / 2, restartW, restartH, restartH / 2);
      const rLabel = this.add.text(0, 0, '▶ PLAY AGAIN', {
        fontFamily: 'Orbitron, sans-serif', fontSize: '22px', fontStyle: '700', color: '#0B0E1A'
      }).setOrigin(0.5);

      this.restartBtn.add([rGlow, rBg, rLabel]);
      this.restartBtn.setSize(restartW, restartH);
      this.restartBtn.setInteractive({ useHandCursor: true });
      this.restartBtn.on('pointerdown', () => this._pressBtn(this.restartBtn));
      this.restartBtn.on('pointerup', () => { this._releaseBtn(this.restartBtn); this._onRestart(); });
      this.restartBtn.on('pointerout', () => this._releaseBtn(this.restartBtn));

      this.tweens.add({
        targets: rGlow, alpha: { from: 0.4, to: 0.65 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut'
      });

      // ---- Quit to Menu (secondary, text button) -----------------------------------
      this.menuBtn = this.add.text(width / 2, y + 52, 'BACK TO MENU', {
        fontFamily: 'Rubik, sans-serif', fontSize: '14px', fontStyle: '500', color: '#8892b0'
      }).setOrigin(0.5).setDepth(10).setAlpha(0).setInteractive({ useHandCursor: true });

      this.menuBtn.on('pointerover', () => this.menuBtn.setColor('#00F0FF'));
      this.menuBtn.on('pointerout', () => this.menuBtn.setColor('#8892b0'));
      this.menuBtn.on('pointerdown', () => this.menuBtn.setScale(0.94));
      this.menuBtn.on('pointerup', () => { this.menuBtn.setScale(1); this._onQuitToMenu(); });
    }

    _pressBtn(container) {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scale: 0.94, duration: 80, ease: 'Quad.Out' });
    }

    _releaseBtn(container) {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scale: 1, duration: 120, ease: 'Back.Out' });
    }

    // =====================================================================
    // ENTRANCE ANIMATION SEQUENCE
    // =====================================================================
    _playEntranceSequence() {
      if (this.audio && this.audio.playCrash) {
        // Crash sound already likely played in GameScene on impact —
        // this scene doesn't re-trigger it to avoid a doubled SFX.
      }

      this.tweens.add({
        targets: this.titleText,
        alpha: 1,
        scale: 1,
        duration: 350,
        ease: 'Back.Out'
      });

      if (this.fx) this.fx.screenShake(0.012, 200);

      this.time.delayedCall(200, () => {
        this.tweens.add({
          targets: this.scoreText,
          alpha: 1,
          duration: 250
        });
        this._animateScoreCountUp();
      });

      if (this.runData.isNewHighScore) {
        this.time.delayedCall(650, () => {
          this.tweens.add({
            targets: this.newBestBanner,
            alpha: 1,
            duration: 250,
            onStart: () => {
              if (this.fx) {
                this.fx.achievementBurst(this.newBestBanner.x, this.newBestBanner.y);
              }
              if (this.audio && this.audio.playAchievement) this.audio.playAchievement();
            }
          });
          this.tweens.add({
            targets: this.newBestBanner,
            scale: { from: 1, to: 1.12 },
            duration: 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
          });
        });
      }

      this.time.delayedCall(500, () => {
        this._statContainers.forEach((c, i) => {
          this.time.delayedCall(i * 80, () => {
            this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 250, ease: 'Back.Out' });
          });
        });
      });

      this.time.delayedCall(950, () => {
        if (this.doubleCoinsContainer) {
          this.tweens.add({ targets: this.doubleCoinsContainer, alpha: 1, scale: 1, duration: 280, ease: 'Back.Out' });
        }
      });

      this.time.delayedCall(1150, () => {
        this.tweens.add({ targets: this.restartBtn, alpha: 1, scale: 1, duration: 300, ease: 'Back.Out' });
        this.tweens.add({ targets: this.menuBtn, alpha: 1, duration: 300, delay: 100 });
      });
    }

    _animateScoreCountUp() {
      const target = Math.floor(this.runData.score);
      const duration = 900;
      const startTime = this.time.now;

      const step = () => {
        const t = Phaser.Math.Clamp((this.time.now - startTime) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        this._displayScore = Math.floor(target * eased);
        this.scoreText.setText(this._formatNum(this._displayScore));

        if (t < 1) {
          this.time.delayedCall(16, step);
        } else {
          this.scoreText.setText(this._formatNum(target));
          if (this.audio && this.audio.playCombo) this.audio.playCombo(2);
        }
      };
      step();
    }

    _formatNum(n) {
      n = Math.floor(n || 0);
      return n.toLocaleString ? n.toLocaleString() : String(n);
    }

    // =====================================================================
    // ACTIONS
    // =====================================================================
    _onRestart() {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.cameras.main.fadeOut(220, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start(this.SCENES.GAME);
      });
    }

    _onQuitToMenu() {
      if (this.audio && this.audio.playButton) this.audio.playButton();
      this.cameras.main.fadeOut(220, 11, 14, 26);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start(this.SCENES.MENU);
      });
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    _cleanup() {
      if (this.fx) { this.fx.destroy(); this.fx = null; }
    }
  }

  window.GameOverScene = GameOverScene;
})(window);