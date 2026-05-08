import * as THREE from 'three';

window.ALL_NPCS = window.ALL_NPCS || [];

// ── Appearance constants ──────────────────────────────────────────────────────

const SKIN_TONES        = [0xffcc99, 0xcc9966, 0xaa7744, 0x885533, 0x6b3f24];
// Unified faded-grey citizen palette. ALL non-rarity NPCs share this exact
// clothing — only skin tone varies — so colorful rarity characters pop hard
// against the crowd. The player can spot a "real" character at a glance.
const NONE_PALETTE = { shirt: 0x9a9a9a, pants: 0x4a4a4a, shoes: 0x3a3128 };

const RARITY_COLORS = {
  common: { shirt: 0x5577aa, pants: 0x666677, shoes: 0x7a5533 },
  rare:   { shirt: 0x448844, pants: 0x333344, shoes: 0xeeeeee },
  epic:   { shirt: 0x7744aa, pants: 0x111122, shoes: 0x44aaff },
  mythic: { shirt: 0xee4422, pants: 0xff7700, shoes: 0xffcc00 },
};

// Two legendary visual presets (plus fallback)
const LEGENDARY_PRESETS = [
  // Preset 0 — Margot Robbie: all-pink Barbiecore
  {
    shirt: 0xff69b4, pants: 0xff69b4, shoes: 0xf4b8c1, skin: 0xffeeee,
    extras: [
      { type: 'sphere', r: 0.19, color: 0xfaf0e6, pos: [0, 1.73, 0] }, // platinum hair
    ],
  },
  // Preset 1 — Bigfoot (Gary): dark brown fur, denim shorts, muddy bare feet
  {
    shirt: 0x3d2008, pants: 0x3b5998, shoes: 0x5c3d11, skin: 0x3d2008,
    extras: [
      { type: 'box', s: [0.14, 0.14, 0.14], color: 0x2e1800, pos: [ 0.22, 0.98, 0.12] },
      { type: 'box', s: [0.14, 0.14, 0.14], color: 0x2e1800, pos: [-0.22, 0.72, 0.12] },
    ],
  },
  // Preset 2 — fallback
  {
    shirt: 0x111111, pants: 0x111111, shoes: 0x00ff44, skin: 0x885533,
    extras: [
      { type: 'box', s: [0.10, 0.30, 0.12], color: 0x00ff44, pos: [0, 1.85, 0] },
      { type: 'box', s: [0.56, 0.24, 0.34], color: 0x1a1a1a, pos: [0, 1.10, 0] },
    ],
  },
];

// Per-feetId color overrides — applied after rarity defaults.
// Optional `extras` array adds geometry on top (bowties, hats, accents) so the
// 18 collectible characters never visually blend with the unified grey crowd.
const APPEARANCE_CONFIGS = {
  common_samurai:   { shirt: 0x1a1a3e, pants: 0x1a1a40, shoes: 0x7a5533, skin: 0xffcc99 },
  common_bill:      { shirt: 0xb5785a, pants: 0xc4a97d, shoes: 0x999999, skin: 0xffe0cc },
  common_gymrat:    { shirt: 0x666666, pants: 0x222222, shoes: 0x39ff14, skin: 0xcc9966 },
  // Grey — corporate-thriller bit. Pure black tuxedo, silver tie, pale skin.
  // Distinct from grey NPCs by deep black contrast + reflective silver accent.
  common_50shades:  { shirt: 0x080808, pants: 0x080808, shoes: 0x0a0a0a, skin: 0xf2e6d8,
    extras: [
      { type: 'box', s: [0.06, 0.30, 0.04], color: 0xc8c8d0, pos: [0, 1.05, 0.16] }, // silver tie
      { type: 'box', s: [0.42, 0.04, 0.30], color: 0xffffff, pos: [0, 1.18, 0.02] }, // white shirt collar slip
    ] },
  rare_trex:        { shirt: 0x4a6741, pants: 0x4a6741, shoes: 0x3d5a38, skin: 0x4a6741 },
  rare_gramma:      { shirt: 0xb39ddb, pants: 0xe8c9e8, shoes: 0xffb3c1, skin: 0xcc9966 },
  // The Colonel — full Colonel Sanders. White suit, black bow tie, black
  // shoes, white goatee, white string tie, fluffy white hair.
  rare_colonel:     { shirt: 0xffffff, pants: 0xffffff, shoes: 0x0a0a0a, skin: 0xffe0c4,
    extras: [
      { type: 'box',    s: [0.18, 0.06, 0.04], color: 0x000000, pos: [0, 1.20, 0.16] }, // black bow tie
      { type: 'box',    s: [0.10, 0.07, 0.04], color: 0xffffff, pos: [0,  1.36, 0.27] }, // white goatee
      { type: 'sphere', r: 0.20, color: 0xf5f5f5, pos: [0, 1.68, 0] },                   // fluffy white hair
    ] },
  rare_cheerleader: { shirt: 0x1a3c8a, pants: 0x1a3c8a, shoes: 0xf5f5f5, skin: 0xffcc99 },
  epic_lebron:      { shirt: 0x552583, pants: 0x222222, shoes: 0x552583, skin: 0x8B6914 },
  epic_sonion:      { shirt: 0x4b0082, pants: 0x7b2d8b, shoes: 0x000000, skin: 0xcc9966 },
  // Sydney's Stunt Double — leans dark. Add bright red carpet shoes so she
  // never gets mistaken for a grey civilian.
  epic_sydney:      { shirt: 0x1a1a1a, pants: 0x1a1a1a, shoes: 0xd62828, skin: 0xffeecc,
    extras: [
      { type: 'box', s: [0.46, 0.06, 0.30], color: 0xd62828, pos: [0, 1.22, 0.04] }, // red carpet sash
    ] },
  // Clav — dark frame-mog. Layered chestnut hair (top volume + side flares
  // + back flow) so he reads as a boss with main-character energy, not as a
  // generic citizen.
  mythic_clav:      { shirt: 0x0d0d0d, pants: 0x333333, shoes: 0x0d0d0d, skin: 0xffcc99,
    extras: [
      { type: 'sphere', r: 0.22, color: 0x6B4423, pos: [ 0.00, 1.78,  0.00] }, // top volume
      { type: 'sphere', r: 0.16, color: 0x6B4423, pos: [-0.18, 1.62, -0.04] }, // left side flare
      { type: 'sphere', r: 0.16, color: 0x6B4423, pos: [ 0.18, 1.62, -0.04] }, // right side flare
      { type: 'sphere', r: 0.14, color: 0x6B4423, pos: [ 0.00, 1.55, -0.18] }, // back flow
    ] },
  mythic_patapim:   { shirt: 0xffeb3b, pants: 0xff6b9d, shoes: 0xff69b4, skin: 0xffcc99 },
  mythic_messi:     { shirt: 0x75aadb, pants: 0xffffff, shoes: 0xffd700, skin: 0xcc9966 },
  secret_rexey:     { shirt: 0xf5e6c8, pants: 0xf5e6c8, shoes: 0x8B6914, skin: 0xd4a373 },
  // Morton — portly older shopkeeper in a brown apron over a cream shirt
  shopkeeper_morton:{ shirt: 0x8b6340, pants: 0x4a3422, shoes: 0x2a1b10, skin: 0xeec5a0 },
  // Vance — young hyped sneakerhead in a brand-orange tee over black joggers
  shopkeeper_fleetfeet:{ shirt: 0xff6633, pants: 0x1a1a1a, shoes: 0xffffff, skin: 0xd4a374 },
};

// Canonical NPC name per feetId
const FEET_NAMES = {
  common_samurai:    'Ronin',
  common_bill:       'Bill Beister',
  common_gymrat:     'Dex',
  common_50shades:   'Grey',
  common_happyfeet:  'Mumble',
  rare_trex:         'Rex (?)',
  rare_gramma:       'Gramma Tilda',
  rare_colonel:      'The Colonel',
  rare_cheerleader:  'Captain Brianna',
  epic_lebron:       'LeBron James',
  epic_sonion:       'Sonion Crine',
  epic_sydney:       'Definitely Sydney (Stunt Double)',
  mythic_clav:       'Clav',
  mythic_patapim:    'Brr Brr Patapim',
  mythic_messi:      'Leo Messi',
  secret_rexey:      'The Ancient One',
  shopkeeper_morton: 'Morton',
  shopkeeper_fleetfeet: 'Vance',
};

