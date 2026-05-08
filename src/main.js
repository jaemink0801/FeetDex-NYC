import * as THREE from 'three';

// Build marker so we can confirm the latest code is actually loaded.
// If you see an old build number in the console, your browser is caching JS.
console.log('%c[FeetDex] BUILD 2026-05-07g — banner removed',
  'color:#44ff88;font-weight:bold');

// Cache-bust: ?v=... appended so browsers re-fetch sub-modules when JS changes.
import { InputHandler }                             from './input.js?v=20260507g';
import { Player }                                   from './player.js?v=20260507g';
import { World }                                    from './world.js?v=20260507g';
import { NPCManager }                               from './npc.js?v=20260507g';
import { FeetDex, BOOSTER_DEFS,
         COSMETIC_PRICES, COSMETIC_SHOE_COLORS,
         FEET_CATALOG }                             from './feetdex.js?v=20260507g';
import { UI }                                       from './ui.js?v=20260507g';
import { Audio }                                    from './audio.js?v=20260507g';
import { startRPSChallenge, getRPSNpcData,
         stopRPSChallenge }                         from './minigame.js?v=20260507g';
import { InteractionSystem, CombatEncounter,
         showHUDMessage }                           from './interaction.js?v=20260507g';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');

// ── Three.js core ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 800);

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Camera must be in the scene graph so camera-attached children (the FP
// legs and feet on the player) render in the world. Lighting is owned
// entirely by world.js (setupLighting) — adding lights here too would
// double-expose the whole scene to white.
scene.add(camera);

// ── Core systems ──────────────────────────────────────────────────────────────
const input   = new InputHandler();
const world   = new World(scene);
const feetdex = new FeetDex();
const ui      = new UI();
const npcMgr  = new NPCManager(scene, world.colliders);
npcMgr.addInteriorNpcs(scene, world.interiorNpcSpawns);
const player  = new Player(camera, input, () => Audio.footstep());
player.setFloorFn((x, z, cy) => world.getFloorY(x, z, cy));

const interaction = new InteractionSystem(camera, scene, player);

// ── State ─────────────────────────────────────────────────────────────────────
// 'playing' | 'dialogue' | 'discovery' | 'feetdex' | 'paused' | 'interior' | 'minigame' | 'combat' | 'transitioning'
let state             = 'playing';
let currentInteriorId = null;
let _nearestNPC       = null;  // updated each frame — proximity only
let _activeNPC        = null;  // set when interaction begins, used through dialogue/discovery/minigame
let _mapOpen          = false;

// Expose state, camera, and feetdex (booster set) for cross-module access
window.gameCamera = camera;
window.gameScene  = scene;
window.gameFeetDex = feetdex;
Object.defineProperty(window, 'gameState', { get: () => state });

// ── Fade overlay (created here — not in index.html) ───────────────────────────
const fadeDiv = document.createElement('div');
Object.assign(fadeDiv.style, {
  position: 'fixed', inset: '0', background: '#000', opacity: '0',
  pointerEvents: 'none', zIndex: '500',
  transition: 'opacity 0.35s ease',
});
document.body.appendChild(fadeDiv);

// ── Pointer lock ──────────────────────────────────────────────────────────────
function requestLock() { canvas.requestPointerLock(); }

document.getElementById('lock-overlay').addEventListener('click', requestLock);

let _firstStartShown = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    ui.hideLockOverlay();
    // First time the player actually enters the game — pop the objective
    // tip, then chain into the tutorial's follow-the-arrow hint.
    if (!_firstStartShown) {
      _firstStartShown = true;
      // Defer slightly so the lock-overlay fade doesn't visually race with it
      setTimeout(() => {
        ui.showTip('OBJECTIVE',
          "Discover all <b style=\"color:#FFD700\">18 unique feet</b> across NYC by interacting with <b>characters</b> " +
          "(they look very different from the everyday crowd). " +
          "Fight <b style=\"color:#ff7733\">mythics</b> and <b style=\"color:#ffd700\">legendaries</b> " +
          "and defeat them to claim their feet."
        );
        // After OBJECTIVE is dismissed, show the Feet God's first directive.
        _afterTipCallback = () => {
          if (!tutorial.active) return;
          ui.openFeetGodDialogue(
            "Your first character waits inside the <b>Empire State Building</b> — the tall one straight ahead. Step inside."
          );
        };
      }, 250);
    }
  } else if (!_mapOpen && (state === 'playing' || state === 'interior')) {
    ui.showLockOverlay();
  }
});

// ── Tutorial ──────────────────────────────────────────────────────────────────
// Per-session 6-step linear FSM. Drives the side checklist, the guiding
// arrow, and a few scripted dialogues. Skipping the tutorial is harmless —
// nothing blocks normal play, the steps just won't tick off.
const TUTORIAL_STEPS = [
  { id: 'enter-esb',   label: 'Enter the Empire State Building' },
  { id: 'find-sonion', label: 'Talk to a character inside' },
  { id: 'find-shop',   label: "Open the [M] map to find Morton's Shop" },
  { id: 'talk-morton', label: 'Talk to Morton' },
  { id: 'buy-sprint',  label: 'Buy your first tool' },
];
const ESB_DOOR = { x: 0, z: 8.2 };
const tutorial = {
  active: true,
  stepIdx: 0,
  completed: new Set(),
  isStep(id) { return this.active && TUTORIAL_STEPS[this.stepIdx]?.id === id; },
  advance(id) {
    if (!this.active) return;
    if (this.completed.has(id)) return;
    if (TUTORIAL_STEPS[this.stepIdx]?.id !== id) return; // out-of-order — ignore
    this.completed.add(id);
    Audio.uiClick();
    while (this.stepIdx < TUTORIAL_STEPS.length &&
           this.completed.has(TUTORIAL_STEPS[this.stepIdx].id)) {
      this.stepIdx++;
    }
    this.render();
  },
  finish() {
    this.active = false;
    this.render();
  },
  render() {
    ui.renderTutorial(TUTORIAL_STEPS, this.stepIdx, this.completed, this.active);
  },
};

function _updateTutorial() {
  ui.updateTutorialArrow(false);
  _updateHandPointer();
}

// ── Tutorial hand pointer ─────────────────────────────────────────────────────
// Per-step targets for the big 👇 hand. Each entry is either:
//   { type: 'world', wx, wy, wz }   — projects a world position to screen
//   { type: 'hud',   selector }     — anchors above a fixed HUD element
// After tutorial.active goes false, the hand is permanently hidden.
const HAND_TARGETS = {
  // ESB door — point at the top of the building so it reads "look here"
  // rather than "look at the ground". The roof of ESB is far above ground.
  'enter-esb':   { type: 'world', wx: 0,    wy: 60,  wz: 8.2 },
  // Sonion at the back of the ESB lobby (interior coords ~ world x=2000)
  'find-sonion': { type: 'world', wx: 2000, wy: 2.4, wz: 3 },
  // Find-shop step: point at the minimap so the player notices the map UI
  'find-shop':   { type: 'hud',   selector: '__minimap' },
  // Morton at the back of the shop interior
  'talk-morton': { type: 'world', wx: 3400, wy: 2.4, wz: -4.5 },
  // buy-sprint step uses the shop card pulse highlight — no hand needed.
};

const _handProjVec = new THREE.Vector3();

function _updateHandPointer() {
  if (!tutorial.active) { ui.hideHand(); return; }
  const stepId = TUTORIAL_STEPS[tutorial.stepIdx]?.id;
  const target = HAND_TARGETS[stepId];
  if (!target) { ui.hideHand(); return; }

  if (target.type === 'hud') {
    let rect = null;
    if (target.selector === '__minimap') {
      const can = _mmCan;
      if (can) rect = can.getBoundingClientRect();
    } else {
      const el = document.querySelector(target.selector);
      if (el) rect = el.getBoundingClientRect();
    }
    if (!rect) { ui.hideHand(); return; }
    // If the target is too close to the top of the screen, pop the hand
    // BELOW it (pointing up) instead of off-screen above it.
    if (rect.top < 90) {
      ui.setHandScreenPos(rect.left + rect.width / 2, rect.bottom + 6, 'below');
    } else {
      ui.setHandScreenPos(rect.left + rect.width / 2, rect.top - 6, 'above');
    }
    return;
  }

  // World target — project to screen via the camera
  _handProjVec.set(target.wx, target.wy, target.wz);
  _handProjVec.project(camera);
  const behind = _handProjVec.z > 1;
  if (behind) { ui.hideHand(); return; }
  const sx = (_handProjVec.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-_handProjVec.y * 0.5 + 0.5) * window.innerHeight;
  // Hide if the target is way off-screen — clamping the hand to the edge
  // doesn't communicate direction usefully without an arrow rotation.
  const M = 60;
  if (sx < -M || sx > window.innerWidth + M || sy < -M || sy > window.innerHeight + M) {
    ui.hideHand();
    return;
  }
  ui.setHandScreenPos(sx, sy);
}

// ── Missions ──────────────────────────────────────────────────────────────────

// Missions are populated at bootstrap, but the corner panel is held back
// until the tutorial finishes — first-time players see one thing at a time.
let _missionsRevealed = false;

function _initMissions() {
  feetdex.initMissions();
  if (_missionsRevealed) ui.renderMissions(feetdex.activeMissions);
}

function _revealMissions() {
  _missionsRevealed = true;
  ui.renderMissions(feetdex.activeMissions);
}

function _onCharacterCollected(feetId) {
  if (!_missionsRevealed) return;  // missions stay dormant until tutorial done
  const result = feetdex.resolveMission('find', feetId);
  if (!result) return;
  _celebrateMission(result);
}

function _onNpcDialogueDone(npc) {
  if (!_missionsRevealed) return;
  if (!npc || !npc.feetId) return;
  const result = feetdex.resolveMission('talk', npc.feetId);
  if (!result) return;
  _celebrateMission(result);
}

// Plays the celebration: green-checkmark + feet rain on the row, gold toast,
// then re-renders so the replacement mission slides in.
function _celebrateMission(result) {
  Audio.discover();
  ui.markMissionComplete(result.mission.id, () => {
    ui.renderMissions(feetdex.activeMissions);
    ui.updateGold(feetdex.gold, _nextBoosterTarget());
    if (result.goldAwarded > 0) ui.showGoldToast(result.goldAwarded);
  });
}

