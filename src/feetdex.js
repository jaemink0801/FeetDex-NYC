// Collection tracker — persists via localStorage

// Gold awarded by rarity when a foot is collected. Drives the Morton's Shop
// economy. Numbers tuned so the total possible income (980g if every foot is
// found) covers all 5 boosters (770g) with a slim ~210g buffer — every
// purchase decision has real opportunity cost.
export const GOLD_VALUES = {
  common:    10,
  rare:      20,
  epic:      50,
  mythic:    100,
  legendary: 200,
  secret:    500,   // Ancient One pays back the Tracker exactly
};

// Cosmetic-foot prices at Fleet Feet. Exactly equal to the gold reward the
// player earned for finding that foot — buying a skin "spends back" what you
// earned, which is the cleanest opportunity-cost framing.
export const COSMETIC_PRICES = {
  common:    10,
  rare:      20,
  epic:      50,
  mythic:    100,
  legendary: 200,
  secret:    500,
};

// Shoe color the player wears when they equip a given cosmetic. Mirrors the
// NPC's own shoe color so "wearing Messi's feet" actually looks like Messi.
export const COSMETIC_SHOE_COLORS = {
  common_samurai:    0x7a5533,
  common_bill:       0x999999,
  common_gymrat:     0x39ff14,
  common_50shades:   0x555555,
  common_happyfeet:  0xf5a623,
  rare_trex:         0x3d5a38,
  rare_gramma:       0xffb3c1,
  rare_colonel:      0x1a1a1a,
  rare_cheerleader:  0xf5f5f5,
  epic_lebron:       0x552583,
  epic_sonion:       0x000000,
  epic_sydney:       0x222222,
  mythic_clav:       0x0d0d0d,
  mythic_patapim:    0xff69b4,
  mythic_messi:      0xffd700,
  legendary_margot:  0xf4b8c1,
  legendary_bigfoot: 0x5c3d11,
  secret_rexey:      0x8B6914,
};

// Mission pool — half ask the player to find a specific (un-named)
// character; half ask them to chat with a named scripted NPC who teaches a
// budgeting/business concept or shares an NYC business fun-fact. The system
// keeps `activeMissions` of size MISSIONS_ACTIVE_MAX = 3; finishing one draws
// a fresh mission from the pool to take its slot.
//
// Find-character missions never name the target. Reward = 'mystery' (?-badge,
// awarded gold randomized 5–25g on completion). Restricted to common/rare/
// epic only — mythics and legendaries belong to the compass arc.
//
// Talk missions reward exactly 20g. The named NPC is placed in npc.js and has
// a fixed dialogue script in ui.js (MISSION_NPC_SCRIPTS).
export const MISSIONS_ACTIVE_MAX = 3;
export const MISSION_POOL = [
  // ── FIND-CHARACTER (target = feetId; reveal omits the name) ────────────
  { id: 'find_grand_central', type: 'find', target: 'common_samurai',
    label: 'A figure trains alone in the shadows of Grand Central.',
    reward: 'mystery' },
  { id: 'find_1wtc',          type: 'find', target: 'common_50shades',
    label: 'Someone in a sharp suit paces the One World Trade lobby.',
    reward: 'mystery' },
  { id: 'find_gym',           type: 'find', target: 'common_gymrat',
    label: 'Someone is putting in serious work at the gym.',
    reward: 'mystery' },
  { id: 'find_pharmacy',      type: 'find', target: 'rare_gramma',
    label: 'A familiar face works the counter at the pharmacy.',
    reward: 'mystery' },
  { id: 'find_kfc',           type: 'find', target: 'rare_colonel',
    label: 'An icon awaits at the chicken joint.',
    reward: 'mystery' },
  { id: 'find_hotel',         type: 'find', target: 'epic_lebron',
    label: 'A hoops legend has checked into a midtown hotel.',
    reward: 'mystery' },

  // ── TALK-NPC (target = scripted mission-NPC feetId) ─────────────────────
  { id: 'talk_martin_ts',     type: 'talk', target: 'npc_martin_ts',
    label: 'Find Martin in Times Square.',                     reward: 20 },
  { id: 'talk_grace_office',  type: 'talk', target: 'npc_grace_office',
    label: 'Grace works in the Office. Hear her out.',         reward: 20 },
  { id: 'talk_lucy_cafe',     type: 'talk', target: 'npc_lucy_cafe',
    label: 'Stop by the Cafe — ask Lucy about the bell.',      reward: 20 },
  { id: 'talk_hassan_diner',  type: 'talk', target: 'npc_hassan_diner',
    label: 'Hassan runs the Diner. He has a story for you.',   reward: 20 },
  { id: 'talk_mei_museum',    type: 'talk', target: 'npc_mei_museum',
    label: 'Visit Mei at the Museum — she has a story about NYC advertising.', reward: 20 },
  { id: 'talk_carter_gallery',type: 'talk', target: 'npc_carter_gallery',
    label: 'Carter runs the Gallery. He has thoughts on art.', reward: 20 },
];

