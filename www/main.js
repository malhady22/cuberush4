/**
 * =====================================================================
 * main.js — Cube Rush
 * =====================================================================
 * Application entry point. Responsibilities:
 *  1. Build the Phaser game config (via Config.getGameConfig()) and
 *     boot the Phaser.Game instance once the DOM is ready.
 *  2. Mobile app-shell concerns that live OUTSIDE any single scene:
 *     - Hide the native HTML splash screen once Boot/Preload are done.
 *     - Prevent pinch-zoom, double-tap-zoom, context menu, overscroll.
 *     - Keep the canvas correctly sized on resize/orientation change.
 *     - Pause/resume audio + the game loop on tab visibility change.
 *     - Portrait-lock enforcement + rotate-device overlay hookup
 *       (the overlay markup/CSS lives in index.html/style.css).
 *  3. Global error handling so a low-end Android WebView never shows a
 *     silent black screen — falls back to a friendly reload prompt.
 *
 * This file intentionally contains NO gameplay logic — all game rules
 * live in the scene files and manager classes it wires together.
 * =====================================================================
 */

(function (window, document) {
  'use strict';

  // -----------------------------------------------------------------
  // 1. GLOBAL ERROR HANDLING (register before anything else runs)
  // -----------------------------------------------------------------
  let gameCrashed = false;

  function showFatalErrorOverlay(message) {
    if (gameCrashed) return; // only show once
    gameCrashed = true;

    try {
      const existing = document.getElementById('cr-fatal-overlay');
      if (existing) return;

      const overlay = document.createElement('div');
      overlay.id = 'cr-fatal-overlay';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'background:rgba(11,14,26,0.97)', 'color:#ffffff',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'text-align:center', 'padding:24px',
        'font-family:Rubik,sans-serif'
      ].join(';');

      overlay.innerHTML = [
        '<div style="font-family:Orbitron,sans-serif;font-size:22px;font-weight:700;',
        'color:#FF3B3B;margin-bottom:12px;">CUBE RUSH</div>',
        '<div style="font-size:16px;opacity:0.85;margin-bottom:20px;max-width:320px;">',
        'Something went wrong. Please restart the game.</div>',
        '<button id="cr-fatal-reload" style="padding:14px 28px;border:none;border-radius:12px;',
        'background:linear-gradient(135deg,#00F0FF,#FF2E9A);color:#0B0E1A;font-weight:700;',
        'font-size:15px;font-family:Rubik,sans-serif;">RESTART</button>'
      ].join('');

      document.body.appendChild(overlay);
      document.getElementById('cr-fatal-reload').addEventListener('click', () => {
        window.location.reload();
      });
    } catch (e) {
      // If even the overlay fails, fall back to a raw reload attempt.
      window.location.reload();
    }
    // Log for debugging via remote/USB debugging on Android.
    if (message) console.error('[Cube Rush] Fatal error:', message);
  }

  window.addEventListener('error', (event) => {
    showFatalErrorOverlay(event && event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    showFatalErrorOverlay(event && event.reason);
  });

  // -----------------------------------------------------------------
  // 2. SPLASH SCREEN HANDOFF
  // -----------------------------------------------------------------
  // index.html renders a native HTML/CSS splash immediately (no JS
  // dependency) so the player sees something instantly. We hide it
  // once BootScene has finished its minimal setup and PreloadScene has
  // begun (both scenes emit a global custom event for this purpose so
  // main.js never needs a hard reference into scene internals).
  function hideSplashScreen() {
    const splash = document.getElementById('splash-screen');
    if (!splash) return;
    splash.classList.add('splash-hidden');
    window.setTimeout(() => {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 600); // matches CSS fade-out transition duration
  }

  window.addEventListener('cuberush:hideSplash', hideSplashScreen);

  // Safety net: force-hide the splash after a max wait even if a scene
  // event is missed, so the player is never stuck on the splash screen.
  window.setTimeout(hideSplashScreen, 8000);

  // -----------------------------------------------------------------
  // 3. MOBILE HARDENING — prevent zoom / scroll / context menu
  // -----------------------------------------------------------------
  function preventGesture(e) {
    if (e.touches && e.touches.length > 1) e.preventDefault(); // pinch
  }

  let lastTouchEnd = 0;
  function preventDoubleTapZoom(e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }

  document.addEventListener('touchstart', preventGesture, { passive: false });
  document.addEventListener('touchmove', preventGesture, { passive: false });
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Prevent the page itself from scrolling/bouncing (iOS/Android
  // overscroll) — canvas-internal scrolling is handled by Phaser input.
  document.addEventListener('touchmove', (e) => {
    if (!e.target.closest('.scrollable')) e.preventDefault();
  }, { passive: false });

  // -----------------------------------------------------------------
  // 4. VIEWPORT / RESIZE HANDLING
  // -----------------------------------------------------------------
  let phaserGame = null;

  function resizeGameToWindow() {
    if (!phaserGame) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    phaserGame.scale.resize(width, height);

    // Notify the active scene(s) so gameplay objects (Player lanes,
    // UI anchors) can reposition themselves.
    phaserGame.scene.getScenes(true).forEach((scene) => {
      if (typeof scene.onGameResize === 'function') {
        scene.onGameResize(width, height);
      }
    });
  }

  const debouncedResize = debounce(resizeGameToWindow, 120);

  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  window.addEventListener('resize', debouncedResize);
  window.addEventListener('orientationchange', () => window.setTimeout(resizeGameToWindow, 250));

  // -----------------------------------------------------------------
  // 5. PORTRAIT LOCK — best-effort Screen Orientation API + CSS overlay
  //    fallback (the rotate-device overlay markup lives in index.html).
  // -----------------------------------------------------------------
  function tryLockPortrait() {
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('portrait').catch(() => { /* not supported/allowed — CSS overlay covers it */ });
      }
    } catch (e) { /* ignore — some browsers throw synchronously */ }
  }

  function updateOrientationOverlay() {
    const overlay = document.getElementById('rotate-overlay');
    if (!overlay) return;
    const isLandscape = window.innerWidth > window.innerHeight;
    overlay.classList.toggle('rotate-overlay-visible', isLandscape);

    if (phaserGame) {
      if (isLandscape) {
        phaserGame.loop.sleep();
      } else {
        phaserGame.loop.wake();
      }
    }
  }

  window.addEventListener('resize', updateOrientationOverlay);
  window.addEventListener('orientationchange', () => window.setTimeout(updateOrientationOverlay, 250));

  // -----------------------------------------------------------------
  // 6. VISIBILITY HANDLING — pause game + audio when app is backgrounded
  //    (saves battery, prevents "catch-up" delta spikes on resume).
  // -----------------------------------------------------------------
  function handleVisibilityChange() {
    if (!phaserGame) return;

    if (document.hidden) {
      phaserGame.scene.getScenes(true).forEach((scene) => {
        if (scene.scene.key === (window.Config && window.Config.SCENES && window.Config.SCENES.GAME)) {
          if (typeof scene.pauseForBackground === 'function') scene.pauseForBackground();
        }
      });
      if (window.CubeRushAudio && typeof window.CubeRushAudio.suspend === 'function') {
        window.CubeRushAudio.suspend();
      }
      // Force-flush any pending debounced saves immediately.
      if (window.CubeRushStorage && typeof window.CubeRushStorage.forceSave === 'function') {
        window.CubeRushStorage.forceSave();
      }
    } else {
      if (window.CubeRushAudio && typeof window.CubeRushAudio.resume === 'function') {
        window.CubeRushAudio.resume();
      }
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', () => { if (!document.hidden) handleVisibilityChange(); });
  window.addEventListener('pagehide', () => {
    if (window.CubeRushStorage && typeof window.CubeRushStorage.forceSave === 'function') {
      window.CubeRushStorage.forceSave();
    }
  });

  // -----------------------------------------------------------------
  // 7. BOOTSTRAP — build config + create the Phaser.Game instance
  // -----------------------------------------------------------------
  function bootGame() {
    try {
      if (!window.Phaser) {
        showFatalErrorOverlay('Phaser failed to load. Check your internet connection.');
        return;
      }

      const buildConfig = (window.Config && typeof window.Config.getGameConfig === 'function')
        ? window.Config.getGameConfig
        : (typeof window.getGameConfig === 'function' ? window.getGameConfig : null);

      if (!buildConfig) {
        showFatalErrorOverlay('Game configuration failed to load.');
        return;
      }

      // Every scene file registers itself on `window` as its final line
      // (e.g. `window.BootScene = BootScene;`). Collect them here, in boot
      // order, into the array Phaser's `scene:` config expects. BootScene
      // MUST be first — it's the scene Phaser auto-starts on Game creation.
      const sceneClasses = [
        window.BootScene,
        window.PreloadScene,
        window.MenuScene,
        window.ShopScene,
        window.AchievementsScene,
        window.DailyRewardScene,
        window.LuckySpinScene,
        window.GameScene,
        window.UIScene,
        window.GameOverScene
      ].filter(Boolean); // defensive: skip any scene file that failed to load rather than crash the boot

      if (sceneClasses.length === 0) {
        showFatalErrorOverlay('No game scenes were found to load.');
        return;
      }

      // getGameConfig(scenes) builds the full Phaser config (design
      // resolution, scale mode, physics, renderer) and already hardcodes
      // parent: 'phaser-container' to match index.html — it only needs the
      // scene list, not a {parent,width,height} options object.
      const gameConfig = buildConfig(sceneClasses);

      phaserGame = new Phaser.Game(gameConfig);

      // Expose for debugging via Android USB remote inspection / dev console.
      window.CubeRushGame = phaserGame;

      tryLockPortrait();
      updateOrientationOverlay();

      // Global audio unlock is also handled inside AudioManager itself,
      // but we mirror a lightweight resume-on-first-input here as a
      // second safety net for Android WebView autoplay policies.
      const unlockAudioOnce = () => {
        if (window.CubeRushAudio && typeof window.CubeRushAudio.unlock === 'function') {
          window.CubeRushAudio.unlock();
        }
        document.removeEventListener('touchstart', unlockAudioOnce);
        document.removeEventListener('click', unlockAudioOnce);
      };
      document.addEventListener('touchstart', unlockAudioOnce, { passive: true });
      document.addEventListener('click', unlockAudioOnce);

    } catch (err) {
      showFatalErrorOverlay(err && err.message ? err.message : String(err));
    }
  }

  // -----------------------------------------------------------------
  // 8. DOM READY GATE
  // -----------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootGame);
  } else {
    bootGame();
  }

  // -----------------------------------------------------------------
  // 9. MONETIZATION READY — global AdMob bridge stubs.
  // -----------------------------------------------------------------
  // These no-op stubs let GameOverScene / MenuScene / ShopScene call
  // ad-related hooks today without breaking anything. When packaging
  // with Capacitor + a real AdMob plugin, replace the bodies of these
  // functions with actual plugin calls (window.admob.* / Capacitor
  // plugin bridge) — no other file needs to change.
  window.CubeRushAds = window.CubeRushAds || {
    isReady: false,

    showBanner() {
      // TODO: integrate cordova-plugin-admob-free / Capacitor AdMob
      console.log('[Ads] showBanner() stub called');
    },
    hideBanner() {
      console.log('[Ads] hideBanner() stub called');
    },
    showInterstitial(onComplete) {
      console.log('[Ads] showInterstitial() stub called');
      if (typeof onComplete === 'function') onComplete(true);
    },
    showRewarded(onReward, onFail) {
      console.log('[Ads] showRewarded() stub called');
      // Simulate a successful reward in dev/browser builds so gameplay
      // flows (double coins on Game Over, etc.) remain testable without
      // a real ad SDK wired up yet.
      if (typeof onReward === 'function') onReward();
    }
  };

  // -----------------------------------------------------------------
  // 10. EXPOSE RESIZE HANDLER for scenes/managers that want to trigger
  //     a manual re-layout (e.g. after toggling fullscreen).
  // -----------------------------------------------------------------
  window.CubeRushRequestResize = resizeGameToWindow;

})(window, document);