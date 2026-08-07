/**
 * Storage.js
 * ----------------------------------------------------------------------
 * Cube Rush — Centralized localStorage persistence layer.
 *
 * Every piece of persistent game state flows through this single module.
 * No other file should call localStorage directly — this keeps save/load
 * logic in one place, makes versioning/migration possible, and protects
 * against corrupted data crashing the game on boot.
 *
 * Responsibilities:
 *  - Define the default save-data shape (single source of truth for a
 *    fresh install)
 *  - Load / validate / repair save data from localStorage
 *  - Provide typed getters/setters for every persisted field
 *  - Debounce writes so rapid updates (e.g. coin pickups) don't hammer
 *    localStorage every frame
 *  - Provide import/export (JSON) for backup or cloud-sync hooks later
 * ----------------------------------------------------------------------
 */

class Storage {
  constructor() {
    this.STORAGE_KEY = 'cubeRush_saveData_v1';
    this.SAVE_VERSION = 1;

    // Internal in-memory mirror of save data. All reads/writes go
    // through this object; we only touch localStorage on load and
    // on (debounced) flush.
    this.data = null;

    // Debounce handle for batched writes
    this._flushTimer = null;
    this._flushDelayMs = 400;

    this._load();
  }

  // ----------------------------------------------------------------
  // Default shape
  // ----------------------------------------------------------------

  _getDefaultData() {
    return {
      version: this.SAVE_VERSION,

      // Currency & scoring
      coins: 0,
      totalCoinsEarned: 0,
      highScore: 0,
      bestCombo: 0,
      totalRunsPlayed: 0,
      totalDistanceRun: 0,

      // Progression
      xp: 0,
      level: 1,

      // Skins
      unlockedSkins: ['classic'],
      selectedSkin: 'classic',

      // Achievements: map of achievementId -> { unlocked: bool, progress: number, unlockedAt: timestamp|null }
      achievements: {},

      // Missions: map of missionId -> { progress: number, completed: bool, claimed: bool }
      missions: {},

      // Daily reward
      dailyReward: {
        lastClaimedTimestamp: null,
        streakDay: 0, // 0 = none claimed yet, 1-7 cycles
      },

      // Lucky spin
      luckySpin: {
        lastSpinTimestamp: null,
        totalSpins: 0,
      },

      // Reward chests earned but not yet opened
      pendingChests: 0,

      // Settings
      settings: {
        musicEnabled: true,
        sfxEnabled: true,
        musicVolume: 0.7,
        sfxVolume: 1.0,
        vibrationEnabled: true,
        graphicsQuality: 'high', // 'low' | 'medium' | 'high' — used for low-end phone fallback
      },

      // Timestamps
      firstPlayedTimestamp: Date.now(),
      lastPlayedTimestamp: Date.now(),
    };
  }

  // ----------------------------------------------------------------
  // Load / Save / Migration
  // ----------------------------------------------------------------