const NPC_NAMES = [
  'Darnell', 'Maria', 'Tony', 'Keisha', 'Pablo',
  'Fatima', 'Jerome', 'Sunita', 'Miguel', 'Brenda',
  'Tyrone', 'Yuki', 'Rashid', 'Carmen', 'DeShawn',
  'Priya', 'Orlando', 'Tanya', 'Kwame', 'Svetlana',
];

// Random-spawn pool — fixed-position NPCs are excluded.
// (common_samurai → Grand Central, common_50shades → 1WTC, both fixed.)
const FEET_POOL = {
  common: ['common_bill'],
  mythic: ['mythic_clav', 'mythic_patapim'],
};

// Fixed world positions for legendary NPCs
const LEGENDARY_DEFS = [
  { name: 'Margot Robbie',  pos: [-44, 0, -38], preset: 0, feetId: 'legendary_margot',  bodyScale: 1.00 },
  { name: 'Bigfoot (Gary)', pos: [ 38, 0,  48], preset: 1, feetId: 'legendary_bigfoot', bodyScale: 1.27 },
];

// Fixed world positions for other specifically-placed NPCs
const SPECIAL_DEFS = [
  // Mumble hidden in the Times Square crowd
  { name: 'Mumble',       pos: [  6, 0, -38], rarity: 'common', feetId: 'common_happyfeet', minigame: null,  isPenguin: true, bodyScale: 0.70 },
  // Messi near Central Park (north zone)
  { name: 'Leo Messi',    pos: [ 20, 0,  45], rarity: 'mythic', feetId: 'mythic_messi',      minigame: 'rps', bodyScale: 0.97 },
  // The Ancient One — dead end of a hidden 2-unit alley in the far NW outskirts
  { name: 'The Ancient One', pos: [-117, 0, -228], rarity: 'secret', feetId: 'secret_rexey',     minigame: null,  bodyScale: 1.00 },
  // One named character per accessible building. Each interior is at world
  // x=INTERIOR_BASE_X + (3 + interiorIdx) * 200 with z near 0:
  //   Cafe=2600, Diner=2800, Gym=3000, Office=3200, Shop=3400, Bar=3600,
  //   Gallery=3800, Laundry=4000, Pharmacy=4200, Hotel=4400, KFC=4600,
  //   Bodega=4800, Museum=5000, Barbershop=5200.
  // Dex — Gym
  { name: 'Dex',               pos: [3000, 0,   0], rarity: 'common', feetId: 'common_gymrat',     minigame: null,  bodyScale: 1.00 },
  // LeBron James — Hotel Lobby (relocated from Gym to fix Dex overlap)
  { name: 'LeBron James',      pos: [4400, 0,   0], rarity: 'epic',   feetId: 'epic_lebron',       minigame: null,  bodyScale: 1.05 },
  // Gramma Tilda — Pharmacy
  { name: 'Gramma Tilda',      pos: [4200, 0,   2], rarity: 'rare',   feetId: 'rare_gramma',       minigame: null,  bodyScale: 1.00 },
  // The Colonel — KFC
  { name: 'The Colonel',       pos: [4600, 0,   3], rarity: 'rare',   feetId: 'rare_colonel',      minigame: null,  bodyScale: 1.00 },
  // Captain Brianna — Bar (relocated from Brooklyn Bridge to fix Rex overlap)
  { name: 'Captain Brianna',   pos: [3600, 0,   0], rarity: 'rare',   feetId: 'rare_cheerleader',  minigame: null,  bodyScale: 1.00 },
  // Ronin — Grand Central interior (custom ox=1800). The lost samurai's storyline
  // ends in a transit hub: he wandered from Kyoto, ended up here, doesn't know
  // where to go next.
  { name: 'Ronin',             pos: [1800, 0,   0], rarity: 'common', feetId: 'common_samurai',    minigame: null,  bodyScale: 1.00 },
  // Grey — 1WTC lobby (interior x=2400). Grey is obsessed with Pantone 18-0306
  // pewter and "the most underappreciated grey"; the polished black-granite,
  // brushed-steel, and blue-glass palette of 1WTC is exactly their aesthetic.
  // Positioned south of the reflecting pool so the player sees them immediately
  // on entering and they aren't standing on the pool rim collider.
  { name: 'Grey',              pos: [2400, 0, 4.5], rarity: 'common', feetId: 'common_50shades',   minigame: null,  bodyScale: 1.00 },
  // Morton — Shop interior (id='shop' index 4 → world x=3400). Not a feet
  // collector; the shopkeeper. feetId 'shopkeeper_morton' is a sentinel
  // main.js uses to open the shop UI instead of the discovery flow.
  // Morton stands BEHIND the L-counter (counter at local z=-3, depth 0.75
  // → north edge at z=-3.75). Place him at z=-4.5 so he isn't sitting on
  // the counter's solid AABB and faces the player who enters from the south.
  { name: 'Morton',            pos: [3400, 0, -4.5], rarity: 'none',   feetId: 'shopkeeper_morton', minigame: null,  bodyScale: 1.05 },
  // Vance — Fleet Feet (rebranded Bodega interior, index 11 → world x=4800).
  // The cosmetic-shop counterpart to Morton. feetId 'shopkeeper_fleetfeet'
  // is a sentinel main.js uses to open the Fleet Feet UI.
  { name: 'Vance',             pos: [4800, 0, -4.5], rarity: 'none',   feetId: 'shopkeeper_fleetfeet', minigame: null, bodyScale: 1.00 },
  // Rex (?) — Brooklyn Bridge deck (sole named character on the bridge)
  { name: 'Rex (?)',           pos: [-60, 6, -80], rarity: 'rare',   feetId: 'rare_trex',         minigame: null,  bodyScale: 1.30 },
  // ESB lobby — Sonion Crine always here
  { name: 'Sonion Crine',      pos: [2000, 0,   3], rarity: 'epic',   feetId: 'epic_sonion',      minigame: null,  bodyScale: 1.00 },
  // Chrysler lobby — Sydney always here
  { name: 'Definitely Sydney (Stunt Double)', pos: [2200, 0, -3], rarity: 'epic', feetId: 'epic_sydney', minigame: null, bodyScale: 1.00 },

  // ── Mission-NPCs (named scripted civilians; rarity 'none' so they stay
  // visually identical to the grey crowd. The mission system reveals their
  // names through "go look for X in the Y" mission text.)
  { name: 'Martin', pos: [  10, 0, -36], rarity: 'none', feetId: 'npc_martin_ts',      minigame: null, bodyScale: 1.00 },
  { name: 'Grace',  pos: [3200, 0,   3], rarity: 'none', feetId: 'npc_grace_office',   minigame: null, bodyScale: 1.00 },
  { name: 'Lucy',   pos: [2600, 0,   2], rarity: 'none', feetId: 'npc_lucy_cafe',      minigame: null, bodyScale: 1.00 },
  { name: 'Hassan', pos: [2800, 0,  -2], rarity: 'none', feetId: 'npc_hassan_diner',   minigame: null, bodyScale: 1.00 },
  { name: 'Mei',    pos: [5000, 0,   2], rarity: 'none', feetId: 'npc_mei_museum',     minigame: null, bodyScale: 1.00 },
  { name: 'Carter', pos: [3800, 0,   3], rarity: 'none', feetId: 'npc_carter_gallery', minigame: null, bodyScale: 1.00 },
];

// Mission-NPC feetIds — grey citizens with scripted dialogue. Excluded from
// random NPC spawns and from any feet-collection logic.
export const MISSION_NPC_IDS = new Set([
  'npc_martin_ts', 'npc_grace_office', 'npc_lucy_cafe',
  'npc_hassan_diner', 'npc_mei_museum', 'npc_carter_gallery',
]);

// ── Shared AudioContext ────────────────────────────────────────────────────────

let _ctx = null;
function _initCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
}