// ── UI callbacks ──────────────────────────────────────────────────────────────
ui.onResume = () => {
  state = 'playing';
  ui.closePause();
  requestLock();
};

ui.onOpenFeetDex = () => {
  ui.closePause();
  ui.openFeetDex(feetdex);
  state = 'feetdex';
};

ui.onResetProgress = () => {
  feetdex.reset();
  ui.updateCollection(0, feetdex.total);
  ui.updateGold(feetdex.gold, _nextBoosterTarget());
  _applyEquippedCosmetic();
  feetdex.initMissions();
  if (_missionsRevealed) ui.renderMissions(feetdex.activeMissions);
  ui.closePause();
  state = 'playing';
  requestLock();
};

ui.onVolume = (v) => Audio.setVolume(v);

ui.onWinClose = () => {
  state = 'playing';
  requestLock();
};

ui.onPlayAgain = () => {
  feetdex.reset();
  window.location.reload();
};

// FeetDex close button — ui.js fires its own DOM event; also update state here
document.getElementById('fdex-close-btn').addEventListener('click', () => {
  if (state === 'feetdex') {
    ui.closeFeetDex();
    state = 'playing';
    requestLock();
  }
});

// ── Key handlers ──────────────────────────────────────────────────────────────
function _handleE() {
  // If the legendary hint is up, the first E press just dismisses it.
  if (_dismissLegendaryHint()) return;

  // Feet God dialogue — first E skips typewriter, second E closes + runs cb.
  if (ui.isFeetGodDialogueOpen) {
    const r = ui.advanceFeetGodDialogue();
    if (r === 'done') {
      const cb = _afterTipCallback; _afterTipCallback = null;
      if (cb) cb();
    }
    return;
  }

  // Generic tip overlay (booster how-to, fight tutorial). Dismiss + run
  // any chained callback (e.g., the countdown into a fight).
  if (ui.isTipOpen) {
    ui.hideTip();
    const cb = _afterTipCallback; _afterTipCallback = null;
    if (cb) cb();
    return;
  }

  // Shop overlay: E closes it
  if (state === 'shop') { _closeShop(); _activeNPC = null; return; }
  if (state === 'fleet') { _closeFleet(); _activeNPC = null; return; }

  switch (state) {

    case 'playing':
    case 'interior': {
      // Priority 1: NPC interaction
      if (_nearestNPC) {
        // Morton routes to the shop UI instead of the discovery dialogue flow.
        if (_nearestNPC.feetId === 'shopkeeper_morton') {
          _activeNPC = _nearestNPC;
          Audio.interact();
          _openShop();
          return;
        }
        // Vance routes to the Fleet Feet cosmetic shop UI.
        if (_nearestNPC.feetId === 'shopkeeper_fleetfeet') {
          _activeNPC = _nearestNPC;
          Audio.interact();
          _openFleet();
          return;
        }
        _activeNPC = _nearestNPC;
        if (_activeNPC.rarity === 'legendary') Audio.legendaryFanfare();
        else Audio.interact();

        // For legendary: dlgCount = how many fights they've ALREADY WON
        // against this legendary (0 = haven't beaten them yet, 1 = beat once,
        // 2 = beat twice). The counter only advances on a combat win — losing
        // or retreating from round 1 keeps the player on round 1.
        let dlgCount = 0;
        if (_activeNPC.rarity === 'legendary') {
          dlgCount = _activeNPC.feetCollected
            ? 99
            : feetdex.getLegendaryCount(_activeNPC.name);
        }

        ui.openDialogue(_activeNPC, dlgCount);
        state = 'dialogue';
        _activeNPC.isInDialogue = true;
        return;
      }
      // Priority 2: landmark door
      const door = world.checkDoorProximity(player.position);
      if (door) {
        if (door.action === 'near-entry') _enterLandmark(door.id, door.name);
        else if (door.action === 'near-exit') _exitLandmark();
        return;
      }
      // Priority 3: subway access — pressing E at a station with the
      // MetroCard owned opens the map so the player can pick a destination.
      const station = _nearestSubway();
      if (station && feetdex.hasBooster('metrocard')) {
        Audio.interact();
        _openMap();
        return;
      }
      break;
    }

    case 'dialogue': {
      const result = ui.advanceDialogue();
      _handleDialogueResult(result);
      break;
    }

    case 'discovery': {
      const entry = ui.confirmDiscovery();
      const wasSonion = _activeNPC?.feetId === 'epic_sonion';
      if (entry) {
        const result = feetdex.collect(entry.id);
        if (result.isNew) {
          if (_activeNPC) _activeNPC.feetCollected = true;
          ui.updateCollection(feetdex.count, feetdex.total);
          ui.updateGold(feetdex.gold, _nextBoosterTarget());
          if (result.goldAwarded > 0) {
            Audio.goldKaching();
            ui.showGoldToast(result.goldAwarded);
          }
          // Mission triggers on character discovery.
          _onCharacterCollected(entry.id);
          if (feetdex.isComplete) {
            state = 'playing';
            setTimeout(() => ui.showWinScreen(feetdex), 300);
            return;
          }
        }
      }
      state = 'playing';
      _activeNPC = null;
      requestLock();
      // Tutorial: first foot collected (Sonion). Enable the foot pointer
      // and prompt the player toward Morton's Shop via the map.
      if (wasSonion && tutorial.isStep('find-sonion')) {
        tutorial.advance('find-sonion');
        ui.updateGold(feetdex.gold, _nextBoosterTarget());
        setTimeout(() => {
          ui.openFeetGodDialogue(
            "Each foot you collect earns you <b>gold</b>. " +
            "The big pointing hand next to your gold counter marks your next tool. " +
            "Head to <b>Morton's Shop</b> — open the <b>[M]</b> map to find your way."
          );
        }, 600);
      }
      break;
    }
  }
}

function _handleDialogueResult(result) {
  if (!result || result === 'typing' || result === 'next') return;

  if (result === 'done') {
    ui.closeDialogue();
    state = currentInteriorId ? 'interior' : 'playing';
    if (_activeNPC) {
      // Talk-missions resolve when the player presses past the LAST line
      // of a named scripted civilian.
      _onNpcDialogueDone(_activeNPC);
      _activeNPC.isInDialogue = false;
      _activeNPC._dialogueEndTime = Date.now();
    }
    _activeNPC = null;
    requestLock();
    return;
  }

  if (result === 'discover') {
    const entry = _activeNPC ? feetdex.getEntry(_activeNPC.feetId) : null;
    if (entry && !feetdex.has(entry.id)) {
      ui.closeDialogue();
      ui.showDiscovery(entry, _activeNPC);
      if (_activeNPC.rarity === 'legendary') Audio.legendaryFanfare();
      else Audio.discover();
      state = 'discovery';
    } else {
      // Already collected — just close
      ui.closeDialogue();
      state = 'playing';
      if (_activeNPC) { _activeNPC.isInDialogue = false; _activeNPC._dialogueEndTime = Date.now(); }
      _activeNPC = null;
      requestLock();
    }
    return;
  }

  if (result === 'challenge') {
    ui.closeDialogue();
    if (_activeNPC && feetdex.has(_activeNPC.feetId)) {
      state = 'playing';
      _activeNPC = null;
      requestLock();
      return;
    }
    // Mythic NPCs get real-time combat (with tutorial+countdown wrapper);
    // others get RPS
    if (_activeNPC?.rarity === 'mythic') {
      _startBattle(_activeNPC);
    } else {
      _openMinigame(_activeNPC);
      state = 'minigame';
    }
    return;
  }

  if (result === 'legendary_done') {
    ui.closeDialogue();

    // Already collected? Just close out — no fight, no discovery.
    if (!_activeNPC || _activeNPC.feetCollected || !_activeNPC.feetId) {
      state = 'playing';
      if (_activeNPC) { _activeNPC.isInDialogue = false; _activeNPC._dialogueEndTime = Date.now(); }
      _activeNPC = null;
      requestLock();
      return;
    }

    // Straight to the fight tutorial — the 3-defeat rule lives inside the
    // fight tutorial copy, so there's no separate "you must find me 3 times"
    // popup chained before it.
    _startBattle(_activeNPC);
  }
}

// The Ancient One (secret_rexey) is a physical NPC at a fixed position.
// The secret is discovered by finding the hidden alley — no programmatic unlock needed.
function _checkSecretUnlock() { /* no-op */ }

// ── Morton's Shop ─────────────────────────────────────────────────────────────

// First-visit greeting is always the introduction.
const MORTON_FIRST_LINE =
  "First time, eh? I'm Morton. Whatever's in your pocket, I've got something for it. Work the streets right and you can have it all — just pick what helps you most, right now.";

// Fallback rotating wisdom for return visits when no contextual line fits.
const MORTON_LINES = [
  "Coin you spend twice is coin you don't have.",
  "Cheap thing today, expensive lesson tomorrow.",
  "Money buys time. Time buys money. Pick which way you're going.",
  "Some folks save for the big one. Some grab three small ones. Both work.",
  "Best customers are the patient ones.",
  "Whatever you don't buy is what you keep.",
  "Boosters compound. So do mistakes.",
];
let _mortonVisits = 0;

// Pick a context-aware greeting if the player's current state suggests one.
// Falls back to a rotating one-liner.
function _mortonGreeting() {
  if (_mortonVisits === 0) { _mortonVisits++; return MORTON_FIRST_LINE; }
  _mortonVisits++;

  const gold      = feetdex.gold;
  const ownedN    = feetdex.boosters.size;
  const totalN    = BOOSTER_DEFS.length;
  const target    = _nextBoosterTarget();

  // Highest-priority observations — only one fires per visit.
  if (ownedN >= totalN) {
    return "You bought it all. Smart spender.";
  }
  if (gold === 0) {
    return "Window-shopping is fine. Come back when you've got coins.";
  }
  if (ownedN === 0 && gold >= 50) {
    return "Sitting on coin like a hen on an egg, eh? Money in your pocket isn't earning you anything.";
  }
  if (target && target.diff <= 0 && ownedN < totalN) {
    return `${target.name} is in reach. Your call.`;
  }
  if (target && target.diff > 0 && target.diff <= 20) {
    return `${target.diff} short of the ${target.name}. Almost there.`;
  }
  if (gold >= 480 && !feetdex.hasBooster('ancient_tracker')) {
    return "20 short of the Tracker. Hold tight — that one pays itself back.";
  }
  // Fallback: rotate the generic wisdom lines
  return MORTON_LINES[(_mortonVisits - 2) % MORTON_LINES.length];
}

