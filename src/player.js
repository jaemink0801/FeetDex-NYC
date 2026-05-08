import * as THREE from 'three';

const WALK_SPEED    = 5;
const SPRINT_SPEED  = 10;
const GRAVITY       = 20;
const JUMP_VEL      = 9;
const PLAYER_H      = 1.8;
const EYE_LEVEL     = 1.6;
const PLAYER_R      = 0.4;
const LOOK_SENS     = 0.002;
const STEP_INTERVAL = 0.4;

// Circle vs AABB overlap — closest point on box to circle center
function _overlapsAABB(px, pz, radius, box) {
  const nearX = Math.max(box.minX, Math.min(px, box.maxX));
  const nearZ = Math.max(box.minZ, Math.min(pz, box.maxZ));
  const dx = px - nearX;
  const dz = pz - nearZ;
  return (dx * dx + dz * dz) < (radius * radius);
}

export class Player {
  constructor(camera, input, audioFn) {
    this.camera   = camera;
    this.input    = input;
    this.playStep = audioFn;

    this._spawn     = new THREE.Vector3(0, 0, 14);
    this.position   = this._spawn.clone();
    this.velocity   = new THREE.Vector3();
    this.yaw        = 0;
    this.pitch      = 0;
    this.onGround   = false;
    this._stepTimer = 0;
    this._sprint    = false;
    this._getFloor  = () => 0;
    this._animTime  = 0;     // accumulator for leg-swing animation

    // ── First-person legs + feet ──
    // Two hip-pivot groups attached to the camera. Pivot rotates around the
    // hip joint (top of leg) so the leg + foot swing together when walking.
    // Default colors: dark pants, dark shoes. Equipped cosmetic foot recolors
    // the shoes via setShoeColor() called from main.js.
    this._legs = new THREE.Group();
    camera.add(this._legs);
    this._legs.position.set(0, -EYE_LEVEL + 0.2, -0.05);
    this._legShoes = [];     // cached for cosmetic recolor

    const pantMat  = new THREE.MeshLambertMaterial({ color: 0x1a1a28 });
    const skinMat  = new THREE.MeshLambertMaterial({ color: 0xcca888 });
    this._defaultShoeMat = new THREE.MeshLambertMaterial({ color: 0x2a1b10 });

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0, 0);
      this._legs.add(hip);