function _makeDistortion(c, amount = 28) {
  const ws = c.createWaveShaper();
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  ws.curve = curve; return ws;
}
function _makeReverb(c, dur = 0.4) {
  const conv = c.createConvolver();
  const len  = Math.floor(c.sampleRate * dur);
  const buf  = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  conv.buffer = buf; return conv;
}

// Global EQ chain — lazy-init once per AudioContext
let _eqIn = null;
function _getEQIn(c) {
  if (_eqIn) return _eqIn;
  const ls = c.createBiquadFilter();
  ls.type = 'lowshelf'; ls.frequency.value = 200; ls.gain.value = -6;
  const hs = c.createBiquadFilter();
  hs.type = 'highshelf'; hs.frequency.value = 600; hs.gain.value = -5;
  ls.connect(hs); hs.connect(c.destination);
  return (_eqIn = ls);
}

// Voice profiles — original frequencies and per-character master gain
// Fields: freq, type, masterGain, dur(s), gap(s), up(Hz), dn(Hz),
//   h2(Hz), hg, harmType, lfo(Hz vibrato), ld(Hz depth),
//   tremolo(gain depth for tremolo LFO), lilt(Hz added to last 2 syllables),
//   sweep(bool — Bigfoot arc), altUp(bool — up every other syllable),
//   dist, rev, noise, randFreq
const VOICE_PROFILES = {
  common_happyfeet: { freq:280,  type:'sine', masterGain:0.16, dur:0.045, gap:0.020, up:240, dn:0,  h2:560, hg:0.05, harmType:'square',   lfo:8,  ld:30,  tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  common_samurai:   { freq:160,  type:'sine', masterGain:0.15, dur:0.180, gap:0.080, up:0,   dn:20, h2:80,  hg:0.08, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  common_bill:      { freq:220,  type:'sine', masterGain:0.14, dur:0.110, gap:0.050, up:25,  dn:0,  h2:440, hg:0.04, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  common_gymrat:    { freq:200,  type:'sine', masterGain:0.15, dur:0.060, gap:0.025, up:60,  dn:0,  h2:200, hg:0.06, harmType:'sawtooth', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  common_50shades:  { freq:175,  type:'sine', masterGain:0.12, dur:0.200, gap:0.090, up:10,  dn:0,  h2:87,  hg:0.06, harmType:'sine',     lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  rare_trex:        { freq:90,   type:'sine', masterGain:0.08, dur:0.200, gap:0.090, up:50,  dn:10, h2:45,  hg:0.12, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:true,  rev:false, noise:false, randFreq:false },
  rare_gramma:      { freq:350,  type:'sine', masterGain:0.13, dur:0.120, gap:0.055, up:0,   dn:0,  h2:700, hg:0.03, harmType:'sine',     lfo:5,  ld:20,  tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  rare_colonel:     { freq:145,  type:'sine', masterGain:0.16, dur:0.190, gap:0.085, up:8,   dn:0,  h2:72,  hg:0.09, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  rare_cheerleader: { freq:480,  type:'sine', masterGain:0.08, dur:0.050, gap:0.020, up:80,  dn:0,  h2:960, hg:0.04, harmType:'sine',     lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:true,  dist:false, rev:false, noise:false, randFreq:false },
  epic_lebron:      { freq:130,  type:'sine', masterGain:0.08, dur:0.140, gap:0.060, up:0,   dn:15, h2:65,  hg:0.10, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  epic_sonion:      { freq:155,  type:'sine', masterGain:0.5625, dur:0.170, gap:0.075, up:5,   dn:0,  h2:310, hg:0.06, harmType:'sine',     lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:true,  noise:false, randFreq:false },
  epic_sydney:      { freq:310,  type:'sine', masterGain:0.07, dur:0.095, gap:0.040, up:0,   dn:0,  h2:155, hg:0.06, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:true,  rev:false, noise:false, randFreq:false },
  mythic_clav:      { freq:185,  type:'sine', masterGain:0.15, dur:0.070, gap:0.030, up:80,  dn:0,  h2:370, hg:0.05, harmType:'sawtooth', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  mythic_patapim:   { freq:520,  type:'sine', masterGain:0.08, dur:0.030, gap:0.012, up:0,   dn:0,  h2:260, hg:0.06, harmType:'square',   lfo:14, ld:0,   tremolo:0.08, lilt:0,  sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:true  },
  mythic_messi:     { freq:240,  type:'sine', masterGain:0.15, dur:0.100, gap:0.045, up:0,   dn:0,  h2:480, hg:0.04, harmType:'sine',     lfo:0,  ld:0,   tremolo:0,    lilt:25, sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  legendary_margot: { freq:400,  type:'sine', masterGain:0.075, dur:0.085, gap:0.035, up:0,   dn:0,  h2:800, hg:0.03, harmType:'sine',     lfo:5,  ld:0,   tremolo:0.04, lilt:60, sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  legendary_bigfoot:{ freq:75,   type:'sine', masterGain:0.08, dur:0.250, gap:0.110, up:0,   dn:0,  h2:37,  hg:0.14, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:true,  altUp:false, dist:true,  rev:false, noise:false, randFreq:false },
  secret_rexey:     { freq:220,  type:'sine', masterGain:0.15, dur:0.160, gap:0.070, up:55,  dn:0,  h2:440, hg:0.07, harmType:'sine',     lfo:4,  ld:22,  tremolo:0.03, lilt:80, sweep:false, altUp:true,  dist:false, rev:true,  noise:false, randFreq:true  },
  // Morton — warm, slightly nasal older shopkeeper. Lower frequency with a
  // gentle up-tick at start of each syllable (calls attention) and a soft
  // triangle harmonic above to give him a "raspy uncle" quality.
  shopkeeper_morton:{ freq:135,  type:'sine', masterGain:0.18, dur:0.150, gap:0.070, up:14,  dn:0,  h2:270, hg:0.09, harmType:'triangle', lfo:0,  ld:0,   tremolo:0,    lilt:18, sweep:false, altUp:false, dist:false, rev:false, noise:false, randFreq:false },
  // Vance — bright, energetic, sneakerhead-on-espresso. Faster syllables and
  // higher base pitch with an upward inflection at the start of each sound.
  shopkeeper_fleetfeet:{ freq:235,  type:'sine', masterGain:0.15, dur:0.075, gap:0.030, up:35,  dn:0,  h2:470, hg:0.06, harmType:'square',   lfo:0,  ld:0,   tremolo:0,    lilt:0,  sweep:false, altUp:true,  dist:false, rev:false, noise:false, randFreq:false },
};

function _playVoice(feetId, baseFreq, text) {
  const c = _ctx;
  const prof = VOICE_PROFILES[feetId];
  const syllDur = prof ? prof.dur : 0.08;
  const syllGap = prof ? prof.gap : 0.04;
  const syllCount = Math.min(
    Math.max(3, Math.floor(text.length / 6)),
    Math.floor(0.95 / (syllDur + syllGap))
  );

  if (!prof) return _playGenericVoice(baseFreq, syllCount);

  const eqIn      = _getEQIn(c);
  const masterGain = c.createGain();
  masterGain.gain.value = prof.masterGain;
  masterGain.connect(eqIn);

  const nodes = [masterGain];
  const t0    = c.currentTime + 0.02;

  // Effect nodes — dist/rev sit between per-syllable gains and masterGain
  let oscDest = masterGain;
  if (prof.rev) {
    const rev = _makeReverb(c);
    rev.connect(masterGain);
    nodes.push(rev);
    oscDest = rev;
  }
  if (prof.dist) {
    const dist = _makeDistortion(c);
    dist.connect(oscDest);
    nodes.push(dist);
    oscDest = dist;
  }

  for (let s = 0; s < syllCount; s++) {
    const t    = t0 + s * (syllDur + syllGap);
    const endT = t  + syllDur;
    const atk  = Math.min(0.01, syllDur * 0.15);

    // Frequency for this syllable
    const isLast2     = prof.lilt > 0 && s >= syllCount - 2;
    const useAltUp    = prof.altUp && s % 2 !== 0;
    const fBase       = prof.randFreq ? (300 + Math.random() * 400) : prof.freq;
    const f           = isLast2 ? fBase + prof.lilt : fBase;
    const fStart      = useAltUp ? f : f + (prof.up || 0);

    // Main oscillator
    const osc  = c.createOscillator();
    const oscG = c.createGain();
    osc.type   = prof.type;
    osc.connect(oscG);
    oscG.connect(oscDest);
    osc.start(t);

    if (prof.sweep) {
      // Bigfoot: arc 75 → 55 → 85 Hz
      osc.frequency.setValueAtTime(75, t);
      osc.frequency.linearRampToValueAtTime(55, t + syllDur * 0.5);
      osc.frequency.linearRampToValueAtTime(85, endT);
    } else {
      osc.frequency.setValueAtTime(Math.max(1, fStart), t);
      if (!useAltUp && prof.up > 0)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t + Math.min(syllDur * 0.45, 0.04));
      if (prof.dn > 0)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, f - prof.dn), endT);
    }

    // Gain envelope
    oscG.gain.setValueAtTime(0.0001, t);
    oscG.gain.linearRampToValueAtTime(1.0, t + atk);
    oscG.gain.setValueAtTime(1.0, Math.max(t + atk + 0.001, endT - atk));
    oscG.gain.exponentialRampToValueAtTime(0.0001, endT);
    osc.stop(endT + 0.05);
    nodes.push(osc, oscG);

    // Vibrato LFO — modulates oscillator frequency
    if (prof.lfo > 0 && prof.ld > 0) {
      const lfoOsc = c.createOscillator();
      const lfoG   = c.createGain();
      lfoOsc.type          = 'sine';
      lfoOsc.frequency.value = prof.lfo;
      lfoG.gain.value        = prof.ld;
      lfoOsc.connect(lfoG); lfoG.connect(osc.frequency);
      lfoOsc.start(t); lfoOsc.stop(endT + 0.05);
      nodes.push(lfoOsc, lfoG);
    }

    // Tremolo LFO — modulates gain
    if (prof.tremolo > 0 && prof.lfo > 0) {
      const trmOsc = c.createOscillator();
      const trmG   = c.createGain();
      trmOsc.type          = 'sine';
      trmOsc.frequency.value = prof.lfo;
      trmG.gain.value        = prof.tremolo;
      trmOsc.connect(trmG); trmG.connect(oscG.gain);
      trmOsc.start(t); trmOsc.stop(endT + 0.05);
      nodes.push(trmOsc, trmG);
    }

    // Harmonic layer
    if (prof.h2 > 0 && prof.hg > 0) {
      const o2  = c.createOscillator();
      const o2G = c.createGain();
      o2.type          = prof.harmType || 'sine';
      o2.frequency.value = prof.h2;
      o2.connect(o2G); o2G.connect(masterGain);
      o2.start(t);
      o2G.gain.setValueAtTime(0.0001, t);
      o2G.gain.linearRampToValueAtTime(prof.hg, t + atk);
      o2G.gain.exponentialRampToValueAtTime(0.0001, endT);
      o2.stop(endT + 0.05);
      nodes.push(o2, o2G);
    }
  }

  // White-noise whisper layer (Rexey)
  if (prof.noise) {
    const totalDur = syllCount * (syllDur + syllGap);
    const bufSrc   = c.createBufferSource();
    const nBuf     = c.createBuffer(1, Math.ceil(c.sampleRate * totalDur), c.sampleRate);
    const nd       = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const nG = c.createGain();
    nG.gain.value = 0.05;
    bufSrc.buffer = nBuf;
    bufSrc.connect(nG); nG.connect(masterGain);
    bufSrc.start(t0); bufSrc.stop(t0 + totalDur + 0.05);
    nodes.push(bufSrc, nG);
  }

  return nodes;
}

function _playGenericVoice(baseFreq, syllCount) {
  const c         = _ctx;
  const eqIn      = _getEQIn(c);
  const masterGain = c.createGain();
  masterGain.gain.value = 0.15;
  masterGain.connect(eqIn);

  const nodes = [masterGain];
  const t0    = c.currentTime + 0.02;
  const dur   = 0.08, gap = 0.04;

  for (let s = 0; s < syllCount; s++) {
    const t    = t0 + s * (dur + gap);
    const endT = t  + dur;
    const f    = baseFreq * (0.85 + Math.random() * 0.30);

    const osc  = c.createOscillator();
    const oscG = c.createGain();
    osc.type   = 'sine';
    osc.connect(oscG); oscG.connect(masterGain);
    osc.start(t);
    osc.frequency.setValueAtTime(f + 40, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t + 0.04);
    oscG.gain.setValueAtTime(0.0001, t);
    oscG.gain.linearRampToValueAtTime(1.0, t + 0.01);
    oscG.gain.setValueAtTime(1.0, t + dur - 0.06);
    oscG.gain.exponentialRampToValueAtTime(0.0001, endT);
    osc.stop(endT + 0.05);
    nodes.push(osc, oscG);

    // Octave-up harmonic
    const o2  = c.createOscillator();
    const o2G = c.createGain();
    o2.type          = 'sine';
    o2.frequency.value = f * 2;
    o2.connect(o2G); o2G.connect(masterGain);
    o2.start(t);
    o2G.gain.setValueAtTime(0.0001, t);
    o2G.gain.linearRampToValueAtTime(0.06, t + 0.01);
    o2G.gain.exponentialRampToValueAtTime(0.0001, endT);
    o2.stop(endT + 0.05);
    nodes.push(o2, o2G);
  }
  return nodes;
}

// Per-character animation dispatch table; called from update() when _animActive
const ANIM_DISPATCHERS = {
  common_happyfeet: (npc, t) => {
    const p = npc._parts;
    if (p[8]) p[8].position.y = 0.04 + Math.abs(Math.sin(t * Math.PI * 8)) * 0.12;
    if (p[9]) p[9].position.y = 0.04 + Math.abs(Math.sin(t * Math.PI * 8 + Math.PI)) * 0.12;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 4) * 0.18;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 4) * 0.18;
    if (p[2]) p[2].rotation.x = Math.sin(t * Math.PI * 8) * 0.05;
    npc.group.rotation.z = Math.sin(t * Math.PI * 6) * 0.07;
  },
  common_samurai: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.6) * 0.04;
    if (p[7]) p[7].rotation.x = Math.sin(t * Math.PI * 1.8) * 0.06;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 1.6) * 0.05;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 1.6 + 0.5) * 0.05;
  },
  common_bill: (npc, t) => {
    const p = npc._parts;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 4)) * 0.06);
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 4) * 0.12;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 4) * 0.12;
    if (p[7]) p[7].rotation.y =  Math.sin(t * Math.PI * 3) * 0.08;
  },
  common_gymrat: (npc, t) => {
    const p = npc._parts;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 10)) * 0.10);
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.abs(Math.sin(t * Math.PI * 6)) * 0.4;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.abs(Math.sin(t * Math.PI * 6 + Math.PI)) * 0.4;
    if (p[7]) p[7].rotation.x =  Math.sin(t * Math.PI * 10) * 0.04;
  },
  common_50shades: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.0) * 0.02;
    if (p[7]) p[7].rotation.z = Math.sin(t * Math.PI * 1.2) * 0.08;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 1.0) * 0.02;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 1.0) * 0.02;
  },
  rare_trex: (npc, t) => {
    const p = npc._parts;
    const stomp = Math.abs(Math.sin(t * Math.PI * 3));
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (stomp * 0.18);
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 3) * 0.35;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 3) * 0.35;
    if (p[7]) p[7].position.z = stomp * 0.08;
    npc.group.rotation.z = Math.sin(t * Math.PI * 3) * 0.05;
  },
  rare_gramma: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.4) * 0.03;
    if (p[7]) p[7].rotation.x = Math.sin(t * Math.PI * 1.6) * 0.05;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 1.4) * 0.10;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 1.4) * 0.10;
  },
  rare_colonel: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.2) * 0.02;
    if (p[7]) p[7].rotation.x = Math.sin(t * Math.PI * 1.4) * 0.03;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.max(0, Math.sin((t % 3) * Math.PI / 1.5)) * 0.5;
  },
  rare_cheerleader: (npc, t) => {
    const p = npc._parts;
    const b = Math.abs(Math.sin(t * Math.PI * 10));
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (b * 0.20);
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 10) * 0.55;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 10) * 0.55;
    if (p[7]) p[7].rotation.x =  Math.sin(t * Math.PI * 10) * 0.08;
    const s = npc._bodyScale * (1 + b * 0.04);
    npc.group.scale.set(s, s, s);
  },
  epic_lebron: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 2) * 0.05;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 2) * 0.32;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 2) * 0.32;
    if (p[7]) p[7].rotation.x =  Math.sin(t * Math.PI * 2.4) * 0.06;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 2)) * 0.05);
  },
  epic_sonion: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.4) * 0.04;
    if (p[7]) p[7].rotation.z = Math.sin(t * Math.PI * 1.6) * 0.10;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 1.2) * 0.20;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 1.2) * 0.20;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.sin(t * Math.PI * 1.0) * 0.04 + 0.04);
  },
  epic_sydney: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 2.2) * 0.03;
    if (p[7]) p[7].rotation.z = Math.max(0, Math.sin((t % 3) / 3 * Math.PI)) * 0.15;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 2.2) * 0.08;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 2.2) * 0.08;
  },
  mythic_clav: (npc, t) => {
    const p = npc._parts;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 8)) * 0.08);
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.abs(Math.sin(t * Math.PI * 6)) * 0.6;
    if (p[7]) p[7].rotation.y =  Math.sin(t * Math.PI * 6) * 0.15;
  },
  mythic_patapim: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.y += 0.08;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 16)) * 0.25);
    if (!npc._pataLast || t - npc._pataLast > 0.10) {
      npc._pataLast = t;
      if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.random() * 1.2;
      if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.random() * 1.2;
    }
    if (!npc._pataHeadLast || t - npc._pataHeadLast > 0.08) {
      npc._pataHeadLast = t;
      if (p[7]) { p[7].rotation.x = (Math.random() - 0.5) * 0.4; p[7].rotation.z = (Math.random() - 0.5) * 0.4; }
    }
    const s = npc._bodyScale * (0.95 + Math.abs(Math.sin(t * Math.PI * 16)) * 0.10);
    npc.group.scale.set(s, s, s);
  },
  mythic_messi: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 2.6) * 0.04;
    if (p[7]) p[7].rotation.z = Math.sin(t * Math.PI * 2.6) * 0.07;
    if (p[2]) p[2].rotation.x = Math.max(0, Math.sin((t % 2.5) / 2.5 * Math.PI)) * 0.2;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 2.6)) * 0.03);
  },
  legendary_margot: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 2.4) * 0.06;
    if (p[7]) p[7].rotation.z = Math.max(0, Math.sin((t % 4) / 4 * Math.PI)) * 0.20;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 2.0) * 0.18;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 2.0) * 0.18;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (Math.abs(Math.sin(t * Math.PI * 2.4)) * 0.04);
  },
  legendary_bigfoot: (npc, t) => {
    const p = npc._parts;
    const stomp = Math.abs(Math.sin(t * Math.PI * 2.4));
    npc.group.position.y = (npc._origGroupPosY ?? 0) + (stomp * 0.22);
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z =  Math.sin(t * Math.PI * 2.4) * 0.45;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  = -Math.sin(t * Math.PI * 2.4) * 0.45;
    if (p[7]) p[7].position.z = stomp * 0.12;
    npc.group.rotation.z = Math.sin(t * Math.PI * 2.4) * 0.07;
    const s = npc._bodyScale * (1 + stomp * 0.03);
    npc.group.scale.set(s, s, s);
  },
  secret_rexey: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.0) * 0.015;
    if (p[7]) p[7].rotation.y = Math.sin(t * Math.PI * 1.2) * 0.18;
    if (npc._rightArmPivot) npc._rightArmPivot.position.y = 1.06 + Math.max(0, Math.sin((t % 3) / 3 * Math.PI)) * 0.10;
  },
  // Vance — bouncy sneakerhead. Quick subtle two-step bob with arms moving
  // like he's hyping up the next pair.
  shopkeeper_fleetfeet: (npc, t) => {
    const p = npc._parts;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + Math.abs(Math.sin(t * Math.PI * 4.0)) * 0.06;
    if (npc._rightArmPivot) npc._rightArmPivot.rotation.z = -0.1 + Math.sin(t * Math.PI * 4.5) * 0.55;
    if (npc._leftArmPivot)  npc._leftArmPivot.rotation.z  =  0.1 - Math.sin(t * Math.PI * 4.5) * 0.55;
    if (p[7]) p[7].rotation.y = Math.sin(t * Math.PI * 2.0) * 0.18;
  },
  // Morton — friendly shopkeeper. Right arm gestures rhythmically (counting
  // imaginary coins), head bobs slightly with each syllable, body sways.
  shopkeeper_morton: (npc, t) => {
    const p = npc._parts;
    npc.group.rotation.z = Math.sin(t * Math.PI * 1.6) * 0.04;
    npc.group.position.y = (npc._origGroupPosY ?? 0) + Math.abs(Math.sin(t * Math.PI * 2.4)) * 0.04;
    if (npc._rightArmPivot) {
      // Pointing/counting gesture — arm comes up and down rhythmically
      npc._rightArmPivot.rotation.z = -0.2 + Math.sin(t * Math.PI * 3.5) * 0.45;
      npc._rightArmPivot.rotation.x = Math.sin(t * Math.PI * 2.0) * 0.25;
    }
    if (npc._leftArmPivot) {
      npc._leftArmPivot.rotation.z = Math.sin(t * Math.PI * 1.8 + Math.PI / 3) * 0.10;
    }
    if (p[7]) {
      p[7].rotation.x = Math.sin(t * Math.PI * 3.0) * 0.06;
      p[7].rotation.y = Math.sin(t * Math.PI * 1.4) * 0.12;
    }
  },
};