// Next-cheapest unowned booster + how much more gold the player needs.
// Returns { name, diff } or null if everything's owned.
function _nextBoosterTarget() {
  const unowned = BOOSTER_DEFS.filter(b => !feetdex.hasBooster(b.id));
  if (unowned.length === 0) return null;
  unowned.sort((a, b) => a.price - b.price);
  // Show the cheapest one not yet owned
  const next = unowned[0];
  return { name: next.name, diff: Math.max(0, next.price - feetdex.gold) };
}
function _mortonOnPurchase(boosterId) {
  const lines = {
    sprint_feet:    "Smart pick. Your legs will thank you.",
    radar:          "Now you'll see who's worth your time.",
    armor:          "Keeps you upright. Stay upright, stay rich.",
    sword:          "Hits like a paid invoice. They'll feel that one.",
    ancient_tracker:"Big spender. Hope you know what you're doing — that star is patient but the gold isn't.",
  };
  return lines[boosterId] ?? "Smart pick.";
}

function _openShop() {
  // Tutorial path: first time meeting Morton — run a 3-line teaching arc,
  // award a 20g visit bonus, then open the shop with Sprint Feet highlighted.
  if (tutorial.isStep('talk-morton')) {
    tutorial.advance('talk-morton');
    document.exitPointerLock();
    state = 'shop';
    _runMortonTutorial();
    return;
  }
  document.exitPointerLock();
  state = 'shop';
  ui.openShop(feetdex, BOOSTER_DEFS, _onBuyBooster, _mortonGreeting());
}

function _runMortonTutorial() {
  const lines = [
    {
      title: 'MORTON',
      body: "First time, eh? I'm Morton. Save up the <b style=\"color:#FFD700\">gold</b> those feet pay you and you can buy <b>tools</b> here — " +
            "stuff that helps you find feet faster, or fight bosses tougher. The richer you are, the more options you've got."
    },
    {
      title: 'MORTON',
      body: "Catch is, you can't buy them all. Every coin you spend on one tool is a coin you can't spend on another. " +
            "Fancy folks call that <b>opportunity cost</b>. You don't need every tool to win this — " +
            "pick the ones that fit your style and skip the rest. <i>Spend wisely.</i>"
    },
    {
      title: 'MORTON',
      body: "On the house — here's <b style=\"color:#FFD700\">+20g</b> for visiting. " +
            "Try the <b>Sprint Feet</b>. They'll save you a lot of walking."
    },
  ];
  let i = 0;
  // _mortonVisits ticks once for the first-visit greeting that we replaced.
  _mortonVisits = 1;
  const showNext = () => {
    if (i >= lines.length) {
      // Award visit bonus then open the shop.
      feetdex.gold += 20;
      feetdex.totalEarned += 20;
      ui.updateGold(feetdex.gold, _nextBoosterTarget());
      ui.showGoldToast(20);
      Audio.goldKaching();
      ui.openShop(
        feetdex, BOOSTER_DEFS, _onBuyBooster,
        "Try the Sprint Feet — they're glowing for a reason.",
        'sprint_feet'
      );
      return;
    }
    const line = lines[i++];
    ui.showTip(line.title, line.body);
    _afterTipCallback = showNext;
  };
  showNext();
}
function _closeShop() {
  ui.closeShop();
  state = currentInteriorId ? 'interior' : 'playing';
  requestLock();
}

// ── Fleet Feet (cosmetic shop) ──────────────────────────────────────────────
const VANCE_FIRST_LINE =
  "Yo welcome to FLEET FEET! Found a cool pair out there? Bring 'em here, I'll get you the skin so you can rock 'em. Cosmetic only — no boost, all flex.";

const VANCE_LINES = [
  "Drip is forever. Boosters wear off, fits don't.",
  "You earned it once. Spend it on something fun.",
  "Smart spender saves first, then treats themselves.",
  "Customize loud — the streets remember.",
  "If you bought every skin you'd be broke. So pick one.",
  "Every gold here is gold you DIDN'T put toward tools.",
];
let _vanceVisits = 0;

function _vanceGreeting() {
  if (_vanceVisits === 0) { _vanceVisits++; return VANCE_FIRST_LINE; }
  _vanceVisits++;

  const collectedN = feetdex.count;
  const ownedSkins = feetdex.cosmetics.size;
  const equipped   = feetdex.equippedCosmetic;
  const boostersN  = feetdex.boosters.size;
  const totalBoost = BOOSTER_DEFS.length;

  if (collectedN === 0) {
    return "Empty FeetDex, empty rack. Go find some pairs first.";
  }
  if (boostersN === 0 && feetdex.gold >= 50) {
    return "Hey — Morton's right there. Maybe grab a tool before you blow it on shoes?";
  }
  if (boostersN < Math.ceil(totalBoost / 2) && feetdex.totalSpentSkins > feetdex.totalSpentTools) {
    return "Looking sharp, but you're spending more on drip than tools. That's a vibe, not a strategy.";
  }
  if (equipped) {
    const e = feetdex.getEntry(equipped);
    if (e) return `Those ${e.name.toUpperCase()} look CLEAN on you.`;
  }
  if (ownedSkins === 0 && feetdex.gold >= 10) {
    return "First skin's the hardest to commit to. Just do it.";
  }
  return VANCE_LINES[(_vanceVisits - 2) % VANCE_LINES.length];
}

function _openFleet() {
  document.exitPointerLock();
  state = 'fleet';
  ui.openFleetFeetShop(feetdex, FEET_CATALOG, COSMETIC_PRICES,
    _onBuyCosmetic, _onEquipCosmetic, _onUnequipCosmetic,
    _vanceGreeting());
}
function _closeFleet() {
  ui.closeFleetFeetShop();
  state = currentInteriorId ? 'interior' : 'playing';
  requestLock();
}

function _applyEquippedCosmetic() {
  const id = feetdex.equippedCosmetic;
  player.setShoeColor(id ? (COSMETIC_SHOE_COLORS[id] ?? null) : null);
}

function _onBuyCosmetic(footId) {
  const entry = feetdex.getEntry(footId);
  if (!entry || !feetdex.has(footId) || feetdex.hasCosmetic(footId)) return;
  const price = COSMETIC_PRICES[entry.rarity] ?? 0;
  if (!feetdex.trySpend(price, 'skins')) return;
  feetdex.giveCosmetic(footId);
  feetdex.equipCosmetic(footId);
  _applyEquippedCosmetic();
  ui.updateGold(feetdex.gold, _nextBoosterTarget());
  ui.setFleetLine(`That's a ${price}⛂ statement piece. Looks fresh.`);
  Audio.uiClick();
  ui.refreshFleetFeetShop?.();
}

function _onEquipCosmetic(footId) {
  if (!feetdex.hasCosmetic(footId)) return;
  feetdex.equipCosmetic(footId);
  _applyEquippedCosmetic();
  Audio.uiClick();
  ui.refreshFleetFeetShop?.();
}

function _onUnequipCosmetic() {
  feetdex.unequipCosmetic();
  _applyEquippedCosmetic();
  Audio.uiClick();
  ui.refreshFleetFeetShop?.();
}
// One- or two-sentence how-to tips, shown once on first purchase.
const BOOSTER_TIPS = {
  sprint_feet:    { title: 'SPRINT FEET',
    body: 'Hold <b>SHIFT</b> while moving to break into a sprint.' },
  radar:          { title: 'RADAR',
    body: 'All <b>common</b>, <b>rare</b>, and <b>epic</b> characters now show as colored dots on both the minimap and the <b>[M]</b> map — anywhere in the city.' },
  compass:        { title: 'COMPASS',
    body: 'Press <b>[C]</b> and the needle twitches toward powerful presences — <b>mythics</b> and <b>legendaries</b>. It can\'t tell you who or how far, just which way.' },
  armor:          { title: 'ARMOR',
    body: 'Your HP is doubled and you take 30% less damage from mythics and legendaries.' },
  sword:          { title: 'SWORD',
    body: 'Your punches now deal double damage, knock enemies back hard, and strike twice as fast.' },
  metrocard:      { title: 'METROCARD',
    body: 'Walk up to any subway station and press <b>[E]</b> to ride. The map opens with the <b style="color:#0066ff">blue dots</b> — click any station and the subway takes you straight there. Hop between stations to cross the city in seconds.' },
  ancient_tracker:{ title: 'ANCIENT TRACKER',
    body: 'A gold <b>★</b> now marks The Ancient One\'s hideout — just follow it.' },
};
let _shownTips = new Set();
let _afterTipCallback = null;     // run after the tip is dismissed (countdown chains here)

function _showBoosterTip(id) {
  if (_shownTips.has(id)) return false;
  _shownTips.add(id);
  const t = BOOSTER_TIPS[id];
  if (!t) return false;
  ui.showTip(t.title, t.body);
  return true;
}