      // Pant section
      const pant = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.085, 0.55, 8), pantMat,
      );
      pant.position.set(0, -0.32, 0);
      hip.add(pant);

      // Ankle / skin band
      const ankle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.06, 8), skinMat,
      );
      ankle.position.set(0, -0.62, 0);
      hip.add(ankle);

      // Shoe — its material is cloned per leg so cosmetic recolor doesn't
      // affect the shared default material on other legs.
      const shoeMat = this._defaultShoeMat.clone();
      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.07, 0.20), shoeMat,
      );
      shoe.position.set(0, -0.69, 0.04);
      hip.add(shoe);
      this._legShoes.push(shoe);

      if (side === -1) this._leftHip  = hip;
      else             this._rightHip = hip;
    }

    window.addEventListener('keydown', e => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._sprint = true;
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._sprint = false;
    });
    window.addEventListener('blur', () => { this._sprint = false; });

    this._updateCamera();
  }

  update(dt, solids) {
    this._look();
    this._move(dt, solids);
    this._updateCamera();
    this._animateLegs(dt);
  }

  // Swing the leg pivots based on horizontal velocity. Faster gait when
  // sprinting; legs hang neutral when standing still.
  _animateLegs(dt) {
    if (!this._leftHip || !this._rightHip) return;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < 0.1) {
      // Decay back toward neutral
      this._leftHip.rotation.x  *= 0.85;
      this._rightHip.rotation.x *= 0.85;
      return;
    }
    const sprinting = speed > WALK_SPEED * 1.2;
    const freq = sprinting ? 12 : 7.5;
    this._animTime += dt * freq;
    const swing = Math.sin(this._animTime) * (sprinting ? 0.7 : 0.5);
    this._leftHip.rotation.x  =  swing;
    this._rightHip.rotation.x = -swing;
  }

  // Recolor the FP shoes for a cosmetic. Pass null to revert to default.
  setShoeColor(hex) {
    if (!this._legShoes) return;
    for (const shoe of this._legShoes) {
      if (hex == null) {
        shoe.material.color.copy(this._defaultShoeMat.color);
      } else {
        shoe.material.color.set(hex);
      }
      shoe.material.needsUpdate = true;
    }
  }

  setFloorFn(fn) { this._getFloor = fn; }

  respawn() {
    this.position.copy(this._spawn);
    this.velocity.set(0, 0, 0);
    this.yaw   = 0;
    this.pitch = 0;
    this._updateCamera();
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _look() {
    const { dx, dy } = this.input.consumeMouseDelta();
    this.yaw   -= dx * LOOK_SENS;
    this.pitch  = Math.max(-Math.PI / 2 + 0.01,
                   Math.min( Math.PI / 2 - 0.01,
                   this.pitch - dy * LOOK_SENS));
  }

  _move(dt, solids) {
    const fwd   = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3( Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let mx = 0, mz = 0;
    if (this.input.isDown('KeyW')) { mx += fwd.x;   mz += fwd.z; }
    if (this.input.isDown('KeyS')) { mx -= fwd.x;   mz -= fwd.z; }
    if (this.input.isDown('KeyA')) { mx -= right.x; mz -= right.z; }
    if (this.input.isDown('KeyD')) { mx += right.x; mz += right.z; }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx /= len; mz /= len; }

    // Sprint is gated behind Morton's "Sprint Feet" booster — Shift does
    // nothing until the player buys it.
    const sprintUnlocked = window.gameFeetDex?.hasBooster('sprint_feet');
    const speed = (this._sprint && sprintUnlocked) ? SPRINT_SPEED : WALK_SPEED;
    this.velocity.x = mx * speed;
    this.velocity.z = mz * speed;

    if (this.input.isDown('Space') && this.onGround) {
      this.velocity.y = JUMP_VEL;
      this.onGround = false;
    }

    // Gravity uses onGround from the START of this frame (before ground test below)
    if (!this.onGround) this.velocity.y -= GRAVITY * dt;

    // ── Y axis: gravity + terrain-aware ground clamp ─────────────────────────
    let ny = this.position.y + this.velocity.y * dt;
    const floorY = this._getFloor(this.position.x, this.position.z, this.position.y);
    // Only snap upward if the floor is close — prevents teleporting when walking
    // under a raised surface (e.g. under the Brooklyn Bridge deck).
    const snapDist = floorY - this.position.y;
    if (ny <= floorY && snapDist < 1.5) {
      ny = floorY; this.velocity.y = 0; this.onGround = true;
    } else {
      // Player is above the floor, OR the floor is unreachably far above them
      // (e.g. walking under a raised deck — don't teleport).
      this.onGround = false;
    }

    // ── X axis: attempt movement, cancel entirely if any solid is hit ─────────
    const dx = this.velocity.x * dt;
    let   nx = this.position.x + dx;
    if (dx !== 0) {
      let blocked = false;
      for (const s of solids) {
        if (_overlapsAABB(nx, this.position.z, PLAYER_R, s)) {
          nx = this.position.x; this.velocity.x = 0; blocked = true; break;
        }
      }
      if (!blocked) {
        for (const entry of (window.SOLID_COLLIDERS || [])) {
          const b = entry.box;
          if (nx + PLAYER_R > b.min.x && nx - PLAYER_R < b.max.x &&
              this.position.z + PLAYER_R > b.min.z && this.position.z - PLAYER_R < b.max.z) {
            nx = this.position.x; this.velocity.x = 0; break;
          }
        }
      }
    }

    // ── Z axis: uses updated X so corner approach resolves to a clean slide ───
    const dz = this.velocity.z * dt;
    let   nz = this.position.z + dz;
    if (dz !== 0) {
      let blocked = false;
      for (const s of solids) {
        if (_overlapsAABB(nx, nz, PLAYER_R, s)) {
          nz = this.position.z; this.velocity.z = 0; blocked = true; break;
        }
      }
      if (!blocked) {
        for (const entry of (window.SOLID_COLLIDERS || [])) {
          const b = entry.box;
          if (nx + PLAYER_R > b.min.x && nx - PLAYER_R < b.max.x &&
              nz + PLAYER_R > b.min.z && nz - PLAYER_R < b.max.z) {
            nz = this.position.z; this.velocity.z = 0; break;
          }
        }
      }
    }

    this.position.set(nx, ny, nz);

    // ── Footstep sound ─────────────────────────────────────────────────────────
    if (this.onGround && (mx !== 0 || mz !== 0)) {
      this._stepTimer -= dt;
      if (this._stepTimer <= 0) {
        this.playStep();
        this._stepTimer = speed === SPRINT_SPEED ? STEP_INTERVAL * 0.55 : STEP_INTERVAL;
      }
    } else {
      this._stepTimer = 0;
    }
  }

  _updateCamera() {
    this.camera.position.set(
      this.position.x,
      this.position.y + EYE_LEVEL,
      this.position.z,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