// ── Seeded PRNG ───────────────────────────────────────────────────────────────

function makePRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

// ── NPC class ─────────────────────────────────────────────────────────────────

export class NPC {
  constructor(scene, position, rarity, name, legendaryPreset = null, feetId = null, minigame = null, bodyScale = 1.0, isPenguin = false) {
    this.scene           = scene;
    this.rarity          = rarity;
    this.name            = name;
    this.legendaryPreset = legendaryPreset;
    this.feetId          = feetId;
    this.minigame        = minigame;
    this.feetCollected   = false;
    this.isInDialogue    = false;
    this._dialogueEndTime = 0;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.scale.setScalar(bodyScale);

    this._rotDir   = (rarity === 'legendary') ? 1 : -1;
    this._rotSpeed = 0.003 * (0.5 + Math.random());

    this._parts     = [];
    this._isPenguin = isPenguin;

    // Voice + animation state
    this._voiceFreq   = 180 + Math.random() * 140;
    this._activeNodes = [];
    this._animActive  = false;
    this._bodyScale  = bodyScale;

    this._buildMesh();
    this._buildOutline();
    if (rarity === 'legendary') this._buildParticles();

    scene.add(this.group);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  update(elapsedTime) {
    // In combat the encounter system drives rotation/position directly
    if (!this._inCombat && !this._kod) {
      this.group.rotation.y += this._rotDir * this._rotSpeed;
    }

    // Drive per-character animation when active (skip while KO'd)
    if (this._animActive && this.feetId && !this._kod) {
      const fn = ANIM_DISPATCHERS[this.feetId];
      if (fn) fn(this, elapsedTime);
    }

    if (this._particles) {
      const wx = this.group.position.x;
      const wy = this.group.position.y + 1.92 * this.group.scale.x;
      const wz = this.group.position.z;
      this._particles.forEach((p, i) => {
        const angle = elapsedTime * 1.2 + (i / 5) * Math.PI * 2;
        p.position.set(wx + Math.cos(angle) * 0.65, wy, wz + Math.sin(angle) * 0.65);
      });
    }
  }

  setHighlighted(on) {
    if (this._outlineGroup) this._outlineGroup.visible = on;
  }

  interact() {
    console.log(`INTERACT with ${this.rarity} NPC: ${this.name}`);
    return this;
  }

  dispose() {
    this.scene.remove(this.group);
    if (this._particles) {
      for (const p of this._particles) this.scene.remove(p);
    }
  }

  // ── Voice ──────────────────────────────────────────────────────────────────

  startVoice(text) {
    this.stopVoice();
    try {
      _initCtx();
      this._activeNodes = _playVoice(this.feetId, this._voiceFreq, text);
    } catch (e) {}
  }

  stopVoice() {
    for (const node of this._activeNodes) {
      if (node.stop) try { node.stop(0); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
    }
    this._activeNodes = [];
  }

  nextVoiceLine(text) {
    this.stopVoice();
    this.startVoice(text);
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  startAnimation() {
    if (this._animActive) return;
    this._animActive = true;
    // Save original part transforms so stopAnimation can restore them
    this._origPartRot = this._parts.map(p => ({ x: p.rotation.x, y: p.rotation.y, z: p.rotation.z }));
    this._origPartPos = this._parts.map(p => ({ x: p.position.x, y: p.position.y, z: p.position.z }));
    this._origGroupRotZ = this.group.rotation.z;
    this._origGroupPosY = this.group.position.y;
  }

  stopAnimation() {
    if (!this._animActive) return;
    this._animActive = false;
    if (this._origPartRot) {
      this._parts.forEach((p, i) => {
        p.rotation.x = this._origPartRot[i].x;
        p.rotation.y = this._origPartRot[i].y;
        p.rotation.z = this._origPartRot[i].z;
        p.position.x = this._origPartPos[i].x;
        p.position.y = this._origPartPos[i].y;
        p.position.z = this._origPartPos[i].z;
      });
    }
    this.group.rotation.z = this._origGroupRotZ ?? 0;
    this.group.position.y = this._origGroupPosY ?? 0;
    const bs = this._bodyScale ?? 1;
    this.group.scale.set(bs, bs, bs);
    this._pataLast = 0; this._pataHeadLast = 0;
  }

  // ── Private: body construction ────────────────────────────────────────────

  _part(geo, color, pos) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(...pos);
    this.group.add(mesh);
    this._parts.push(mesh);
    return mesh;
  }

  // Arm pivot: Group at shoulder; mesh hangs downward so rotation.z swings from the top joint.
  _armPivot(geo, color, side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.31, 1.06, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(0, -0.26, 0);
    pivot.add(mesh);
    this.group.add(pivot);
    this._parts.push(pivot);
    if (side > 0) this._rightArmPivot = pivot;
    else          this._leftArmPivot  = pivot;
    return pivot;
  }

  _buildMesh() {
    if (this._isPenguin) { this._buildPenguin(); return; }

    let shirtColor, pantColor, shoeColor, skinColor;

    if (this.rarity === 'legendary' && this.legendaryPreset !== null) {
      const p = LEGENDARY_PRESETS[this.legendaryPreset];
      shirtColor = p.shirt; pantColor = p.pants; shoeColor = p.shoes; skinColor = p.skin;
    } else if (RARITY_COLORS[this.rarity]) {
      const rc   = RARITY_COLORS[this.rarity];
      shirtColor = rc.shirt; pantColor = rc.pants; shoeColor = rc.shoes;
      skinColor  = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
    } else {
      // Unified citizen — every random crowd NPC wears the exact same outfit.
      shirtColor = NONE_PALETTE.shirt;
      pantColor  = NONE_PALETTE.pants;
      shoeColor  = NONE_PALETTE.shoes;
      skinColor  = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
    }

    // Apply per-NPC appearance config overrides
    const cfg = this.feetId ? APPEARANCE_CONFIGS[this.feetId] : null;
    if (cfg) {
      if (cfg.shirt !== undefined) shirtColor = cfg.shirt;
      if (cfg.pants !== undefined) pantColor  = cfg.pants;
      if (cfg.shoes !== undefined) shoeColor  = cfg.shoes;
      if (cfg.skin  !== undefined) skinColor  = cfg.skin;
    }

    // Shoes
    this._part(new THREE.BoxGeometry(0.14, 0.08, 0.18), shoeColor,  [ 0.10, 0.04, 0.03]);
    this._part(new THREE.BoxGeometry(0.14, 0.08, 0.18), shoeColor,  [-0.10, 0.04, 0.03]);
    // Legs
    this._part(new THREE.BoxGeometry(0.12, 0.50, 0.12), pantColor,  [ 0.10, 0.25, 0]);
    this._part(new THREE.BoxGeometry(0.12, 0.50, 0.12), pantColor,  [-0.10, 0.25, 0]);
    // Body
    this._part(new THREE.BoxGeometry(0.50, 0.72, 0.28), shirtColor, [0, 0.86, 0]);
    // Arms — pivot at shoulder so rotation swings from the top joint
    this._armPivot(new THREE.BoxGeometry(0.11, 0.52, 0.11), shirtColor,  1);
    this._armPivot(new THREE.BoxGeometry(0.11, 0.52, 0.11), shirtColor, -1);
    // Head
    this._part(new THREE.SphereGeometry(0.28, 8, 8),    skinColor,  [0, 1.50, 0]);

    // Legendary extras
    if (this.rarity === 'legendary' && this.legendaryPreset !== null) {
      for (const ex of LEGENDARY_PRESETS[this.legendaryPreset].extras) {
        const geo = ex.type === 'sphere'
          ? new THREE.SphereGeometry(ex.r, 8, 8)
          : new THREE.BoxGeometry(...ex.s);
        this._part(geo, ex.color, ex.pos);
      }
    }

    // Per-feetId extras (bowties, accents, glowing eyes, etc.) — used to
    // visually separate the 18 collectible characters from the grey crowd.
    if (cfg && cfg.extras) {
      for (const ex of cfg.extras) {
        const geo = ex.type === 'sphere'
          ? new THREE.SphereGeometry(ex.r, 8, 8)
          : new THREE.BoxGeometry(...ex.s);
        this._part(geo, ex.color, ex.pos);
      }
    }

    // Vance — visually distinct sneaker-store shopkeeper: backwards snapback
    // cap (orange brim, black crown), white wristbands, and an orange chest
    // band suggesting an apron / lanyard.
    if (this.feetId === 'shopkeeper_fleetfeet') {
      // Snapback cap — flat brim out the back (worn backwards)
      this._part(new THREE.BoxGeometry(0.50, 0.05, 0.32), 0xff6633, [0, 1.78, -0.18]);
      this._part(new THREE.CylinderGeometry(0.24, 0.24, 0.20, 14), 0x111111, [0, 1.86, 0]);
      // White wristbands at each wrist
      this._part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), 0xffffff, [ 0.30, 0.40, 0]);
      this._part(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), 0xffffff, [-0.30, 0.40, 0]);
      // Brand chest band
      this._part(new THREE.BoxGeometry(0.52, 0.10, 0.30), 0xffffff, [0, 1.10, 0]);
    }