function _onBuyBooster(id) {
  const def = BOOSTER_DEFS.find(b => b.id === id);
  if (!def || feetdex.hasBooster(id)) return;
  if (!feetdex.trySpend(def.price, 'tools')) return;
  feetdex.giveBooster(id);
  ui.updateGold(feetdex.gold, _nextBoosterTarget());
  ui.setShopLine(_mortonOnPurchase(id));
  Audio.uiClick();

  // Tutorial finale: buying Sprint Feet during the tutorial suppresses the
  // normal how-to tip and runs Morton's farewell + Tutorial Complete +
  // (after the celebration fades) the optional-missions introduction.
  if (id === 'sprint_feet' && tutorial.isStep('buy-sprint')) {
    tutorial.advance('buy-sprint');
    setTimeout(() => {
      if (state === 'shop') _closeShop();
      ui.showTip('MORTON',
        "Good luck out there, kid. Go discover all you can in the feet world."
      );
      _afterTipCallback = () => {
        tutorial.finish();
        ui.showTutorialComplete();
        Audio.gameWin();
        // After the 4.2s celebration overlay clears, fire the held-back
        // Sprint Feet how-to tip, then introduce missions.
        setTimeout(() => {
          _showBoosterTip('sprint_feet');
          _afterTipCallback = () => {
            ui.openFeetGodDialogue(
              "Optional <b>missions</b> have appeared in the corner — three at a time. " +
              "Some send you searching for a <b>character</b> in a landmark; others ask you to <b>chat with locals</b> who'll teach you about business and the city. " +
              "They're side gold, not required to win — skip any you don't feel like. Finish one and a fresh mission slides in."
            );
            _afterTipCallback = () => { _revealMissions(); };
          };
        }, 4500);
      };
    }, 350);
    return;
  }

  // Close the shop and pop the how-to tip so the player understands what
  // they just bought before re-entering the world.
  setTimeout(() => {
    if (state === 'shop') _closeShop();
    _showBoosterTip(id);
  }, 350);
}

// Legendary 3-meeting hint — shown once, the first time the player finishes a
// legendary's 1st-encounter dialogue. Stays visible until the player presses E
// to dismiss it (no auto-timeout — the 3-meeting rule is too important to risk
// the player not reading it).
let _legendaryHintShown = false;
function _showLegendaryHint() {
  if (_legendaryHintShown) return;
  _legendaryHintShown = true;
  const el = document.getElementById('legendary-hint');
  if (!el) return;
  el.classList.add('active');
}
let _afterLegendaryHint = null;
function _dismissLegendaryHint() {
  const el = document.getElementById('legendary-hint');
  if (!el || !el.classList.contains('active')) return false;
  el.classList.remove('active');
  const cb = _afterLegendaryHint; _afterLegendaryHint = null;
  if (cb) cb();
  return true;
}

function _relocateLegendary(npc) {
  const RANGE    = 80;
  const MIN_DIST = 50;
  for (let t = 0; t < 300; t++) {
    const x = (Math.random() - 0.5) * RANGE * 2;
    const z = (Math.random() - 0.5) * RANGE * 2;
    if (Math.hypot(x - npc.group.position.x, z - npc.group.position.z) < MIN_DIST) continue;
    const inBuilding = world.colliders.some(
      b => x > b.min.x + 1 && x < b.max.x - 1 && z > b.min.z + 1 && z < b.max.z - 1,
    );
    if (!inBuilding) {
      npc.group.position.set(x, npc.group.position.y, z);
      return;
    }
  }
}

function _handleF() {
  if (state === 'playing' || state === 'interior') {
    Audio.uiClick();
    ui.openFeetDex(feetdex);
    state = 'feetdex';
  } else if (state === 'feetdex') {
    Audio.uiClick();
    ui.closeFeetDex();
    state = (currentInteriorId ? 'interior' : 'playing');
    requestLock();
  }
}

function _handleESC() {
  if (_mapOpen) { _closeMap(); return; }
  if (state === 'playing' || state === 'interior') {
    Audio.uiClick();
    ui.openPause(feetdex);
    state = 'paused';
  } else if (state === 'paused') {
    Audio.uiClick();
    ui.closePause();
    state = (currentInteriorId ? 'interior' : 'playing');
    requestLock();
  } else if (state === 'shop') {
    _closeShop();
    _activeNPC = null;
  } else if (state === 'fleet') {
    _closeFleet();
    _activeNPC = null;
  } else if (ui.isCompassPickerOpen) {
    ui.closeCompassPicker();
    requestLock();
  } else if (state === 'minigame') {
    _closeMinigame();
    state = 'playing';
    _activeNPC = null;
    requestLock();
  } else if (state === 'combat') {
    _closeCombat();
    state = 'playing';
    _activeNPC = null;
    requestLock();
  }
}

// ── Landmark transitions ──────────────────────────────────────────────────────
function _fadeTransition(halfDuration, midCallback) {
  return new Promise(resolve => {
    fadeDiv.style.transition = `opacity ${halfDuration / 1000}s ease`;
    fadeDiv.style.opacity = '1';
    setTimeout(() => {
      midCallback();
      requestAnimationFrame(() => {
        fadeDiv.style.opacity = '0';
        setTimeout(resolve, halfDuration);
      });
    }, halfDuration);
  });
}

function _enterLandmark(id, name) {
  if (state === 'transitioning') return;
  state = 'transitioning';
  Audio.interact();
  _fadeTransition(350, () => {
    const interior = world.getInterior(id);
    if (!interior) { state = 'playing'; return; }
    player.position.copy(interior.playerSpawn);
    if (interior.entryYaw !== undefined) player.yaw = interior.entryYaw;
    player.pitch = 0;
    player.velocity.set(0, 0, 0);
    currentInteriorId = id;
    state = 'interior';
  }).then(() => {
    requestLock();
    // Tutorial: entered the Empire State Building.
    if (id === 'esb' && tutorial.isStep('enter-esb')) {
      tutorial.advance('enter-esb');
      setTimeout(() => {
        ui.openFeetGodDialogue(
          "Buildings you can enter glow <b>yellow</b> on the map and minimap — same with their doors. " +
          "Find the character inside this landmark. Walk up to them and press <b>E</b> to speak."
        );
      }, 450);
    }
  });
}

function _exitLandmark() {
  if (state === 'transitioning') return;
  state = 'transitioning';
  Audio.interact();
  const interior = world.getInterior(currentInteriorId);
  _fadeTransition(350, () => {
    if (interior?.cityReturnPos) player.position.copy(interior.cityReturnPos);
    if (interior?.exitYaw !== undefined) player.yaw = interior.exitYaw;
    player.pitch = 0;
    player.velocity.set(0, 0, 0);
    currentInteriorId = null;
    state = 'playing';
  }).then(() => requestLock());
}

// ── Minigame ──────────────────────────────────────────────────────────────────
function _openMinigame(npc) {
  document.exitPointerLock(); // free the cursor so buttons are clickable
  const rpsData = getRPSNpcData(npc.feetId);
  startRPSChallenge(
    { name: rpsData.displayName, winLine: rpsData.winLine, lossLine: rpsData.lossLine },
    () => handleMinigameResult(npc, true),
    () => handleMinigameResult(npc, false),
  );
}

function _closeMinigame() {
  stopRPSChallenge(); // clears timers + removes 'active' class
}

// Tutorial copy shown once each, before the first mythic and first legendary
// fights. Mirrored shape — same first sentence, second sentence specific.
// theme drives the popup color (orange / gold).
const FIGHT_TUTORIAL = {
  mythic: {
    title: 'MYTHIC FIGHT',
    theme: 'mythic',
    body : '<b>WASD</b> to move. <b>LEFT CLICK</b> to punch. Step away to dodge.<br/><br/>' +
           'Sword and Armor make this much easier.',
  },
  legendary: {
    title: 'LEGENDARY FIGHT',
    theme: 'legendary',
    body : '<b>WASD</b> to move. <b>LEFT CLICK</b> to punch. Step away to dodge.<br/><br/>' +
           'Legendaries are stronger — find and defeat this one three times to claim their feet.',
  },
};
let _firstMythicFought    = false;
let _firstLegendaryFought = false;

// Public entry point used in place of the old _openCombat. Handles
// tutorials, the 3-2-1 countdown, and only THEN starts the fight.
// Player and NPC stay at the exact positions they had when dialogue ended —
// no spacing teleport — so the countdown→fight transition feels grounded.
function _startBattle(npc) {
  const tutorialKey = npc.rarity === 'legendary' ? 'legendary'
                    : npc.rarity === 'mythic'    ? 'mythic'
                    : null;
  const showTutorial =
    (tutorialKey === 'mythic'    && !_firstMythicFought)    ||
    (tutorialKey === 'legendary' && !_firstLegendaryFought);

  const proceed = () => _runCountdownAndFight(npc);

  if (showTutorial && tutorialKey) {
    if (tutorialKey === 'mythic')    _firstMythicFought    = true;
    if (tutorialKey === 'legendary') _firstLegendaryFought = true;
    const t = FIGHT_TUTORIAL[tutorialKey];
    ui.showTip(t.title, t.body, t.theme);
    state = 'pre-combat';                   // E dismissal handled by the
    _afterTipCallback = proceed;            // generic-tip dismiss path
    // Pointer lock stays — the tutorial accepts only E, no mouse needed,
    // and re-acquiring lock from a timer would fail browser security checks.
  } else {
    proceed();
  }
}

function _runCountdownAndFight(npc) {
  state = 'pre-combat';
  // Pointer lock stays — see comment in _startBattle.
  const SEQ = ['3', '2', '1', 'FIGHT!'];
  let step = 0;
  const advance = () => {
    if (step >= SEQ.length) {
      ui.hideCountdown();
      _openCombat(npc);
      return;
    }
    const txt = SEQ[step];
    ui.showCountdown(txt);
    if (txt === 'FIGHT!') Audio.countdownGo();
    else                  Audio.countdownTick();
    step++;
    setTimeout(advance, txt === 'FIGHT!' ? 500 : 750);
  };
  advance();
}

function _openCombat(npc) {
  state = 'combat';
  Audio.startBattleMusic();
  const combat = new CombatEncounter(
    npc, player, camera,
    () => { interaction.clearCombat(); Audio.stopBattleMusic(); handleMinigameResult(npc, true);  },
    () => { interaction.clearCombat(); Audio.stopBattleMusic(); handleMinigameResult(npc, false); }
  );
  interaction.setCombat(combat);
}

function _closeCombat() {
  interaction.clearCombat();
  Audio.stopBattleMusic();
}

