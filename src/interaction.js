import * as THREE from 'three';
import { Audio } from './audio.js';

// ── HUD message toast ─────────────────────────────────────────────────────────

let _hudMsgEl    = null;
let _hudMsgTimer = null;

export function showHUDMessage(text, durationMs = 2500) {
  if (!_hudMsgEl) _hudMsgEl = document.getElementById('hud-msg');
  if (!_hudMsgEl) return;
  _hudMsgEl.textContent = text;
  _hudMsgEl.classList.add('visible');
  clearTimeout(_hudMsgTimer);
  _hudMsgTimer = setTimeout(() => _hudMsgEl?.classList.remove('visible'), durationMs);
}

// ── Combat encounter ──────────────────────────────────────────────────────────

const _NPC_HP     = { common: 30, rare: 50, epic: 70, mythic: 100, legendary: 150 };
const _NPC_DMG    = { common: 8,  rare: 12, epic: 16, mythic: 25,  legendary: 37  };
const PLAYER_DMG  = 10;
const PLAYER_MAX  = 100;
const HIT_CD      = 500;   // ms between player attacks
const HIT_RANGE   = 2.6;   // metres — player punch must land within this
const NPC_HIT_RANGE = 2.2; // metres — NPC swing must connect within this
const NPC_ATK_CD  = 640;   // ms between NPC attacks (1.25× faster than 800)
const NPC_WINDUP  = 240;   // ms — visible swing wind-up (1.25× faster than 300)
const KO_DELAY_MS = 2400;  // ms — KO + flop pause before reward dialogue

export class CombatEncounter {
  constructor(npc, player, camera, onWin, onLose) {
    this._npc        = npc;
    this._player     = player;
    this._camera     = camera;
    this._onWin      = onWin;
    this._onLose     = onLose;

    // Player and NPC stats. Armor doubles HP and reduces incoming damage by
    // 30%; Sword doubles damage, knockback, and player attack speed.
    const fdex = window.gameFeetDex;
    const hasArmor = fdex?.hasBooster('armor');
    this._hasArmor  = !!hasArmor;
    this._hasSword  = fdex?.hasBooster('sword') ?? false;
    this._playerHP   = hasArmor ? PLAYER_MAX * 2 : PLAYER_MAX;
    this._playerMax  = this._playerHP;
    this._npcHP      = _NPC_HP[npc.rarity] ?? PLAYER_MAX;
    this._npcMaxHP   = this._npcHP;

    // Per-rarity attack-speed multiplier. Mythics swing 1.65× faster than
    // baseline (1.5 × 1.1). Legendaries 1.5× — they're tougher in HP/damage
    // already, so attack-speed parity with mythics keeps the fight fair.
    const speedMult = npc.rarity === 'legendary' ? 1.5
                     : npc.rarity === 'mythic'    ? 1.65
                     : 1;
    this._atkCd  = NPC_ATK_CD / speedMult;
    this._windup = NPC_WINDUP / speedMult;

    this._lastHit       = 0;
    this._swingStart    = 0;        // when current NPC swing started; 0 = idle
    this._swingTargetHP = null;     // captured player HP at swing start (for dodge check)
    this._nextSwing     = Date.now() + 1200;
    this._koTime        = 0;        // when NPC HP hit 0
    this._active        = true;
    // Mythics chase at 8.1 m/s; legendaries 1.25× faster (≈10.1) — they're
    // the late-game challenge so they hunt you down more aggressively.
    this._chaseSpeed    = (npc.rarity === 'legendary') ? 10.1 : 8.1;
    this._origGroupY    = npc.group.position.y;
    this._origGroupRotX = npc.group.rotation.x;
    this._bodyScale     = npc.group.scale.x;

    // Hit-feedback timers (0 = inactive)
    this._hurtFlashUntil  = 0;   // NPC scale-pulse after player hits
    this._shakeUntil      = 0;   // player camera shake after taking a hit
    this._recoilDx        = 0;   // NPC recoil push, decays each frame
    this._recoilDz        = 0;

    npc._inCombat = true;

    // Battle UI elements
    this._heartsEl  = document.getElementById('combat-hearts');
    this._npcLabel  = document.getElementById('combat-npc-label');
    this._flash     = document.getElementById('combat-flash');
    this._vignette  = document.getElementById('battle-vignette');
    document.getElementById('combat-hud')?.classList.remove('active'); // legacy HUD off
    if (this._heartsEl) this._heartsEl.classList.add('active');
    if (this._npcLabel) {
      this._npcLabel.classList.add('active');
      this._npcLabel.querySelector('.cb2-name').textContent = npc.name ?? 'NPC';
    }
    if (this._vignette) this._vignette.classList.add('active');
    this._renderHearts();
    this._renderNpcBar();
  }

