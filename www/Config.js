/**
 * ============================================================================
 * CUBE RUSH — Config.js
 * ----------------------------------------------------------------------------
 * Single source of truth for every tunable number, color, key, and static
 * data table used across the game. No other file should hard-code a magic
 * number that belongs here — this keeps balancing, re-skinning, and
 * localization changes to ONE place.
 *
 * Loaded first (after Phaser) in index.html, so every other script can read
 * the global `CONFIG` object synchronously.
 * ============================================================================
 */

const CONFIG = {

  // ==========================================================================
  // DESIGN RESOLUTION
  // Phaser's ScaleManager (see getGameConfig() below) fits this virtual
  // resolution into whatever the real device screen is, letterboxing as
  // needed. Portrait 9:16 base — matches the vast majority of Android phones.
  // ==========================================================================
  DESIGN_WIDTH: 720,
  DESIGN_HEIGHT: 1280,

  // ==========================================================================
  // SCENE KEYS
  // Centralized to avoid typo bugs when calling scene.start() / scene.launch()
  // ==========================================================================
  SCENES: {
    BOOT: 'BootScene',
    PRELOAD: 'PreloadScene',
    MENU: 'MenuScene',
    SHOP: 'ShopScene',
    ACHIEVEMENTS: 'AchievementsScene',
    DAILY_REWARD: 'DailyRewardScene',
    LUCKY_SPIN: 'LuckySpinScene',
    GAME: 'GameScene',
    UI: 'UIScene',
    GAME_OVER: 'GameOverScene'
  },

  // ==========================================================================
  // COLOR PALETTE
  // Numeric (0xRRGGBB) for Phaser graphics/tints, string (#rrggbb) for CSS-
  // adjacent usage (DOM text styles, canvas gradients). Keep in sync with
  // style.css :root tokens.
  // ==========================================================================
  COLORS: {
    VOID: 0x0B0E1A,
    VOID_SOFT: 0x12162A,
    VOID_HEX: '#0B0E1A',
    CYAN: 0x00F0FF,
    CYAN_HEX: '#00F0FF',
    MAGENTA: 0xFF2E9A,
    MAGENTA_HEX: '#FF2E9A',
    GOLD: 0xFFD23F,
    GOLD_HEX: '#FFD23F',
    DANGER: 0xFF3B3B,
    DANGER_HEX: '#FF3B3B',
    MINT: 0x39FF88,
    MINT_HEX: '#39FF88',
    INK_100: 0xF5F7FF,
    INK_100_HEX: '#F5F7FF',
    INK_400: 0x8891B0,
    INK_400_HEX: '#8891B0',
    LANE_LINE: 0x1E2440,
    SHADOW: 0x000000
  },

  // ==========================================================================
  // FONTS
  // ==========================================================================
  FONTS: {
    DISPLAY: 'Orbitron',
    BODY: 'Rubik'
  },

  // ==========================================================================
  // STORAGE
  // See Storage.js — every persisted field is keyed off this map so a rename
  // here is the only place that needs to change.
  // ==========================================================================
  STORAGE_KEYS: {
    ROOT: 'cubeRush_save_v1'
  },

  // ==========================================================================
  // LANES / TRACK
  // The runner uses a 3-lane system. Lane positions are computed at runtime
  // in GameScene from DESIGN_WIDTH so they always stay centered.
  // ==========================================================================
  TRACK: {
    LANE_COUNT: 3,
    LANE_MARGIN: 90,       // px from each screen edge to the outer lane centers
    GROUND_Y: 980,         // y position of the running plane
    HORIZON_Y: 260,        // vanishing-point reference for parallax layers
    SCROLL_LINE_SPACING: 160
  },

  // ==========================================================================
  // PLAYER / MOVEMENT
  // ==========================================================================
  PLAYER: {
    SIZE: 84,
    LANE_SWITCH_MS: 140,        // tween duration for a lane change
    JUMP_VELOCITY: -1350,
    JUMP_DURATION_MS: 620,
    GRAVITY: 4200,
    SLIDE_DURATION_MS: 420,
    HITBOX_SHRINK: 0.72,        // forgiving hitbox (percentage of visual size)
    INVULN_AFTER_HIT_MS: 900,
    SWIPE_MIN_DISTANCE: 28,     // px threshold to register a swipe vs a tap
    SWIPE_MAX_TIME_MS: 500,
    TAP_MAX_MOVEMENT: 14,       // px — below this, a touch counts as a "tap" (jump)
    TRAIL_EMIT_RATE: 45
  },

  // ==========================================================================
  // FORWARD SPEED / DIFFICULTY CURVE
  // Difficulty ramps every DIFFICULTY.INTERVAL_MS (30s per spec). Each tier
  // raises scroll speed and unlocks additional obstacle variety / density.
  // ==========================================================================
  DIFFICULTY: {
    INTERVAL_MS: 30000,
    MAX_TIER: 10,
    BASE_SPEED: 480,            // px/sec world scroll speed at tier 0
    SPEED_PER_TIER: 55,         // added px/sec per tier
    MAX_SPEED: 1380,
    BASE_SPAWN_INTERVAL_MS: 950,
    MIN_SPAWN_INTERVAL_MS: 430,
    SPAWN_INTERVAL_STEP_MS: 55, // reduced per tier, floored at MIN
    DOUBLE_SPAWN_CHANCE_START_TIER: 3, // tier at which two obstacles can share a beat
    TRIPLE_SPAWN_CHANCE_START_TIER: 6
  },

  // ==========================================================================
  // OBSTACLES
  // `minTier` gates when a type starts appearing so early runs feel fair and
  // later runs feel chaotic. `weight` is relative spawn probability among all
  // currently-unlocked types. `lanes` = how many lanes wide it can occupy.
  // ==========================================================================
  OBSTACLE_TYPES: {
    SPIKE:          { id: 'SPIKE',          minTier: 0, weight: 18, lanes: 1, kind: 'ground' },
    HOLE:           { id: 'HOLE',           minTier: 0, weight: 14, lanes: 1, kind: 'ground_gap' },
    MOVING_WALL:    { id: 'MOVING_WALL',    minTier: 1, weight: 12, lanes: 1, kind: 'lane_sweep' },
    ROLLING_BALL:   { id: 'ROLLING_BALL',   minTier: 1, weight: 12, lanes: 1, kind: 'ground_moving' },
    FALLING_BLOCK:  { id: 'FALLING_BLOCK',  minTier: 2, weight: 12, lanes: 1, kind: 'aerial_drop' },
    FIRE_TRAP:      { id: 'FIRE_TRAP',      minTier: 2, weight: 12, lanes: 1, kind: 'timed_ground' },
    ROTATING_LASER: { id: 'ROTATING_LASER', minTier: 3, weight: 10, lanes: 3, kind: 'sweep_all' },
    ELECTRIC_GATE:  { id: 'ELECTRIC_GATE',  minTier: 4, weight: 10, lanes: 2, kind: 'timed_gate' }
  },

  // ==========================================================================
  // COINS
  // ==========================================================================
  COINS: {
    VALUE: 1,
    SPAWN_PATTERN_LENGTH: 5,    // coins per arc/line pickup pattern
    PATTERN_SPACING: 62,
    MAGNET_RADIUS: 220,
    MAGNET_PULL_SPEED: 900,
    DOUBLE_COINS_MULTIPLIER: 2
  },

  // ==========================================================================
  // COMBO SYSTEM
  // Combo increases per coin collected within the combo window; resets on
  // hit or if the window expires with no pickup.
  // ==========================================================================
  COMBO: {
    WINDOW_MS: 2200,
    STEP: 1,
    MAX_MULTIPLIER: 10,
    SCORE_PER_STEP_BONUS: 0.15  // +15% score per multiplier step while active
  },

  // ==========================================================================
  // POWER-UPS
  // ==========================================================================
  POWERUPS: {
    SPAWN_CHANCE: 0.010,        // rolled once per obstacle-spawn tick
    MIN_GAP_MS: 12000,          // minimum time between power-up spawns
    TYPES: {
      MAGNET:    { id: 'MAGNET',    durationMs: 8000,  color: 0xFFD23F, icon: 'magnet' },
      SHIELD:    { id: 'SHIELD',    durationMs: 7000,  color: 0x00F0FF, icon: 'shield' },
      SLOWMO:    { id: 'SLOWMO',    durationMs: 5000,  color: 0xFF2E9A, icon: 'slowmo', timeScale: 0.55 },
      DOUBLE_COINS: { id: 'DOUBLE_COINS', durationMs: 10000, color: 0x39FF88, icon: 'double' }
    }
  },

  // ==========================================================================
  // XP / LEVEL SYSTEM
  // Level N requires XP_BASE * (N ^ XP_EXPONENT), rounded. Rewards coins on
  // every level-up (see MissionManager.getXpForLevel / applyLevelUp).
  // ==========================================================================
  XP: {
    BASE: 60,
    EXPONENT: 1.35,
    MAX_LEVEL: 100,
    COINS_PER_XP: 0,            // XP does not cost coins; awarded from play
    RUN_XP_PER_10_SCORE: 1,     // XP earned per 10 score points at run end
    LEVEL_UP_COIN_REWARD: 25
  },

  // ==========================================================================
  // DAILY REWARD (7-day repeating cycle, resets streak if a day is missed)
  // ==========================================================================
  DAILY_REWARDS: [
    { day: 1, type: 'coins', amount: 50 },
    { day: 2, type: 'coins', amount: 75 },
    { day: 3, type: 'coins', amount: 100 },
    { day: 4, type: 'spin',  amount: 1 },
    { day: 5, type: 'coins', amount: 150 },
    { day: 6, type: 'coins', amount: 200 },
    { day: 7, type: 'chest', amount: 1 }
  ],

  // ==========================================================================
  // LUCKY SPIN WHEEL
  // Weighted segments; `type` matches a reward resolver in LuckySpinScene.
  // ==========================================================================
  SPIN_REWARDS: [
    { label: '50 Coins',   type: 'coins', amount: 50,  weight: 26, color: 0x00F0FF },
    { label: '100 Coins',  type: 'coins', amount: 100, weight: 20, color: 0xFF2E9A },
    { label: '200 Coins',  type: 'coins', amount: 200, weight: 12, color: 0xFFD23F },
    { label: '25 Coins',   type: 'coins', amount: 25,  weight: 26, color: 0x39FF88 },
    { label: 'Free Skin',  type: 'skin',  amount: 1,   weight: 4,  color: 0xFF2E9A },
    { label: '500 Coins',  type: 'coins', amount: 500, weight: 4,  color: 0xFFD23F },
    { label: 'Chest',      type: 'chest', amount: 1,   weight: 6,  color: 0x00F0FF },
    { label: 'Jackpot',    type: 'coins', amount: 1000, weight: 2, color: 0xFFFFFF }
  ],

  // ==========================================================================
  // REWARD CHEST (opened from missions / daily-day-7 / lucky spin)
  // Rolls one entry weighted, in addition to a guaranteed small coin amount.
  // ==========================================================================
  CHEST_REWARDS: [
    { type: 'coins', amount: 150, weight: 40 },
    { type: 'coins', amount: 300, weight: 25 },
    { type: 'coins', amount: 600, weight: 12 },
    { type: 'skin',  amount: 1,   weight: 15 },
    { type: 'coins', amount: 1200, weight: 8 }
  ],

  // ==========================================================================
  // SKINS (20 unlockable cube skins)
  // `cost` in coins; `unlock` = 'coins' | 'level' | 'achievement' | 'default'.
  // `primary` / `secondary` drive the cube's gradient fill, `glow` is the
  // bloom-ring tint.
  // ==========================================================================
  // NOTE: keys are primaryColor/secondaryColor/glowColor (not primary/secondary/
  // glow) and price (not cost) because that's what Player.js, MenuScene.js,
  // ShopScene.js and GameOverScene.js actually read — keeping these aligned
  // is required for skins to render/purchase correctly.
  SKINS: [
    { id: 'classic',    name: 'Classic Core',     price: 0,    unlock: 'default',     primaryColor: 0x00F0FF, secondaryColor: 0xFF2E9A, glowColor: 0x00F0FF },
    { id: 'sunburst',   name: 'Sunburst',         price: 300,  unlock: 'coins',        primaryColor: 0xFFD23F, secondaryColor: 0xFF7A2E, glowColor: 0xFFD23F },
    { id: 'mint',       name: 'Mint Surge',       price: 300,  unlock: 'coins',        primaryColor: 0x39FF88, secondaryColor: 0x00F0FF, glowColor: 0x39FF88 },
    { id: 'crimson',    name: 'Crimson Edge',     price: 450,  unlock: 'coins',        primaryColor: 0xFF3B3B, secondaryColor: 0xFF2E9A, glowColor: 0xFF3B3B },
    { id: 'violet',     name: 'Violet Drift',     price: 450,  unlock: 'coins',        primaryColor: 0x8B5CF6, secondaryColor: 0xFF2E9A, glowColor: 0x8B5CF6 },
    { id: 'ice',        name: 'Ice Shard',        price: 600,  unlock: 'coins',        primaryColor: 0xBFF7FF, secondaryColor: 0x00F0FF, glowColor: 0xBFF7FF },
    { id: 'gold',       name: 'Gold Rush',        price: 750,  unlock: 'coins',        primaryColor: 0xFFD23F, secondaryColor: 0xFFF3C4, glowColor: 0xFFD23F },
    { id: 'toxic',      name: 'Toxic Pulse',      price: 750,  unlock: 'coins',        primaryColor: 0x39FF88, secondaryColor: 0x0BFF6E, glowColor: 0x39FF88 },
    { id: 'nebula',     name: 'Nebula',           price: 900,  unlock: 'coins',        primaryColor: 0x8B5CF6, secondaryColor: 0x00F0FF, glowColor: 0xFF2E9A },
    { id: 'inferno',    name: 'Inferno',          price: 900,  unlock: 'coins',        primaryColor: 0xFF7A2E, secondaryColor: 0xFF3B3B, glowColor: 0xFFD23F },
    { id: 'obsidian',   name: 'Obsidian',         price: 1100, unlock: 'coins',        primaryColor: 0x1E2440, secondaryColor: 0x00F0FF, glowColor: 0x00F0FF },
    { id: 'aurora',     name: 'Aurora',           price: 1100, unlock: 'coins',        primaryColor: 0x39FF88, secondaryColor: 0x8B5CF6, glowColor: 0x00F0FF },
    { id: 'rose',       name: 'Rose Quartz',      price: 1300, unlock: 'coins',        primaryColor: 0xFF9EC4, secondaryColor: 0xFF2E9A, glowColor: 0xFF9EC4 },
    { id: 'storm',      name: 'Storm Front',      price: 1300, unlock: 'coins',        primaryColor: 0x8891B0, secondaryColor: 0x00F0FF, glowColor: 0xF5F7FF },
    { id: 'lava',       name: 'Lava Core',        price: 1500, unlock: 'coins',        primaryColor: 0xFF3B3B, secondaryColor: 0xFFD23F, glowColor: 0xFF7A2E },
    { id: 'galaxy',     name: 'Galaxy',           price: 1800, unlock: 'coins',        primaryColor: 0x0B0E1A, secondaryColor: 0xFF2E9A, glowColor: 0x8B5CF6 },
    { id: 'rookie',     name: 'Rookie Badge',     price: 400,  unlock: 'coins',        primaryColor: 0x00F0FF, secondaryColor: 0x39FF88, glowColor: 0x39FF88 },
    { id: 'veteran',    name: 'Veteran Badge',    price: 800,  unlock: 'coins',        primaryColor: 0xFFD23F, secondaryColor: 0xFF2E9A, glowColor: 0xFFD23F },
    { id: 'legend',     name: 'Legend Badge',     price: 1600, unlock: 'coins',        primaryColor: 0xFFFFFF, secondaryColor: 0x00F0FF, glowColor: 0xFFFFFF },
    { id: 'immortal',   name: 'Immortal',         price: 2200, unlock: 'coins',        primaryColor: 0xFF2E9A, secondaryColor: 0xFFD23F, glowColor: 0xFFFFFF }
  ],

  // ==========================================================================
  // ACHIEVEMENTS
  // `metric` matches a running-stat tracked in Storage.js stats block.
  // ==========================================================================
  ACHIEVEMENTS: [
    { id: 'first_run',       name: 'First Steps',      desc: 'Complete your first run',              metric: 'totalRuns',        goal: 1,     reward: 50 },
    { id: 'coin_collector',  name: 'Coin Collector',   desc: 'Collect 500 total coins',               metric: 'totalCoinsEarned', goal: 500,   reward: 75 },
    { id: 'coin_hoarder',    name: 'Coin Hoarder',     desc: 'Collect 5,000 total coins',              metric: 'totalCoinsEarned', goal: 5000,  reward: 200 },
    { id: 'coin_tycoon',     name: 'Coin Tycoon',      desc: 'Collect 25,000 total coins',             metric: 'totalCoinsEarned', goal: 25000, reward: 500 },
    { id: 'score_500',       name: 'Getting Started',  desc: 'Score 500 in a single run',              metric: 'bestScore',        goal: 500,   reward: 50 },
    { id: 'score_2000',      name: 'Runner',           desc: 'Score 2,000 in a single run',            metric: 'bestScore',        goal: 2000,  reward: 100 },
    { id: 'score_5000',      name: 'Speedster',        desc: 'Score 5,000 in a single run',            metric: 'bestScore',        goal: 5000,  reward: 250 },
    { id: 'score_10000',     name: 'Unstoppable',      desc: 'Score 10,000 in a single run',           metric: 'bestScore',        goal: 10000, reward: 500 },
    { id: 'combo_5',         name: 'Combo Starter',    desc: 'Reach a 5x combo',                       metric: 'bestCombo',        goal: 5,     reward: 60 },
    { id: 'combo_10',        name: 'Combo Master',     desc: 'Reach a 10x combo',                      metric: 'bestCombo',        goal: 10,    reward: 150 },
    { id: 'jumps_100',       name: 'Hop To It',        desc: 'Jump 100 times',                         metric: 'totalJumps',       goal: 100,   reward: 40 },
    { id: 'jumps_1000',      name: 'Frequent Flyer',   desc: 'Jump 1,000 times',                       metric: 'totalJumps',       goal: 1000,  reward: 150 },
    { id: 'swipes_500',      name: 'Quick Fingers',    desc: 'Swipe lanes 500 times',                  metric: 'totalSwipes',      goal: 500,   reward: 100 },
    { id: 'runs_10',         name: 'Regular',          desc: 'Complete 10 runs',                       metric: 'totalRuns',        goal: 10,    reward: 60 },
    { id: 'runs_50',         name: 'Dedicated',        desc: 'Complete 50 runs',                       metric: 'totalRuns',        goal: 50,    reward: 150 },
    { id: 'runs_200',        name: 'Obsessed',         desc: 'Complete 200 runs',                      metric: 'totalRuns',        goal: 200,   reward: 400 },
    { id: 'shields_used_20', name: 'Well Protected',   desc: 'Use Shield power-up 20 times',           metric: 'shieldsUsed',      goal: 20,    reward: 100 },
    { id: 'magnets_used_20', name: 'Magnetic',         desc: 'Use Coin Magnet 20 times',               metric: 'magnetsUsed',      goal: 20,    reward: 100 },
    { id: 'skins_5',         name: 'Fashionista',      desc: 'Unlock 5 skins',                         metric: 'skinsUnlocked',    goal: 5,     reward: 120 },
    { id: 'skins_all',       name: 'Full Wardrobe',    desc: 'Unlock every skin',                      metric: 'skinsUnlocked',    goal: 20,    reward: 600 },
    { id: 'level_10',        name: 'Rising Star',      desc: 'Reach Level 10',                         metric: 'level',            goal: 10,    reward: 150 },
    { id: 'level_25',        name: 'Elite Runner',     desc: 'Reach Level 25',                         metric: 'level',            goal: 25,    reward: 350 },
    { id: 'level_50',        name: 'Grandmaster',      desc: 'Reach Level 50',                         metric: 'level',            goal: 50,    reward: 800 },
    { id: 'missions_10',     name: 'Task Force',       desc: 'Complete 10 missions',                   metric: 'missionsComplete', goal: 10,    reward: 100 },
    { id: 'missions_50',     name: 'Mission Legend',   desc: 'Complete all 50 missions',               metric: 'missionsComplete', goal: 50,    reward: 1000 },
    { id: 'perfect_runner',  name: 'Perfect Runner',   desc: 'Score 3,000+ without using a power-up',  metric: 'perfectRunBest',   goal: 3000,  reward: 300 },
    { id: 'spins_25',        name: 'Wheel Spinner',    desc: 'Use Lucky Spin 25 times',                metric: 'totalSpins',       goal: 25,    reward: 120 },
    { id: 'chests_10',       name: 'Treasure Hunter',  desc: 'Open 10 reward chests',                  metric: 'chestsOpened',     goal: 10,    reward: 150 },
    { id: 'daily_7',         name: 'Creature of Habit', desc: 'Claim 7 daily rewards',                 metric: 'dailyClaims',      goal: 7,     reward: 200 },
    { id: 'daily_30',        name: 'Loyal Runner',     desc: 'Claim 30 daily rewards',                 metric: 'dailyClaims',      goal: 30,    reward: 500 }
  ],

  // ==========================================================================
  // AUDIO
  // Volumes are 0..1 multipliers applied on top of the master/sfx/music
  // sliders stored in Storage.js settings.
  // ==========================================================================
  AUDIO: {
    MASTER_DEFAULT: 1,
    SFX_DEFAULT: 1,
    MUSIC_DEFAULT: 0.6
  },

  // ==========================================================================
  // MISC UI TIMING
  // ==========================================================================
  UI: {
    TOAST_DURATION_MS: 1800,
    BUTTON_TWEEN_MS: 90,
    SCREEN_SHAKE_LIGHT: { duration: 120, intensity: 0.006 },
    SCREEN_SHAKE_HEAVY: { duration: 260, intensity: 0.014 },
    FLOATING_TEXT_RISE: 70,
    FLOATING_TEXT_MS: 750
  },

  // ==========================================================================
  // MONETIZATION HOOKS (see main.js AdManager stub)
  // Flip ENABLED to true and wire real AdMob unit IDs once the Capacitor
  // AdMob plugin is installed in the native shell. All calls are safely
  // no-op when disabled so gameplay never blocks on ad availability.
  // ==========================================================================
  ADS: {
    ENABLED: false,
    BANNER_UNIT_ID: 'ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY',
    INTERSTITIAL_UNIT_ID: 'ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ',
    REWARDED_UNIT_ID: 'ca-app-pub-XXXXXXXXXXXXXXXX/WWWWWWWWWW',
    INTERSTITIAL_EVERY_N_RUNS: 3,
    REWARDED_REVIVE_ENABLED: true,
    REWARDED_DOUBLE_COINS_ENABLED: true
  }
};