// Boosters available at Morton's Shop. ID matches the FeetDex.boosters set.
// Ordered cheapest-first so the HUD "next target" hint always points at the
// most affordable unowned tool.
export const BOOSTER_DEFS = [
  { id:'sprint_feet',    name:'Sprint Feet',    price:20,
    desc:'Unlocks sprint when holding Shift.' },
  { id:'metrocard',      name:'MetroCard',      price:50,
    desc:'Walk to a subway station and press [E] to ride.' },
  { id:'compass',        name:'Compass',        price:80,
    desc:'Press [C] for a needle that twitches toward mythics & legendaries.' },
  { id:'armor',          name:'Armor',          price:100,
    desc:'Doubles HP and reduces damage taken in combat.' },
  { id:'radar',          name:'Radar',          price:100,
    desc:'Common, rare, and epic characters show on minimap and map.' },
  { id:'sword',          name:'Sword',          price:100,
    desc:'Doubles damage, knockback, and your attack speed in combat.' },
  { id:'ancient_tracker',name:'Ancient Tracker',price:500,
    desc:'A guiding star points to The Ancient One.' },
];

export const FEET_CATALOG = [
  // Common (5)
  { id:'common_samurai',    rarity:'common',    name:"The Lost Samurai's Feet" },
  { id:'common_bill',       rarity:'common',    name:"Bill Beister's Ginger Feet" },
  { id:'common_gymrat',     rarity:'common',    name:"Gym Rat's Grimy Feet" },
  { id:'common_50shades',   rarity:'common',    name:"50 Shades of Feet" },
  { id:'common_happyfeet',  rarity:'common',    name:"Happy Feet" },
  // Rare (4)
  { id:'rare_trex',         rarity:'rare',      name:"T-Rex Feet (?)" },
  { id:'rare_gramma',       rarity:'rare',      name:"Gramma Tilda's Feet" },
  { id:'rare_colonel',      rarity:'rare',      name:"Colonel's Toe Lickin' Good Feet" },
  { id:'rare_cheerleader',  rarity:'rare',      name:"Cheerleader Captain's Feet" },
  // Epic (3)
  { id:'epic_lebron',       rarity:'epic',      name:"LeBron James' Feet" },
  { id:'epic_sonion',       rarity:'epic',      name:"Sonion's Crine-Forged Feet" },
  { id:'epic_sydney',       rarity:'epic',      name:"Sydney Sweeney's (Stunt Double's) Feet" },
  // Mythic (3)
  { id:'mythic_clav',       rarity:'mythic',    name:"Clav's Framemog Feet" },
  { id:'mythic_patapim',    rarity:'mythic',    name:"Feet of Brr Brr Patapim" },
  { id:'mythic_messi',      rarity:'mythic',    name:"Messi's Golden Foot" },
  // Legendary (2)
  { id:'legendary_margot',  rarity:'legendary', name:"Feet of Margot Robbie" },
  { id:'legendary_bigfoot', rarity:'legendary', name:"Big Foot's Big Foot" },
  // Secret (1)
  { id:'secret_rexey',      rarity:'secret',    name:"The Ancient One's Cure-It-All Feet of Ancient Wonders" },
];

// localStorage isn't strictly required — on file:// in some browsers it
// throws on access (private mode, restrictive storage policy). Wrap so the
// game still boots on those configurations.
function _safeClearStorage() {
  try { localStorage.clear(); } catch { /* storage unavailable — fine */ }
}

export class FeetDex {
  constructor() {
    _safeClearStorage();
    this._collected = new Set();
    this.legendaryEncounters = {
      'Margot Robbie':  0,
      'Bigfoot (Gary)': 0,
    };

    // Morton's Shop economy state — per-run, never persisted
    this.gold = 0;
    this.boosters = new Set();      // booster ids owned
    this.cosmetics = new Set();     // foot ids owned as cosmetic skins (Fleet Feet)
    this.equippedCosmetic = null;   // currently worn foot id (or null = default)

    // Lifetime totals for the end-of-run budgeting portfolio
    this.totalEarned       = 0;     // gold awarded, ever
    this.totalSpentTools   = 0;     // gold spent at Morton's
    this.totalSpentSkins   = 0;     // gold spent at Fleet Feet

    this.total = FEET_CATALOG.length; // 18

    // Mission state — corner-of-screen rotating slate.
    this.activeMissions    = [];        // array of mission objects (size ≤ 3)
    this.completedMissions = new Set(); // mission ids
  }