// Exported so Prompt 05 mini-game modules can call back into the state machine.
export function handleMinigameResult(npc, won) {
  _closeMinigame();
  if (won) {
    Audio.gameWin();

    // Legendaries take THREE wins. We bump the counter HERE on a confirmed
    // win — losing or retreating from round 1 leaves the counter at 0, so
    // the player has to actually defeat them to advance past each round.
    if (npc.rarity === 'legendary') {
      const count = feetdex.incrementLegendary(npc.name);   // 1, 2, or 3 after this win
      if (count >= 3) {
        // Final fight — claim their feet
        const entry = feetdex.getEntry(npc.feetId);
        if (entry && !feetdex.has(entry.id)) {
          ui.showDiscovery(entry, npc);
          Audio.legendaryFanfare();
          _activeNPC = npc;
          state = 'discovery';
          return;
        }
      } else {
        // Rounds 1 and 2 — name the legendary explicitly and tell the
        // player how many more wins they need before claiming the feet.
        _relocateLegendary(npc);
        const remaining = 3 - count;
        const plural    = remaining === 1 ? 'time' : 'times';
        showHUDMessage(
          `${npc.name.toUpperCase()} defeated — ${count} of 3. They've slipped away. Beat them ${remaining} more ${plural} to claim their feet.`,
          4200,
        );
      }
    } else {
      // Mythic / RPS-class: single victory = discovery. Flash a quick
      // named-defeat banner before the discovery overlay so the player
      // sees who they just took down.
      showHUDMessage(`${npc.name.toUpperCase()} defeated!`, 1800);
      const entry = feetdex.getEntry(npc.feetId);
      if (entry && !feetdex.has(entry.id)) {
        ui.showDiscovery(entry, npc);
        _activeNPC = npc;
        state = 'discovery';
        return;
      }
    }
  } else {
    Audio.gameLose();
    _triggerDeath();
    return;
  }
  state = 'playing';
  _activeNPC = null;
  requestLock();
}

// ── Death + respawn ──────────────────────────────────────────────────────────
function _triggerDeath() {
  state = 'transitioning';
  document.exitPointerLock();
  const overlay = document.getElementById('death-overlay');
  // Combat-death penalty — lose 20% of current gold. Reinforces the
  // opportunity-cost lesson: "if I'd bought Armor first, I'd still have these
  // coins." The toast briefly tells the player how much they lost.
  const lost = feetdex.penalizeOnDeath();
  ui.updateGold(feetdex.gold, _nextBoosterTarget());
  if (lost > 0) {
    setTimeout(() => ui.showGoldToast(-lost), 600);
  }
  if (overlay) {
    const sub = overlay.querySelector('p');
    if (sub) sub.textContent = lost > 0
      ? `Lost ${lost} gold. Returning to spawn...`
      : 'Returning to spawn...';
    overlay.classList.add('active');
  }
  setTimeout(() => {
    if (overlay) overlay.classList.remove('active');
    player.respawn();
    currentInteriorId = null;
    _activeNPC = null;
    state = 'playing';
    requestLock();
  }, 1800);
}

// ── Full-screen map (M key) ───────────────────────────────────────────────────
const MAP_SIZE  = 500;
const MAP_WORLD = 265;
const MAP_SCALE = MAP_SIZE / (MAP_WORLD * 2);

function _wm(wx, wz) {
  return [(wx + MAP_WORLD) * MAP_SCALE, (wz + MAP_WORLD) * MAP_SCALE];
}

// Filled-rectangle landmarks (rendered as colored boxes on the map)
const _MAP_LMS = [
  // Water bodies (drawn first so other markers paint on top)
  { wx:-195, wz:  0, hw:45, hd:240, color:'#1A3A5C', label:'Hudson River' },
  { wx: 197, wz:  0, hw:48, hd:240, color:'#1A3050', label:'East River' },
  // Roosevelt Island
  { wx: 180, wz:-10, hw: 4, hd: 30, color:'#3A6B35', label:'Roosevelt Is.' },
  // Major landmarks
  { wx:  0, wz:  5, hw:14, hd:12, color:'#85B7EB', label:'Empire State' },
  { wx: 40, wz: 27, hw:12, hd:12, color:'#B5D4F4', label:'Chrysler' },
  { wx: 10, wz:-25, hw:18, hd:12, color:'#FAC775', label:'Times Square' },
  { wx:-15, wz: 60, hw:22, hd:18, color:'#97C459', label:'Central Park' },
  { wx:-60, wz:-80, hw:10, hd:32, color:'#B4B2A9', label:'Brooklyn Bridge' },
  { wx: 75, wz:-30, hw:11, hd: 6, color:'#C4A87A', label:'Grand Central' },
  { wx:-25, wz:-110, hw:10, hd:10, color:'#C8C0A8', label:'Columbus Circle' },
  { wx:  0, wz:-165, hw:22, hd:20, color:'#9BBBD4', label:'Lower Manhattan' },
];

// Linear features (rendered as thin lines — fences along rivers)
const _MAP_LINES = [
  { x1:-143, z1:-232, x2:-143, z2:232, color:'#888888', label:'Hudson Fence' },
  { x1: 143, z1:-232, x2: 143, z2:232, color:'#888888', label:'East Fence' },
];

// Morton's Shop and Fleet Feet are both treated as landmarks — colored markers
// + always-visible labels, just like ESB / Chrysler / GCT. Their world
// positions depend on which generic buildings got tagged 'Shop' / 'Bodega' at
// world-build time, so we look them up from world.buildingLabels at startup.
(function registerShopLandmarks() {
  const shop = world.buildingLabels.find(l => l.name === 'Shop');
  if (shop) {
    _MAP_LMS.push({
      wx: shop.wx, wz: shop.wz, hw: 6, hd: 6,
      color: '#E91E63',                // brass — matches Morton's signage
      label: "Morton's Shop",
    });
  }
  const fleet = world.buildingLabels.find(l => l.name === 'Bodega');
  if (fleet) {
    _MAP_LMS.push({
      wx: fleet.wx, wz: fleet.wz, hw: 6, hd: 6,
      color: '#FF6633',                // brand orange — matches FLEET FEET signage
      label: 'Fleet Feet',
    });
  }
})();

const _MAP_NPC_COLORS = { common:'#6699cc', rare:'#55aa55', epic:'#aa55cc', mythic:'#ff7733' };

// Map marker palette. Landmarks (ESB, Chrysler, etc.) keep their distinct
// per-landmark colors via the _MAP_LMS table. Every accessible enterable
// building (Cafe / Diner / Gym / ... / Barbershop / Morton's Shop) uses one
// uniform yellow so the map reads cleanly: "anything yellow = a place you
// can walk into."
// Per-building distinct colors so the player can match a dot on the map
// back to its name in the legend. Hues span the wheel; saturated values
// stay readable on the dark map background.
const BUILDING_COLORS = {
  'Cafe':         '#FF3B3B',  // bright red
  'Diner':        '#FF8C00',  // dark orange
  'Gym':          '#39FF14',  // neon green
  'Office':       '#1E90FF',  // dodger blue
  'Bar':          '#FF1493',  // deep pink
  'Gallery':      '#FFD700',  // gold
  'Laundry':      '#00FFFF',  // cyan
  'Pharmacy':     '#9ACD32',  // yellow-green
  'Hotel Lobby':  '#9370DB',  // medium purple
  'KFC':          '#FFA07A',  // light salmon
  'Museum':       '#48D1CC',  // medium turquoise
  'Barbershop':   '#A52A2A',  // brown
  // Shop + Bodega are rendered as named landmarks (Morton's, Fleet Feet)
  // and don't appear in the generic-building loop.
};
const BUILDING_COLOR_FALLBACK = '#bbbbbb';
function _buildingColor(name) {
  return BUILDING_COLORS[name] ?? BUILDING_COLOR_FALLBACK;
}

// Radar blink helper — flashes ON for ~250ms, OFF for ~150ms (≈2.5 Hz)
// so the booster reads as a "live" radar ping rather than steady dots.
// Kept for any future per-rarity flash effects but no longer drives the radar.
function _radarBlinkOn() {
  return (Math.floor(performance.now() / 200) % 2) === 0;
}

// Radar dot colour by rarity — common/rare/epic only. Mythics & legendaries
// belong to the compass; secret belongs to the Ancient Tracker.
const RADAR_DOT_COLORS = {
  common: '#6699cc',
  rare:   '#55cc66',
  epic:   '#aa55cc',
};
function _isRadarVisibleNpc(npc) {
  if (!npc.feetId) return false;
  if (npc.feetCollected) return false;
  if (npc.feetId === 'shopkeeper_morton') return false;
  if (npc.feetId === 'shopkeeper_fleetfeet') return false;
  return RADAR_DOT_COLORS.hasOwnProperty(npc.rarity);
}

// Radar position helper — interior NPCs live at huge x coords (1800-5400)
// because their interiors are placed far from the city. Project them back to
// their landmark's city-side door so the radar (a 30m radius around the
// player) can include them. Returns null if no match (NPC not in any known
// interior region — shouldn't happen for feet-collecting NPCs).
function _radarProjectedPos(npc) {
  const px = npc.group.position.x;
  const pz = npc.group.position.z;
  if (Math.abs(px) < 1500) return { x: px, z: pz };  // outdoor
  for (const interior of Object.values(world.interiors)) {
    const sp = interior.playerSpawn;
    if (!sp) continue;
    if (Math.abs(px - sp.x) < 14 && Math.abs(pz - sp.z) < 14) {
      return { x: interior.cityReturnPos.x, z: interior.cityReturnPos.z };
    }
  }
  return null;
}

// Returns the position to use when drawing the player on the map.
// While inside an interior, project to the city-side door so the green arrow
// shows where the player will pop out, instead of vanishing off-map at the
// far-away interior coordinates (e.g. world x=1800 for Grand Central).
function _displayPos() {
  if (currentInteriorId && world.interiors[currentInteriorId]?.cityReturnPos) {
    return world.interiors[currentInteriorId].cityReturnPos;
  }
  return player.position;
}

