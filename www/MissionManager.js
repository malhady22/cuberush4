/**
 * =====================================================================
 * MissionManager.js — Cube Rush
 * =====================================================================
 * Single hub for the 50-mission system, the 30-achievement system, and
 * the XP/Level pipeline that rewards both.
 *
 * ARCHITECTURE
 *  - 50 MISSIONS are procedurally generated from 10 categories x 5
 *    escalating tiers (see CATEGORY_DEFS). Each tier completion grants
 *    coins + XP; the final (5th/hardest) tier of every category also
 *    grants a Reward Chest.
 *  - 30 ACHIEVEMENTS are explicit one-off badge unlocks (see
 *    ACHIEVEMENT_DEFS), each with a `check(ctx)` predicate evaluated
 *    against live lifetime stats + Storage-backed values (high score,
 *    level, skins owned).
 *  - Lifetime stats (coins earned, gems, distance, jumps, dodges by
 *    type, power-up uses, best combo streak, longest survival) are
 *    tracked HERE, separately from CoinManager's spendable coin
 *    balance, so spending coins in the Shop never regresses mission
 *    progress.
 *  - This class is EVENT-DRIVEN, not polled: GameScene wires manager
 *    events (coinCollected, obstaclePassed, jumped, powerUpCollected,
 *    comboChanged) into `recordEvent()`, and progress is evaluated
 *    immediately after each relevant update — no per-frame cost.
 *
 * DEFENSIVE STORAGE ACCESS
 *  - Tries typed Storage.js methods first (isMissionCompleted /
 *    completeMission / isAchievementUnlocked / unlockAchievement /
 *    addXP / addCoins / addChest). If any are missing, falls back to
 *    an internal localStorage-backed stat bag so this file never
 *    throws regardless of the exact Storage.js method names.
 *
 * STATIC API (usable without a live gameplay instance, e.g. from
 * AchievementsScene.js):
 *  - MissionManager.getMissionDefs()
 *  - MissionManager.getAchievementDefs()
 *  - MissionManager.buildMissionStatusList()
 *  - MissionManager.buildAchievementStatusList()
 *
 * INSTANCE EVENTS EMITTED
 *  - 'missionCompleted'   (missionDef)
 *  - 'achievementUnlocked'(achievementDef)
 *  - 'levelUp'            (newLevel:number)
 * =====================================================================
 */