    // Morton — visually distinct shopkeeper: bowler hat + grey mustache,
    // small round glasses sketched on the face, and a brass apron tassel.
    if (this.feetId === 'shopkeeper_morton') {
      // Bowler hat — flat brim disc + dome
      this._part(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 14), 0x1a1208, [0, 1.78, 0]);
      this._part(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 14), 0x1a1208, [0, 1.86, 0]);
      // Bushy grey mustache
      this._part(new THREE.BoxGeometry(0.22, 0.04, 0.05), 0x9a9088, [0, 1.40, 0.27]);
      // Round glasses (two thin discs in front of the eyes)
      this._part(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), 0x222222, [-0.10, 1.52, 0.27]);
      this._part(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), 0x222222, [ 0.10, 1.52, 0.27]);
      // Apron tassel hanging from the chest — brass-colored
      this._part(new THREE.BoxGeometry(0.05, 0.18, 0.05), 0xC9A24A, [0.16, 0.88, 0.16]);
    }
  }

  _buildPenguin() {
    // Rounded black torso
    this._part(new THREE.BoxGeometry(0.50, 0.55, 0.32), 0x111111,  [0, 0.55, 0]);
    // White belly patch
    this._part(new THREE.BoxGeometry(0.28, 0.44, 0.06), 0xf0f0f0,  [0, 0.57, 0.16]);
    // Head
    this._part(new THREE.SphereGeometry(0.24, 8, 8),    0x111111,  [0, 1.12, 0]);
    // White face patch
    this._part(new THREE.BoxGeometry(0.20, 0.18, 0.06), 0xf0f0f0,  [0, 1.10, 0.22]);
    // Eyes
    this._part(new THREE.SphereGeometry(0.04, 5, 5),    0x111111,  [ 0.08, 1.16, 0.25]);
    this._part(new THREE.SphereGeometry(0.04, 5, 5),    0x111111,  [-0.08, 1.16, 0.25]);
    // Wings — pivot at top attachment point so rotation.z swings from the shoulder equivalent
    { const pivot = new THREE.Group(); pivot.position.set(0.32, 0.74, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.07), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      mesh.position.set(0, -0.19, 0); pivot.add(mesh); this.group.add(pivot); this._parts.push(pivot);
      this._rightArmPivot = pivot; }
    { const pivot = new THREE.Group(); pivot.position.set(-0.32, 0.74, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.07), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      mesh.position.set(0, -0.19, 0); pivot.add(mesh); this.group.add(pivot); this._parts.push(pivot);
      this._leftArmPivot = pivot; }
    // Orange feet
    this._part(new THREE.BoxGeometry(0.20, 0.07, 0.22), 0xf5a623,  [ 0.10, 0.04, 0.04]);
    this._part(new THREE.BoxGeometry(0.20, 0.07, 0.22), 0xf5a623,  [-0.10, 0.04, 0.04]);
    // Three forward toes per foot
    for (let side = -1; side <= 1; side += 2) {
      for (let t = -1; t <= 1; t++) {
        this._part(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 5), 0xe8971a,
          [side * 0.10 + t * 0.06, 0.05, 0.17]);
      }
    }
  }

  _buildOutline() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
    this._outlineGroup = new THREE.Group();
    for (const part of this._parts) {
      if (part.isGroup) {
        // Pivot group — outline child mesh at combined rest position
        part.traverse(child => {
          if (!child.isMesh) return;
          const clone = new THREE.Mesh(child.geometry, mat);
          clone.position.set(
            part.position.x + child.position.x,
            part.position.y + child.position.y,
            part.position.z + child.position.z,
          );
          clone.scale.setScalar(1.14);
          this._outlineGroup.add(clone);
        });
      } else {
        const clone = new THREE.Mesh(part.geometry, mat);
        clone.position.copy(part.position);
        clone.rotation.copy(part.rotation);
        clone.scale.setScalar(1.14);
        this._outlineGroup.add(clone);
      }
    }
    this._outlineGroup.visible = false;
    this.group.add(this._outlineGroup);
  }

  _buildParticles() {
    this._particles = [];
    const geo = new THREE.SphereGeometry(0.07, 5, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe060 });
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(geo, mat);
      this.scene.add(p);
      this._particles.push(p);
    }
  }
}