// Anchor-aware label placer. Tries center first, then sweeps a ring of
// candidates outward. Whenever the chosen position is offset from the
// anchor, a thin leader line is drawn from the label back to the dot so the
// player can tell which marker the label belongs to.
function _drawMapLabel(ctx, text, x, y, color, fontPx, placed) {
  ctx.font = `bold ${fontPx}px "Courier New"`;
  const w = ctx.measureText(text).width + 6;
  const h = fontPx + 4;

  const _hits = (cx, cy) => {
    if (cx - w / 2 < 4 || cx + w / 2 > MAP_SIZE - 4) return true;   // off-canvas
    if (cy - h / 2 < 4 || cy + h / 2 > MAP_SIZE - 4) return true;
    const box = { x: cx - w / 2, y: cy - h / 2, w, h };
    for (const p of placed) {
      if (box.x < p.x + p.w && box.x + box.w > p.x &&
          box.y < p.y + p.h && box.y + box.h > p.y) return true;
    }
    return false;
  };
  const _draw = (cx, cy) => {
    // Leader line — drawn first so the text background fills over it
    if (cx !== x || cy !== y) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    }
    placed.push({ x: cx - w / 2, y: cy - h / 2, w, h });
    // Text shadow + fill
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillText(text, cx + 1, cy + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  };

  // Spiral of candidate offsets from the anchor. Steps outward in rings so
  // the closest non-overlapping spot wins.
  const STEP_Y = h + 3;
  const STEP_X = h + 3;
  const candidates = [
    [0, 0],
    // ring 1
    [0, -STEP_Y], [0, STEP_Y],
    [-(w / 2 + STEP_X), 0], [w / 2 + STEP_X, 0],
    // ring 2
    [0, -STEP_Y * 2], [0, STEP_Y * 2],
    [-(w / 2 + STEP_X), -STEP_Y], [w / 2 + STEP_X, -STEP_Y],
    [-(w / 2 + STEP_X),  STEP_Y], [w / 2 + STEP_X,  STEP_Y],
    // ring 3
    [0, -STEP_Y * 3], [0, STEP_Y * 3],
    [-(w / 2 + STEP_X * 2), 0], [w / 2 + STEP_X * 2, 0],
    [-(w / 2 + STEP_X), -STEP_Y * 2], [w / 2 + STEP_X, -STEP_Y * 2],
    [-(w / 2 + STEP_X),  STEP_Y * 2], [w / 2 + STEP_X,  STEP_Y * 2],
    // ring 4
    [0, -STEP_Y * 4], [0, STEP_Y * 4],
    [-(w / 2 + STEP_X * 2), -STEP_Y], [w / 2 + STEP_X * 2, -STEP_Y],
    [-(w / 2 + STEP_X * 2),  STEP_Y], [w / 2 + STEP_X * 2,  STEP_Y],
  ];
  for (const [dx, dy] of candidates) {
    const cx = x + dx, cy = y + dy;
    if (!_hits(cx, cy)) { _draw(cx, cy); return true; }
  }
  // Last resort — place at center even if overlapping
  _draw(x, y);
  return true;
}

const mapOverlay = document.getElementById('map-overlay');
const staticCtx  = document.getElementById('map-can-static').getContext('2d');
const dynCtx     = document.getElementById('map-can-dyn').getContext('2d');

let _mapBlink         = true;
let _mapBlinkInterval = null;

// Persistent click-region table for the M-key map. Filled by _drawStaticMap;
// consumed by the canvas mousedown handler when the player clicks a subway
// icon while holding the MetroCard.
let _mapStationHits = [];

function _drawStaticMap() {
  _mapStationHits = [];
  staticCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  staticCtx.fillStyle = '#1c1c1c';
  staticCtx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  staticCtx.fillStyle = '#3a3a3a';
  for (const box of world.colliders) {
    const [x1, z1] = _wm(box.min.x, box.min.z);
    const [x2, z2] = _wm(box.max.x, box.max.z);
    staticCtx.fillRect(x1, z1, Math.max(1, x2 - x1), Math.max(1, z2 - z1));
  }

  staticCtx.globalAlpha = 0.65;
  for (const lm of _MAP_LMS) {
    const [x1, z1] = _wm(lm.wx - lm.hw, lm.wz - lm.hd);
    const [x2, z2] = _wm(lm.wx + lm.hw, lm.wz + lm.hd);
    staticCtx.fillStyle = lm.color;
    staticCtx.fillRect(x1, z1, x2 - x1, z2 - z1);
  }
  staticCtx.globalAlpha = 1;

  // River fence lines
  staticCtx.lineWidth   = 2;
  for (const ln of _MAP_LINES) {
    const [x1, z1] = _wm(ln.x1, ln.z1);
    const [x2, z2] = _wm(ln.x2, ln.z2);
    staticCtx.strokeStyle = ln.color;
    staticCtx.beginPath();
    staticCtx.moveTo(x1, z1);
    staticCtx.lineTo(x2, z2);
    staticCtx.stroke();
  }

  staticCtx.textAlign = 'center';
  staticCtx.textBaseline = 'middle';
  const placedLabels = [];

  // Pre-register the yellow enterable-building dots as exclusion zones so
  // landmark labels are guaranteed to skip past them and stay readable.
  for (const lbl of world.buildingLabels) {
    if (lbl.name === 'Shop' || lbl.name === 'Bodega') continue; // landmarks
    const [bx, bz] = _wm(lbl.wx, lbl.wz);
    const r = 6;                           // dot radius + small clearance
    placedLabels.push({ x: bx - r, y: bz - r, w: r * 2, h: r * 2 });
  }

  // Landmarks: name labels drawn ON the map. The placer sweeps a ring of
  // offsets and uses the first non-overlapping position; a thin leader line
  // connects the label back to the marker if it had to nudge away.
  // Hero shops (Morton's, Fleet Feet) get top priority + gold/bigger text
  // so they always pop on a dense map. Then water labels go LAST so they
  // don't claim central real estate.
  const _isHero  = (l) => l.label === "Morton's Shop" || l.label === 'Fleet Feet';
  const _isWater = (l) => /River/.test(l.label);
  const _byImportance = [..._MAP_LMS].sort((a, b) => {
    if (_isHero(a)  !== _isHero(b))  return _isHero(a)  ? -1 : 1; // heroes first
    if (_isWater(a) !== _isWater(b)) return _isWater(a) ?  1 : -1; // water last
    return (b.hw + b.hd) - (a.hw + a.hd);
  });
  for (const lm of _byImportance) {
    const [cx, cz] = _wm(lm.wx, lm.wz);
    if (_isHero(lm)) {
      _drawMapLabel(staticCtx, lm.label, cx, cz, '#FFD700', 13, placedLabels);
    } else {
      _drawMapLabel(staticCtx, lm.label, cx, cz, '#ffffff', 11, placedLabels);
    }
  }

  // Enterable buildings — colored dot + name label drawn directly on the
  // map. Names use the anti-overlap label placer so they read cleanly even
  // when buildings cluster. Shop + Bodega are landmarks, drawn elsewhere.
  for (const lbl of world.buildingLabels) {
    if (lbl.name === 'Shop' || lbl.name === 'Bodega') continue;
    const [bx, bz] = _wm(lbl.wx, lbl.wz);
    staticCtx.fillStyle = _buildingColor(lbl.name);
    staticCtx.beginPath();
    staticCtx.arc(bx, bz, 4.0, 0, Math.PI * 2);
    staticCtx.fill();
    staticCtx.strokeStyle = 'rgba(0,0,0,.6)';
    staticCtx.lineWidth = 1.2;
    staticCtx.stroke();
  }
  // Pass 2: building names. Drawn AFTER landmarks so landmark text wins the
  // prime central spots; the algorithm pushes building labels to whatever
  // free space remains. Smaller font keeps the map readable.
  for (const lbl of world.buildingLabels) {
    if (lbl.name === 'Shop' || lbl.name === 'Bodega') continue;
    const [bx, bz] = _wm(lbl.wx, lbl.wz);
    _drawMapLabel(staticCtx, lbl.name, bx, bz, '#e6e6e6', 9, placedLabels);
  }
  // Hero treatment for Morton's Shop + Fleet Feet — bigger marker with a
  // glowing gold ring so they read as "important" at a glance even on a
  // dense map. The labels are already drawn by the landmark loop above.
  for (const heroLbl of ["Morton's Shop", 'Fleet Feet']) {
    const lm = _MAP_LMS.find(l => l.label === heroLbl);
    if (!lm) continue;
    const [cx, cz] = _wm(lm.wx, lm.wz);
    staticCtx.save();
    staticCtx.shadowColor = '#FFD700';
    staticCtx.shadowBlur  = 10;
    staticCtx.fillStyle   = lm.color;
    staticCtx.beginPath();
    staticCtx.arc(cx, cz, 9, 0, Math.PI * 2);
    staticCtx.fill();
    staticCtx.shadowBlur  = 0;
    staticCtx.lineWidth   = 2.4;
    staticCtx.strokeStyle = '#FFD700';
    staticCtx.stroke();
    staticCtx.restore();
  }

  // Subway stations — small blue dots with a white center. Each gets a
  // street-name label placed via the same anti-overlap algorithm so the
  // names won't collide with each other, with landmark labels, or with the
  // yellow building dots that were pre-registered earlier.
  const stations = window.SUBWAY_STATIONS || [];
  // Pass 1: dots + hit regions + dot-as-exclusion-zone for any later labels
  for (const st of stations) {
    const [sx, sz] = _wm(st.x, st.z);
    staticCtx.fillStyle = '#0033CC';
    staticCtx.beginPath();
    staticCtx.arc(sx, sz, 6, 0, Math.PI * 2);
    staticCtx.fill();
    staticCtx.fillStyle = '#fff';
    staticCtx.beginPath();
    staticCtx.arc(sx, sz, 2, 0, Math.PI * 2);
    staticCtx.fill();
    _mapStationHits.push({ st, cx: sx, cy: sz, r: 10 });
    placedLabels.push({ x: sx - 8, y: sz - 8, w: 16, h: 16 });
  }
  // Pass 2: street-name labels in subway blue
  for (const st of stations) {
    const [sx, sz] = _wm(st.x, st.z);
    _drawMapLabel(staticCtx, st.name, sx, sz, '#88ccff', 11, placedLabels);
  }
}