(function (window) {
  'use strict';

  const FALLBACK_STATS_KEY = 'cubeRush_missionStats_v1';

  // -----------------------------------------------------------------
  // 50 MISSIONS: 10 categories x 5 escalating tiers.
  // -----------------------------------------------------------------
  const CATEGORY_DEFS = [
    { key: 'coins', stat: 'lifetimeCoins', name: 'Coin Collector',
      desc: (t) => `Earn ${t} coins total`, tiers: [100, 500, 1500, 5000, 15000] },
    { key: 'gems', stat: 'lifetimeGems', name: 'Gem Hunter',
      desc: (t) => `Collect ${t} gems total`, tiers: [5, 20, 50, 150, 400] },
    { key: 'distance', stat: 'lifetimeDistance', name: 'Distance Runner',
      desc: (t) => `Travel ${t}m total`, tiers: [500, 2000, 8000, 20000, 50000] },
    { key: 'combo', stat: 'bestComboStreak', name: 'Combo Master',
      desc: (t) => `Chain a combo streak of ${t}`, tiers: [10, 25, 50, 100, 200] },
    { key: 'dodge', stat: 'lifetimeDodges', name: 'Obstacle Dodger',
      desc: (t) => `Dodge ${t} obstacles total`, tiers: [50, 200, 600, 1500, 4000] },
    { key: 'survive', stat: 'longestSurvivalMs', name: 'Survivor',
      desc: (t) => `Survive ${Math.round(t / 1000)}s in one run`, tiers: [30000, 60000, 120000, 240000, 400000] },
    { key: 'powerups', stat: 'lifetimePowerUps', name: 'Power Player',
      desc: (t) => `Use ${t} power-ups total`, tiers: [5, 20, 50, 150, 400] },
    { key: 'jumps', stat: 'lifetimeJumps', name: 'Jumper',
      desc: (t) => `Perform ${t} jumps total`, tiers: [50, 200, 600, 1500, 4000] },
    { key: 'skins', stat: 'skinsUnlockedLive', name: 'Skin Collector',
      desc: (t) => `Unlock ${t} skins`, tiers: [2, 5, 10, 15, 20] },
    { key: 'games', stat: 'lifetimeGamesPlayed', name: 'Dedicated Player',
      desc: (t) => `Play ${t} games`, tiers: [5, 20, 50, 150, 400] }
  ];

  function buildMissionDefs() {
    const missions = [];
    CATEGORY_DEFS.forEach((cat) => {
      cat.tiers.forEach((target, tierIndex) => {
        missions.push({
          id: `${cat.key}_t${tierIndex + 1}`,
          category: cat.key,
          tier: tierIndex + 1,
          name: `${cat.name} ${'I'.repeat(0)}${romanTier(tierIndex + 1)}`,
          description: cat.desc(target),
          statKey: cat.stat,
          target,
          rewardCoins: Math.round(50 * Math.pow(2.2, tierIndex)),
          rewardXp: Math.round(30 * Math.pow(2, tierIndex)),
          grantsChest: tierIndex === cat.tiers.length - 1
        });
      });
    });
    return missions;
  }

  function romanTier(n) {
    return ['I', 'II', 'III', 'IV', 'V'][n - 1] || String(n);
  }

  const MISSIONS = buildMissionDefs(); // exactly 50

  // -----------------------------------------------------------------
  // 30 ACHIEVEMENTS: explicit one-off badge unlocks.
  // check(ctx) receives { stat(key), highScore, level, skinsCount }
  // -----------------------------------------------------------------
  const ACHIEVEMENT_DEFS = [
    { id: 'first_game', name: 'First Steps', description: 'Play your first game', rewardCoins: 50, rewardXp: 40,
      check: (ctx) => ctx.stat('lifetimeGamesPlayed') >= 1 },
    { id: 'coins_1k', name: 'Pocket Change', description: 'Earn 1,000 total coins', rewardCoins: 100, rewardXp: 60,
      check: (ctx) => ctx.stat('lifetimeCoins') >= 1000 },
    { id: 'coins_10k', name: 'Coin Collector', description: 'Earn 10,000 total coins', rewardCoins: 300, rewardXp: 150,
      check: (ctx) => ctx.stat('lifetimeCoins') >= 10000 },
    { id: 'coins_50k', name: 'Coin Tycoon', description: 'Earn 50,000 total coins', rewardCoins: 800, rewardXp: 400,
      check: (ctx) => ctx.stat('lifetimeCoins') >= 50000 },
    { id: 'gems_100', name: 'Gem Fanatic', description: 'Collect 100 gems total', rewardCoins: 250, rewardXp: 150,
      check: (ctx) => ctx.stat('lifetimeGems') >= 100 },
    { id: 'score_1000', name: 'Rising Star', description: 'Reach a high score of 1,000', rewardCoins: 150, rewardXp: 100,
      check: (ctx) => ctx.highScore >= 1000 },
    { id: 'score_5000', name: 'High Roller', description: 'Reach a high score of 5,000', rewardCoins: 400, rewardXp: 250,
      check: (ctx) => ctx.highScore >= 5000 },
    { id: 'score_15000', name: 'Cube Legend', description: 'Reach a high score of 15,000', rewardCoins: 1000, rewardXp: 600,
      check: (ctx) => ctx.highScore >= 15000 },
    { id: 'combo_x3', name: 'Combo Novice', description: 'Reach Combo x3 in a single run', rewardCoins: 100, rewardXp: 80,
      check: (ctx) => ctx.stat('bestComboMultiplier') >= 3 },
    { id: 'combo_max', name: 'Combo Master', description: 'Reach the maximum Combo multiplier', rewardCoins: 350, rewardXp: 200,
      check: (ctx) => ctx.stat('bestComboMultiplier') >= (ctx.maxComboMultiplier || 5) },
    { id: 'distance_10k', name: 'Marathoner', description: 'Travel 10,000m total distance', rewardCoins: 300, rewardXp: 180,
      check: (ctx) => ctx.stat('lifetimeDistance') >= 10000 },
    { id: 'survive_120', name: 'Endless Runner', description: 'Survive 120 seconds in a single run', rewardCoins: 300, rewardXp: 200,
      check: (ctx) => ctx.stat('longestSurvivalMs') >= 120000 },
    { id: 'untouchable_60', name: 'Untouchable', description: 'Survive 60s in one run without getting hit', rewardCoins: 400, rewardXp: 250,
      check: (ctx) => ctx.stat('bestNoHitSurvivalMs') >= 60000 },
    { id: 'shield_50', name: 'Shield Master', description: 'Use Shield power-up 50 times', rewardCoins: 200, rewardXp: 120,
      check: (ctx) => ctx.stat('powerup_shield') >= 50 },
    { id: 'magnet_50', name: 'Magnet Master', description: 'Use Coin Magnet 50 times', rewardCoins: 200, rewardXp: 120,
      check: (ctx) => ctx.stat('powerup_magnet') >= 50 },
    { id: 'slowmo_50', name: 'Time Bender', description: 'Use Slow Motion 50 times', rewardCoins: 200, rewardXp: 120,
      check: (ctx) => ctx.stat('powerup_slowmo') >= 50 },
    { id: 'doublecoins_50', name: 'Double Trouble', description: 'Use Double Coins 50 times', rewardCoins: 200, rewardXp: 120,
      check: (ctx) => ctx.stat('powerup_doubleCoins') >= 50 },
    { id: 'jumps_1000', name: 'Jump King', description: 'Perform 1,000 jumps', rewardCoins: 250, rewardXp: 150,
      check: (ctx) => ctx.stat('lifetimeJumps') >= 1000 },
    { id: 'dodge_1000', name: 'Dodge Master', description: 'Dodge 1,000 obstacles total', rewardCoins: 300, rewardXp: 180,
      check: (ctx) => ctx.stat('lifetimeDodges') >= 1000 },
    { id: 'dodge_spike_100', name: 'Spike Survivor', description: 'Dodge 100 Spikes', rewardCoins: 120, rewardXp: 80,
      check: (ctx) => ctx.stat('dodge_spike') >= 100 },
    { id: 'dodge_wall_100', name: 'Wall Breaker', description: 'Dodge 100 Moving Walls', rewardCoins: 120, rewardXp: 80,
      check: (ctx) => ctx.stat('dodge_wall') >= 100 },
    { id: 'dodge_laser_100', name: 'Laser Dancer', description: 'Dodge 100 Rotating Lasers', rewardCoins: 150, rewardXp: 100,
      check: (ctx) => ctx.stat('dodge_laser') >= 100 },
    { id: 'dodge_ball_100', name: 'Ball Evader', description: 'Dodge 100 Rolling Balls', rewardCoins: 120, rewardXp: 80,
      check: (ctx) => ctx.stat('dodge_ball') >= 100 },
    { id: 'dodge_fire_100', name: 'Fire Walker', description: 'Dodge 100 Fire Traps', rewardCoins: 130, rewardXp: 90,
      check: (ctx) => ctx.stat('dodge_fire') >= 100 },
    { id: 'dodge_gate_100', name: 'Gatekeeper', description: 'Dodge 100 Electric Gates', rewardCoins: 150, rewardXp: 100,
      check: (ctx) => ctx.stat('dodge_gate') >= 100 },
    { id: 'dodge_block_100', name: 'Block Dodger', description: 'Dodge 100 Falling Blocks', rewardCoins: 130, rewardXp: 90,
      check: (ctx) => ctx.stat('dodge_fallingBlock') >= 100 },
    { id: 'dodge_hole_100', name: 'Hole Jumper', description: 'Jump over 100 Holes', rewardCoins: 130, rewardXp: 90,
      check: (ctx) => ctx.stat('dodge_hole') >= 100 },
    { id: 'skins_10', name: 'Fashionista', description: 'Unlock 10 cube skins', rewardCoins: 300, rewardXp: 150,
      check: (ctx) => ctx.skinsCount >= 10 },
    { id: 'skins_all', name: 'Full Wardrobe', description: 'Unlock all 20 cube skins', rewardCoins: 1200, rewardXp: 700,
      check: (ctx) => ctx.skinsCount >= 20 },
    { id: 'level_25', name: 'Legend', description: 'Reach Player Level 25', rewardCoins: 1000, rewardXp: 0,
      check: (ctx) => ctx.level >= 25 }
  ]; // exactly 30

  // =====================================================================
  // DEFENSIVE STORAGE ACCESS HELPERS (module-level, usable statically)
  // =====================================================================
  function getStorage() {
    return window.CubeRushStorage || null;
  }

  function loadFallbackStats() {
    try {
      const raw = window.localStorage.getItem(FALLBACK_STATS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveFallbackStats(obj) {
    try {
      window.localStorage.setItem(FALLBACK_STATS_KEY, JSON.stringify(obj));
    } catch (e) { /* ignore quota errors */ }
  }

  let _fallbackStats = null;
  function ensureFallbackLoaded() {
    if (_fallbackStats === null) _fallbackStats = loadFallbackStats();
  }

  function statGet(key, defaultValue) {
    const storage = getStorage();
    if (storage && typeof storage.getStat === 'function') {
      const v = storage.getStat(key, defaultValue);
      return v === undefined ? defaultValue : v;
    }
    ensureFallbackLoaded();
    return _fallbackStats[key] !== undefined ? _fallbackStats[key] : defaultValue;
  }

  function statSet(key, value) {
    const storage = getStorage();
    if (storage && typeof storage.setStat === 'function') {
      storage.setStat(key, value);
      return;
    }
    ensureFallbackLoaded();
    _fallbackStats[key] = value;
    saveFallbackStats(_fallbackStats);
  }

  function statIncrement(key, amount) {
    const current = statGet(key, 0);
    const next = current + amount;
    statSet(key, next);
    return next;
  }

  function statMax(key, candidate) {
    const current = statGet(key, 0);
    if (candidate > current) {
      statSet(key, candidate);
      return candidate;
    }
    return current;
  }

  function isMissionCompleted(id) {
    const storage = getStorage();
    if (storage && typeof storage.isMissionCompleted === 'function') return storage.isMissionCompleted(id);
    return statGet(`mission_done_${id}`, false) === true;
  }

  function markMissionCompleted(id) {
    const storage = getStorage();
    if (storage && typeof storage.completeMission === 'function') { storage.completeMission(id); return; }
    statSet(`mission_done_${id}`, true);
  }

  function isAchievementUnlocked(id) {
    const storage = getStorage();
    if (storage && typeof storage.isAchievementUnlocked === 'function') return storage.isAchievementUnlocked(id);
    return statGet(`ach_done_${id}`, false) === true;
  }

  function markAchievementUnlocked(id) {
    const storage = getStorage();
    if (storage && typeof storage.unlockAchievement === 'function') { storage.unlockAchievement(id); return; }
    statSet(`ach_done_${id}`, true);
  }

  function grantCoins(amount) {
    const storage = getStorage();
    if (storage && typeof storage.addCoins === 'function') { storage.addCoins(amount); return; }
  }

  function grantChest(count) {
    const storage = getStorage();
    if (storage && typeof storage.addChest === 'function') { storage.addChest(count); return; }
    if (storage && typeof storage.addRewardChest === 'function') { storage.addRewardChest(count); return; }
    statIncrement('unclaimedChests', count);
  }

  function resolveXpCurve() {
    const C = window.Config || {};
    if (C.XP && typeof C.XP.xpForLevel === 'function') return C.XP.xpForLevel;
    if (typeof C.getXpRequiredForLevel === 'function') return C.getXpRequiredForLevel;
    // Fallback curve: gentle exponential ramp.
    return (level) => Math.round(100 * Math.pow(level, 1.5));
  }

  function grantXp(amount) {
    const storage = getStorage();
    const curve = resolveXpCurve();
    if (storage && typeof storage.addXP === 'function') {
      return storage.addXP(amount, curve) || null;
    }
    return null;
  }

  function getHighScoreLive() {
    const storage = getStorage();
    if (storage && typeof storage.getHighScore === 'function') return storage.getHighScore();
    return 0;
  }

  function getLevelLive() {
    const storage = getStorage();
    if (storage && typeof storage.getLevel === 'function') return storage.getLevel();
    return 1;
  }

  function getSkinsCountLive() {
    const storage = getStorage();
    if (storage && typeof storage.getUnlockedSkins === 'function') {
      const list = storage.getUnlockedSkins();
      return Array.isArray(list) ? list.length : 1;
    }
    return 1;
  }

  // =====================================================================
  // MissionManager class
  // =====================================================================
  class MissionManager extends Phaser.Events.EventEmitter {
    /**
     * @param {Phaser.Scene} [scene] - optional; enables live popups/fx/audio.
     * @param {EffectsManager} [fx]
     * @param {AudioManager} [audio]
     */
    constructor(scene, fx, audio) {
      super();
      this.scene = scene || null;
      this.fx = fx || null;
      this.audio = audio || null;

      const C = window.Config || {};
      this.maxComboMultiplier = (C.COINS && C.COINS.maxComboMultiplier) || 5;

      // Session (single-run) tracking — reset via startSession().
      this._session = this._freshSession();
    }

    _freshSession() {
      return {
        startTime: 0,
        distance: 0,
        comboPeak: 0,
        comboMultiplierPeak: 1,
        tookHit: false,
        jumps: 0,
        dodges: 0,
        powerUpsUsed: 0
      };
    }

    // =====================================================================
    // SESSION LIFECYCLE
    // =====================================================================
    startSession() {
      this._session = this._freshSession();
      this._session.startTime = (this.scene && this.scene.time) ? this.scene.time.now : Date.now();
    }

    /**
     * Call once per frame from GameScene with the distance delta (in
     * meters) traveled since the last frame, to keep the "Distance
     * Runner" mission line and lifetime distance stat up to date
     * without needing a separate per-frame event object.
     */
    tickDistance(deltaMeters) {
      if (deltaMeters <= 0) return;
      this._session.distance += deltaMeters;
      statIncrement('lifetimeDistance', deltaMeters);
      this._evaluateAll();
    }

    /**
     * Finalizes the run — call from GameScene right when the player
     * dies (before transitioning to GameOverScene).
     * @param {Object} summary
     * @param {number} summary.survivalMs
     * @param {number} summary.score
     */
    endRun(summary) {
      statIncrement('lifetimeGamesPlayed', 1);
      statMax('longestSurvivalMs', summary.survivalMs || 0);

      if (!this._session.tookHit) {
        statMax('bestNoHitSurvivalMs', summary.survivalMs || 0);
      }

      statMax('bestComboStreak', this._session.comboPeak);
      statMax('bestComboMultiplier', this._session.comboMultiplierPeak);

      this._evaluateAll();
    }

    // =====================================================================
    // EVENT RECORDING (wired from GameScene to the various managers)
    // =====================================================================
    /**
     * @param {string} type - 'coinCollected' | 'obstacleDodged' | 'jump' |
     *                        'powerUpUsed' | 'comboChanged' | 'playerHit'
     * @param {Object} [payload]
     */
    recordEvent(type, payload) {
      switch (type) {
        case 'coinCollected':
          statIncrement('lifetimeCoins', payload.value || 0);
          if (payload.isGem) statIncrement('lifetimeGems', 1);
          if (payload.comboCount > this._session.comboPeak) {
            this._session.comboPeak = payload.comboCount;
          }
          break;

        case 'comboChanged':
          if (payload.multiplier > this._session.comboMultiplierPeak) {
            this._session.comboMultiplierPeak = payload.multiplier;
          }
          break;

        case 'obstacleDodged':
          statIncrement('lifetimeDodges', 1);
          if (payload && payload.type) {
            statIncrement(`dodge_${payload.type}`, 1);
          }
          this._session.dodges++;
          break;

        case 'jump':
          statIncrement('lifetimeJumps', 1);
          this._session.jumps++;
          break;

        case 'powerUpUsed':
          statIncrement('lifetimePowerUps', 1);
          if (payload && payload.type) {
            statIncrement(`powerup_${payload.type}`, 1);
          }
          this._session.powerUpsUsed++;
          break;

        case 'playerHit':
          this._session.tookHit = true;
          break;

        default:
          break;
      }

      this._evaluateAll();
    }

    // =====================================================================
    // EVALUATION
    // =====================================================================
    _buildCheckContext() {
      return {
        stat: (key) => statGet(key, 0),
        highScore: getHighScoreLive(),
        level: getLevelLive(),
        skinsCount: getSkinsCountLive(),
        maxComboMultiplier: this.maxComboMultiplier
      };
    }

    _evaluateAll() {
      this._evaluateMissions();
      this._evaluateAchievements();
    }

    _evaluateMissions() {
      const ctx = this._buildCheckContext();
      MISSIONS.forEach((def) => {
        if (isMissionCompleted(def.id)) return;

        // 'skins' category reads a live value rather than an
        // incrementally-tracked stat.
        const currentValue = def.statKey === 'skinsUnlockedLive'
          ? ctx.skinsCount
          : ctx.stat(def.statKey);

        if (currentValue >= def.target) {
          this._completeMission(def);
        }
      });
    }

    _evaluateAchievements() {
      const ctx = this._buildCheckContext();
      ACHIEVEMENT_DEFS.forEach((def) => {
        if (isAchievementUnlocked(def.id)) return;
        try {
          if (def.check(ctx)) {
            this._unlockAchievement(def);
          }
        } catch (e) {
          // Defensive: a single bad predicate should never crash the loop.
          console.warn('[MissionManager] achievement check failed:', def.id, e);
        }
      });
    }

    _completeMission(def) {
      markMissionCompleted(def.id);
      grantCoins(def.rewardCoins);
      const levelResult = grantXp(def.rewardXp);
      if (def.grantsChest) grantChest(1);

      this._celebrate('mission', def, levelResult);
      this.emit('missionCompleted', def);
    }

    _unlockAchievement(def) {
      markAchievementUnlocked(def.id);
      grantCoins(def.rewardCoins);
      const levelResult = grantXp(def.rewardXp);

      this._celebrate('achievement', def, levelResult);
      this.emit('achievementUnlocked', def);
    }

    _celebrate(kind, def, levelResult) {
      if (this.scene && this.fx) {
        const cam = this.scene.cameras.main;
        const x = cam.width / 2;
        const y = kind === 'achievement' ? cam.height * 0.22 : cam.height * 0.3;

        this.fx.achievementBurst(x, y);
        this.fx.floatingText(
          x, y,
          kind === 'achievement' ? `🏆 ${def.name}` : `✔ ${def.name}`,
          { color: kind === 'achievement' ? 0xffd23f : 0x39ff88, fontSize: 26, duration: 1200 }
        );
      }
      if (this.audio && this.audio.playAchievement) {
        this.audio.playAchievement();
      }

      if (levelResult && levelResult.leveledUp) {
        this._onLevelUp(levelResult.newLevel);
      }
    }

    _onLevelUp(newLevel) {
      if (this.scene && this.fx) {
        const cam = this.scene.cameras.main;
        this.fx.levelUpBurst(cam.width / 2, cam.height * 0.4);
        this.fx.floatingText(cam.width / 2, cam.height * 0.4, `LEVEL ${newLevel}!`, {
          color: 0x00f0ff, fontSize: 34, duration: 1300
        });
      }
      if (this.audio && this.audio.playLevelUp) this.audio.playLevelUp();
      this.emit('levelUp', newLevel);
    }

    // =====================================================================
    // INSTANCE QUERY HELPERS
    // =====================================================================
    getSessionSnapshot() {
      return Object.assign({}, this._session);
    }

    // =====================================================================
    // STATIC API — for UI scenes that don't need live event tracking.
    // =====================================================================
    static getMissionDefs() {
      return MISSIONS.slice();
    }

    static getAchievementDefs() {
      return ACHIEVEMENT_DEFS.slice();
    }

    /**
     * @returns {Array} mission status objects with progress info, ready
     *                  for direct rendering in a missions/achievements UI.
     */
    static buildMissionStatusList() {
      const skinsCount = getSkinsCountLive();
      return MISSIONS.map((def) => {
        const completed = isMissionCompleted(def.id);
        const currentValue = def.statKey === 'skinsUnlockedLive'
          ? skinsCount
          : statGet(def.statKey, 0);
        const progress = Phaser.Math ? Phaser.Math.Clamp(currentValue / def.target, 0, 1) : Math.min(1, currentValue / def.target);
        return Object.assign({}, def, {
          completed,
          currentValue: Math.min(currentValue, def.target),
          progress
        });
      });
    }

    /**
     * @returns {Array} achievement status objects (locked/unlocked).
     */
    static buildAchievementStatusList() {
      const ctx = {
        stat: (key) => statGet(key, 0),
        highScore: getHighScoreLive(),
        level: getLevelLive(),
        skinsCount: getSkinsCountLive(),
        maxComboMultiplier: ((window.Config || {}).COINS || {}).maxComboMultiplier || 5
      };
      return ACHIEVEMENT_DEFS.map((def) => {
        const unlocked = isAchievementUnlocked(def.id);
        let progressHint = unlocked ? 1 : 0;
        return Object.assign({}, def, { unlocked, progressHint });
      });
    }

    static getTotalMissionCount() { return MISSIONS.length; }
    static getTotalAchievementCount() { return ACHIEVEMENT_DEFS.length; }
    static getCompletedMissionCount() {
      return MISSIONS.filter((m) => isMissionCompleted(m.id)).length;
    }
    static getUnlockedAchievementCount() {
      return ACHIEVEMENT_DEFS.filter((a) => isAchievementUnlocked(a.id)).length;
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================
    destroy() {
      this.removeAllListeners();
    }
  }

  window.MissionManager = MissionManager;
})(window);