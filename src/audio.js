// Procedural audio via Web Audio API — no external audio files needed

let ctx = null;
let masterGain = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  // Resume if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Animal Crossing-style voice blip: near-instant attack, clean exponential decay.
// Steady pitch (no sweep) — the pitch identity IS the character's voice.
function _blip(c, t, freq, type, gain, dur = 0.085) {
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type  = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);   // 6 ms attack
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

function tone(freq, duration, type = 'sine', gainVal = 0.18, startTime = 0) {
  const c = getCtx();
  const t = c.currentTime + startTime;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gainVal, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}

function sweep(freqStart, freqEnd, duration, type = 'sine', gainVal = 0.18, startTime = 0) {
  const c = getCtx();
  const t = c.currentTime + startTime;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t);
  osc.frequency.linearRampToValueAtTime(freqEnd, t + duration);
  g.gain.setValueAtTime(gainVal, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + duration + 0.01);
}

// ── Exported sound functions ──────────────────────────────────────────────────

export const Audio = {
  setVolume(v) {
    getCtx();
    masterGain.gain.value = Math.max(0, Math.min(1, v));
  },

  footstep() {
    tone(80, 0.06, 'sine', 0.12);
    tone(60, 0.06, 'triangle', 0.08);
  },

  interact() {
    sweep(200, 420, 0.1, 'sine', 0.15);
  },

  uiClick() {
    tone(600, 0.03, 'square', 0.08);
  },

  discover() {
    // C4 E4 G4 ascending arpeggio
    const notes = [261.63, 329.63, 392.00];
    notes.forEach((f, i) => tone(f, 0.18, 'sine', 0.2, i * 0.16));
  },

  legendaryFanfare() {
    // C4 E4 G4 C5 E5 — longer, with decay
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25];
    notes.forEach((f, i) => {
      tone(f, 0.28, 'sine', 0.22, i * 0.22);
      tone(f * 0.5, 0.28, 'triangle', 0.08, i * 0.22); // sub octave
    });
  },

  // Booming impact when the Feet God appears. Sub-bass + low triangle stack
  // with a layered shimmer riding on top so it reads as "divine" not "scary".
  feetGodBoom() {
    tone(45,  0.9, 'sine',     0.50, 0);     // deep sub
    tone(90,  0.7, 'triangle', 0.30, 0);     // body
    tone(180, 0.5, 'sine',     0.18, 0.04);  // mid octave
    tone(360, 0.4, 'sine',     0.10, 0.10);  // upper shimmer
    tone(540, 0.3, 'sine',     0.06, 0.18);  // brilliance
  },

  // Per-syllable rumble during the Feet God's typewriter — low and slow,
  // like a god speaking through a mountain.
  feetGodSyllable() {
    const f = 55 + Math.random() * 18;       // 55-73 Hz wobble
    tone(f,        0.13, 'sine',     0.28);
    tone(f * 2,    0.11, 'triangle', 0.12);
  },

  // Rain / shower sound for the celebratory feet rain. Filtered white-noise
  // burst with a soft fade-in/out over `duration` seconds.
  rainShower(duration = 3.5) {
    const c = getCtx();
    const t = c.currentTime;
    const bufLen = Math.floor(c.sampleRate * duration);
    const buf = c.createBuffer(1, bufLen, c.sampleRate);
    const data = buf.getChannelData(0);
    const fadeSamples = Math.floor(c.sampleRate * 0.3);
    for (let i = 0; i < bufLen; i++) {
      const env = Math.min(1, i / fadeSamples) * Math.min(1, (bufLen - i) / fadeSamples);
      // Slight density modulation for "patter" texture
      const wobble = 0.85 + 0.15 * Math.sin(i * 0.0007);
      data[i] = (Math.random() * 2 - 1) * env * wobble;
    }
    const src    = c.createBufferSource(); src.buffer = buf;
    const hp     = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const peaker = c.createBiquadFilter(); peaker.type = 'peaking'; peaker.frequency.value = 4500; peaker.Q.value = 1.5; peaker.gain.value = 4;
    const g      = c.createGain(); g.gain.value = 0.22;
    src.connect(hp); hp.connect(peaker); peaker.connect(g); g.connect(masterGain);
    src.start(t); src.stop(t + duration + 0.1);
    // Soft splash thud at start
    tone(80, 0.25, 'sine', 0.18, 0);
  },

  gameWin() {
    // 4-note cheerful jingle: C E G C(high)
    [261.63, 329.63, 392.00, 523.25].forEach((f, i) => tone(f, 0.15, 'sine', 0.2, i * 0.13));
  },

  gameLose() {
    // Descending minor wah
    sweep(300, 180, 0.22, 'sawtooth', 0.15);
    sweep(240, 140, 0.22, 'sawtooth', 0.10, 0.24);
  },

  // Animal Crossing-style per-character voice blip.
  // Each NPC has a signature pitch + waveform; ±4% random wobble keeps it organic.
  npcChatter(rarity, npcId) {
    const c = getCtx();
    const t = c.currentTime;

    // [baseHz, waveType, gain]  — all gains audible through masterGain×0.5
    const PROFILES = {
      // Common
      common_happyfeet: [740, 'sine',     0.22], // penguin: bright squeaky chirp
      common_gymrat:    [110, 'triangle', 0.26], // gym bro: low grunt
      common_samurai:   [165, 'sine',     0.22], // samurai: dignified mid
      common_bill:      [147, 'triangle', 0.22], // Bill: slightly nasal
      common_50shades:  [247, 'triangle', 0.20], // 50 Shades: cool, detached
      // Rare
      rare_trex:        [ 82, 'triangle', 0.28], // T-Rex: deep dino rumble
      rare_gramma:      [196, 'sine',     0.24], // Gramma: warm, gentle
      rare_colonel:     [123, 'triangle', 0.26], // Colonel: authoritative low
      rare_cheerleader: [440, 'sine',     0.22], // Cheerleader: perky & bright
      // Epic
      epic_lebron:      [147, 'sine',     0.24], // LeBron: smooth, low
      epic_sonion:      [185, 'sine',     0.22], // Sonion: mysterious mid
      epic_sydney:      [330, 'sine',     0.22], // Sydney: bright but measured
      // Mythic
      mythic_patapim:   [587, 'sine',     0.24], // Patapim: high bouncy energy
      mythic_clav:      [392, 'square',   0.20], // Clav: robotic square bleep
      mythic_messi:     [220, 'sine',     0.24], // Messi: warm, confident A3
      // Legendary
      legendary_margot: [349, 'sine',     0.24], // Margot: elegant F4
      legendary_bigfoot:[ 98, 'triangle', 0.30], // Gary: deep gentle giant
      // Secret
      secret_rexey:     [110, 'sine',     0.26], // Rexey: ancient resonant A2
    };

    // Rarity fallbacks for NPCs with no feet (rarity='none') or missing ids
    const FALLBACK = {
      epic:      [175, 'sine',     0.22],
      rare:      [165, 'triangle', 0.23],
      mythic:    [294, 'square',   0.20],
      legendary: [220, 'sine',     0.24],
      secret:    [110, 'sine',     0.26],
    };

    const [baseFreq, type, gain] = PROFILES[npcId] ?? FALLBACK[rarity] ?? [262, 'sine', 0.22];

    // Small random wobble (±4%) so repeated blips don't sound mechanical
    const freq = baseFreq * (0.96 + Math.random() * 0.08);
    _blip(c, t, freq, type, gain);
  },

  // ── Combat SFX ──
  // Player gets hit: heavy thud + descending sweep — clearly painful.
  playerHurt() {
    sweep(220, 80, 0.18, 'sawtooth', 0.28);
    tone(70, 0.16, 'triangle', 0.20, 0.02);
  },

  // Player lands a punch on an NPC: short snap + air-whoosh.
  playerHit() {
    sweep(900, 180, 0.08, 'square', 0.18);
    tone(120, 0.05, 'triangle', 0.14, 0.01);
  },

  // NPC takes damage: mid-range pop, a touch lighter than the player hurt sound.
  npcHurt() {
    sweep(440, 200, 0.10, 'square', 0.16);
    tone(310, 0.06, 'triangle', 0.10, 0.02);
  },

  // "Ka-ching!" — old-school cash register bell. Played on every gold reward.
  // If the AudioContext got auto-suspended (browsers do this after periods of
  // inactivity), we wait for the resume() promise before scheduling tones —
  // otherwise ctx.currentTime is stale and the tones get scheduled in the
  // past, which means they don't play.
  goldKaching() {
    const c = getCtx();
    const play = () => {
      tone(1320, 0.08, 'sine',     0.22);
      tone(2640, 0.10, 'sine',     0.08);
      tone( 880, 0.22, 'triangle', 0.18, 0.06);
      tone(1760, 0.18, 'sine',     0.10, 0.06);
    };
    if (c.state === 'suspended') {
      c.resume().then(play).catch(() => play());
    } else {
      play();
    }
  },

  // ── Battle music ──
  // Driving 8-step minor pattern (~140 BPM). Each call schedules the next
  // bar so the tune loops as long as _battleTimer is alive. Simple but
  // reads as "you're in a fight" the moment it starts.
  startBattleMusic() {
    if (this._battleTimer) return;       // already playing
    const c = getCtx();
    const STEP = 0.107;                  // ~140 BPM eighth note
    // Bass walk: A1 — A1 — E1 — A1 — A1 — A1 — F1 — G1 (repeats)
    const BASS = [55, 55, 41, 55, 55, 55, 44, 49];
    // Lead: minor pentatonic riff over A
    const LEAD = [220, 261, 293, 329, 261, 220, 196, 220];
    // Hat: single high tick on every 2nd step
    let step = 0;
    const tick = () => {
      const t = c.currentTime;
      // Bass — square for punch
      tone(BASS[step], STEP * 1.5, 'square', 0.10, 0);
      // Lead — sine, softer
      tone(LEAD[step], STEP * 0.8, 'sine', 0.07, 0.005);
      // Hi-hat-ish on offbeats
      if (step % 2 === 1) tone(8000, 0.03, 'square', 0.04, 0.005);
      // Kick on downbeat (steps 0 and 4)
      if (step % 4 === 0) tone(60, 0.10, 'triangle', 0.18, 0);
      step = (step + 1) % BASS.length;
    };
    tick();
    this._battleTimer = setInterval(tick, STEP * 1000);
  },
  stopBattleMusic() {
    if (!this._battleTimer) return;
    clearInterval(this._battleTimer);
    this._battleTimer = null;
  },

  // Countdown tick (3, 2, 1) — sharp pip
  countdownTick() {
    tone(660, 0.08, 'square', 0.18);
    tone(990, 0.06, 'sine',   0.10, 0.01);
  },
  // Final "FIGHT!" stinger — bigger, brighter
  countdownGo() {
    tone(440, 0.20, 'square', 0.20);
    tone(880, 0.25, 'sine',   0.16, 0.02);
    tone(1320,0.20, 'sine',   0.10, 0.05);
  },
};