function _drawDynamicMap() {
  dynCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

  // Radar booster: steady rarity-colored dots for every uncollected
  // common/rare/epic character anywhere in the city. Indoor characters are
  // projected back to their landmark's city-side door.
  if (feetdex.hasBooster('radar')) {
    for (const npc of (window.ALL_NPCS || [])) {
      if (!_isRadarVisibleNpc(npc)) continue;
      const projected = _radarProjectedPos(npc);
      if (!projected) continue;
      const [nx, nz] = _wm(projected.x, projected.z);
      dynCtx.fillStyle = RADAR_DOT_COLORS[npc.rarity];
      dynCtx.beginPath();
      dynCtx.arc(nx, nz, 4, 0, Math.PI * 2);
      dynCtx.fill();
      dynCtx.strokeStyle = 'rgba(0,0,0,0.7)';
      dynCtx.lineWidth = 1.2;
      dynCtx.stroke();
    }
  }

  const dp = _displayPos();
  const [px, pz] = _wm(dp.x, dp.z);
  dynCtx.save();
  dynCtx.translate(px, pz);
  dynCtx.rotate(-player.yaw);
  dynCtx.fillStyle = '#44ff88';
  dynCtx.beginPath();
  dynCtx.moveTo(0, -10);
  dynCtx.lineTo(7, 9);
  dynCtx.lineTo(-7, 9);
  dynCtx.closePath();
  dynCtx.fill();
  dynCtx.strokeStyle = 'rgba(0,0,0,0.7)';
  dynCtx.lineWidth = 1.5;
  dynCtx.stroke();
  dynCtx.restore();
  // Indoor indicator: dashed circle around the arrow
  if (currentInteriorId) {
    dynCtx.save();
    dynCtx.strokeStyle = '#44ff88';
    dynCtx.lineWidth = 1.4;
    dynCtx.setLineDash([3, 3]);
    dynCtx.beginPath();
    dynCtx.arc(px, pz, 14, 0, Math.PI * 2);
    dynCtx.stroke();
    dynCtx.restore();
  }
}

// MetroCard click-to-teleport. Click in the M-key map bounds is converted to
// canvas coords and tested against the persisted station hit-regions.
const _mapDynCanvas = document.getElementById('map-can-dyn');
if (_mapDynCanvas) {
  _mapDynCanvas.addEventListener('click', (e) => {
    if (!_mapOpen) return;
    if (!feetdex.hasBooster('metrocard')) return;
    const rect = _mapDynCanvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width)  * MAP_SIZE;
    const cy = ((e.clientY - rect.top)  / rect.height) * MAP_SIZE;
    for (const hit of _mapStationHits) {
      const dx = cx - hit.cx, dy = cy - hit.cy;
      if (dx * dx + dy * dy <= hit.r * hit.r) {
        // Don't teleport to the station the player is standing at
        const me = _displayPos();
        if (Math.hypot(me.x - hit.st.x, me.z - hit.st.z) < 4) return;
        _teleportToStation(hit.st);
        return;
      }
    }
  });
  // Make the dynamic canvas pick up clicks even though it sits over the
  // static one (the dyn canvas is on top in the DOM).
  _mapDynCanvas.style.pointerEvents = 'auto';
  _mapDynCanvas.style.cursor = 'pointer';
}

function _teleportToStation(station) {
  if (currentInteriorId) {
    // First exit the interior so the player isn't teleported while inside
    currentInteriorId = null;
  }
  // Place the player a couple units south of the station so they aren't
  // standing inside the entrance graphic
  player.position.set(station.x, 0, station.z + 2.5);
  player.velocity.set(0, 0, 0);
  player.yaw = Math.PI;        // face north
  _closeMap(true);
  Audio.uiClick();
}

// Side-panel legend — only swatches that aren't labeled directly on the
// map. Subway stations are now labeled by street name on the map itself.
function _renderMapLegend() {
  const el = document.getElementById('map-legend');
  if (!el) return;
  const rows = [];
  // With every name now drawn directly on the map, the legend only needs
  // to call out the symbols a player can't read at a glance.
  rows.push('<h4>KEY</h4>');
  rows.push(
    `<div class="lg-row">` +
    `  <span class="lg-swatch circle" style="background:#FFD700; box-shadow:0 0 6px rgba(255,215,0,.8);"></span>` +
    `  <span class="lg-text">★ Shops (Morton's, Fleet Feet)</span>` +
    `</div>`,
    `<div class="lg-row">` +
    `  <span class="lg-swatch circle" style="background:#0033CC;"></span>` +
    `  <span class="lg-text">Subway station</span>` +
    `</div>`,
    `<div class="lg-row">` +
    `  <span class="lg-swatch circle" style="background:#888;"></span>` +
    `  <span class="lg-text">Other accessible building</span>` +
    `</div>`,
  );

  if (feetdex.hasBooster('radar')) {
    rows.push('<h4 style="margin-top:10px;">RADAR</h4>');
    rows.push(
      `<div class="lg-row">` +
      `  <span class="lg-swatch circle" style="background:${RADAR_DOT_COLORS.common};"></span>` +
      `  <span class="lg-text">Common</span>` +
      `</div>`,
      `<div class="lg-row">` +
      `  <span class="lg-swatch circle" style="background:${RADAR_DOT_COLORS.rare};"></span>` +
      `  <span class="lg-text">Rare</span>` +
      `</div>`,
      `<div class="lg-row">` +
      `  <span class="lg-swatch circle" style="background:${RADAR_DOT_COLORS.epic};"></span>` +
      `  <span class="lg-text">Epic</span>` +
      `</div>`,
    );
  }
  if (feetdex.hasBooster('ancient_tracker')) {
    rows.push(
      `<div class="lg-row">` +
      `  <span class="lg-swatch" style="background:#FFD700; clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);"></span>` +
      `  <span class="lg-text">Ancient One (Tracker)</span>` +
      `</div>`,
    );
  }
  el.innerHTML = rows.join('');
}

function _openMap() {
  _mapOpen = true;
  _drawStaticMap();
  _renderMapLegend();
  document.exitPointerLock();
  mapOverlay.classList.add('active');
  _mapBlink = true;
  _mapBlinkInterval = setInterval(() => { _mapBlink = !_mapBlink; }, 800);
}

function _closeMap(attemptLock = false) {
  _mapOpen = false;
  mapOverlay.classList.remove('active');
  clearInterval(_mapBlinkInterval);
  _mapBlinkInterval = null;
  if (state === 'playing' || state === 'interior') {
    ui.showLockOverlay();   // always show — pointer lock re-acquired on next click
    if (attemptLock) requestLock();
  }
}

function _handleM() {
  if (_mapOpen) { _closeMap(true); return; }  // M key is a valid lock gesture
  if (state === 'playing' || state === 'interior') {
    _openMap();
    if (tutorial.isStep('find-shop')) tutorial.advance('find-shop');
  }
}

// ── Corner minimap ────────────────────────────────────────────────────────────
const _mmDiv = document.createElement('div');
Object.assign(_mmDiv.style, { position:'fixed', top:'50px', right:'16px', pointerEvents:'none', zIndex:'10' });
const _mmCan = document.createElement('canvas');
_mmCan.width = _mmCan.height = 160;
Object.assign(_mmCan.style, { border:'1px solid rgba(255,255,255,.25)', background:'rgba(0,0,0,.55)', display:'block' });
_mmDiv.appendChild(_mmCan);
document.body.appendChild(_mmDiv);
const _mmCtx = _mmCan.getContext('2d');
const _MM = 160, _MMH = 200, _MMS = _MM / (_MMH * 2);

function _mm(wx, wz) { return [(wx + _MMH) * _MMS, (wz + _MMH) * _MMS]; }

const _MM_COLS = { common:'#6699cc', rare:'#55aa55', epic:'#aa55cc', mythic:'#ff7733', secret:'#c8a45a' };