  update(dt) {
    if (!this._active) return;

    const now    = Date.now();
    const npc    = this._npc;
    const player = this._player;

    // ── KO sequence ──────────────────────────────────────────────────────
    if (this._koTime > 0) {
      const t = (now - this._koTime) / KO_DELAY_MS;
      if (t < 1) {
        // Fall over — ease group rotation onto its back
        const k = Math.min(1, t * 2);
        npc.group.rotation.x = -Math.PI / 2 * k;
        npc.group.position.y = this._origGroupY - k * 0.6;
      } else {
        this._end(true);
      }
      return;
    }

    // ── Chase player ─────────────────────────────────────────────────────
    const dx = player.position.x - npc.group.position.x;
    const dz = player.position.z - npc.group.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > NPC_HIT_RANGE * 0.85) {
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      npc.group.position.x += nx * this._chaseSpeed * dt;
      npc.group.position.z += nz * this._chaseSpeed * dt;
    }
    // Always face the player
    npc.group.rotation.y = Math.atan2(dx, dz);

    // ── Recoil decay (after the player lands a hit) ──────────────────────
    if (this._recoilDx || this._recoilDz) {
      npc.group.position.x += this._recoilDx;
      npc.group.position.z += this._recoilDz;
      this._recoilDx *= 0.78;
      this._recoilDz *= 0.78;
      if (Math.abs(this._recoilDx) < 0.001) this._recoilDx = 0;
      if (Math.abs(this._recoilDz) < 0.001) this._recoilDz = 0;
    }

    // ── Hurt scale-pulse (NPC took damage) ───────────────────────────────
    if (this._hurtFlashUntil > now) {
      const k = (this._hurtFlashUntil - now) / 220;        // 0..1 remaining
      const s = this._bodyScale * (1 + 0.18 * k);
      npc.group.scale.set(s, s, s);
    } else {
      npc.group.scale.set(this._bodyScale, this._bodyScale, this._bodyScale);
    }

    // ── Swing: anticipation → strike, with body lean ─────────────────────
    if (this._swingStart > 0) {
      const t = (now - this._swingStart) / this._windup;     // 0..1+
      if (t < 0.55) {
        const k = t / 0.55;
        npc.group.rotation.x = this._origGroupRotX + 0.32 * k;
        if (npc._rightArmPivot) npc._rightArmPivot.rotation.x = 0.55 * k;
      } else if (t < 1) {
        const k = (t - 0.55) / 0.45;
        npc.group.rotation.x = this._origGroupRotX + 0.32 * (1 - k) - 0.18 * k;
        if (npc._rightArmPivot) npc._rightArmPivot.rotation.x = 0.55 - 2.0 * k;
      } else {
        npc.group.rotation.x = this._origGroupRotX;
        if (npc._rightArmPivot) npc._rightArmPivot.rotation.x = 0;
        this._swingStart = 0;

        if (dist <= NPC_HIT_RANGE) {
          // Armor reduces incoming damage by 30%
          let dmg = _NPC_DMG[npc.rarity] ?? 25;
          if (this._hasArmor) dmg = Math.round(dmg * 0.70);
          this._playerHP = Math.max(0, this._playerHP - dmg);
          this._flashScreen('rgba(220,0,0,0.32)');
          this._shakeUntil = now + 260;
          try { Audio.playerHurt(); } catch (_) {}
          this._renderHearts();
          if (this._playerHP <= 0) { this._end(false); return; }
        }
        this._nextSwing = now + this._atkCd;
      }
    } else if (now >= this._nextSwing && dist <= NPC_HIT_RANGE) {
      this._swingStart = now;
    }

    // ── Camera shake while player is reeling from a hit ──────────────────
    if (this._shakeUntil > now && this._camera) {
      const k = (this._shakeUntil - now) / 260;
      const amp = 0.08 * k;
      this._camera.position.x += (Math.random() - 0.5) * amp;
      this._camera.position.y += (Math.random() - 0.5) * amp;
      this._camera.rotation.z = (Math.random() - 0.5) * 0.04 * k;
    } else if (this._camera) {
      this._camera.rotation.z = 0;
    }

