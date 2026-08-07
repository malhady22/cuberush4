/**
 * AudioManager.js
 * ----------------------------------------------------------------------
 * Cube Rush — Procedural audio engine built on the Web Audio API.
 *
 * Every sound effect is synthesized at runtime (oscillators + gain
 * envelopes + a little noise for texture) rather than loaded from
 * audio files. This keeps the initial download tiny, guarantees the
 * game has audio even before any asset packs load, and sidesteps
 * autoplay-policy issues on Android WebViews since sounds are only
 * ever created inside a user-gesture-unlocked AudioContext.
 *
 * Respects:
 *  - Storage.js settings (musicEnabled, sfxEnabled, musicVolume, sfxVolume)
 *  - Mobile autoplay restrictions (AudioContext starts suspended until
 *    the first touch/click, per Chrome/WebView policy)
 * ----------------------------------------------------------------------
 */

class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;

    this.unlocked = false;
    this.musicLoopHandle = null;
    this.musicPlaying = false;

    this._initContext();
    this._bindUnlockListeners();
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  _initContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[AudioManager] Web Audio API not supported on this device.');
      this.ctx = null;
      return;
    }

    this.ctx = new AudioContextClass();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();

    const settings = this._getSettings();
    this.musicGain.gain.value = settings.musicEnabled ? settings.musicVolume : 0;
    this.sfxGain.gain.value = settings.sfxEnabled ? settings.sfxVolume : 0;

    this.musicGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
  }

  _bindUnlockListeners() {
    const unlock = () => {
      if (!this.ctx || this.unlocked) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {});
      } else {
        this.unlocked = true;
      }
    };

    ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach((evt) => {
      window.addEventListener(evt, unlock, { once: false, passive: true });
    });
  }

  _getSettings() {
    if (window.CubeRushStorage) {
      return window.CubeRushStorage.getSettings();
    }
    return { musicEnabled: true, sfxEnabled: true, musicVolume: 0.7, sfxVolume: 1.0 };
  }

  // ----------------------------------------------------------------
  // Volume / Mute controls (wired to Settings scene + Storage)
  // ----------------------------------------------------------------

  setMusicEnabled(enabled) {
    if (!this.ctx) return;
    const settings = this._getSettings();
    this._rampGain(this.musicGain, enabled ? settings.musicVolume : 0, 0.1);
    if (window.CubeRushStorage) window.CubeRushStorage.updateSetting('musicEnabled', enabled);
  }

  setSfxEnabled(enabled) {
    if (!this.ctx) return;
    const settings = this._getSettings();
    this._rampGain(this.sfxGain, enabled ? settings.sfxVolume : 0, 0.1);
    if (window.CubeRushStorage) window.CubeRushStorage.updateSetting('sfxEnabled', enabled);
  }

  setMusicVolume(volume) {
    if (!this.ctx) return;
    const clamped = Math.min(1, Math.max(0, volume));
    const settings = this._getSettings();
    this._rampGain(this.musicGain, settings.musicEnabled ? clamped : 0, 0.05);
    if (window.CubeRushStorage) window.CubeRushStorage.updateSetting('musicVolume', clamped);
  }

  setSfxVolume(volume) {
    if (!this.ctx) return;
    const clamped = Math.min(1, Math.max(0, volume));
    const settings = this._getSettings();
    this._rampGain(this.sfxGain, settings.sfxEnabled ? clamped : 0, 0.05);
    if (window.CubeRushStorage) window.CubeRushStorage.updateSetting('sfxVolume', clamped);
  }

  toggleMuteAll() {
    const settings = this._getSettings();
    const shouldMute = settings.musicEnabled || settings.sfxEnabled;
    this.setMusicEnabled(!shouldMute);
    this.setSfxEnabled(!shouldMute);
    return !shouldMute; // returns new "muted" state (true = now muted)
  }

  _rampGain(gainNode, target, duration) {
    if (!this.ctx || !gainNode) return;
    const now = this.ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + duration);
  }

  // ----------------------------------------------------------------
  // Low-level synthesis helpers
  // ----------------------------------------------------------------

  /**
   * Plays a single oscillator tone with an ADSR-ish envelope.
   * type: 'sine' | 'square' | 'sawtooth' | 'triangle'
   */
  _playTone({
    frequency = 440,
    type = 'sine',
    startTime = 0,
    duration = 0.2,
    attack = 0.01,
    decay = 0.1,
    sustainLevel = 0.6,
    release = 0.1,
    volume = 1.0,
    frequencySweepTo = null,
    detune = 0,
  } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + startTime;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.detune.setValueAtTime(detune, now);

    if (frequencySweepTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, frequencySweepTo), now + duration);
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * sustainLevel), now + attack + decay);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + duration + release + 0.05);
  }

  /** Short burst of white noise, useful for crashes/impacts. */
  _playNoise({ startTime = 0, duration = 0.3, volume = 0.5, filterFreq = 1200 } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + startTime;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decay envelope baked into noise
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    noiseSource.start(now);
    noiseSource.stop(now + duration);
  }

  // ----------------------------------------------------------------
  // Public SFX API — called by scenes/managers
  // ----------------------------------------------------------------

  playCoin() {
    // Bright ascending two-note chime
    this._playTone({ frequency: 880, type: 'sine', duration: 0.08, attack: 0.005, decay: 0.05, sustainLevel: 0.3, release: 0.05, volume: 0.5 });
    this._playTone({ frequency: 1318.5, type: 'sine', startTime: 0.05, duration: 0.12, attack: 0.005, decay: 0.08, sustainLevel: 0.3, release: 0.08, volume: 0.45 });
  }

  playJump() {
    // Quick upward pitch sweep
    this._playTone({
      frequency: 300,
      frequencySweepTo: 650,
      type: 'triangle',
      duration: 0.15,
      attack: 0.005,
      decay: 0.05,
      sustainLevel: 0.4,
      release: 0.08,
      volume: 0.5,
    });
  }

  playCrash() {
    // Layered noise burst + low thud
    this._playNoise({ duration: 0.35, volume: 0.6, filterFreq: 900 });
    this._playTone({ frequency: 120, type: 'sawtooth', duration: 0.25, attack: 0.005, decay: 0.1, sustainLevel: 0.3, release: 0.15, volume: 0.6 });
  }

  playButton() {
    // Short, neutral UI click
    this._playTone({ frequency: 520, type: 'square', duration: 0.04, attack: 0.002, decay: 0.02, sustainLevel: 0.2, release: 0.03, volume: 0.3 });
  }

  playLevelUp() {
    // Triumphant rising arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      this._playTone({
        frequency: freq,
        type: 'triangle',
        startTime: i * 0.09,
        duration: 0.18,
        attack: 0.005,
        decay: 0.08,
        sustainLevel: 0.4,
        release: 0.12,
        volume: 0.45,
      });
    });
  }

  playAchievement() {
    // Sparkly double-chime with slight detune for shimmer
    this._playTone({ frequency: 1046.5, type: 'sine', duration: 0.2, attack: 0.005, decay: 0.1, sustainLevel: 0.3, release: 0.15, volume: 0.4 });
    this._playTone({ frequency: 1046.5, type: 'sine', duration: 0.2, attack: 0.005, decay: 0.1, sustainLevel: 0.3, release: 0.15, volume: 0.3, detune: 12 });
    this._playTone({ frequency: 1568, type: 'sine', startTime: 0.1, duration: 0.25, attack: 0.005, decay: 0.12, sustainLevel: 0.3, release: 0.2, volume: 0.4 });
  }

  playCombo(comboCount) {
    // Pitch rises with combo count for escalating feedback, capped so it doesn't get shrill
    const step = Math.min(comboCount, 10);
    const freq = 660 + step * 40;
    this._playTone({ frequency: freq, type: 'sine', duration: 0.06, attack: 0.003, decay: 0.03, sustainLevel: 0.3, release: 0.04, volume: 0.35 });
  }

  playPowerUp() {
    // Rising sweep with a slight shimmer, distinct from jump
    this._playTone({
      frequency: 200,
      frequencySweepTo: 900,
      type: 'sawtooth',
      duration: 0.22,
      attack: 0.01,
      decay: 0.08,
      sustainLevel: 0.35,
      release: 0.1,
      volume: 0.4,
    });
  }

  playCountdownTick() {
    this._playTone({ frequency: 440, type: 'square', duration: 0.08, attack: 0.005, decay: 0.03, sustainLevel: 0.3, release: 0.05, volume: 0.35 });
  }

  playCountdownGo() {
    this._playTone({ frequency: 880, type: 'square', duration: 0.15, attack: 0.005, decay: 0.05, sustainLevel: 0.4, release: 0.1, volume: 0.5 });
  }

  playChestOpen() {
    this._playNoise({ duration: 0.15, volume: 0.25, filterFreq: 2500 });
    this._playTone({ frequency: 700, frequencySweepTo: 1400, type: 'triangle', startTime: 0.05, duration: 0.25, attack: 0.01, decay: 0.1, sustainLevel: 0.3, release: 0.15, volume: 0.4 });
  }

  playSpinTick() {
    this._playTone({ frequency: 300, type: 'square', duration: 0.03, attack: 0.002, decay: 0.01, sustainLevel: 0.3, release: 0.02, volume: 0.25 });
  }

  // ----------------------------------------------------------------
  // Background music — generative ambient loop (no external files)
  // ----------------------------------------------------------------

  /**
   * Starts a lightweight generative background pad loop. Uses two
   * detuned oscillators through a slow filter sweep for movement,
   * kept intentionally low-key so it doesn't compete with SFX.
   */
  startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;

    const playPad = () => {
      if (!this.musicPlaying) return;

      const now = this.ctx.currentTime;
      const rootFreqs = [130.81, 146.83, 164.81, 196.0]; // C3 D3 E3 G3 — simple rotating pad
      const freq = rootFreqs[Math.floor(Math.random() * rootFreqs.length)];

      [freq, freq * 2].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now);
        osc.detune.setValueAtTime(i === 0 ? -6 : 6, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);

        osc.connect(gain);
        gain.connect(this.musicGain);

        osc.start(now);
        osc.stop(now + 3.7);
      });

      this.musicLoopHandle = setTimeout(playPad, 3400);
    };

    playPad();
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicLoopHandle) {
      clearTimeout(this.musicLoopHandle);
      this.musicLoopHandle = null;
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  /** Call on page visibility change (tab/app backgrounded) to save battery. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && this.unlocked) {
      this.ctx.resume().catch(() => {});
    }
  }
}

// Singleton instance shared across all scenes.
window.CubeRushAudio = window.CubeRushAudio || new AudioManager();

document.addEventListener('visibilitychange', () => {
  if (!window.CubeRushAudio) return;
  if (document.hidden) {
    window.CubeRushAudio.suspend();
  } else {
    window.CubeRushAudio.resume();
  }
});