  // ── Missions ───────────────────────────────────────────────────────────────

  // Select up to MISSIONS_ACTIVE_MAX fresh missions, skipping any whose
  // target is already collected (find) or already completed (any type).
  initMissions() {
    this.activeMissions = [];
    for (let i = 0; i < MISSIONS_ACTIVE_MAX; i++) {
      const m = this._drawNextMission();
      if (m) this.activeMissions.push(m);
    }
  }

  _drawNextMission() {
    const taken     = new Set([...this.completedMissions, ...this.activeMissions.map(m => m.id)]);
    const available = MISSION_POOL.filter(m => {
      if (taken.has(m.id)) return false;
      if (m.type === 'find' && this.has(m.target)) return false;
      return true;
    });
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  // Caller passes (type, feetId). If a matching active mission exists,
  // returns { mission, goldAwarded }; otherwise returns null.
  resolveMission(type, feetId) {
    const idx = this.activeMissions.findIndex(m => m.type === type && m.target === feetId);
    if (idx === -1) return null;
    const mission = this.activeMissions[idx];
    this.completedMissions.add(mission.id);
    // Reward: 20g for talk; randomized 5–25g for "?" find missions.
    const goldAwarded = (mission.reward === 'mystery')
      ? (5 + Math.floor(Math.random() * 21))
      : Number(mission.reward) || 0;
    this.gold       += goldAwarded;
    this.totalEarned += goldAwarded;
    // Replace the slot with a fresh mission from the pool.
    const next = this._drawNextMission();
    if (next) this.activeMissions[idx] = next;
    else      this.activeMissions.splice(idx, 1);
    return { mission, goldAwarded };
  }

  // ── Collection ─────────────────────────────────────────────────────────────

  // Returns { isNew: boolean, goldAwarded: number } so the UI can show a
  // "+N gold" toast on collection.
  collect(id) {
    if (this._collected.has(id)) return { isNew: false, goldAwarded: 0 };
    this._collected.add(id);
    const entry = FEET_CATALOG.find(e => e.id === id);
    const award = entry ? (GOLD_VALUES[entry.rarity] ?? 0) : 0;
    this.gold += award;
    this.totalEarned += award;
    return { isNew: true, goldAwarded: award };
  }

  // Spend gold; returns true on success, false if insufficient.
  // `category` ('tools' | 'skins') feeds the portfolio breakdown.
  trySpend(amount, category = 'tools') {
    if (this.gold < amount) return false;
    this.gold -= amount;
    if (category === 'tools') this.totalSpentTools += amount;
    else if (category === 'skins') this.totalSpentSkins += amount;
    return true;
  }

  // Combat-death penalty: lose 20% of current gold (rounded down).
  penalizeOnDeath() {
    const lost = Math.floor(this.gold * 0.20);
    this.gold = Math.max(0, this.gold - lost);
    return lost;
  }

  hasBooster(id) { return this.boosters.has(id); }
  giveBooster(id) { this.boosters.add(id); }

  hasCosmetic(id) { return this.cosmetics.has(id); }
  giveCosmetic(id) { this.cosmetics.add(id); }
  equipCosmetic(id) { this.equippedCosmetic = id; }
  unequipCosmetic() { this.equippedCosmetic = null; }

  has(id) { return this._collected.has(id); }

  get count() { return this._collected.size; }

  get isComplete() { return this._collected.size >= this.total; }

  getEntry(id) { return FEET_CATALOG.find(e => e.id === id) || null; }

  // ── Legendary encounters ────────────────────────────────────────────────────

  incrementLegendary(npcName) {
    if (!(npcName in this.legendaryEncounters)) this.legendaryEncounters[npcName] = 0;
    this.legendaryEncounters[npcName]++;
    return this.legendaryEncounters[npcName];
  }

  getLegendaryCount(npcName) { return this.legendaryEncounters[npcName] || 0; }

  reset() {
    this._collected.clear();
    this.legendaryEncounters = { 'Margot Robbie': 0, 'Bigfoot (Gary)': 0 };
    this.gold = 0;
    this.boosters.clear();
    this.cosmetics.clear();
    this.equippedCosmetic = null;
    this.totalEarned = 0;
    this.totalSpentTools = 0;
    this.totalSpentSkins = 0;
    this.activeMissions = [];
    this.completedMissions.clear();
    _safeClearStorage();
  }

  // Returns all catalog entries annotated with collected status
  getAll() {
    return FEET_CATALOG.map(e => ({ ...e, collected: this._collected.has(e.id) }));
  }
}