function _drawMinimap(elapsed) {
  _mmCtx.clearRect(0, 0, _MM, _MM);
  _mmCtx.fillStyle = 'rgba(0,0,0,.6)';
  _mmCtx.fillRect(0, 0, _MM, _MM);

  // Water bodies — drawn first so colliders paint on top
  _mmCtx.fillStyle = '#1A3A5C';
  {
    const [hx1, hz1] = _mm(-240, -240);
    const [hx2, hz2] = _mm(-150,  240);
    _mmCtx.fillRect(hx1, hz1, hx2 - hx1, hz2 - hz1);
  }
  _mmCtx.fillStyle = '#1A3050';
  {
    const [ex1, ez1] = _mm(150, -240);
    const [ex2, ez2] = _mm(245,  240);
    _mmCtx.fillRect(ex1, ez1, ex2 - ex1, ez2 - ez1);
  }
  // Roosevelt Island
  _mmCtx.fillStyle = '#3A6B35';
  {
    const [rx1, rz1] = _mm(176, -40);
    const [rx2, rz2] = _mm(184,  20);
    _mmCtx.fillRect(rx1, rz1, rx2 - rx1, rz2 - rz1);
  }
  // River fence lines
  _mmCtx.strokeStyle = '#cccccc';
  _mmCtx.lineWidth = 1;
  for (const fx of [-143, 143]) {
    const [fx1, fz1] = _mm(fx, -232);
    const [fx2, fz2] = _mm(fx,  232);
    _mmCtx.beginPath();
    _mmCtx.moveTo(fx1, fz1);
    _mmCtx.lineTo(fx2, fz2);
    _mmCtx.stroke();
  }

  _mmCtx.fillStyle = '#555';
  for (const box of world.colliders) {
    const [x1, z1] = _mm(box.min.x, box.min.z);
    const [x2, z2] = _mm(box.max.x, box.max.z);
    _mmCtx.fillRect(x1, z1, Math.max(1, x2 - x1), Math.max(1, z2 - z1));
  }

  // Enterable building markers — colored per type. Labels avoid overlap and
  // alternate above/below the dot based on the building's z parity.
  _mmCtx.textAlign = 'center';
  _mmCtx.textBaseline = 'middle';
  const placedMM = [];
  // Pass 1: dots (cheap, always render). Shop and Bodega are rendered as
  // landmark markers below (Morton's Shop + Fleet Feet), so skip them here.
  for (const lbl of world.buildingLabels) {
    if (lbl.name === 'Shop' || lbl.name === 'Bodega') continue;
    const [bx, bz] = _mm(lbl.wx, lbl.wz);
    _mmCtx.fillStyle = _buildingColor(lbl.name);
    _mmCtx.beginPath();
    _mmCtx.arc(bx, bz, 3.0, 0, Math.PI * 2);
    _mmCtx.fill();
    _mmCtx.strokeStyle = 'rgba(0,0,0,0.6)';
    _mmCtx.lineWidth = 1;
    _mmCtx.stroke();
  }
  // Subway station icons — minimal blue dots
  for (const st of (window.SUBWAY_STATIONS || [])) {
    const [sx, sz] = _mm(st.x, st.z);
    _mmCtx.fillStyle = '#0033CC';
    _mmCtx.beginPath();
    _mmCtx.arc(sx, sz, 4, 0, Math.PI * 2);
    _mmCtx.fill();
    _mmCtx.fillStyle = '#fff';
    _mmCtx.beginPath();
    _mmCtx.arc(sx, sz, 1.8, 0, Math.PI * 2);
    _mmCtx.fill();
  }

  // Morton's Shop — always-visible brass landmark marker (always orient the
  // player toward where they can spend their gold).
  const shopLM = _MAP_LMS.find(l => l.label === "Morton's Shop");
  if (shopLM) {
    const [smx, smz] = _mm(shopLM.wx, shopLM.wz);
    _mmCtx.fillStyle = '#E91E63';
    _mmCtx.beginPath();
    _mmCtx.arc(smx, smz, 4.5, 0, Math.PI * 2);
    _mmCtx.fill();
    _mmCtx.strokeStyle = '#660014';
    _mmCtx.lineWidth = 1.4;
    _mmCtx.stroke();
  }
  // Fleet Feet — always-visible orange landmark marker
  const fleetLM = _MAP_LMS.find(l => l.label === 'Fleet Feet');
  if (fleetLM) {
    const [fmx, fmz] = _mm(fleetLM.wx, fleetLM.wz);
    _mmCtx.fillStyle = '#FF6633';
    _mmCtx.beginPath();
    _mmCtx.arc(fmx, fmz, 4.5, 0, Math.PI * 2);
    _mmCtx.fill();
    _mmCtx.strokeStyle = '#3a1a00';
    _mmCtx.lineWidth = 1.4;
    _mmCtx.stroke();
  }

  // Radar booster: steady rarity-colored dots for every uncollected
  // common/rare/epic character anywhere in the city.
  if (feetdex.hasBooster('radar')) {
    for (const npc of (window.ALL_NPCS || [])) {
      if (!_isRadarVisibleNpc(npc)) continue;
      const projected = _radarProjectedPos(npc);
      if (!projected) continue;
      const [nx, nz] = _mm(projected.x, projected.z);
      _mmCtx.fillStyle = RADAR_DOT_COLORS[npc.rarity];
      _mmCtx.beginPath();
      _mmCtx.arc(nx, nz, 2.4, 0, Math.PI * 2);
      _mmCtx.fill();
    }
  }

  // Ancient Tracker: persistent star at the alley dead end so the player
  // can navigate to The Ancient One's location even from across the map.
  if (feetdex.hasBooster('ancient_tracker') && !feetdex.has('secret_rexey')) {
    const [sx, sz] = _mm(-117, -228);
    _mmCtx.save();
    _mmCtx.fillStyle = '#FFD700';
    _mmCtx.shadowColor = 'rgba(255,215,0,0.9)';
    _mmCtx.shadowBlur = 6;
    // Five-pointed star
    _mmCtx.translate(sx, sz);
    _mmCtx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 6 : 2.4;
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      i === 0 ? _mmCtx.moveTo(x, y) : _mmCtx.lineTo(x, y);
    }
    _mmCtx.closePath();
    _mmCtx.fill();
    _mmCtx.restore();
  }

  // Player arrow — uses cityReturnPos when inside an interior so the arrow
  // is always visible on the map.
  const dp = _displayPos();
  const [px, pz] = _mm(dp.x, dp.z);
  _mmCtx.save();
  _mmCtx.translate(px, pz);
  _mmCtx.rotate(-player.yaw);
  _mmCtx.fillStyle = '#44ff88';
  _mmCtx.beginPath(); _mmCtx.moveTo(0, -7); _mmCtx.lineTo(5, 6); _mmCtx.lineTo(-5, 6); _mmCtx.closePath(); _mmCtx.fill();
  _mmCtx.strokeStyle = 'rgba(0,0,0,0.7)';
  _mmCtx.lineWidth = 1.2;
  _mmCtx.stroke();
  _mmCtx.restore();
  // Pulsing dashed ring to indicate "you're inside a building"
  if (currentInteriorId) {
    _mmCtx.save();
    _mmCtx.strokeStyle = '#44ff88';
    _mmCtx.lineWidth = 1.2;
    _mmCtx.setLineDash([3, 3]);
    _mmCtx.beginPath();
    _mmCtx.arc(px, pz, 10, 0, Math.PI * 2);
    _mmCtx.stroke();
    _mmCtx.restore();
  }
}

// ── Compass booster ──────────────────────────────────────────────────────────
// Compass no longer picks a building. While active, it auto-points at the
// nearest live mythic or legendary NPC (uncollected/undefeated), without
// disclosing who it is or how far. "Vague" by design — direction only.
let _compassActive = false;

function _handleC() {
  if (!feetdex.hasBooster('compass')) return;
  if (state !== 'playing' && state !== 'interior') return;
  _compassActive = !_compassActive;
}

function _findNearestBoss(from) {
  const npcs = window.ALL_NPCS || [];
  let best = null, bestDist = Infinity;
  for (const npc of npcs) {
    if (npc.rarity !== 'mythic' && npc.rarity !== 'legendary') continue;
    if (npc.feetCollected) continue;
    // For legendaries, track the same NPC across the 3-encounter arc — only
    // hide once the feet are fully collected (feetCollected handles that).
    const dx = npc.group.position.x - from.x;
    const dz = npc.group.position.z - from.z;
    const d  = Math.hypot(dx, dz);
    if (d < bestDist) { bestDist = d; best = npc; }
  }
  return best;
}

function _updateCompassPointer() {
  if (!feetdex.hasBooster('compass') || !_compassActive) {
    ui.updateCompassPointer(false);
    return;
  }
  const from = currentInteriorId
    ? (world.interiors[currentInteriorId]?.cityReturnPos ?? player.position)
    : player.position;
  const target = _findNearestBoss(from);
  if (!target) { ui.updateCompassPointer(false); return; }
  const dx = target.group.position.x - from.x;
  const dz = target.group.position.z - from.z;
  const targetAngle = Math.atan2(dx, -dz);
  const dirDeg = (targetAngle - player.yaw) * 180 / Math.PI;
  // Pass null distance so the UI shows "??" instead of metres — vague intent.
  ui.updateCompassPointer(true, '???', null, dirDeg);
}

// ── Ancient Tracker compass ──────────────────────────────────────────────────
// World position of The Ancient One's alley dead-end (matches buildSecretAlley)
const _ANCIENT_POS = { x: -117, z: -228 };
function _updateTrackerCompass() {
  if (!feetdex.hasBooster('ancient_tracker') || feetdex.has('secret_rexey')) {
    ui.updateTrackerCompass(false);
    return;
  }
  const from = currentInteriorId
    ? (world.interiors[currentInteriorId]?.cityReturnPos ?? player.position)
    : player.position;
  const dx = _ANCIENT_POS.x - from.x;
  const dz = _ANCIENT_POS.z - from.z;
  const dist = Math.hypot(dx, dz);
  // Direction: bearing in screen-degrees. atan2 returns radians; we want
  // the SVG arrow (which points up at 0°) to rotate toward the target
  // relative to the player's facing.
  const targetAngle = Math.atan2(dx, -dz);          // world bearing
  const relative    = targetAngle - player.yaw;      // relative to player's heading
  const dirDeg      = (relative * 180 / Math.PI);
  ui.updateTrackerCompass(true, dist, dirDeg);
}

// ── Interact hint ─────────────────────────────────────────────────────────────
const SUBWAY_PROX = 4;        // metres — show subway hint when this close

function _nearestSubway() {
  let best = null, bestDist = SUBWAY_PROX;
  for (const st of (window.SUBWAY_STATIONS || [])) {
    const d = Math.hypot(st.x - player.position.x, st.z - player.position.z);
    if (d < bestDist) { bestDist = d; best = st; }
  }
  return best;
}

function _updateHint() {
  if (state !== 'playing' && state !== 'interior') {
    ui.clearInteractHint();
    return;
  }
  if (_nearestNPC) {
    ui.setInteractHint(`[E] Talk to ${_nearestNPC.name}`);
    return;
  }
  const door = world.checkDoorProximity(player.position);
  if (door) {
    ui.setInteractHint(door.action === 'near-entry' ? `[E] Enter ${door.name}` : '[E] Exit building');
    return;
  }
  // Subway station — E opens the map and lets the player pick a destination
  // if they own the MetroCard. Without it, the hint nudges them to buy one.
  const station = _nearestSubway();
  if (station) {
    ui.setInteractHint(feetdex.hasBooster('metrocard')
      ? '[E] Ride subway'
      : '[E] Need MetroCard to ride the subway');
    return;
  }
  ui.clearInteractHint();
}

// ── Game loop ─────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let _npcFrame = 0;

function gameLoop() {
  requestAnimationFrame(gameLoop);

  const dt      = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;
  const locked  = document.pointerLockElement === canvas;

  if (locked && (state === 'playing' || state === 'interior' || state === 'combat')) {
    player.update(dt, world.getSolids(currentInteriorId));
  }

  _npcFrame ^= 1;
  if (_npcFrame === 0) _nearestNPC = npcMgr.update(elapsed, player.position);

  interaction.update(dt);

  if (input.justPressed('KeyE'))   _handleE();
  if (input.justPressed('KeyF'))   _handleF();
  if (input.justPressed('KeyM'))   _handleM();
  if (input.justPressed('KeyC'))   _handleC();
  if (input.justPressed('Escape')) _handleESC();

  _updateHint();
  _updateTrackerCompass();
  _updateCompassPointer();
  _updateTutorial();
  _drawMinimap(elapsed);
  if (_mapOpen) _drawDynamicMap();

  renderer.render(scene, camera);
  input.endFrame();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
ui.updateCollection(feetdex.count, feetdex.total);
ui.updateGold(feetdex.gold, _nextBoosterTarget());
_applyEquippedCosmetic();
tutorial.render();
_initMissions();
gameLoop();