  _load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(this.STORAGE_KEY);
    } catch (e) {
      console.warn('[Storage] localStorage unavailable, using in-memory fallback.', e);
      this.data = this._getDefaultData();
      return;
    }

    if (!raw) {
      this.data = this._getDefaultData();
      this._flush(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      this.data = this._migrateAndValidate(parsed);
    } catch (e) {
      console.warn('[Storage] Corrupted save data detected, resetting to defaults.', e);
      this.data = this._getDefaultData();
      this._flush(true);
    }
  }

  /**
   * Merges saved data over a fresh default object so any new fields
   * added in later game updates are automatically backfilled without
   * wiping the player's existing progress. Also runs version-specific
   * migrations if SAVE_VERSION is ever bumped.
   */
  _migrateAndValidate(parsed) {
    const defaults = this._getDefaultData();

    const merged = this._deepMerge(defaults, parsed);

    // Basic sanity checks — guard against negative/NaN corruption
    merged.coins = this._sanitizeNumber(merged.coins, 0);
    merged.totalCoinsEarned = this._sanitizeNumber(merged.totalCoinsEarned, 0);
    merged.highScore = this._sanitizeNumber(merged.highScore, 0);
    merged.bestCombo = this._sanitizeNumber(merged.bestCombo, 0);
    merged.xp = this._sanitizeNumber(merged.xp, 0);
    merged.level = Math.max(1, this._sanitizeNumber(merged.level, 1));
    merged.pendingChests = Math.max(0, this._sanitizeNumber(merged.pendingChests, 0));

    if (!Array.isArray(merged.unlockedSkins) || merged.unlockedSkins.length === 0) {
      merged.unlockedSkins = ['classic'];
    }
    if (!merged.unlockedSkins.includes('classic')) {
      merged.unlockedSkins.unshift('classic');
    }
    if (!merged.selectedSkin || !merged.unlockedSkins.includes(merged.selectedSkin)) {
      merged.selectedSkin = 'classic';
    }

    merged.version = this.SAVE_VERSION;
    return merged;
  }

  _deepMerge(base, override) {
    const result = Array.isArray(base) ? [] : {};
    for (const key in base) {
      if (override && Object.prototype.hasOwnProperty.call(override, key)) {
        const baseVal = base[key];
        const overrideVal = override[key];
        if (
          baseVal && overrideVal &&
          typeof baseVal === 'object' && typeof overrideVal === 'object' &&
          !Array.isArray(baseVal)
        ) {
          result[key] = this._deepMerge(baseVal, overrideVal);
        } else {
          result[key] = overrideVal;
        }
      } else {
        result[key] = base[key];
      }
    }
    return result;
  }

  _sanitizeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /**
   * Schedules a debounced write to localStorage. Pass immediate=true
   * to bypass the debounce (used on first install and on scene
   * transitions where we want a guaranteed flush, e.g. before Game Over).
   */
  _flush(immediate = false) {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    const write = () => {
      try {
        this.data.lastPlayedTimestamp = Date.now();
        window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.warn('[Storage] Failed to write save data.', e);
      }
    };

    if (immediate) {
      write();
    } else {
      this._flushTimer = setTimeout(write, this._flushDelayMs);
    }
  }

  /** Forces any pending debounced write to happen immediately. Call this
   *  on scene shutdown / page visibility change to avoid losing progress. */
  forceSave() {
    this._flush(true);
  }

  // ----------------------------------------------------------------
  // Coins
  // ----------------------------------------------------------------

  getCoins() {
    return this.data.coins;
  }

  addCoins(amount) {
    if (amount <= 0) return this.data.coins;
    this.data.coins += amount;
    this.data.totalCoinsEarned += amount;
    this._flush();
    return this.data.coins;
  }

  /** Returns true if the spend succeeded, false if insufficient coins. */
  spendCoins(amount) {
    if (amount <= 0) return true;
    if (this.data.coins < amount) return false;
    this.data.coins -= amount;
    this._flush();
    return true;
  }

  // ----------------------------------------------------------------
  // Score / Combo
  // ----------------------------------------------------------------

  getHighScore() {
    return this.data.highScore;
  }

  /** Returns true if this run set a new high score. */
  submitScore(score) {
    this.data.totalRunsPlayed += 1;
    const isNewHigh = score > this.data.highScore;
    if (isNewHigh) {
      this.data.highScore = score;
    }
    this._flush(true);
    return isNewHigh;
  }

  submitCombo(combo) {
    if (combo > this.data.bestCombo) {
      this.data.bestCombo = combo;
      this._flush();
    }
    return this.data.bestCombo;
  }

  addDistance(distance) {
    this.data.totalDistanceRun += Math.max(0, distance);
    this._flush();
  }

  // ----------------------------------------------------------------
  // XP / Level
  // ----------------------------------------------------------------

  getXP() {
    return this.data.xp;
  }

  getLevel() {
    return this.data.level;
  }

  /**
   * Adds XP and levels up as many times as the XP curve allows.
   * xpCurveFn: (level) => xpRequiredForNextLevel — supplied by caller
   * (typically Config.js) so this module stays free of gameplay tuning.
   * Returns { xp, level, leveledUp, levelsGained }.
   */
  addXP(amount, xpCurveFn) {
    if (amount <= 0) {
      return { xp: this.data.xp, level: this.data.level, leveledUp: false, levelsGained: 0 };
    }

    this.data.xp += amount;
    let levelsGained = 0;

    if (typeof xpCurveFn === 'function') {
      let requiredXP = xpCurveFn(this.data.level);
      while (this.data.xp >= requiredXP) {
        this.data.xp -= requiredXP;
        this.data.level += 1;
        levelsGained += 1;
        requiredXP = xpCurveFn(this.data.level);
      }
    }

    this._flush();
    return {
      xp: this.data.xp,
      level: this.data.level,
      leveledUp: levelsGained > 0,
      levelsGained,
    };
  }

  // ----------------------------------------------------------------
  // Skins
  // ----------------------------------------------------------------

  getUnlockedSkins() {
    return [...this.data.unlockedSkins];
  }

  isSkinUnlocked(skinId) {
    return this.data.unlockedSkins.includes(skinId);
  }

  unlockSkin(skinId) {
    if (this.isSkinUnlocked(skinId)) return false;
    this.data.unlockedSkins.push(skinId);
    this._flush(true);
    return true;
  }

  getSelectedSkin() {
    return this.data.selectedSkin;
  }

  selectSkin(skinId) {
    if (!this.isSkinUnlocked(skinId)) return false;
    this.data.selectedSkin = skinId;
    this._flush();
    return true;
  }

  // ----------------------------------------------------------------
  // Achievements
  // ----------------------------------------------------------------

  getAchievement(id) {
    return this.data.achievements[id] || { unlocked: false, progress: 0, unlockedAt: null };
  }

  getAllAchievements() {
    return { ...this.data.achievements };
  }

  updateAchievementProgress(id, progress, target) {
    const current = this.getAchievement(id);
    if (current.unlocked) return current;

    const newProgress = Math.max(current.progress, progress);
    const unlocked = target != null && newProgress >= target;

    this.data.achievements[id] = {
      unlocked,
      progress: newProgress,
      unlockedAt: unlocked ? Date.now() : null,
    };

    this._flush(true);
    return this.data.achievements[id];
  }

  unlockAchievement(id) {
    const current = this.getAchievement(id);
    if (current.unlocked) return false;
    this.data.achievements[id] = {
      unlocked: true,
      progress: current.progress,
      unlockedAt: Date.now(),
    };
    this._flush(true);
    return true;
  }

  // ----------------------------------------------------------------
  // Missions
  // ----------------------------------------------------------------

  getMission(id) {
    return this.data.missions[id] || { progress: 0, completed: false, claimed: false };
  }

  getAllMissions() {
    return { ...this.data.missions };
  }

  updateMissionProgress(id, amount, target) {
    const current = this.getMission(id);
    if (current.completed) return current;

    const newProgress = current.progress + amount;
    const completed = target != null && newProgress >= target;

    this.data.missions[id] = {
      progress: Math.min(newProgress, target != null ? target : newProgress),
      completed,
      claimed: current.claimed,
    };

    this._flush();
    return this.data.missions[id];
  }

  claimMission(id) {
    const current = this.getMission(id);
    if (!current.completed || current.claimed) return false;
    this.data.missions[id] = { ...current, claimed: true };
    this._flush(true);
    return true;
  }

  // ----------------------------------------------------------------
  // Daily Reward
  // ----------------------------------------------------------------

  getDailyRewardState() {
    return { ...this.data.dailyReward };
  }

  /**
   * Determines whether the daily reward is available right now, based
   * on a 24h cooldown from the last claim. Returns { available, streakDay }
   * where streakDay is the day (1-7) that WOULD be claimed if claimed now.
   */
  checkDailyRewardAvailability(cycleLength = 7) {
    const { lastClaimedTimestamp, streakDay } = this.data.dailyReward;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const twoDaysMs = oneDayMs * 2;

    if (!lastClaimedTimestamp) {
      return { available: true, streakDay: 1 };
    }

    const elapsed = now - lastClaimedTimestamp;

    if (elapsed < oneDayMs) {
      return { available: false, streakDay: (streakDay % cycleLength) + 1 };
    }

    // Missed more than a day — streak resets to day 1
    if (elapsed >= twoDaysMs) {
      return { available: true, streakDay: 1 };
    }

    return { available: true, streakDay: (streakDay % cycleLength) + 1 };
  }

  claimDailyReward(cycleLength = 7) {
    const { available, streakDay } = this.checkDailyRewardAvailability(cycleLength);
    if (!available) return null;

    this.data.dailyReward = {
      lastClaimedTimestamp: Date.now(),
      streakDay,
    };
    this._flush(true);
    return { streakDay };
  }

  // ----------------------------------------------------------------
  // Lucky Spin
  // ----------------------------------------------------------------

  getLuckySpinState() {
    return { ...this.data.luckySpin };
  }

  canSpinToday() {
    const { lastSpinTimestamp } = this.data.luckySpin;
    if (!lastSpinTimestamp) return true;
    const oneDayMs = 24 * 60 * 60 * 1000;
    return Date.now() - lastSpinTimestamp >= oneDayMs;
  }

  recordLuckySpin() {
    this.data.luckySpin.lastSpinTimestamp = Date.now();
    this.data.luckySpin.totalSpins += 1;
    this._flush(true);
  }

  // ----------------------------------------------------------------
  // Reward Chests
  // ----------------------------------------------------------------

  getPendingChests() {
    return this.data.pendingChests;
  }

  addPendingChest(count = 1) {
    this.data.pendingChests += count;
    this._flush(true);
    return this.data.pendingChests;
  }

  openChest() {
    if (this.data.pendingChests <= 0) return false;
    this.data.pendingChests -= 1;
    this._flush(true);
    return true;
  }

  // ----------------------------------------------------------------
  // Settings
  // ----------------------------------------------------------------

  getSettings() {
    return { ...this.data.settings };
  }

  updateSetting(key, value) {
    if (!(key in this.data.settings)) return false;
    this.data.settings[key] = value;
    this._flush();
    return true;
  }

  // ----------------------------------------------------------------
  // Import / Export (backup, future cloud-sync hook)
  // ----------------------------------------------------------------

  exportSaveData() {
    return JSON.stringify(this.data);
  }

  importSaveData(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      this.data = this._migrateAndValidate(parsed);
      this._flush(true);
      return true;
    } catch (e) {
      console.warn('[Storage] Failed to import save data.', e);
      return false;
    }
  }

  // ----------------------------------------------------------------
  // Reset
  // ----------------------------------------------------------------

  resetAllProgress() {
    this.data = this._getDefaultData();
    this._flush(true);
  }
}

// Singleton instance — every scene/manager accesses the same save state
// through window.CubeRushStorage rather than instantiating its own copy.
window.CubeRushStorage = window.CubeRushStorage || new Storage();