// ── Interior spawn zones (world-space bounding boxes for indoor areas) ────────

// Interior room world-x values: ESB=2000, Chrysler=2200, Cafe=2600, Diner=2800, Gym=3000, Office=3200,
// Shop=3400, Bar=3600, Gallery=3800, Laundry=4000, Pharmacy=4200, Hotel=4400, KFC=4600,
// Bodega=4800, Museum=5000, Barbershop=5200
const INTERIOR_SPAWN_ZONES = [
  { label: 'esb_interior',        xMin:1992, xMax:2008, zMin: -8, zMax:  8, y: 0, skipCollision: true },
  { label: 'gc_interior',         xMin:1792, xMax:1808, zMin: -8, zMax:  8, y: 0, skipCollision: true },
  { label: 'chrysler_interior',   xMin:2192, xMax:2208, zMin: -8, zMax:  8, y: 0, skipCollision: true },
  { label: 'wtc_interior',        xMin:2392, xMax:2408, zMin: -8, zMax:  8, y: 0, skipCollision: true },
  { label: 'cafe_interior',       xMin:2592, xMax:2608, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'diner_interior',      xMin:2792, xMax:2808, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'gym_interior',        xMin:2992, xMax:3008, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'office_interior',     xMin:3192, xMax:3208, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'shop_interior',       xMin:3392, xMax:3408, zMin: -7, zMax:  6, y: 0, skipCollision: true },
  { label: 'bar_interior',        xMin:3592, xMax:3608, zMin: -8, zMax:  4, y: 0, skipCollision: true },
  { label: 'gallery_interior',    xMin:3792, xMax:3808, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'laundry_interior',    xMin:3992, xMax:4008, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'pharmacy_interior',   xMin:4192, xMax:4208, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'hotel_interior',      xMin:4392, xMax:4408, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'kfc_interior',        xMin:4593, xMax:4607, zMin:  2, zMax:  8, y: 0, skipCollision: true },
  { label: 'bodega_interior',     xMin:4792, xMax:4808, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'museum_interior',     xMin:4992, xMax:5008, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'barbershop_interior', xMin:5192, xMax:5208, zMin: -8, zMax:  6, y: 0, skipCollision: true },
  { label: 'times_square',        xMin:   4, xMax:  16, zMin: -46, zMax: -34, y: 0 },
  { label: 'bridge_deck',         xMin: -63, xMax: -57, zMin:-100, zMax: -60, y: 6, skipCollision: true },
  { label: 'central_park',        xMin: -80, xMax: -20, zMin:  40, zMax:  80, y: 0 },
];

