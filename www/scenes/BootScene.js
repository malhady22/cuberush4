/**
 * =====================================================================
 * BootScene.js — Cube Rush
 * =====================================================================
 * The FIRST scene to run. Intentionally minimal — no asset loading, no
 * gameplay. Responsibilities:
 *
 *  1. Load persisted save data via Storage.js (so every later scene —
 *     including PreloadScene's runtime texture budget decisions — can
 *     rely on Storage already being initialized).
 *  2. Instantiate the singleton AudioManager (Web Audio API needs to
 *     exist before any scene tries to play a sound effect).
 *  3. Detect device capability (low-end vs high-end) ONCE and stamp it
 *     into the Phaser Data Registry so EffectsManager/ObstacleManager/
 *     etc. in every later scene can read `this.registry.get('quality')`
 *     instead of each re-implementing detection.
 *  4. Configure global Phaser-level defaults (input touch settings,
 *     pixel ratio cap for low-end Android GPUs, Arcade Physics debug
 *     flag from saved settings).
 *  5. Immediately transition to PreloadScene.
 *
 * No visuals are rendered in this scene — the HTML splash screen
 * (index.html/style.css) is still covering the canvas at this point.
 * =====================================================================
 */

(function (window) {
  'use strict';

  class BootScene extends Phaser.Scene {
    constructor() {
      super({ key: (window.Config && window.Config.SCENES && window.Config.SCENES.BOOT) || 'BootScene' });
    }

    // -----------------------------------------------------------------
    // Phaser lifecycle: init (receives no external data on first boot)
    // -----------------------------------------------------------------
    init() {
      this._sceneKeys = (window.Config && window.Config.SCENES) || {
        BOOT: 'BootScene',
        PRELOAD: 'PreloadScene'
      };
    }

    // -----------------------------------------------------------------
    // Phaser lifecycle: create
    // -----------------------------------------------------------------
    create() {
      this._initStorage();
      this._initAudio();
      this._detectAndStoreQuality();
      this._configureInputDefaults();
      this._configurePhysicsDebug();
      this._logEnvironmentInfo();

      // Hand off to PreloadScene immediately — it owns the visible
      // loading bar and runtime texture/audio-graph warm-up.
      this.scene.start(this._sceneKeys.PRELOAD || 'PreloadScene');
    }

    // =====================================================================
    // STORAGE INITIALIZATION
    // =====================================================================
    _initStorage() {
      try {
        if (window.CubeRushStorage && typeof window.CubeRushStorage.init === 'function') {
          window.CubeRushStorage.init();
        } else if (window.CubeRushStorage && typeof window.CubeRushStorage.load === 'function') {
          // Some Storage.js implementations expose load() instead of init().
          window.CubeRushStorage.load();
        }
      } catch (e) {
        console.warn('[BootScene] Storage init failed, continuing with in-memory defaults:', e);
      }
    }

    // =====================================================================
    // AUDIO SINGLETON INITIALIZATION
    // =====================================================================
    _initAudio() {
      try {
        if (!window.CubeRushAudio && window.AudioManager) {
          window.CubeRushAudio = new window.AudioManager(this);
        } else if (window.CubeRushAudio && typeof window.CubeRushAudio.attachScene === 'function') {
          // Allow the manager to grab a fresh Phaser time/tween reference
          // if it needs one for the generative music loop scheduler.
          window.CubeRushAudio.attachScene(this);
        }
      } catch (e) {
        console.warn('[BootScene] AudioManager failed to initialize (game will run silently):', e);
      }
    }

    // =====================================================================
    // DEVICE CAPABILITY DETECTION
    // =====================================================================
    /**
     * Stamps a 'quality' ('high'|'low') value and a safe device pixel
     * ratio cap into the registry so:
     *  - EffectsManager can reduce particle counts on low-end phones.
     *  - The renderer doesn't try to render at full DPR on very cheap
     *    Android devices (e.g. 3x DPR phones with weak GPUs), which is
     *    a common cause of frame drops in WebView-based games.
     */
    _detectAndStoreQuality() {
      let quality = 'high';

      try {
        const settings = (window.CubeRushStorage && typeof window.CubeRushStorage.getSettings === 'function')
          ? window.CubeRushStorage.getSettings()
          : null;

        if (settings && settings.performanceMode) {
          quality = 'low';
        } else {
          const cores = navigator.hardwareConcurrency || 4;
          const mem = navigator.deviceMemory || 4; // GB, Chrome/Android only
          const ua = navigator.userAgent || '';
          const isOldAndroid = /Android\s(4|5|6|7)\./.test(ua);

          if (cores <= 4 || mem <= 2 || isOldAndroid) {
            quality = 'low';
          }
        }
      } catch (e) {
        quality = 'high'; // fail open — assume capable device
      }

      // Cap device pixel ratio: full DPR on flagship phones looks
      // great but tanks fill-rate on cheap Android GPUs. 2 is a safe
      // ceiling; low-end devices get capped at 1 (native resolution).
      const rawDpr = window.devicePixelRatio || 1;
      const dprCap = quality === 'low' ? 1 : Math.min(rawDpr, 2);

      this.registry.set('quality', quality);
      this.registry.set('devicePixelRatioCap', dprCap);
      this.registry.set('hardwareConcurrency', navigator.hardwareConcurrency || 0);

      // Also mirror onto window for non-scene code (e.g. Effects.js's
      // own defensive detectQuality fallback) to stay consistent.
      window.CubeRushQuality = quality;
    }

    // =====================================================================
    // INPUT DEFAULTS
    // =====================================================================
    _configureInputDefaults() {
      // Multi-touch isn't needed (swipe/tap is single-pointer), but we
      // explicitly cap it to reduce input processing overhead and avoid
      // ghost-touch issues on some budget Android touch digitizers.
      this.input.addPointer(0); // ensure only the default pointer exists
      this.input.setTopOnly(true);

      // Disable the default Phaser mouse wheel / context menu handlers
      // that aren't relevant for a touch-first mobile runner.
      if (this.input.mouse && this.input.mouse.disableContextMenu) {
        this.input.mouse.disableContextMenu();
      }
    }

    // =====================================================================
    // PHYSICS DEBUG (only ever on if explicitly saved in dev settings)
    // =====================================================================
    _configurePhysicsDebug() {
      try {
        const settings = (window.CubeRushStorage && typeof window.CubeRushStorage.getSettings === 'function')
          ? window.CubeRushStorage.getSettings()
          : null;

        if (settings && settings.debugPhysics && this.physics && this.physics.world) {
          this.physics.world.drawDebug = true;
          this.physics.world.createDebugGraphic();
        }
      } catch (e) { /* non-fatal — debug visuals are optional */ }
    }

    // =====================================================================
    // ENVIRONMENT LOGGING (helps diagnose device-specific issues when
    // testing via Android USB remote debugging)
    // =====================================================================
    _logEnvironmentInfo() {
      try {
        console.log(
          '%c[Cube Rush] Boot complete',
          'color:#00F0FF;font-weight:bold;',
          {
            quality: this.registry.get('quality'),
            dprCap: this.registry.get('devicePixelRatioCap'),
            cores: navigator.hardwareConcurrency,
            memory: navigator.deviceMemory,
            userAgent: navigator.userAgent
          }
        );
      } catch (e) { /* logging must never break boot */ }
    }
  }

  window.BootScene = BootScene;
})(window);