    this._renderNpcBar();
  }

  playerAttack() {
    if (!this._active || this._koTime > 0) return;
    const now = Date.now();
    // Sword halves the swing cooldown (2× attack speed)
    const cooldown = this._hasSword ? HIT_CD / 2 : HIT_CD;
    if (now - this._lastHit < cooldown) return;
    this._lastHit = now;

    // Range + facing check — only land hits if mythic is in front and close
    const npc    = this._npc;
    const player = this._player;
    const dx = npc.group.position.x - player.position.x;
    const dz = npc.group.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > HIT_RANGE) return;

    // Facing: dot product of player look-direction and (npc - player) on XZ
    const lookX = -Math.sin(player.yaw);
    const lookZ = -Math.cos(player.yaw);
    const dot = (dx * lookX + dz * lookZ) / (dist || 1);
    if (dot < 0.35) return;  // ~70° cone in front of player

    // Sword booster doubles damage and knockback
    const dmg    = this._hasSword ? PLAYER_DMG * 2 : PLAYER_DMG;
    const recoil = this._hasSword ? 1.5 : 0.55;
    this._npcHP = Math.max(0, this._npcHP - dmg);
    this._flashScreen('rgba(255,255,80,0.18)');
    this._renderNpcBar();

    // ── Hit feedback: punch SFX, NPC hurt SFX, scale-pulse, recoil push ──
    try { Audio.playerHit(); } catch (_) {}
    try { Audio.npcHurt();   } catch (_) {}
    this._hurtFlashUntil = now + 220;
    // Push NPC away from player along the hit direction (decays over a few frames)
    const norm = dist || 1;
    this._recoilDx = (dx / norm) * recoil;
    this._recoilDz = (dz / norm) * recoil;

    if (this._npcHP <= 0) {
      this._koTime = now;
      this._swingStart = 0;
      if (npc._rightArmPivot) npc._rightArmPivot.rotation.x = 0;
      npc.group.rotation.x = this._origGroupRotX;
    }
  }

  forceClose() {
    this._cleanup();
    this._active = false;
  }

  _end(won) {
    this._cleanup();
    this._active = false;
    if (won) this._onWin(); else this._onLose();
  }

  _cleanup() {
    const npc = this._npc;
    npc._inCombat = false;
    if (this._koTime > 0) {
      npc._kod = true;   // KO pose retained until they offer their feet
    } else {
      // Reset transient combat poses if they retreated mid-fight
      npc.group.rotation.x = this._origGroupRotX;
      npc.group.scale.set(this._bodyScale, this._bodyScale, this._bodyScale);
      if (npc._rightArmPivot) npc._rightArmPivot.rotation.x = 0;
    }
    if (this._camera) this._camera.rotation.z = 0;
    if (this._heartsEl) this._heartsEl.classList.remove('active');
    if (this._npcLabel) {
      this._npcLabel.classList.remove('active');
      // _renderNpcBar set style.display='block' inline; clear it so the CSS
      // .active rule's display:none can hide the label after combat ends.
      this._npcLabel.style.display = 'none';
    }
    if (this._vignette) this._vignette.classList.remove('active');
  }

  _flashScreen(color) {
    if (!this._flash) return;
    this._flash.style.background = color;
    this._flash.style.opacity    = '1';
    setTimeout(() => { if (this._flash) this._flash.style.opacity = '0'; }, 130);
  }

  _renderHearts() {
    if (!this._heartsEl) return;
    // 10 hearts, each = 10 HP. Display: full / half / empty.
    const hp = this._playerHP;
    const hearts = [];
    for (let i = 0; i < 10; i++) {
      const v = hp - i * 10;
      const cls = v >= 10 ? 'full' : v >= 5 ? 'half' : 'empty';
      hearts.push(`<span class="cb2-heart cb2-${cls}">&#10084;</span>`);
    }
    this._heartsEl.innerHTML = hearts.join('');
  }

  _renderNpcBar() {
    if (!this._npcLabel) return;
    const pct = Math.round((this._npcHP / this._npcMaxHP) * 100);
    const wrap = this._npcLabel.querySelector('.cb2-bar-wrap');
    const bar  = this._npcLabel.querySelector('.cb2-bar');
    if (bar) bar.style.width = pct + '%';

    // Project NPC head position to screen
    if (!this._camera || !wrap) return;
    const npc = this._npc;
    const headWorld = new THREE.Vector3(
      npc.group.position.x,
      npc.group.position.y + 2.2 * (npc.group.scale.y || 1),
      npc.group.position.z,
    );
    const projected = headWorld.clone().project(this._camera);
    if (projected.z > 1) {
      this._npcLabel.style.display = 'none';
      return;
    }
    const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (1 - (projected.y * 0.5 + 0.5)) * window.innerHeight;
    this._npcLabel.style.display = 'block';
    this._npcLabel.style.left = `${sx}px`;
    this._npcLabel.style.top  = `${sy}px`;
  }
}

// ── Interaction system ────────────────────────────────────────────────────────

export class InteractionSystem {
  constructor(camera, scene, player) {
    this._camera = camera;
    this._scene  = scene;
    this._player = player;
    this._combat = null;

    document.addEventListener('mousedown', e => {
      if (e.button === 0 && window.gameState === 'combat' && this._combat) {
        this._combat.playerAttack();
      }
    });
  }

  setCombat(encounter) { this._combat = encounter; }
  clearCombat()        { if (this._combat) { this._combat.forceClose(); this._combat = null; } }

  update(dt) {
    if (this._combat) this._combat.update(dt);
  }
}