function _separateNPCs(npcs) {
  const SEP = 1.2, FORCE = 0.025;
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i], b = npcs[j];
      if (a.isInDialogue || b.isInDialogue) continue;
      const dx = b.group.position.x - a.group.position.x;
      const dz = b.group.position.z - a.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < SEP && dist > 0.001) {
        const nx = dx / dist, nz = dz / dist;
        const push = (SEP - dist) * FORCE;
        a.group.position.x -= nx * push;
        a.group.position.z -= nz * push;
        b.group.position.x += nx * push;
        b.group.position.z += nz * push;
      }
    }
  }
}

// ── NPCManager class ──────────────────────────────────────────────────────────

export class NPCManager {
  constructor(scene, colliders) {
    this.npcs         = [];
    this._highlighted = null;

    const rng     = makePRNG((Date.now() ^ 0xdeadbeef) >>> 0);
    let   nameIdx = 0;

    // ── Legendary NPCs — 50-attempt jitter loop for clear placement ──────────
    for (const def of LEGENDARY_DEFS) {
      let sx = def.pos[0], sz = def.pos[2];
      for (let attempt = 0; attempt < 50; attempt++) {
        const jx = def.pos[0] + (attempt === 0 ? 0 : (Math.random() - 0.5) * 4);
        const jz = def.pos[2] + (attempt === 0 ? 0 : (Math.random() - 0.5) * 4);
        if (isSpawnClear(jx, 0, jz, 1.2, colliders)) { sx = jx; sz = jz; break; }
      }
      const npc = new NPC(
        scene, new THREE.Vector3(sx, 0, sz),
        'legendary', def.name, def.preset, def.feetId, null, def.bodyScale ?? 1.0,
      );
      this.npcs.push(npc);
      window.ALL_NPCS.push(npc);
    }

    // ── Special fixed-position NPCs — safety-check, except Rexey (tight alley)
    // and elevated spawns (bridge deck etc.) which have a fixed y > 0
    for (const def of SPECIAL_DEFS) {
      const sy = def.pos[1] ?? 0;
      let sx = def.pos[0], sz = def.pos[2];
      if (def.feetId !== 'secret_rexey' && sy === 0) {
        const safe = _safeSpawn(def.pos[0], def.pos[2], colliders, 1.0);
        if (safe) { sx = safe[0]; sz = safe[1]; }
      }
      const npc = new NPC(
        scene, new THREE.Vector3(sx, sy, sz),
        def.rarity, def.name, null, def.feetId, def.minigame ?? null,
        def.bodyScale ?? 1.0, def.isPenguin ?? false,
      );
      this.npcs.push(npc);
      window.ALL_NPCS.push(npc);
    }

    // ── 60 randomly placed NPCs ──────────────────────────────────────────────
    const namedPool = [];
    for (const [rar, ids] of Object.entries(FEET_POOL)) {
      for (const fid of ids) {
        namedPool.push({ rarity: rar, feetId: fid, minigame: rar === 'mythic' ? 'rps' : null });
      }
    }
    for (let i = namedPool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [namedPool[i], namedPool[j]] = [namedPool[j], namedPool[i]];
    }

    const spawnPoints = [];
    let   attempts    = 0;
    // Spread across the full extended grid (≈ ±115 in each axis)
    while (spawnPoints.length < 70 && attempts < 12000) {
      attempts++;
      const x = (rng() - 0.5) * 230;
      const z = (rng() - 0.5) * 230;
      if (!isSpawnClear(x, 0, z, 2.0, colliders))                               continue;
      if (spawnPoints.some(p => Math.hypot(p[0] - x, p[1] - z) < 4))           continue;
      if (SPECIAL_DEFS.some(d => Math.hypot(d.pos[0] - x, d.pos[2] - z) < 5))  continue;
      spawnPoints.push([x, z]);
    }

    for (const [x, z] of spawnPoints) {
      const entry    = namedPool.length > 0 ? namedPool.pop() : null;
      const rarity   = entry?.rarity   ?? 'none';
      const feetId   = entry?.feetId   ?? null;
      const minigame = entry?.minigame ?? null;
      const name     = FEET_NAMES[feetId] ?? NPC_NAMES[nameIdx++ % NPC_NAMES.length];
      const bodyScale = feetId === 'epic_lebron' ? 1.18 : 1.0;

      const npc = new NPC(
        scene, new THREE.Vector3(x, 0, z),
        rarity, name, null, feetId, minigame, bodyScale,
      );
      this.npcs.push(npc);
      window.ALL_NPCS.push(npc);
    }

    // ── Interior-zone NPCs — round-robin so every zone gets a fair share ─────
    // 3 NPCs per zone × ~19 zones ≈ 57 NPCs distributed evenly
    const PER_ZONE = 3;
    for (let pass = 0; pass < PER_ZONE; pass++) {
      for (const zone of INTERIOR_SPAWN_ZONES) {
        const spawn = _spawnInZone(zone, colliders);
        if (!spawn) continue;
        const entry    = namedPool.length > 0 ? namedPool.pop() : null;
        const rarity   = entry?.rarity   ?? 'none';
        const feetId   = entry?.feetId   ?? null;
        const minigame = entry?.minigame ?? null;
        const name     = FEET_NAMES[feetId] ?? NPC_NAMES[nameIdx++ % NPC_NAMES.length];
        const bodyScale = feetId === 'epic_lebron' ? 1.18 : 1.0;
        const npc = new NPC(
          scene, new THREE.Vector3(spawn.x, spawn.y, spawn.z),
          rarity, name, null, feetId, minigame, bodyScale,
        );
        this.npcs.push(npc);
        window.ALL_NPCS.push(npc);
      }
    }

    // ── Audit: count NPCs per interior zone and warn about empty rooms ─────
    setTimeout(() => {
      const counts = {};
      for (const zone of INTERIOR_SPAWN_ZONES) counts[zone.label] = 0;
      for (const npc of this.npcs) {
        const px = npc.group.position.x, pz = npc.group.position.z;
        for (const zone of INTERIOR_SPAWN_ZONES) {
          if (px >= zone.xMin && px <= zone.xMax &&
              pz >= zone.zMin && pz <= zone.zMax) {
            counts[zone.label]++;
            break;
          }
        }
      }
      const summary = Object.entries(counts)
        .map(([k, v]) => `${k}:${v}`).join(' ');
      console.log(`[FeetDex] NPC zone counts — ${summary}`);
      for (const [label, count] of Object.entries(counts)) {
        if (count < 2) console.warn(`[FeetDex] zone "${label}" has only ${count} NPC(s)`);
      }
    }, 50);
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  update(elapsedTime, playerPos) {
    let closest     = null;
    let closestDist = Infinity;

    for (const npc of this.npcs) {
      const d = playerPos.distanceTo(npc.group.position);
      if (d < 60 || npc.rarity === 'legendary') npc.update(elapsedTime);
      // Per-NPC interaction range. Shopkeepers can be reached from across
      // their counter (the counter solid blocks the player from getting any
      // closer than ~2u, so a tighter limit would lock them out).
      const range = (npc.feetId === 'shopkeeper_morton' ||
                     npc.feetId === 'shopkeeper_fleetfeet') ? 4.5 : 2.5;
      if (d < range && d < closestDist) { closestDist = d; closest = npc; }
    }

    if (this._highlighted !== closest) {
      if (this._highlighted) this._highlighted.setHighlighted(false);
      if (closest)           closest.setHighlighted(true);
      this._highlighted = closest;
    }

    _separateNPCs(this.npcs);
    return closest;
  }

  interactWithNearest() {
    return this._highlighted ? this._highlighted.interact() : null;
  }

  addInteriorNpcs(scene, spawns) {
    for (const { x, y, z } of spawns) {
      const npc = new NPC(
        scene, new THREE.Vector3(x, y, z),
        'none', NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)],
        null, null, null,
      );
      this.npcs.push(npc);
      window.ALL_NPCS.push(npc);
    }
  }
}