// Freeze top-level to catch accidental runtime mutation of shared config
// (nested objects remain mutable for performance — deep-freeze isn't worth
// the cost on a mobile CPU for a config that's effectively read-only anyway).
Object.freeze(CONFIG);

/**
 * Builds the Phaser game configuration object. Called once from main.js.
 * Kept as a factory (not a static object) so DESIGN_WIDTH/HEIGHT changes
 * above always propagate correctly even if this file is hot-reloaded.
 */
function getGameConfig(scenes) {
  return {
    type: Phaser.AUTO,
    width: CONFIG.DESIGN_WIDTH,
    height: CONFIG.DESIGN_HEIGHT,
    parent: 'phaser-container',
    backgroundColor: CONFIG.COLORS.VOID_HEX,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: CONFIG.DESIGN_WIDTH,
      height: CONFIG.DESIGN_HEIGHT
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 0 }, // per-entity gravity applied manually (see Player.js)
        debug: false
      }
    },
    // Low-end Android hardening: disable antialias on very low-DPI devices
    // is handled at runtime in BootScene after detecting device.pixelRatio.
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: true,
      powerPreference: 'high-performance',
      transparent: false
    },
    fps: {
      target: 60,
      forceSetTimeOut: false
    },
    audio: {
      disableWebAudio: false
    },
    banner: false,
    scene: scenes
  };
}

// ============================================================================
// WINDOW BRIDGE
// ----------------------------------------------------------------------------
// `const CONFIG` and `function getGameConfig` are top-level classic-script
// declarations. Function declarations auto-attach to `window`; `const` does
// NOT. Every other file in this project (Player.js, GameScene.js, UIScene.js,
// ShopScene.js, main.js, etc.) reads config through `window.CONFIG` and/or
// `window.Config` (both casings appear across the codebase), and main.js
// specifically calls `window.Config.getGameConfig(...)`. Without these two
// lines, every one of those reads silently returns `undefined`, every
// consumer falls back to its own private hardcoded defaults, and main.js's
// boot sequence fails outright with "Game configuration failed to load."
// This bridge makes both access patterns resolve to the same real object.
// ============================================================================
window.CONFIG = CONFIG;
window.getGameConfig = getGameConfig;

// `CONFIG` was frozen above (Object.freeze), so attaching getGameConfig
// directly onto it would silently no-op in non-strict mode. main.js calls
// window.Config.getGameConfig(...), so window.Config needs to be a
// (separate, unfrozen) object that carries both the data AND that method.
window.Config = Object.assign({}, CONFIG, { getGameConfig: getGameConfig });