// ── Module helpers ────────────────────────────────────────────────────────────

// Returns true if the point (x,z) is within `radius` units of any solid box.
function _isSolid(x, z, colliders, radius) {
  for (const box of colliders) {
    if (x + radius > box.min.x && x - radius < box.max.x &&
        z + radius > box.min.z && z - radius < box.max.z) return true;
  }
  return false;
}

// Spiral outward from (x,z) until a clear spot is found; returns [nx,nz] or null.
function _safeSpawn(x, z, colliders, radius = 1.0, maxTries = 120) {
  if (!_isSolid(x, z, colliders, radius)) return [x, z];
  for (let t = 0; t < maxTries; t++) {
    const angle = t * 2.399963;          // golden angle — good angular coverage
    const dist  = 1.5 + t * 0.25;
    const nx = x + Math.cos(angle) * dist;
    const nz = z + Math.sin(angle) * dist;
    if (!_isSolid(nx, nz, colliders, radius)) return [nx, nz];
  }
  return null;
}

// Clear-check combining building colliders, SOLID_COLLIDERS props, and NPC separation.
function isSpawnClear(x, y, z, radius, colliders) {
  if (_isSolid(x, z, colliders, radius)) return false;
  for (const entry of (window.SOLID_COLLIDERS || [])) {
    const b = entry.box;
    if (x + radius > b.min.x && x - radius < b.max.x &&
        z + radius > b.min.z && z - radius < b.max.z) return false;
  }
  for (const npc of (window.ALL_NPCS || [])) {
    if (Math.hypot(npc.group.position.x - x, npc.group.position.z - z) < radius) return false;
  }
  return true;
}

// Pick a random point inside a specific INTERIOR_SPAWN_ZONE; returns {x,y,z} or null.
function _spawnInZone(zone, colliders) {
  if (zone.skipCollision) {
    for (let i = 0; i < 30; i++) {
      const x = zone.xMin + Math.random() * (zone.xMax - zone.xMin);
      const z = zone.zMin + Math.random() * (zone.zMax - zone.zMin);
      // Even in skip-collision rooms, avoid stacking with existing NPCs
      let tooClose = false;
      for (const npc of (window.ALL_NPCS || [])) {
        if (Math.hypot(npc.group.position.x - x, npc.group.position.z - z) < 1.4) {
          tooClose = true; break;
        }
      }
      if (!tooClose) return { x, y: zone.y, z };
    }
    const x = zone.xMin + Math.random() * (zone.xMax - zone.xMin);
    const z = zone.zMin + Math.random() * (zone.zMax - zone.zMin);
    return { x, y: zone.y, z };
  }
  for (let i = 0; i < 200; i++) {
    const x = zone.xMin + Math.random() * (zone.xMax - zone.xMin);
    const z = zone.zMin + Math.random() * (zone.zMax - zone.zMin);
    if (isSpawnClear(x, zone.y, z, 1.2, colliders)) return { x, y: zone.y, z };
  }
  return null;
}
