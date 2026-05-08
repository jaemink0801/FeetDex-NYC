import * as THREE from 'three';

// ── City grid constants ───────────────────────────────────────────────────────

const AVENUES       = [-120, -90, -60, -30, 0, 30, 60, 90, 120];
const CROSS_STREETS = [-120, -100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100, 120];
const STREET_HALF   = 2.5;   // half of 5-unit road width
const SIDEWALK_W    = 2;     // sidewalk inset on each block edge

// Extent of the road grid (matches outermost avenue/street)
const GRID_MIN = -120, GRID_MAX = 120;

// NYC-accurate palette: limestone, red brick, concrete, dark glass, sandstone, terracotta
const BUILDING_COLORS = [
  0xc2b99a, // limestone
  0x8b4c3c, // red brick
  0x7a7a7a, // concrete
  0x4a5a6a, // dark glass
  0xb8a07a, // sandstone
  0xa06050, // terracotta
  0x888880, // steel
  0xd0c8b8, // pale stone
];
const WINDOW_W = 1.1, WINDOW_H = 1.4;
const DOOR_W   = 1.2, DOOR_H   = 2.0;
const FLOOR_H  = 3.2;

// Exclusion zones around landmarks — no generic buildings placed here
const LANDMARK_ZONES = [
  { x:   0, z:   0, r: 18 }, // Empire State Building
  { x:  40, z:  20, r: 16 }, // Chrysler Building
  { x: -60, z: -80, r: 22 }, // Brooklyn Bridge
  { x: -50, z:  60, r: 48 }, // Central Park (80×60 extent)
  { x:  10, z: -40, r: 22 }, // Times Square
  { x:  80, z:  80, r: 16 }, // Secret alley cluster (SE corner)
  { x:  75, z: -30, r: 14 }, // Grand Central Terminal
];

// Interior rooms placed far from the city to avoid visibility
const INTERIOR_BASE_X = 2000;

// Bridge deck surface elevation — used by ramps, getFloorY, and NPC spawn zone
const BRIDGE_DECK_Y = 6;

// Expose bridge geometry to npc.js (loaded after world.js)
window.BRIDGE_DECK_Y   = 6;
window.BRIDGE_X_CENTER = -60;
window.BRIDGE_Z_START  = -68;
window.BRIDGE_Z_END    = -92;
window.BRIDGE_Z_MID    = -80;

// ── Seeded PRNG ───────────────────────────────────────────────────────────────

function makePRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

// ── Canvas-texture label sprite ───────────────────────────────────────────────

function makeLabel(text, {
  fontSize    = 72,
  width       = 1024,
  height      = 256,
  bgAlpha     = 0,
  bgColor     = null,
  textColor   = '#FFFFFF',
  strokeColor = '#000000',
  strokeWidth = 8,
} = {}) {
  const canvas  = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  } else if (bgAlpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${bgAlpha})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.font         = `bold ${fontSize}px 'Arial Black', Impact, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin     = 'round';
  ctx.strokeStyle  = strokeColor;
  ctx.lineWidth    = strokeWidth;
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle    = textColor;
  ctx.fillText(text, width / 2, height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.minFilter   = THREE.LinearFilter;
  // Static double-sided plane (NOT a Sprite). Geometry is unit-sized so callers
  // can keep using mesh.scale.set(w, h, 1) just like they did with Sprites.
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
  );
  return plane;
}

// ── Block layout ──────────────────────────────────────────────────────────────

// Returns {x1,x2,z1,z2} for each buildable block between streets.
// x1/x2 are the block edges (inclusive of sidewalk). Buildings are inset by SIDEWALK_W.
function computeBlocks() {
  const xSegs = [], zSegs = [];
  for (let i = 0; i < AVENUES.length - 1; i++)
    xSegs.push({ x1: AVENUES[i] + STREET_HALF, x2: AVENUES[i + 1] - STREET_HALF });
  for (let j = 0; j < CROSS_STREETS.length - 1; j++)
    zSegs.push({ z1: CROSS_STREETS[j] + STREET_HALF, z2: CROSS_STREETS[j + 1] - STREET_HALF });
  const blocks = [];
  for (const xs of xSegs) for (const zs of zSegs) blocks.push({ ...xs, ...zs });
  return blocks;
}

function inLandmarkZone(cx, cz) {
  for (const z of LANDMARK_ZONES) {
    const dx = cx - z.x, dz = cz - z.z;
    if (dx * dx + dz * dz < z.r * z.r) return true;
  }
  return false;
}

// Push a flat AABB into the solid-objects registry used by player collision.
function registerSolid(solidObjects, cx, cz, halfW, halfD, padding = 0.05) {
  solidObjects.push({
    minX: cx - halfW - padding,
    maxX: cx + halfW + padding,
    minZ: cz - halfD - padding,
    maxZ: cz + halfD + padding,
  });
}

// Global Box3 collider registry — {box, mesh, isStatic} entries.
window.SOLID_COLLIDERS = [];
window.registerSolid = function(mesh, scene) {
  if (scene && !mesh.parent) scene.add(mesh);
  // Force world matrix before computing bounds — required for group children
  // that may not yet have been rendered.
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  window.SOLID_COLLIDERS.push({ box, mesh, isStatic: true });
  return box;
};
window.refreshSolid = function() {
  for (const entry of window.SOLID_COLLIDERS)
    if (!entry.isStatic) entry.box.setFromObject(entry.mesh);
};
window.refreshAllSolids = function() {
  for (const entry of window.SOLID_COLLIDERS) {
    entry.mesh.updateMatrixWorld(true);
    entry.box.setFromObject(entry.mesh);
  }
};

// ── Generic buildings (InstancedMesh) ─────────────────────────────────────────

function buildGenericBuildings(scene, blocks, solidObjects) {
  const rng = makePRNG(42);

  // Collect all instance data before creating meshes
  const bldData = []; // { cx, h, cz, w, d, colorIdx }
  const winData = []; // { px, py, pz, rotY }
  const dooData = []; // { px, py, pz }

  const dummy  = new THREE.Object3D();
  const colObj = new THREE.Color();

  for (const blk of blocks) {
    const bw = blk.x2 - blk.x1 - 2 * SIDEWALK_W;
    const bd = blk.z2 - blk.z1 - 2 * SIDEWALK_W;
    if (bw < 5 || bd < 5) continue;

    const innerX1 = blk.x1 + SIDEWALK_W;
    const innerZ1 = blk.z1 + SIDEWALK_W;
    const isOuter = blk.x1 <= AVENUES[1] + STREET_HALF ||
                    blk.x2 >= AVENUES[AVENUES.length - 2] - STREET_HALF ||
                    blk.z1 <= CROSS_STREETS[1] + STREET_HALF ||
                    blk.z2 >= CROSS_STREETS[CROSS_STREETS.length - 2] - STREET_HALF;
    const count   = Math.floor(rng() * 2) + (isOuter ? 3 : 2);  // inner 2–3, outer 3–4

    for (let b = 0; b < count; b++) {
      // Divide block width into equal strips; randomize position within strip
      const segW = bw / count;
      let   cx   = innerX1 + segW * b + segW * (0.12 + rng() * 0.76);
      let   cz   = innerZ1 + bd  *      (0.12 + rng() * 0.76);

      if (inLandmarkZone(cx, cz)) continue;

      const w        = 4 + rng() * Math.max(0, segW * 0.75 - 4);
      const d        = 4 + rng() * Math.max(0, bd   * 0.75 - 4);

      // Clamp so the entire building footprint stays within the block's inner
      // bounds — never extending past the sidewalk into the road.
      const xMin = blk.x1 + SIDEWALK_W + w / 2;
      const xMax = blk.x2 - SIDEWALK_W - w / 2;
      const zMin = blk.z1 + SIDEWALK_W + d / 2;
      const zMax = blk.z2 - SIDEWALK_W - d / 2;
      if (xMin > xMax || zMin > zMax) continue;
      cx = Math.max(xMin, Math.min(xMax, cx));
      cz = Math.max(zMin, Math.min(zMax, cz));
      // Height tiers: occasional skyscrapers (15%), tall (30%), mid-rise, low
      const r3 = rng();
      const h = r3 < 0.15 ? 70 + rng() * 55           // skyscraper 70–125
              : r3 < 0.45 ? (isOuter ? 45 + rng() * 35 : 25 + rng() * 25)  // tall
              :               (isOuter ? 18 + rng() * 22 : 8  + rng() * 18); // mid/low
      const colorIdx = Math.floor(rng() * BUILDING_COLORS.length);
      bldData.push({ cx, h, cz, w, d, colorIdx });

      const numFloors = Math.floor(h / FLOOR_H);

      // 4 cardinal faces: { px, pz, rotY, horizontal axis is X? }
      const faces = [
        { px: cx,       pz: cz - d/2 - 0.05, rotY: Math.PI,       alongX: true,  isSouth: false }, // N
        { px: cx,       pz: cz + d/2 + 0.05, rotY: 0,             alongX: true,  isSouth: true  }, // S
        { px: cx-w/2-0.05, pz: cz,           rotY: -Math.PI / 2,  alongX: false, isSouth: false }, // W
        { px: cx+w/2+0.05, pz: cz,           rotY:  Math.PI / 2,  alongX: false, isSouth: false }, // E
      ];

      for (const face of faces) {
        const faceW  = face.alongX ? w : d;
        const numCol = faceW > 6 ? 2 : 1;

        // Door clearance: horizontal half-span that must stay window-free
        const doorClear = face.isSouth ? (DOOR_W / 2 + WINDOW_W / 2) : 0;

        // Full-height windows on every floor (was previously capped at 8).
        for (let fl = 0; fl < numFloors; fl++) {
          const wy = fl * FLOOR_H + FLOOR_H * 0.55;
          if (wy >= h - 0.8) continue;

          for (let col = 0; col < numCol; col++) {
            const offset = numCol === 1 ? 0 : (col === 0 ? -faceW * 0.22 : faceW * 0.22);
            // Skip windows whose center falls within the door opening
            if (wy < DOOR_H && Math.abs(offset) < doorClear) continue;
            winData.push({
              px:   face.alongX ? face.px + offset : face.px,
              py:   wy,
              pz:   face.alongX ? face.pz : face.pz + offset,
              rotY: face.rotY,
            });
          }
        }

        // One door on the south face only
        if (face.isSouth) {
          dooData.push({ px: face.px, py: DOOR_H / 2, pz: face.pz });
        }
      }
    }
  }

  // Register every building footprint for player collision
  for (const b of bldData) {
    registerSolid(solidObjects, b.cx, b.cz, b.w / 2, b.d / 2);
  }

  // ── Building boxes ──────────────────────────────────────────────────────────
  const boxMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial(),
    bldData.length,
  );
  bldData.forEach((b, i) => {
    dummy.position.set(b.cx, b.h / 2, b.cz);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    boxMesh.setMatrixAt(i, dummy.matrix);
    colObj.setHex(BUILDING_COLORS[b.colorIdx]);
    boxMesh.setColorAt(i, colObj);
  });
  boxMesh.instanceMatrix.needsUpdate = true;
  if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
  scene.add(boxMesh);

  // ── Water towers on tall buildings ──────────────────────────────────────────
  const wtMat    = new THREE.MeshLambertMaterial({ color: 0x7a5c38 });
  const wtLegMat = new THREE.MeshLambertMaterial({ color: 0x4a3820 });
  const wtStep   = Math.max(1, Math.floor(bldData.length / 14));
  let   wtCount  = 0;
  for (let i = 0; i < bldData.length && wtCount < 14; i += wtStep) {
    const b = bldData[i];
    if (b.h < 14) continue;
    const ry = b.h; // exact visual rooftop y
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.2, 10), wtMat);
    tank.position.set(b.cx, ry + 1.1, b.cz);
    scene.add(tank);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.0, 10), wtLegMat);
    cap.position.set(b.cx, ry + 2.7, b.cz);
    scene.add(cap);
    for (let a = 0; a < Math.PI * 2; a += Math.PI * 2 / 3) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 5), wtLegMat);
      leg.position.set(b.cx + Math.cos(a) * 0.9, ry - 1.25, b.cz + Math.sin(a) * 0.9);
      leg.rotation.z = Math.sin(a) * 0.18;
      leg.rotation.x = -Math.cos(a) * 0.18;
      scene.add(leg);
    }
    wtCount++;
  }

  // ── Window planes ───────────────────────────────────────────────────────────
  if (winData.length > 0) {
    const winMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xc8dce8 }),
      winData.length,
    );
    winData.forEach((w, i) => {
      dummy.position.set(w.px, w.py, w.pz);
      dummy.rotation.set(0, w.rotY, 0);
      dummy.scale.set(WINDOW_W, WINDOW_H, 1);
      dummy.updateMatrix();
      winMesh.setMatrixAt(i, dummy.matrix);
    });
    winMesh.instanceMatrix.needsUpdate = true;
    scene.add(winMesh);
  }

  // ── Door planes ─────────────────────────────────────────────────────────────
  if (dooData.length > 0) {
    const doorMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x5c4033 }),
      dooData.length,
    );
    dooData.forEach((d, i) => {
      dummy.position.set(d.px, d.py, d.pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(DOOR_W, DOOR_H, 1);
      dummy.updateMatrix();
      doorMesh.setMatrixAt(i, dummy.matrix);
    });
    doorMesh.instanceMatrix.needsUpdate = true;
    scene.add(doorMesh);
  }

  // Colliders — full-height AABB per building
  const colliders = bldData.map(b => new THREE.Box3(
    new THREE.Vector3(b.cx - b.w / 2, 0, b.cz - b.d / 2),
    new THREE.Vector3(b.cx + b.w / 2, b.h, b.cz + b.d / 2),
  ));

  // Pick ~14 buildings evenly distributed across bldData to be enterable.
  const ENTERABLE_NAMES = ['Cafe','Diner','Gym','Office','Shop','Bar','Gallery','Laundry',
                            'Pharmacy','Hotel Lobby','KFC','Bodega','Museum','Barbershop'];
  const enterables = [];
  const step = Math.max(1, Math.floor(bldData.length / 12));
  const eDoorMat = new THREE.MeshStandardMaterial({
    color: 0xffe060, emissive: 0xffe060, emissiveIntensity: 0.85,
  });
  const _nearestStreet = (pos, streets) => Math.min(...streets.map(s => Math.abs(pos - s)));

  bldData.forEach((b, i) => {
    if (i % step !== 0 || enterables.length >= 14) return;
    if (b.w < 4 || b.d < 4) return;
    const eid = `generic_${enterables.length}`;
    const typeName = ENTERABLE_NAMES[enterables.length];

    // Pick the face whose outer edge is closest to a street
    const faceCandidates = [
      { dx: 0,          dz:  b.d/2+0.15, rotY: 0,            streetDist: _nearestStreet(b.cz + b.d/2, CROSS_STREETS) },
      { dx: 0,          dz: -b.d/2-0.15, rotY: Math.PI,      streetDist: _nearestStreet(b.cz - b.d/2, CROSS_STREETS) },
      { dx:  b.w/2+0.15, dz: 0,          rotY:  Math.PI/2,   streetDist: _nearestStreet(b.cx + b.w/2, AVENUES) },
      { dx: -b.w/2-0.15, dz: 0,          rotY: -Math.PI/2,   streetDist: _nearestStreet(b.cx - b.w/2, AVENUES) },
    ];
    const best = faceCandidates.reduce((a, c) => c.streetDist < a.streetDist ? c : a);

    const doorPos = new THREE.Vector3(b.cx + best.dx, 1.4, b.cz + best.dz);
    const eDoor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.8, 0.2), eDoorMat);
    eDoor.position.copy(doorPos);
    eDoor.rotation.y = best.rotY;
    scene.add(eDoor);

    // City-side return position (2 units out from door face)
    const retDir = [0, Math.PI, Math.PI/2, -Math.PI/2].indexOf(best.rotY);
    const retOffsets = [[0,2],[0,-2],[2,0],[-2,0]];
    const exitYaws   = [Math.PI, 0, -Math.PI/2, Math.PI/2];
    const [rdx, rdz] = retOffsets[retDir] ?? [0, 2];
    const cityReturnPos = new THREE.Vector3(doorPos.x + rdx, 0, doorPos.z + rdz);
    const exitYaw = exitYaws[retDir] ?? Math.PI;

    enterables.push({ id: eid, name: typeName, cx: b.cx, cz: b.cz, w: b.w, d: b.d, doorPos, cityReturnPos, exitYaw });
  });

  return { colliders, enterables };
}

// ── City boundary wall ────────────────────────────────────────────────────────
// Solid continuous perimeter walls at ±250 with decorative towers.

function buildCityBoundary(scene, solidObjects) {
  const rng    = makePRNG(888);
  const EDGE   = 250;
  const WALL_D = 8;
  const mat    = new THREE.MeshLambertMaterial({ color: 0x5a5a5a });
  const tMat   = new THREE.MeshLambertMaterial({ color: 0x6e6e78 });
  const colliders = [];

  // Four continuous base walls
  const bases = [
    { cx:     0, cy: 12, cz: -EDGE, w: EDGE * 2 + WALL_D * 2, h: 24, d: WALL_D },
    { cx:     0, cy: 12, cz:  EDGE, w: EDGE * 2 + WALL_D * 2, h: 24, d: WALL_D },
    { cx: -EDGE, cy: 12, cz:     0, w: WALL_D, h: 24, d: EDGE * 2 },
    { cx:  EDGE, cy: 12, cz:     0, w: WALL_D, h: 24, d: EDGE * 2 },
  ];
  for (const b of bases) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.cx, b.cy, b.cz);
    scene.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(b.cx - b.w / 2, 0, b.cz - b.d / 2),
      new THREE.Vector3(b.cx + b.w / 2, b.h * 2, b.cz + b.d / 2),
    ));
    registerSolid(solidObjects, b.cx, b.cz, b.w / 2, b.d / 2);
  }

  // Decorative towers along north/south walls
  for (let x = -EDGE + 10; x <= EDGE - 10; x += 18) {
    for (const z of [-EDGE, EDGE]) {
      const tw = 10 + rng() * 6;
      const th = 25 + rng() * 45;
      const t  = new THREE.Mesh(new THREE.BoxGeometry(tw, th, WALL_D + 2), tMat);
      t.position.set(x, th / 2, z);
      scene.add(t);
    }
  }
  // Decorative towers along east/west walls
  for (let z = -EDGE + 10; z <= EDGE - 10; z += 18) {
    for (const x of [-EDGE, EDGE]) {
      const td = 10 + rng() * 6;
      const th = 25 + rng() * 45;
      const t  = new THREE.Mesh(new THREE.BoxGeometry(WALL_D + 2, th, td), tMat);
      t.position.set(x, th / 2, z);
      scene.add(t);
    }
  }

  return colliders;
}

// ── NYC street props ──────────────────────────────────────────────────────────
// Water towers, fire hydrants, yellow cabs, steam vents, newspaper stands.
// Returns an array of prop colliders to prevent walking through large props.

function buildStreetProps(scene, solidObjects) {
  const propColliders = [];

  // Helpers for the prop-position audit. After the grid extension a lot of
  // legacy hardcoded positions ended up either in the road or inside a block.
  // _inRoad: true if the point is on a paved avenue or cross-street lane.
  // _onSidewalk: true if the point is on a sidewalk strip near a road.
  const _inRoad = (x, z) => {
    for (const ax of AVENUES)       if (Math.abs(x - ax) <= STREET_HALF) return true;
    for (const cz of CROSS_STREETS) if (Math.abs(z - cz) <= STREET_HALF) return true;
    return false;
  };
  const _onSidewalk = (x, z) => {
    for (const ax of AVENUES)       if (Math.abs(x - ax) < STREET_HALF + 1.4) return true;
    for (const cz of CROSS_STREETS) if (Math.abs(z - cz) < STREET_HALF + 1.4) return true;
    return false;
  };
  const _validProp = (x, z) => _onSidewalk(x, z) && !_inRoad(x, z);

  // ── Yellow taxi cabs — placed on actual avenues / cross-streets ───────────
  const cabMat     = new THREE.MeshLambertMaterial({ color: 0xf5c518 });
  const cabDarkMat = new THREE.MeshLambertMaterial({ color: 0xd4a800 });
  const tireMat    = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const signMat    = new THREE.MeshStandardMaterial({
    color: 0xf5c518, emissive: 0xffe060, emissiveIntensity: 0.9,
  });
  const glassMat   = new THREE.MeshLambertMaterial({ color: 0x88aacc, transparent: true, opacity: 0.7 });

  // Taxis placed on real avenue / cross-street positions for the current grid
  // (avenues at x=±0, ±30, ±60, ±90, ±120; cross-streets at z=±0, ±20, ±40, ...).
  // Each car must sit in a road lane, never in a block.
  const taxiDefs = [
    // Avenue lanes — rotY 0 = southbound (along +z), Math.PI = northbound
    { x:  0.8, z:  16,  rotY: 0         },
    { x: -0.7, z: -34,  rotY: Math.PI   },
    { x: 30.6, z:  6,   rotY: Math.PI   },
    { x: 29.4, z: -28,  rotY: 0         },
    { x:-29.5, z:  46,  rotY: Math.PI   },
    { x:-30.5, z: -55,  rotY: 0         },
    { x: 60.5, z:  -8,  rotY: 0         },
    // Cross-street lanes — rotY PI/2 = eastbound (along +x), -PI/2 = westbound
    { x:  15,  z:  0.8, rotY:  Math.PI / 2 },
    { x: -45,  z: 20.8, rotY: -Math.PI / 2 },
    { x:  50,  z:-19.4, rotY:  Math.PI / 2 },
    { x: -18,  z:-20.8, rotY: -Math.PI / 2 },
    { x:  10,  z: 39.2, rotY: -Math.PI / 2 },
  ];

  for (const { x: tx, z: tz, rotY } of taxiDefs) {
    if (inLandmarkZone(tx, tz)) continue;

    const car = new THREE.Group();
    car.position.set(tx, 0, tz);
    car.rotation.y = rotY;

    // Main body sill (lower, wide)
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 4.2), cabDarkMat);
    sill.position.set(0, 0.61, 0);
    car.add(sill);

    // Cabin (upper, narrower)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.72, 2.1), cabMat);
    cabin.position.set(0, 1.33, -0.1);
    car.add(cabin);

    // Windshields (front + back)
    for (const gz of [-0.98, 1.0]) {
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.62), glassMat);
      ws.position.set(0, 1.33, gz);
      ws.rotation.y = gz < 0 ? Math.PI : 0;
      car.add(ws);
    }

    // Taxi sign on roof
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 0.38), signMat);
    sign.position.set(0, 1.79, -0.1);
    car.add(sign);

    // Wheels — cylinder axis along X (rotation.z = PI/2)
    for (const [wx, wz] of [[-0.9, -1.35], [0.9, -1.35], [-0.9, 1.35], [0.9, 1.35]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.24, 10), tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.27, wz);
      car.add(wheel);
      // Hubcap
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 8),
        new THREE.MeshLambertMaterial({ color: 0x888888 }));
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx > 0 ? wx + 0.12 : wx - 0.12, 0.27, wz);
      car.add(hub);
    }

    scene.add(car);
    const isAlongZ = (rotY === 0 || Math.abs(Math.abs(rotY) - Math.PI) < 0.01);
    propColliders.push(isAlongZ
      ? new THREE.Box3(new THREE.Vector3(tx-0.95,0,tz-2.1), new THREE.Vector3(tx+0.95,1.8,tz+2.1))
      : new THREE.Box3(new THREE.Vector3(tx-2.1,0,tz-0.95), new THREE.Vector3(tx+2.1,1.8,tz+0.95)));
    registerSolid(solidObjects, tx, tz, isAlongZ ? 0.95 : 2.1, isAlongZ ? 2.1 : 0.95);
  }

  // ── Fire hydrants — on sidewalk edges near building fronts ───────────────
  const hydrantMat  = new THREE.MeshLambertMaterial({ color: 0xcc1100 });
  const hydrantMat2 = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
  // Placed at building-side edge of sidewalk (avenue ± 3.3 units, or cross-street ± 3.3)
  const hydrantPositions = [
    [ 3.3, -22], [ 3.3,   2], [ 3.3,  25], [ 3.3,  45], [ 3.3, -62],
    [-3.3, -15], [-3.3,  32], [-3.3,  55],
    [33.3,   8], [33.3,  38], [33.3, -58],
    [26.7, -22], [26.7,  18],
    [-26.7,  48], [-26.7, -38],
    [-33.3,  12], [-33.3, -24],
    [63.3,  28], [63.3,  55],
    [18,  13.3], [-18,  13.3], [48, 13.3],
  ];
  for (const [hx, hz] of hydrantPositions) {
    if (inLandmarkZone(hx, hz)) continue;
    if (!_validProp(hx, hz)) continue;     // skip if now in road or mid-block
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 8), hydrantMat);
    base.position.set(hx, 0.3, hz);
    scene.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), hydrantMat);
    dome.position.set(hx, 0.7, hz);
    scene.add(dome);
    const bolt1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 6), hydrantMat2);
    bolt1.rotation.z = Math.PI / 2;
    bolt1.position.set(hx + 0.22, 0.44, hz);
    scene.add(bolt1);
    const bolt2 = bolt1.clone();
    bolt2.position.set(hx - 0.22, 0.44, hz);
    scene.add(bolt2);
    propColliders.push(new THREE.Box3(
      new THREE.Vector3(hx - 0.28, 0, hz - 0.28),
      new THREE.Vector3(hx + 0.28, 0.85, hz + 0.28),
    ));
    registerSolid(solidObjects, hx, hz, 0.28, 0.28);
  }

  // ── Street vendor carts (hot-dog, pretzel, halal) ─────────────────────────
  const cartColors  = [0x4477cc, 0xcc4422, 0x44aa44, 0x888822, 0xaa4488];
  const umbColors   = [0xee3311, 0x1144ee, 0xee9900, 0x11aa44, 0xaa11aa];
  // Vendor stands — on sidewalk strips (avenue ± 3.5 units), not in streets or buildings
  const standSpots  = [
    [ 3.5,  22], [ 3.5,  50], [-3.5,  35],
    [33.5,  50], [33.5, -55], [26.5,  15],
    [-26.5,  48], [-33.5, -50], [ 63.5,  42],
    [ 3.5, -65],
  ];
  for (let si = 0; si < standSpots.length; si++) {
    const [sx, sz] = standSpots[si];
    if (inLandmarkZone(sx, sz)) continue;
    if (!_validProp(sx, sz)) continue;
    const ci = si % cartColors.length;
    const cartMat = new THREE.MeshLambertMaterial({ color: cartColors[ci] });
    const umbMat  = new THREE.MeshLambertMaterial({ color: umbColors[ci] });

    const cart = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.85), cartMat);
    cart.position.set(sx, 0.55, sz);
    scene.add(cart);
    // Cart shelf
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.85),
      new THREE.MeshLambertMaterial({ color: 0x888888 }));
    shelf.position.set(sx, 1.13, sz);
    scene.add(shelf);
    // Umbrella pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6),
      new THREE.MeshLambertMaterial({ color: 0x777777 }));
    pole.position.set(sx, 1.9, sz);
    scene.add(pole);
    // Umbrella canopy
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.55, 10), umbMat);
    umb.position.set(sx, 3.4, sz);
    scene.add(umb);
    const umbBrim = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.12, 10),
      new THREE.MeshLambertMaterial({ color: 0xffffff }));
    umbBrim.position.set(sx, 3.18, sz);
    scene.add(umbBrim);
    // Collider for cart body
    propColliders.push(new THREE.Box3(
      new THREE.Vector3(sx - 0.85, 0, sz - 0.55),
      new THREE.Vector3(sx + 0.85, 1.2, sz + 0.55),
    ));
    registerSolid(solidObjects, sx, sz, 0.85, 0.55);
  }

  // ── Steam grates ──────────────────────────────────────────────────────────
  const steamMat = new THREE.MeshStandardMaterial({
    color: 0xffffaa, emissive: 0xffaa00, emissiveIntensity: 0.6,
  });
  const grateSpots = [
    [ 5, 12], [-15, 8], [22, -30], [-32, -12], [8, 55], [48, 3],
    [-5, -20], [35, 45], [-50, 15], [15, -65],
  ];
  for (const [gx, gz] of grateSpots) {
    if (inLandmarkZone(gx, gz)) continue;
    // Steam grates belong on the road surface (they are manholes), so they
    // should be IN a road, not on a sidewalk or in a building.
    if (!_inRoad(gx, gz)) continue;
    const grate = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), steamMat);
    grate.rotation.x = -Math.PI / 2;
    grate.position.set(gx, 0.02, gz);
    scene.add(grate);
    // Faint steam light
    const sLight = new THREE.PointLight(0xffcc44, 0.15, 4);
    sLight.position.set(gx, 0.5, gz);
    scene.add(sLight);
  }

  // ── Street / traffic-light poles at intersections ─────────────────────────
  const poleMat   = new THREE.MeshLambertMaterial({ color: 0x666666 });
  const streetSignMat = new THREE.MeshLambertMaterial({ color: 0x1a5c1a });
  const intersections = [
    [-15,-15],[-15,15],[15,-15],[15,15],[-15,-45],[15,-45],
    [-45,-15],[-45,15],[45,-15],[45,15],[-15,-75],[15,-75],
    [-45,-45],[45,-45],[-75,-15],[-75,15],[75,-15],[75,15],
  ];
  for (const [ix, iz] of intersections) {
    const px = ix + 3, pz = iz + 3;
    // Skip if this intersection's pole position landed inside a road or
    // mid-block after the grid extension shifted things around.
    if (!_validProp(px, pz)) continue;
    const pMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 5.0, 6), poleMat);
    pMesh.position.set(px, 2.5, pz);
    scene.add(pMesh);
    // Horizontal arm
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(px + 1.25, 4.8, pz);
    scene.add(arm);
    // Street name sign
    const sMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.32, 0.06), streetSignMat);
    sMesh.position.set(px + 1.2, 4.6, pz);
    scene.add(sMesh);
    // Traffic light box
    const tlight = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.72, 0.22), poleMat);
    tlight.position.set(px + 2.55, 4.6, pz);
    scene.add(tlight);
    // Lights (green/yellow/red)
    for (const [ly, col] of [[4.88,0x22cc22],[4.6,0xeecc00],[4.32,0xcc1100]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 5),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 }));
      l.position.set(px + 2.55, ly, pz);
      scene.add(l);
    }
  }

  // ── Mailboxes (USPS blue) — on sidewalk edges ────────────────────────────
  const mailMat = new THREE.MeshLambertMaterial({ color: 0x1a4a8a });
  const mailboxPositions = [
    [3.3, 42], [-3.3, -12], [33.3, 48], [26.7, -32],
    [-26.7, 55], [-33.3, -48], [63.3, 38], [-63.3, 22],
    [3.3, -52], [26.7, 52], [-26.7, -62], [33.3, -28],
  ];
  for (const [mx, mz] of mailboxPositions) {
    if (inLandmarkZone(mx, mz)) continue;
    if (!_validProp(mx, mz)) continue;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.35), mailMat);
    box.position.set(mx, 0.45, mz);
    scene.add(box);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.22, 8), mailMat);
    top.rotation.z = Math.PI / 2;
    top.position.set(mx, 0.98, mz);
    scene.add(top);
    propColliders.push(new THREE.Box3(
      new THREE.Vector3(mx - 0.25, 0, mz - 0.18),
      new THREE.Vector3(mx + 0.25, 1.1, mz + 0.18),
    ));
    registerSolid(solidObjects, mx, mz, 0.25, 0.18);
  }

  // ── Park benches scattered near Central Park edge ─────────────────────────
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x5c3d1e });
  const benchSpots = [[-50, 45], [-45, 52], [-55, 58], [-60, 42], [-48, 65]];
  for (const [bx, bz] of benchSpots) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.55), benchMat);
    seat.position.set(bx, 0.5, bz);
    scene.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.07), benchMat);
    back.position.set(bx, 0.8, bz - 0.24);
    scene.add(back);
    for (const lx of [bx - 0.7, bx + 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.55), benchMat);
      leg.position.set(lx, 0.25, bz);
      scene.add(leg);
    }
    registerSolid(solidObjects, bx, bz, 0.9, 0.28);
  }

  // ── Traffic-light pole bases — only where the pole was actually placed ──
  for (const [ix, iz] of intersections) {
    const px = ix + 3, pz = iz + 3;
    if (!_validProp(px, pz)) continue;
    registerSolid(solidObjects, px, pz, 0.15, 0.15);
  }

  return propColliders;
}

// ── Sidewalk furniture: streetlights, hydrants, trees, mailboxes ─────────────

function _nearIntersection(x, z, margin = 4) {
  for (const ax of AVENUES)
    for (const cz of CROSS_STREETS)
      if (Math.abs(x - ax) < margin && Math.abs(z - cz) < margin) return true;
  return false;
}

function _makeStreetlight(scene, solidObjects, x, z, armDir) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 4.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
  );
  pole.position.set(x, 2.2, z);
  scene.add(pole);
  registerSolid(solidObjects, x, z, 0.1, 0.1);

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(armDir.x !== 0 ? 1.0 : 0.07, 0.07, armDir.z !== 0 ? 1.0 : 0.07),
    new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
  );
  arm.position.set(x + armDir.x * 0.5, 4.35, z + armDir.z * 0.5);
  scene.add(arm);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshLambertMaterial({
      color: 0xFFF8DC, emissive: 0xFFF8DC, emissiveIntensity: 0.7,
    }),
  );
  globe.position.set(x + armDir.x, 4.35, z + armDir.z);
  scene.add(globe);
}

function _makeHydrant(scene, solidObjects, x, z) {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.2, 0.55, 8),
    new THREE.MeshLambertMaterial({ color: 0xCC1100 }),
  );
  body.position.set(x, 0.28, z);
  scene.add(body);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xAA0E00 }),
  );
  cap.position.set(x, 0.6, z);
  scene.add(cap);
  registerSolid(solidObjects, x, z, 0.22, 0.22);
}

function _makeTree(scene, solidObjects, x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.2, 1.8, 6),
    new THREE.MeshLambertMaterial({ color: 0x4A3728 }),
  );
  trunk.position.set(x, 0.9, z);
  scene.add(trunk);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x2D5A27 }),
  );
  canopy.position.set(x, 2.4, z);
  scene.add(canopy);
  registerSolid(solidObjects, x, z, 0.25, 0.25);
}

function _makeMailbox(scene, solidObjects, x, z) {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.78, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x003087 }),
  );
  body.position.set(x, 0.4, z);
  scene.add(body);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, 0.22, 8),
    new THREE.MeshLambertMaterial({ color: 0x002A75 }),
  );
  top.rotation.z = Math.PI / 2;
  top.position.set(x, 0.92, z);
  scene.add(top);
  registerSolid(solidObjects, x, z, 0.28, 0.22);
}

function buildSidewalkFurniture(scene, solidObjects) {
  const swOff = STREET_HALF + 0.9;   // distance from road centerline to furniture row

  // Walk along every avenue (N–S)
  for (const ax of AVENUES) {
    let step = 0;
    for (let z = GRID_MIN + 4; z <= GRID_MAX - 4; z += 4) {
      step++;
      if (_nearIntersection(ax, z, 4)) continue;

      // Streetlight every 8 units (every 2nd step), alternating sides
      if (step % 2 === 0) {
        const side = (step % 4 === 0) ? -1 : 1;
        const fx = ax + side * swOff;
        if (!inLandmarkZone(fx, z))
          _makeStreetlight(scene, solidObjects, fx, z, { x: -side, z: 0 });
      }
      // Hydrant every 28 units (every 7th step), west side
      if (step % 7 === 0) {
        const fx = ax - swOff;
        if (!inLandmarkZone(fx, z)) _makeHydrant(scene, solidObjects, fx, z);
      }
      // Tree every 16 units (every 4th step), alternating sides
      if (step % 4 === 1) {
        const side = (step % 8 === 1) ? 1 : -1;
        const fx = ax + side * swOff;
        if (!inLandmarkZone(fx, z)) _makeTree(scene, solidObjects, fx, z);
      }
      // Mailbox every 60 units (every 15th step), east side
      if (step % 15 === 0) {
        const fx = ax + swOff;
        if (!inLandmarkZone(fx, z)) _makeMailbox(scene, solidObjects, fx, z);
      }
    }
  }

  // Walk along every cross street (E–W)
  for (const cz of CROSS_STREETS) {
    let step = 0;
    for (let x = GRID_MIN + 4; x <= GRID_MAX - 4; x += 4) {
      step++;
      if (_nearIntersection(x, cz, 4)) continue;

      if (step % 2 === 0) {
        const side = (step % 4 === 0) ? -1 : 1;
        const fz = cz + side * swOff;
        if (!inLandmarkZone(x, fz))
          _makeStreetlight(scene, solidObjects, x, fz, { x: 0, z: -side });
      }
      if (step % 7 === 0) {
        const fz = cz + swOff;
        if (!inLandmarkZone(x, fz)) _makeHydrant(scene, solidObjects, x, fz);
      }
      if (step % 4 === 2) {
        const side = (step % 8 === 2) ? -1 : 1;
        const fz = cz + side * swOff;
        if (!inLandmarkZone(x, fz)) _makeTree(scene, solidObjects, x, fz);
      }
    }
  }
}

// ── Road & sidewalk ground ────────────────────────────────────────────────────

function buildStreets(scene, blocks) {
  // Base asphalt covering the full 500×500 play area
  const roadMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshLambertMaterial({ color: 0x1C1C1C }),
  );
  roadMesh.rotation.x = -Math.PI / 2;
  scene.add(roadMesh);

  // Concrete sidewalk on every buildable block — but SKIP blocks that fall
  // inside the Central Park footprint, otherwise the off-white sidewalk
  // overlaps the green park grass at the same y and causes white flicker.
  const swMat = new THREE.MeshLambertMaterial({ color: 0xC8C0B0 });
  for (const blk of blocks) {
    const cxMid = (blk.x1 + blk.x2) / 2;
    const czMid = (blk.z1 + blk.z2) / 2;
    // Central Park world bounds: x ∈ [-90, -10], z ∈ [30, 90]
    if (cxMid > -92 && cxMid < -8 && czMid > 28 && czMid < 92) continue;
    const w = blk.x2 - blk.x1, d = blk.z2 - blk.z1;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), swMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cxMid, 0.02, czMid);
    scene.add(mesh);
  }

  // Curb strips along every avenue (E/W edges) and street (N/S edges)
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x6e6e6a });
  const curbThk = 0.18;
  for (const ax of AVENUES) {
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.18, GRID_MAX - GRID_MIN),
        curbMat,
      );
      curb.position.set(ax + side * STREET_HALF, 0.05, (GRID_MIN + GRID_MAX) / 2);
      scene.add(curb);
    }
  }
  for (const cz of CROSS_STREETS) {
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(GRID_MAX - GRID_MIN, 0.18, 0.16),
        curbMat,
      );
      curb.position.set((GRID_MIN + GRID_MAX) / 2, 0.05, cz + side * STREET_HALF);
      scene.add(curb);
    }
  }

  // Center yellow line + dashed white lane markers along every avenue
  const yellowMat = new THREE.MeshLambertMaterial({ color: 0xFFD700 });
  const whiteMat  = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
  for (const ax of AVENUES) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, GRID_MAX - GRID_MIN - 6),
      yellowMat,
    );
    cl.rotation.x = -Math.PI / 2;
    cl.position.set(ax, 0.025, 0);
    scene.add(cl);
    for (let dz = GRID_MIN + 4; dz < GRID_MAX - 4; dz += 6) {
      // Skip dashes inside intersections
      if (CROSS_STREETS.some(cz => Math.abs(dz - cz) < STREET_HALF + 1)) continue;
      const left  = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2.2), whiteMat);
      const right = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2.2), whiteMat);
      left.rotation.x  = right.rotation.x = -Math.PI / 2;
      left.position.set(ax - 1.1,  0.025, dz);
      right.position.set(ax + 1.1, 0.025, dz);
      scene.add(left); scene.add(right);
    }
  }

  // Center yellow line + dashed white lane markers along every cross street
  for (const cz of CROSS_STREETS) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_MAX - GRID_MIN - 6, 0.18),
      yellowMat,
    );
    cl.rotation.x = -Math.PI / 2;
    cl.position.set(0, 0.025, cz);
    scene.add(cl);
    for (let dx = GRID_MIN + 4; dx < GRID_MAX - 4; dx += 6) {
      if (AVENUES.some(ax => Math.abs(dx - ax) < STREET_HALF + 1)) continue;
      const top = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.14), whiteMat);
      const bot = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.14), whiteMat);
      top.rotation.x = bot.rotation.x = -Math.PI / 2;
      top.position.set(dx, 0.025, cz - 1.1);
      bot.position.set(dx, 0.025, cz + 1.1);
      scene.add(top); scene.add(bot);
    }
  }
}

// Crosswalk stripes painted at every avenue × street intersection.
// Drawn as part of the road system so they appear under traffic-light poles.
function _buildCrosswalks(scene) {
  const cwMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  for (const ax of AVENUES) {
    for (const cz of CROSS_STREETS) {
      for (let s = 0; s < 5; s++) {
        const off = -1.6 + s * 0.8;
        // North approach
        const n = new THREE.Mesh(new THREE.PlaneGeometry(0.55, STREET_HALF * 1.6), cwMat);
        n.rotation.x = -Math.PI / 2;
        n.position.set(ax + off, 0.03, cz - STREET_HALF - 0.55);
        scene.add(n);
        // South approach
        const s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.55, STREET_HALF * 1.6), cwMat);
        s2.rotation.x = -Math.PI / 2;
        s2.position.set(ax + off, 0.03, cz + STREET_HALF + 0.55);
        scene.add(s2);
        // East approach
        const e = new THREE.Mesh(new THREE.PlaneGeometry(STREET_HALF * 1.6, 0.55), cwMat);
        e.rotation.x = -Math.PI / 2;
        e.position.set(ax + STREET_HALF + 0.55, 0.03, cz + off);
        scene.add(e);
        // West approach
        const w = new THREE.Mesh(new THREE.PlaneGeometry(STREET_HALF * 1.6, 0.55), cwMat);
        w.rotation.x = -Math.PI / 2;
        w.position.set(ax - STREET_HALF - 0.55, 0.03, cz + off);
        scene.add(w);
      }
    }
  }
}

// ── Landmark: Empire State Building ──────────────────────────────────────────

function buildESB(scene, solidObjects) {
  const lm = (col, emi) => new THREE.MeshLambertMaterial(emi ? { color: col, emissive: emi } : { color: col });
  const group = new THREE.Group();
  function add(geo, mat, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
    return m;
  }

  // 8-tier Art Deco stepped tower (base 16×16)
  const tiers = [
    [16, 16, 12,  6,    0x888898],
    [14, 14, 10, 17,    0x9090A0],
    [11, 11,  8, 25,    0x9898A8],
    [ 9,  9,  8, 32,    0xA0A0B4],
    [ 6,  6,  8, 39,    0xA8A8C0],
    [ 4,  4,  8, 46,    0xB0B0CC],
    [ 3,  3,  6, 52,    0xB8B8D8],
    [ 2,  2,  6, 58,    0xC0C0E0],
  ];
  for (const [w, d, h, centerY, col] of tiers) {
    add(new THREE.BoxGeometry(w, h, d), lm(col), 0, centerY, 0);
  }

  // Solid wall segments for base tier — door gap on south face (x: -3 to +3, 6 units wide)
  const BASE = 8;
  registerSolid(solidObjects,  0,    -BASE, BASE, 0.5); // N wall
  registerSolid(solidObjects, -BASE,  0,    0.5, BASE); // W wall
  registerSolid(solidObjects,  BASE,  0,    0.5, BASE); // E wall
  registerSolid(solidObjects, -5.5,  BASE,  2.5, 0.5); // S wall left  (x -8→-3)
  registerSolid(solidObjects,  5.5,  BASE,  2.5, 0.5); // S wall right (x  3→ 8)

  // Window stripe columns on first 3 tiers (N/S/E/W faces)
  for (let ti = 0; ti < 3; ti++) {
    const [w, d, h, centerY] = tiers[ti];
    const halfW = w / 2, halfD = d / 2;
    const tierBottom = centerY - h / 2;
    const stripeH = h - 1.5;
    const stripeY = tierBottom + 0.75 + stripeH / 2;
    const strMat = lm(0x1A1A2E, 0x0A0A18);
    // N/S faces — stripe along x axis
    for (let x = -halfW + 1.8; x < halfW - 0.9 + 0.01; x += 1.8) {
      add(new THREE.BoxGeometry(0.3, stripeH, 0.07), strMat, x, stripeY, -halfD - 0.01);
      add(new THREE.BoxGeometry(0.3, stripeH, 0.07), strMat, x, stripeY,  halfD + 0.01);
    }
    // E/W faces — stripe along z axis
    for (let z = -halfD + 1.8; z < halfD - 0.9 + 0.01; z += 1.8) {
      add(new THREE.BoxGeometry(0.07, stripeH, 0.3), strMat, -halfW - 0.01, stripeY, z);
      add(new THREE.BoxGeometry(0.07, stripeH, 0.3), strMat,  halfW + 0.01, stripeY, z);
    }
  }

  // Observation deck ring
  add(new THREE.CylinderGeometry(2.8, 2.8, 0.6, 16), lm(0xD8D8D8), 0, 61.3, 0);

  // Art Deco crown — 6 stacked narrowing cylinders
  const crownMat = lm(0xF0F0F0, 0x252525);
  for (const [rt, rb, ch, cy] of [
    [2.2, 2.0, 2.2, 63  ],
    [1.7, 1.7, 2.0, 65.5],
    [1.3, 1.3, 1.8, 68  ],
    [0.9, 0.9, 1.5, 70.3],
    [0.6, 0.6, 1.3, 72.3],
    [0.35,0.35,1.0, 74  ],
  ]) {
    add(new THREE.CylinderGeometry(rt, rb, ch, 16), crownMat, 0, cy, 0);
  }

  // Antenna
  add(new THREE.CylinderGeometry(0.08, 0.08, 14, 6), lm(0xEEEEEE), 0, 82, 0);

  // Identity sign above south entrance
  {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const cx2 = c.getContext('2d');
    cx2.fillStyle = '#1A2040'; cx2.fillRect(0, 0, 1024, 128);
    cx2.font = 'bold 52px "Arial Black", Impact, sans-serif';
    cx2.textAlign = 'center'; cx2.textBaseline = 'middle'; cx2.lineJoin = 'round';
    cx2.strokeStyle = '#8899CC'; cx2.lineWidth = 5; cx2.strokeText('EMPIRE STATE BUILDING', 512, 64);
    cx2.fillStyle = '#E8E8FF'; cx2.fillText('EMPIRE STATE BUILDING', 512, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(10, 1.0, 0.10),
      [lm(0x1A2040), lm(0x1A2040), lm(0x1A2040), lm(0x1A2040),
       new THREE.MeshBasicMaterial({ map: tex }),
       new THREE.MeshBasicMaterial({ map: tex })],
    );
    m.position.set(0, 9.0, 8.06);
    group.add(m);
  }

  group.position.set(0, 0, 0);
  scene.add(group);
  return new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 89, 8));
}

// ── Landmark: Chrysler Building ───────────────────────────────────────────────

function buildChrysler(scene, solidObjects) {
  const lm = (col, emi) => new THREE.MeshLambertMaterial(emi ? { color: col, emissive: emi } : { color: col });
  const group = new THREE.Group();
  function add(geo, mat, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
    return m;
  }

  // Three main setback tiers
  const tiers = [
    [14, 14, 18,  9,    0x9999aa],
    [ 9,  9, 12, 24,    0xaaaabc],
    [ 6,  6,  9, 34.5,  0xbbbbcc],
  ];
  for (const [w, d, h, cy, col] of tiers) {
    add(new THREE.BoxGeometry(w, h, d), lm(col), 0, cy, 0);
    registerSolid(solidObjects, 40, 20, w / 2, d / 2);
  }

  // Vertical brick ribbing on all 3 tiers
  const ribMat = lm(0xD4C9A8);
  for (const [w, d, h, cy] of tiers) {
    const halfW = w / 2, halfD = d / 2;
    const tierBottom = cy - h / 2;
    // N/S faces
    for (let x = -halfW + 0.8; x < halfW - 0.4 + 0.01; x += 0.8) {
      add(new THREE.BoxGeometry(0.3, h, 0.06), ribMat, x, cy, -halfD - 0.01);
      add(new THREE.BoxGeometry(0.3, h, 0.06), ribMat, x, cy,  halfD + 0.01);
    }
    // E/W faces
    for (let z = -halfD + 0.8; z < halfD - 0.4 + 0.01; z += 0.8) {
      add(new THREE.BoxGeometry(0.06, h, 0.3), ribMat, -halfW - 0.01, cy, z);
      add(new THREE.BoxGeometry(0.06, h, 0.3), ribMat,  halfW + 0.01, cy, z);
    }
  }

  // Eagle gargoyles at 4 corners of tier 2 top (y=30)
  const eagleMat = lm(0xC0C0C0);
  for (const [ex, ez] of [[-4,-4],[-4,4],[4,-4],[4,4]]) {
    // Head
    add(new THREE.SphereGeometry(0.45, 7, 6), eagleMat, ex, 30.6, ez);
    // Beak
    add(new THREE.BoxGeometry(0.35, 0.2, 0.25), eagleMat, ex, 30.5, ez - 0.55);
    // Wings (two flat boxes angled)
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.4), eagleMat);
    wingL.position.set(ex - 0.9, 30.2, ez);
    wingL.rotation.z = 0.52;
    group.add(wingL);
    const wingR = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.4), eagleMat);
    wingR.position.set(ex + 0.9, 30.2, ez);
    wingR.rotation.z = -0.52;
    group.add(wingR);
  }

  // Sunburst crown — 4 tiers of radiating spokes at y=40,43,46,49
  const sunMat = lm(0xC8C8C8, 0x111111);
  for (let ti = 0; ti < 4; ti++) {
    const sy = 40 + ti * 3;
    const radius = (ti + 1) * 0.6;
    const discR = 3 - ti * 0.5;
    add(new THREE.CylinderGeometry(discR, discR, 0.3, 8), lm(0xAAAAAA, 0x111111), 0, sy, 0);
    for (let si = 0; si < 8; si++) {
      const angle = (si / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.5, 0.4), sunMat);
      spoke.position.set(Math.sin(angle) * radius, sy, Math.cos(angle) * radius);
      spoke.rotation.y = angle;
      group.add(spoke);
    }
  }

  // Spire
  add(new THREE.CylinderGeometry(0.1, 0.1, 16, 6), lm(0xEFEFEF), 0, 57, 0);

  // Identity sign above south entrance
  {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const cx2 = c.getContext('2d');
    cx2.fillStyle = '#2A2A3A'; cx2.fillRect(0, 0, 1024, 128);
    cx2.font = 'bold 60px "Arial Black", Impact, sans-serif';
    cx2.textAlign = 'center'; cx2.textBaseline = 'middle'; cx2.lineJoin = 'round';
    cx2.strokeStyle = '#AAAACC'; cx2.lineWidth = 5; cx2.strokeText('CHRYSLER BUILDING', 512, 64);
    cx2.fillStyle = '#D4C9A8'; cx2.fillText('CHRYSLER BUILDING', 512, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(10, 1.0, 0.10),
      [lm(0x2A2A3A), lm(0x2A2A3A), lm(0x2A2A3A), lm(0x2A2A3A),
       new THREE.MeshBasicMaterial({ map: tex }),
       new THREE.MeshBasicMaterial({ map: tex })],
    );
    m.position.set(0, 9.0, 7.06);
    group.add(m);
  }

  group.position.set(40, 0, 20);
  scene.add(group);
  return new THREE.Box3(new THREE.Vector3(33, 0, 13), new THREE.Vector3(47, 73, 27));
}


// ── Landmark: Brooklyn Bridge (decorative) ────────────────────────────────────

function buildBrooklynBridge(scene, solidObjects) {
  const lm = (col, emi) => new THREE.MeshLambertMaterial(emi ? { color: col, emissive: emi } : { color: col });
  const group = new THREE.Group();
  function add(geo, mat, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
    return m;
  }

  // Gothic towers at local x=-7 and x=7
  for (const tx of [-7, 7]) {
    // Main shaft
    add(new THREE.BoxGeometry(5, 32, 5), lm(0x8B7355), tx, 16, 0);
    // Horizontal belt courses
    for (const by of [8, 16, 24, 30]) {
      add(new THREE.BoxGeometry(5, 0.3, 5), lm(0xAA9977), tx, by, 0);
    }
    // Pointed arch recesses N and S face
    add(new THREE.BoxGeometry(2.5, 5, 0.15), lm(0x222222), tx, 28, -2.55);
    add(new THREE.BoxGeometry(2.5, 5, 0.15), lm(0x222222), tx, 28,  2.55);
    // Twin crown prongs
    add(new THREE.BoxGeometry(0.8, 4, 0.8), lm(0x9A8A6A), tx - 1.2, 34.5, 0);
    add(new THREE.BoxGeometry(0.8, 4, 0.8), lm(0x9A8A6A), tx + 1.2, 34.5, 0);
    // Arch keystone cap
    add(new THREE.BoxGeometry(5, 0.5, 5), lm(0x9A8A6A), tx, 32.5, 0);
  }

  // Anchorage blocks at each end (local z=-30 and z=30)
  for (const az of [-30, 30]) {
    add(new THREE.BoxGeometry(18, 6, 8), lm(0x696969), 0, 3, az);
  }

  // Bridge deck — main roadway
  add(new THREE.BoxGeometry(14, 0.8, 60), lm(0x9A8A70), 0, 5.2, 0);
  // Pedestrian walkway (raised on top, center)
  add(new THREE.BoxGeometry(4, 0.6, 60), lm(0xD2B48C), 0, 5.8, 0);
  // White lane markings
  add(new THREE.BoxGeometry(0.3, 0.1, 60), lm(0xFFFFFF), -3, 5.65, 0);
  add(new THREE.BoxGeometry(0.3, 0.1, 60), lm(0xFFFFFF),  3, 5.65, 0);
  // Yellow center line
  add(new THREE.BoxGeometry(0.2, 0.1, 60), lm(0xFFD700), 0, 5.65, 0);

  // Cable system — symmetric catenary: two mirrored halves per cable line.
  // Each half rises from an anchorage (z=±30, y≈6) up to the tower top (z=0, y≈32).
  const cableMat = lm(0x555568);
  const HALF_LEN = Math.hypot(30, 26);          // 30 horizontal × 26 vertical
  const HALF_ANG = Math.atan2(26, 30);           // tilt angle so cable goes from low end to high
  for (const cx of [-5, -7, 5, 7]) {
    // South half (z=-30 anchorage → z=0 tower top)
    const south = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, HALF_LEN), cableMat,
    );
    south.position.set(cx, 19, -15);
    south.rotation.x = -HALF_ANG;                // tilt so +z end rises (toward tower)
    group.add(south);
    // North half (z=0 tower top → z=30 anchorage)
    const north = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, HALF_LEN), cableMat,
    );
    north.position.set(cx, 19, 15);
    north.rotation.x = HALF_ANG;                 // mirror — +z end descends (toward anchorage)
    group.add(north);
  }

  // Vertical hangers
  const hangerMat = cableMat;
  for (let hz = -24; hz <= 24; hz += 4) {
    for (const tx of [-7, 7]) {
      add(new THREE.CylinderGeometry(0.07, 0.07, 12, 4), hangerMat, tx, 11, hz);
    }
  }

  // Railing posts and horizontal rails
  const railMat = lm(0x777777);
  for (let pz = -28; pz <= 28; pz += 2) {
    for (const tx of [-7, 7]) {
      add(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 4), railMat, tx, 6.6, pz);
    }
  }
  add(new THREE.BoxGeometry(0.06, 0.06, 60), railMat, -7, 7.2, 0);
  add(new THREE.BoxGeometry(0.06, 0.06, 60), railMat,  7, 7.2, 0);

  // Night lighting along bridge
  const lightMat = lm(0xFFF8DC, 0xFFF0AA);
  for (let lz = -24; lz <= 24; lz += 6) {
    for (const tx of [-7, 7]) {
      add(new THREE.SphereGeometry(0.18, 6, 6), lightMat, tx, 7.5, lz);
    }
  }

  // ── Tower window recesses ─────────────────────────────────────────────────
  for (const tx of [-7, 7]) {
    for (const bz of [-2.7, 0, 2.7]) {
      // Three recessed gothic windows per tower face
      add(new THREE.BoxGeometry(1.1, 3.5, 0.10), lm(0x111118), tx, 22, bz - 2.7); // north face
      add(new THREE.BoxGeometry(1.1, 3.5, 0.10), lm(0x111118), tx, 22, bz + 2.7); // south face
    }
    for (const bx of [-2.7, 0, 2.7]) {
      add(new THREE.BoxGeometry(0.10, 3.5, 1.1), lm(0x111118), tx + (tx > 0 ? 2.7 : -2.7), 22, bx);
    }
  }

  // ── "BROOKLYN BRIDGE 1883" canvas sign on each tower face ────────────────
  const _bbCanvas = document.createElement('canvas');
  _bbCanvas.width = 1024; _bbCanvas.height = 128;
  const _bbCtx = _bbCanvas.getContext('2d');
  _bbCtx.fillStyle = '#D2B48C'; _bbCtx.fillRect(0, 0, 1024, 128);
  _bbCtx.font = 'bold 72px "Arial Black", Impact, sans-serif';
  _bbCtx.textAlign = 'center'; _bbCtx.textBaseline = 'middle';
  _bbCtx.strokeStyle = '#4a3010'; _bbCtx.lineWidth = 8; _bbCtx.lineJoin = 'round';
  _bbCtx.strokeText('BROOKLYN BRIDGE  1883', 512, 64);
  _bbCtx.fillStyle = '#2a1a05'; _bbCtx.fillText('BROOKLYN BRIDGE  1883', 512, 64);
  const _bbTex = new THREE.CanvasTexture(_bbCanvas);
  _bbTex.minFilter = THREE.LinearFilter; _bbTex.needsUpdate = true;
  const _bbMat = new THREE.MeshBasicMaterial({ map: _bbTex });
  for (const tx of [-7, 7]) {
    const signN = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.56, 0.06), _bbMat);
    signN.position.set(tx, 12.5, -2.6);
    group.add(signN);
    const signS = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.56, 0.06), _bbMat);
    signS.position.set(tx, 12.5, 2.6);
    signS.rotation.y = Math.PI;
    group.add(signS);
  }

  // ── Pedestrian walkway planks — alternating wood tones ───────────────────
  const plankMatA = lm(0x8B6914);
  const plankMatB = lm(0x7A5C10);
  for (let pz = -29; pz <= 29; pz += 1.2) {
    const pm = (Math.floor((pz + 30) / 1.2) % 2 === 0) ? plankMatA : plankMatB;
    add(new THREE.BoxGeometry(4, 0.05, 1.1), pm, 0, 5.85, pz);
  }

  group.position.set(-60, 0, -80);
  scene.add(group);

  // ── Tower + anchorage player collision ────────────────────────────────────
  registerSolid(solidObjects, -67, -80, 2.5, 2.5);  // left tower
  registerSolid(solidObjects, -53, -80, 2.5, 2.5);  // right tower
  // Anchorages split into left/right halves — center road lane (x=-63 to -57) must stay open.
  registerSolid(solidObjects, -66, -110, 3, 4);      // south anchorage left
  registerSolid(solidObjects, -54, -110, 3, 4);      // south anchorage right
  registerSolid(solidObjects, -66,  -50, 3, 4);      // north anchorage left
  registerSolid(solidObjects, -54,  -50, 3, 4);      // north anchorage right
  // Bridge deck side railing walls — keep player on the road surface
  registerSolid(solidObjects, -67.5, -80, 0.5, 32); // left deck edge rail (world z -112 to -48)
  registerSolid(solidObjects, -52.5, -80, 0.5, 32); // right deck edge rail

  const roadMat = lm(0x9A8A70);  // match bridge deck color

  // ── Smooth approach ramps — equal length on each side ─────────────────────
  const RAMP_LEN = 14;
  const rampSurf = Math.hypot(RAMP_LEN, BRIDGE_DECK_Y);
  // North ramp: world z=-32 (y=0) to z=-46 (y=BRIDGE_DECK_Y)
  const northRamp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, rampSurf), roadMat);
  northRamp.rotation.x = Math.atan2(BRIDGE_DECK_Y, RAMP_LEN);
  northRamp.position.set(-60, BRIDGE_DECK_Y / 2, -39);
  scene.add(northRamp);

  // South ramp: world z=-128 (y=0) to z=-114 (y=BRIDGE_DECK_Y)
  const southRamp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, rampSurf), roadMat);
  southRamp.rotation.x = -Math.atan2(BRIDGE_DECK_Y, RAMP_LEN);
  southRamp.position.set(-60, BRIDGE_DECK_Y / 2, -121);
  scene.add(southRamp);

  // ── Road under bridge deck ────────────────────────────────────────────────
  const underpassMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const underpass = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 60), underpassMat);
  underpass.position.set(-60, 0.05, -80); // world coords — bridge group z-center
  scene.add(underpass);
  // Center line stripe
  const uLine = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 60),
    new THREE.MeshLambertMaterial({ color: 0xFFFFFF }));
  uLine.position.set(-60, 0.06, -80);
  scene.add(uLine);

  // ── Ramp guardrails (prevent player walking off ramp sides) ──────────────
  registerSolid(solidObjects, -63.25, -38, 0.25, 8);   // north ramp left edge
  registerSolid(solidObjects, -56.75, -38, 0.25, 8);   // north ramp right edge
  registerSolid(solidObjects, -63.25,-120, 0.25, 6);   // south ramp left edge
  registerSolid(solidObjects, -56.75,-120, 0.25, 6);   // south ramp right edge

  // ── NPC spawn-exclusion colliders ─────────────────────────────────────────
  const colliders = [];
  colliders.push(new THREE.Box3(new THREE.Vector3(-69.5, 0, -82.5), new THREE.Vector3(-64.5, 34, -77.5)));  // left tower
  colliders.push(new THREE.Box3(new THREE.Vector3(-55.5, 0, -82.5), new THREE.Vector3(-50.5, 34, -77.5)));  // right tower
  colliders.push(new THREE.Box3(new THREE.Vector3(-69, 0, -114),    new THREE.Vector3(-51, BRIDGE_DECK_Y, -106)));   // south anchorage
  colliders.push(new THREE.Box3(new THREE.Vector3(-69, 0,  -54),    new THREE.Vector3(-51, BRIDGE_DECK_Y,  -46)));   // north anchorage
  colliders.push(new THREE.Box3(new THREE.Vector3(-67, 0, -110),    new THREE.Vector3(-53, BRIDGE_DECK_Y + 1, -50))); // bridge deck
  // Ramp exclusion zones (one box per ramp)
  colliders.push(new THREE.Box3(new THREE.Vector3(-63, 0, -46), new THREE.Vector3(-57, BRIDGE_DECK_Y, -30)));  // north ramp
  colliders.push(new THREE.Box3(new THREE.Vector3(-63, 0, -126), new THREE.Vector3(-57, BRIDGE_DECK_Y, -114))); // south ramp
  return colliders;
}

// ── Landmark: Central Park (terrain) ─────────────────────────────────────────

function buildCentralPark(scene, solidObjects) {
  const lm = (col, emi) => new THREE.MeshLambertMaterial(emi ? { color: col, emissive: emi } : { color: col });
  const group = new THREE.Group();
  function add(geo, mat, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
    return m;
  }

  // ── Park ground ──
  // Lifted well above any city sidewalk/asphalt (those are at y=0 and y=0.02)
  // so the green is never z-fighting any other ground mesh.
  const GRASS_Y = 0.10;
  const TRAIL_Y = 0.16;            // 6cm above grass — comfortable separation
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), lm(0x1E6B1E));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = GRASS_Y;
  group.add(grass);

  // ── Trails (beige) ──
  const BEIGE = 0xD2B48C;
  const beigeMat = lm(BEIGE);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 60), beigeMat);
  path.rotation.x = -Math.PI / 2;
  path.position.y = TRAIL_Y;
  group.add(path);

  add(new THREE.BoxGeometry(2, 0.04, 56), beigeMat,  38, TRAIL_Y, 0);
  add(new THREE.BoxGeometry(2, 0.04, 56), beigeMat, -38, TRAIL_Y, 0);
  add(new THREE.BoxGeometry(76, 0.04, 2), beigeMat,   0, TRAIL_Y, -28);
  add(new THREE.BoxGeometry(76, 0.04, 2), beigeMat,   0, TRAIL_Y,  28);

  // Stone perimeter walls — each side has a 6-unit-wide gate centered on that side
  const wallMat = lm(0x777777);
  const postMat = lm(0x555555);
  // North wall — opening at local x=0
  add(new THREE.BoxGeometry(37, 0.8, 0.5), wallMat, -21.5, 0.4, -29.5);
  add(new THREE.BoxGeometry(37, 0.8, 0.5), wallMat,  21.5, 0.4, -29.5);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat, -3, 1.1, -29.5);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat,  3, 1.1, -29.5);
  // South wall — opening at local x=0
  add(new THREE.BoxGeometry(37, 0.8, 0.5), wallMat, -21.5, 0.4,  29.5);
  add(new THREE.BoxGeometry(37, 0.8, 0.5), wallMat,  21.5, 0.4,  29.5);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat, -3, 1.1,  29.5);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat,  3, 1.1,  29.5);
  // West wall — opening at local z=0
  add(new THREE.BoxGeometry(0.5, 0.8, 27), wallMat, -39.5, 0.4, -16.5);
  add(new THREE.BoxGeometry(0.5, 0.8, 27), wallMat, -39.5, 0.4,  16.5);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat, -39.5, 1.1, -3);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat, -39.5, 1.1,  3);
  // East wall — opening at local z=0
  add(new THREE.BoxGeometry(0.5, 0.8, 27), wallMat, 39.5, 0.4, -16.5);
  add(new THREE.BoxGeometry(0.5, 0.8, 27), wallMat, 39.5, 0.4,  16.5);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat, 39.5, 1.1, -3);
  add(new THREE.BoxGeometry(0.5, 2.2, 0.5), postMat, 39.5, 1.1,  3);

  // 40 trees using seeded PRNG
  const tRng = makePRNG(77);
  const treeColliders = [];
  const gx = -50, gz = 60; // group world origin

  for (let i = 0; i < 40; i++) {
    const tx = (tRng() - 0.5) * 70;
    const tz = (tRng() - 0.5) * 50;
    if (Math.abs(tx) < 3.5) continue;

    const treeType = i % 3;
    if (treeType === 0) {
      // Elm: wide flat cone canopy
      const trunkH = 2.5;
      add(new THREE.CylinderGeometry(0.25, 0.35, trunkH, 6), lm(0x4A2E0A), tx, trunkH / 2, tz);
      add(new THREE.ConeGeometry(3.2, 4, 7), lm(0x2D5A1B), tx, trunkH + 2, tz);
    } else if (treeType === 1) {
      // Oak: sphere canopy
      const trunkH = 2;
      add(new THREE.CylinderGeometry(0.4, 0.5, trunkH, 6), lm(0x3A2008), tx, trunkH / 2, tz);
      add(new THREE.SphereGeometry(3, 7, 5), lm(0x1A4A0A), tx, trunkH + 1.5, tz);
    } else {
      // Decorative: double cone
      const trunkH = 1.8;
      add(new THREE.CylinderGeometry(0.2, 0.25, trunkH, 6), lm(0x4A2E0A), tx, trunkH / 2, tz);
      add(new THREE.ConeGeometry(2, 3, 6),   lm(0x33AA33), tx, trunkH + 1.5, tz);
      add(new THREE.ConeGeometry(1.2, 2.5, 6), lm(0x55CC55), tx, trunkH + 1.5 + 2, tz);
    }

    const wx = gx + tx, wz = gz + tz;
    treeColliders.push(new THREE.Box3(
      new THREE.Vector3(wx - 0.5, 0, wz - 0.5),
      new THREE.Vector3(wx + 0.5, 7, wz + 0.5),
    ));
    registerSolid(solidObjects, wx, wz, 0.8, 0.8);
  }

  // Pond
  add(new THREE.CylinderGeometry(6, 6, 0.15, 16), lm(0x1A3A5C, 0x0A1A2C), 15, 0.08, -8);
  // Lily pads
  const lilyPositions = [[14.5, 0.16, -7.2],[15.8, 0.16, -8.6],[13.8, 0.16, -9],[16.2, 0.16, -7.8],[15, 0.16, -6.5]];
  for (const [lx, ly, lz] of lilyPositions) {
    add(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 8), lm(0x2D6A2D), lx, ly, lz);
  }

  // Bethesda Fountain at x=4, z=5
  const bx = 4, bz = 5;
  add(new THREE.CylinderGeometry(4, 4, 0.4, 16), lm(0xAAAAAA), bx, 0.2, bz);
  add(new THREE.CylinderGeometry(3, 3, 0.5, 16), lm(0x999999), bx, 0.7, bz);
  add(new THREE.CylinderGeometry(0.35, 0.4, 3, 8), lm(0x888888), bx, 1.5, bz);
  // Angel body
  add(new THREE.SphereGeometry(0.45, 6, 6), lm(0xBBBBBB), bx, 4.2, bz);
  add(new THREE.BoxGeometry(0.7, 1.2, 0.4), lm(0xAAAAAA), bx, 3.4, bz);
  add(new THREE.ConeGeometry(0.5, 1.8, 6), lm(0xAAAAAA), bx, 2.5, bz);
  // Wings
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.6), lm(0xCCCCCC));
  wingL.position.set(bx - 0.85, 3.8, bz);
  wingL.rotation.z = 0.5;
  group.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.6), lm(0xCCCCCC));
  wingR.position.set(bx + 0.85, 3.8, bz);
  wingR.rotation.z = -0.5;
  group.add(wingR);

  // Park benches (12 total)
  const benchMat = lm(0x3B1F08);
  const benchPositions = [
    [-15,18],[-10,18],[-5,18],[5,18],[10,18],[15,18],
    [-15,-18],[-10,-18],[-5,-18],[5,-18],[10,-18],[15,-18],
  ];
  for (const [bpx, bpz] of benchPositions) {
    add(new THREE.BoxGeometry(1.8, 0.1, 0.55), benchMat, bpx, 0.5, bpz);
    add(new THREE.BoxGeometry(1.8, 0.5, 0.07), benchMat, bpx, 0.82, bpz - 0.24);
    add(new THREE.BoxGeometry(0.08, 0.5, 0.55), benchMat, bpx - 0.72, 0.25, bpz);
    add(new THREE.BoxGeometry(0.08, 0.5, 0.55), benchMat, bpx + 0.72, 0.25, bpz);
  }

  // Lampposts (6 total)
  const polePositions = [[-20,14],[0,14],[20,14],[-20,-14],[0,-14],[20,-14]];
  for (const [lpx, lpz] of polePositions) {
    add(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), lm(0x2A2A2A), lpx, 3, lpz);
    // 3 globe arms: x=-0.8, 0, +0.8
    for (const gox of [-0.8, 0, 0.8]) {
      add(new THREE.SphereGeometry(0.22, 6, 6), lm(0xFFFACD, 0xFFE88A), lpx + gox, 6.2, lpz);
    }
  }

  // Fountain basin outer torus ring
  add(new THREE.TorusGeometry(3.8, 0.38, 8, 24), lm(0xA0A0A0), bx, 0.4, bz, 0);

  // Diagonal path stripes through the park — same beige, slightly above
  // the central path to avoid z-fighting at the crossing.
  for (const [px, pz, rotY] of [[0,-14,0.4],[0,0,0.4],[0,14,0.4]]) {
    const pathStripe = new THREE.Mesh(new THREE.BoxGeometry(40, 0.04, 1.6), beigeMat);
    pathStripe.rotation.y = rotY;
    pathStripe.position.set(px, TRAIL_Y + 0.02, pz);
    group.add(pathStripe);
  }

  // "CENTRAL PARK" entrance sign on stone pillars at south gate
  const cpCanvas = document.createElement('canvas');
  cpCanvas.width = 1024; cpCanvas.height = 256;
  const cpCtx = cpCanvas.getContext('2d');
  cpCtx.fillStyle = '#1a5c1a'; cpCtx.fillRect(0, 0, 1024, 256);
  cpCtx.fillStyle = '#c8a832'; cpCtx.fillRect(0, 0, 1024, 28); cpCtx.fillRect(0, 228, 1024, 28);
  cpCtx.font = 'bold 130px "Arial Black", Impact, sans-serif';
  cpCtx.textAlign = 'center'; cpCtx.textBaseline = 'middle'; cpCtx.lineJoin = 'round';
  cpCtx.strokeStyle = '#0a2e0a'; cpCtx.lineWidth = 12; cpCtx.strokeText('CENTRAL PARK', 512, 128);
  cpCtx.fillStyle = '#FFD700'; cpCtx.fillText('CENTRAL PARK', 512, 128);
  const cpTex = new THREE.CanvasTexture(cpCanvas);
  cpTex.minFilter = THREE.LinearFilter; cpTex.needsUpdate = true;
  // Stone pillar pair
  add(new THREE.BoxGeometry(1.4, 3.5, 1.4), lm(0x999988), -6, 1.75, 28);
  add(new THREE.BoxGeometry(1.4, 3.5, 1.4), lm(0x999988),  6, 1.75, 28);
  const cpSign = new THREE.Mesh(new THREE.BoxGeometry(11, 1.6, 0.12),
    [new THREE.MeshLambertMaterial({ color: 0x1a5c1a }),
     new THREE.MeshLambertMaterial({ color: 0x1a5c1a }),
     new THREE.MeshLambertMaterial({ color: 0x1a5c1a }),
     new THREE.MeshLambertMaterial({ color: 0x1a5c1a }),
     new THREE.MeshBasicMaterial({ map: cpTex }),
     new THREE.MeshBasicMaterial({ map: cpTex }),
    ]);
  cpSign.position.set(0, 3.0, 28.1);
  group.add(cpSign);

  // ── Perimeter fence — player wall collision + NPC exclusion ─────────────────
  // Each wall has a 6-unit gate centered on its midpoint.
  // North wall — two halves
  registerSolid(solidObjects, gx - 21.5, gz - 29.5, 18.5, 0.25);
  registerSolid(solidObjects, gx + 21.5, gz - 29.5, 18.5, 0.25);
  // South wall — two halves
  registerSolid(solidObjects, gx - 21.5, gz + 29.5, 18.5, 0.25);
  registerSolid(solidObjects, gx + 21.5, gz + 29.5, 18.5, 0.25);
  // West wall — two halves
  registerSolid(solidObjects, gx - 39.5, gz - 16.5, 0.25, 13.5);
  registerSolid(solidObjects, gx - 39.5, gz + 16.5, 0.25, 13.5);
  // East wall — two halves
  registerSolid(solidObjects, gx + 39.5, gz - 16.5, 0.25, 13.5);
  registerSolid(solidObjects, gx + 39.5, gz + 16.5, 0.25, 13.5);

  // NPC-exclusion AABBs, split for each gate
  // North fence
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx - 40, 0, gz - 29.75), new THREE.Vector3(gx - 3, 1, gz - 29.25)));
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx +  3, 0, gz - 29.75), new THREE.Vector3(gx + 40, 1, gz - 29.25)));
  // South fence
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx - 40, 0, gz + 29.25), new THREE.Vector3(gx - 3, 1, gz + 29.75)));
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx +  3, 0, gz + 29.25), new THREE.Vector3(gx + 40, 1, gz + 29.75)));
  // West fence
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx - 39.75, 0, gz - 30), new THREE.Vector3(gx - 39.25, 1, gz - 3)));
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx - 39.75, 0, gz +  3), new THREE.Vector3(gx - 39.25, 1, gz + 30)));
  // East fence
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx + 39.25, 0, gz - 30), new THREE.Vector3(gx + 39.75, 1, gz - 3)));
  treeColliders.push(new THREE.Box3(new THREE.Vector3(gx + 39.25, 0, gz +  3), new THREE.Vector3(gx + 39.75, 1, gz + 30)));

  group.position.set(gx, 0, gz);
  scene.add(group);
  return treeColliders;
}

// ── Landmark: Times Square (street canyon with dense towers + billboards) ────────

function buildTimesSquare(scene, solidObjects) {
  const ox = 10, oz = -40;

  function bx(color, x, y, z, w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(ox + x, y, oz + z);
    scene.add(m);
    return m;
  }
  function emissive(color, emissiveColor, x, y, z, w, h, d, rotY = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, emissive: emissiveColor, emissiveIntensity: 0.95 }));
    m.position.set(ox + x, y, oz + z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  }
  const BRAND_COLORS = {
    'COCA-COLA':       { bg: '#CC0000', text: '#FFFFFF' },
    'ONE TIMES SQ':    { bg: '#CC0000', text: '#FFFFFF' },
    'TKTS':            { bg: '#CC0000', text: '#FFFFFF' },
    'NASDAQ':          { bg: '#003366', text: '#00FF41', stroke: '#001122' },
    'NASDAQ  +2.4%  DJIA  34,521': { bg: '#003366', text: '#00FF41', stroke: '#001122' },
    "M&M'S":           { bg: '#DD1111', text: '#FFFF00', stroke: '#880000' },
    'TIMES SQUARE':    { bg: '#111111', text: '#FFFF00' },
    'BREAKING NEWS':   { bg: '#001199', text: '#FFFFFF' },
    'NYC  LIVE':       { bg: '#001199', text: '#FFFFFF' },
    'DISNEY':          { bg: '#000080', text: '#FFD700' },
    'DISNEY+':         { bg: '#001166', text: '#FFFFFF' },
    'STREAM NOW':      { bg: '#001166', text: '#88AAFF' },
    'MTV':             { bg: '#000000', text: '#FFFFFF' },
    'SPOTIFY':         { bg: '#1DB954', text: '#000000', stroke: '#0A6630' },
    'SEPHORA':         { bg: '#000000', text: '#FFFFFF' },
    'PREMIUM':         { bg: '#1DB954', text: '#000000', stroke: '#0A6630' },
    'WHOLE FOODS':     { bg: '#00674B', text: '#FFFFFF' },
    'AMERICAN EAGLE':  { bg: '#003087', text: '#FFFFFF' },
    'MARKET':          { bg: '#00674B', text: '#FFFFFF' },
    'SAMSUNG':         { bg: '#1428A0', text: '#FFFFFF' },
    'PEPSI':           { bg: '#004B93', text: '#FFFFFF' },
    'MARRIOTT':        { bg: '#8B0000', text: '#FFFFFF' },
    'NIKE':            { bg: '#000000', text: '#FFFFFF' },
    'BROADWAY':        { bg: '#1A1A1A', text: '#FFD700' },
    'BROADWAY  TIMES SQUARE': { bg: '#222222', text: '#FFFF00', stroke: '#000000' },
    'PHANTOM':         { bg: '#111111', text: '#FFDD00' },
    'OF THE OPERA':    { bg: '#111111', text: '#FFDD00' },
    'HAMILTON':        { bg: '#1A1A00', text: '#FFCC00' },
    'TONIGHT 8PM':     { bg: '#1A1A00', text: '#FFCC00' },
    'MOULIN ROUGE':    { bg: '#880000', text: '#FFCCFF' },
    // Ground-floor storefronts
    'STARBUCKS':        { bg: '#00704A', text: '#FFFFFF', stroke: '#003D26' },
    'MCDONALDS':        { bg: '#DA291C', text: '#FFC72C', stroke: '#8B0000' },
    'WALGREENS':        { bg: '#E31837', text: '#FFFFFF' },
    'BANK OF AMERICA':  { bg: '#012169', text: '#FFFFFF' },
    'HARD ROCK CAFE':   { bg: '#2C2C2C', text: '#FFD700', stroke: '#6B5000' },
    'ESPN ZONE':        { bg: '#CC0000', text: '#FFFFFF' },
  };

  // Brand-specific graphic draw functions — called by flatSign when a brand has a graphic logo.
  // Each fn receives (ctx, W=1024, H=256) and draws on top of the already-filled background.
  const BRAND_GRAPHICS = {
    'COCA-COLA': (ctx, W, H) => {
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8;
      ctx.font = `italic 900 ${Math.round(H * 0.68)}px Georgia, "Times New Roman", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Coca-Cola', W / 2, H * 0.40);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.72)'; ctx.lineWidth = 10; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.80);
      ctx.bezierCurveTo(W * 0.22, H * 0.55, W * 0.55, H * 1.0, W * 0.78, H * 0.68);
      ctx.bezierCurveTo(W * 0.88, H * 0.60, W * 0.94, H * 0.60, W, H * 0.60);
      ctx.stroke();
      ctx.restore();
    },
    'SAMSUNG': (ctx, W, H) => {
      ctx.save();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W * 0.43, H * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(H * 0.37)}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SAMSUNG', W / 2, H / 2);
      ctx.restore();
    },
    'PEPSI': (ctx, W, H) => {
      const cx = H * 0.50 + 16, cy = H / 2, r = H * 0.41;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#004B93'; ctx.fillRect(cx - r, cy - r, r * 2, r);
      ctx.fillStyle = '#C8122A'; ctx.fillRect(cx - r, cy, r * 2, r);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.06);
      ctx.bezierCurveTo(cx - r * 0.4, cy - r * 0.28, cx + r * 0.4, cy + r * 0.28, cx + r, cy + r * 0.06);
      ctx.lineTo(cx + r, cy + r * 0.24);
      ctx.bezierCurveTo(cx + r * 0.4, cy + r * 0.46, cx - r * 0.4, cy - r * 0.10, cx - r, cy + r * 0.24);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#BBBBBB'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(H * 0.50)}px 'Arial Black', sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('PEPSI', cx + r + 22, cy);
    },
    'MTV': (ctx, W, H) => {
      const mx = 60, my = 18, mw = 360, mh = 200;
      ctx.fillStyle = '#FFFF00';
      ctx.fillRect(mx, my, 55, mh);
      ctx.fillRect(mx + mw - 55, my, 55, mh);
      ctx.beginPath();
      ctx.moveTo(mx + 55, my);
      ctx.lineTo(mx + mw / 2, my + mh * 0.58);
      ctx.lineTo(mx + mw - 55, my);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 ${Math.round(H * 0.68)}px 'Arial Black', Impact, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('TV', mx + mw - 10, my + mh * 0.64);
      ctx.strokeStyle = '#FFFF00'; ctx.lineWidth = 4;
      ctx.strokeRect(mx + mw + 8, H * 0.08, W - mx - mw - 68, H * 0.82);
    },
    'NASDAQ': (ctx, W, H) => {
      const bars = [0.38, 0.52, 0.44, 0.68, 0.58, 0.78, 0.64, 0.90];
      const bw = 44, gap = 18, sx = 50, baseY = H - 24;
      ctx.fillStyle = '#00FF41';
      for (let i = 0; i < bars.length; i++) {
        const bh = bars[i] * (H - 52);
        ctx.fillRect(sx + i * (bw + gap), baseY - bh, bw, bh);
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(H * 0.34)}px Arial, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('NASDAQ', W - 30, H - 16);
      ctx.fillStyle = '#00FF41';
      ctx.font = `bold ${Math.round(H * 0.28)}px monospace`;
      ctx.fillText('+2.4%', W - 30, H - 16 - Math.round(H * 0.38));
    },
    'NIKE': (ctx, W, H) => {
      ctx.save();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 24; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(55, H * 0.44);
      ctx.bezierCurveTo(W * 0.28, H * 0.92, W * 0.56, H * 0.08, W - 55, H * 0.26);
      ctx.stroke();
      ctx.restore();
    },
    'SEPHORA': (ctx, W, H) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(W * 0.07, 0); ctx.lineTo(W * 0.20, 0);
      ctx.lineTo(W * 0.13, H); ctx.lineTo(0, H);
      ctx.closePath(); ctx.fill();
      ctx.font = `bold ${Math.round(H * 0.43)}px 'Arial Black', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SEPHORA', W * 0.57, H / 2);
    },
    'AMERICAN EAGLE': (ctx, W, H) => {
      const hx = W / 2, hy = H * 0.30, hr = H * 0.19;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 12; ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + side * hr * 0.7, hy + hr * 0.5);
        ctx.bezierCurveTo(hx + side * W * 0.22, hy - hr * 0.2, hx + side * W * 0.40, hy + hr * 0.9, hx + side * W * 0.47, H * 0.62);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx + side * hr * 0.7, hy + hr * 0.5);
        ctx.bezierCurveTo(hx + side * W * 0.18, hy + hr * 0.6, hx + side * W * 0.35, hy + hr * 1.8, hx + side * W * 0.42, H * 0.80);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(H * 0.26)}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('AMERICAN EAGLE', W / 2, H - 8);
    },
    'DISNEY': (ctx, W, H) => {
      const base = H * 0.72;
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(W / 2 - 38, H * 0.28, 76, base - H * 0.28);
      ctx.fillRect(W / 2 - 98, H * 0.40, 42, base - H * 0.40);
      ctx.fillRect(W / 2 + 56, H * 0.40, 42, base - H * 0.40);
      const tri = (lx, ty, tw) => {
        ctx.beginPath();
        ctx.moveTo(lx, ty); ctx.lineTo(lx + tw / 2, ty - 28); ctx.lineTo(lx + tw, ty);
        ctx.closePath(); ctx.fill();
      };
      tri(W / 2 - 38, H * 0.28, 76);
      tri(W / 2 - 98, H * 0.40, 42);
      tri(W / 2 + 56, H * 0.40, 42);
      ctx.fillRect(W / 2 - 118, base, 236, H - base);
      ctx.fillStyle = '#001166';
      ctx.beginPath();
      ctx.arc(W / 2, base, 20, Math.PI, 0); ctx.fill();
      ctx.fillRect(W / 2 - 20, base, 40, H - base);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `italic bold ${Math.round(H * 0.36)}px Georgia, serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('Disney', 30, H * 0.50);
    },
  };

  // Flat canvas-textured sign (BoxGeometry depth 0.10, canvas on face 4 (+Z local) and face 5 (-Z)
  function flatSign(text, x, y, z, sw = 5.6, sh = 2.1, rotY = 0) {
    const b = BRAND_COLORS[text] ?? { bg: '#111111', text: '#FFFFFF' };
    const bgHex = parseInt(b.bg.replace('#', ''), 16);
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = b.bg; ctx.fillRect(0, 0, 1024, 256);
    if (BRAND_GRAPHICS[text]) {
      BRAND_GRAPHICS[text](ctx, 1024, 256);
    } else {
      const fs = text.length > 13 ? 62 : text.length > 9 ? 78 : 96;
      ctx.font = `bold ${fs}px 'Arial Black', Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.strokeStyle = b.stroke ?? '#000000'; ctx.lineWidth = 8;
      ctx.strokeText(text, 512, 128);
      ctx.fillStyle = b.text; ctx.fillText(text, 512, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const sideMat = new THREE.MeshLambertMaterial({ color: bgHex });
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sw, sh, 0.10),
      [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat],
    );
    m.position.set(ox + x, y, oz + z);
    if (rotY) m.rotation.y = rotY;
    scene.add(m);
    window.registerSolid(m);
    return m;
  }

  function label(text, x, y, z, scaleX = 4, scaleY = 1.5) {
    const b = BRAND_COLORS[text];
    const sp = makeLabel(text, {
      fontSize:    80,
      width:       1024,
      height:      256,
      bgColor:     b?.bg     ?? null,
      textColor:   b?.text   ?? '#FFFFFF',
      strokeColor: b?.stroke ?? (b?.bg ? '#00000088' : '#000000'),
      strokeWidth: 8,
    });
    sp.position.set(ox + x, y, oz + z);
    sp.scale.set(scaleX * 1.4, scaleY * 1.4, 1);
    scene.add(sp);
  }

  // ── Ground: concrete + crosswalk stripes ─────────────────────────────────────
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(38, 38),
    new THREE.MeshLambertMaterial({ color: 0xBBBBBB }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(ox, 0.01, oz);
  scene.add(plaza);

  // Pedestrian island (bowtie plaza center)
  bx(0xCCCCBB, 0, 0.04, 0, 14, 0.08, 8);
  bx(0xCCCCBB, 0, 0.04, 6, 10, 0.08, 4);

  // Road lane dividers
  for (const sx of [-11, -4, 4, 11]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 38),
      new THREE.MeshLambertMaterial({ color: 0xFFFFFF }));
    stripe.position.set(ox + sx, 0.02, oz);
    scene.add(stripe);
  }
  // Crosswalk dashes at north + south edges
  for (const cz of [-16, 16]) {
    for (let cx = -12; cx <= 12; cx += 2) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 2.5),
        new THREE.MeshLambertMaterial({ color: 0xFFFFFF }));
      dash.position.set(ox + cx, 0.025, oz + cz);
      scene.add(dash);
    }
  }

  // ── One Times Square — wedge tower. Slimmed from width 9 → 5 so the south
  // passageways either side of OTS are 7.5u wide (was 5.5u). Local z=-13.5
  // keeps the south face at world z=-57, clear of the cross-street z=-60
  // road (which spans world z=-57.5 to -62.5). Faces now at local x=±2.5.
  const OTS_Z = -13.5;
  // Main shaft
  bx(0xC8B89A, 0, 30, OTS_Z, 5, 60, 7);
  registerSolid(solidObjects, ox, oz + OTS_Z, 2.5, 3.5);
  // Setback tier
  bx(0xD0C0A0, 0, 62, OTS_Z, 4, 4, 5);
  // Mast/spire (greyish but tiny — top of the tower)
  bx(0xAAAAAA, 0, 67, OTS_Z, 1.2, 6, 1.2);
  bx(0xBBBBBB, 0, 73.5, OTS_Z, 0.5, 1, 0.5);
  // LED wrap — each panel sits 0.05u OUTSIDE its tower face. With shaft
  // width 5, panels at local x=±2.55 (just outside ±2.5 faces). South/north
  // panels narrower to fit the new 5-wide tower.
  emissive(0xDD0000, 0xFF0000,  -2.55, 18, OTS_Z, 0.10, 28, 6.6, 0);
  emissive(0xDD0000, 0xFF0000,   2.55, 18, OTS_Z, 0.10, 28, 6.6, 0);
  emissive(0x111111, 0xFF0000,   0,   18, OTS_Z - 3.55, 4.4, 28, 0.10, 0);
  emissive(0x111111, 0xFF4400,   0,   18, OTS_Z + 3.55, 4.4, 28, 0.10, 0);
  // Brand labels (sized for the narrower face)
  label('COCA-COLA',    0, 22, OTS_Z - 3.65, 3.5, 1.0);
  label('ONE TIMES SQ', 0, 12, OTS_Z - 3.65, 3.5, 0.85);
  label('TIMES SQUARE', 0, 22, OTS_Z + 3.65, 3.5, 1.0);
  // New Year's Eve ball platform (small dark band at top)
  bx(0x222222, 0, 65.5, OTS_Z, 2, 0.4, 2);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xCCDDFF, emissive: 0x8899FF, emissiveIntensity: 0.8 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 10), ballMat);
  ball.position.set(ox, 67, oz + OTS_Z);
  scene.add(ball);
  // Flagpole
  const fpMat = new THREE.MeshLambertMaterial({ color: 0xAAAAAA });
  const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8, 6), fpMat);
  fp.position.set(ox, 74, oz + OTS_Z);
  scene.add(fp);

  // ── 4 corner towers only. Middle-N, middle-S, middle-W, and middle-E all
  // removed so every cardinal approach to the square (the four avenues that
  // run up to it) is wide-open. The Coca-Cola/Samsung street-level wraps
  // that were rotated onto the middle west/east towers and protruded as
  // "horizontal bars" past the tower edges are deleted with their hosts.
  const towers = [
    [-14,-14, 8,58, 8, 0x888898],
    [ 14,-14, 8,62, 8, 0x9999aa],
    [-14, 14, 8,50, 8, 0x7a8a9a],
    [ 14, 14, 8,54, 8, 0x888880],
  ];
  for (const [tx, tz, tw, th, td, tc] of towers) {
    bx(tc, tx, th / 2, tz, tw, th, td);
    registerSolid(solidObjects, ox + tx, oz + tz, tw / 2, td / 2);
    for (let wy = 2; wy <= th - 2; wy += 3) {
      emissive(0x223344, 0x111828, tx, wy, tz - td / 2 - 0.04, tw - 0.4, 0.8, 0.06);
      emissive(0x223344, 0x111828, tx, wy, tz + td / 2 + 0.04, tw - 0.4, 0.8, 0.06, Math.PI);
      emissive(0x223344, 0x111828, tx - tw / 2 - 0.04, wy, tz, 0.06, 0.8, td - 0.4, Math.PI / 2);
      emissive(0x223344, 0x111828, tx + tw / 2 + 0.04, wy, tz, 0.06, 0.8, td - 0.4, -Math.PI / 2);
    }
  }

  // ── Large LED wraps on tower faces (main ad canvas) ───────────────────────────
  // Each label sits 0.15u IN FRONT of its panel front face so the panel
  // doesn't occlude the text from the player's perspective in the square.
  //
  // West (-14,-14) corner tower's +z face (toward square) at world z=-50.
  // Panel front at world z=-49.95. Labels at local z=-9.85 → world z=-49.85,
  // which is 0.10 in front of the panel.
  emissive(0x003366, 0x0055FF, -14.1, 28, -10, 0.10, 36, 7.6, Math.PI / 2);
  label('NASDAQ  +2.4%  DJIA  34,521', -15, 20, -9.85, 6, 0.9);
  label('NASDAQ', -15, 30, -9.85, 4, 1.2);
  // East (14,-14) corner tower's +z face — M&M's
  emissive(0xBB2200, 0xFF3300,  14.1, 28, -10, 0.10, 36, 7.6, -Math.PI / 2);
  label("M&M'S", 15, 32, -9.85, 4.5, 1.4);
  label('TIMES SQUARE', 15, 26, -9.85, 4, 1.0);
  // BREAKING NEWS / DISNEY+ / SPOTIFY / WHOLE FOODS / COCA-COLA / SAMSUNG
  // wrap panels and labels deleted — they were anchored on towers we removed
  // (middle-N, middle-S, middle-W, middle-E) so without their hosts they were
  // floating mid-air bars or overlapping panels.

  // ── Mid-height billboards — placed FLAT against the inner faces of the
  // four corner towers (no rotation that would make the panel wider than its
  // host tower, no projection past the tower edges). Each billboard sits
  // 0.05u outside its tower face so it's visible from inside the square.
  // Format: [hostTowerLocal{x,z}, hostFace, ly, fw, fh, brand]
  //   hostFace: 'inner-z' for the +z or -z face that points toward square center
  //             'inner-x' for the +x or -x face that points toward square center
  // After the middle towers were removed only the 4 corners remain; their
  // inner faces are at local x=±10 (corner east/west faces facing center) and
  // local z=±10 (corner south/north faces facing center).
  // We mount one large billboard per corner tower, centered over the +z or
  // -z face that the player sees from inside the square.
  const cornerBillboards = [
    // [localCx, localCz, sw, sh, ly, brand, faceAxis]
    // Northwest corner (-14,-14): +z face is at local z=-10 (closer to square
    // center). Mount billboard 0.05u in front of it (z=-9.95). Width/depth
    // matches the tower (w=8, so sign sw=7 fits comfortably inside).
    { lx: -14, lz: -9.95, sw: 7, sh: 14, ly: 44, brand: 'AMERICAN EAGLE', face: '+z' },
    // Northeast corner (14,-14): +z face at local z=-10
    { lx:  14, lz: -9.95, sw: 7, sh: 14, ly: 44, brand: 'NIKE',           face: '+z' },
    // Southwest corner (-14,14): -z face at local z=10
    { lx: -14, lz:  9.95, sw: 7, sh: 14, ly: 32, brand: 'SEPHORA',        face: '-z' },
    // Southeast corner (14,14): -z face at local z=10
    { lx:  14, lz:  9.95, sw: 7, sh: 14, ly: 32, brand: 'DISNEY',         face: '-z' },
  ];
  for (const b of cornerBillboards) {
    // rotY=0 puts the billboard's front face toward +z; rotY=π flips it to -z
    const rotY = b.face === '+z' ? 0 : Math.PI;
    flatSign(b.brand, b.lx, b.ly, b.lz, b.sw, b.sh, rotY);
  }

  // ── Neon torus rings (decorative) ─────────────────────────────────────────────
  const torusMat1 = new THREE.MeshStandardMaterial({ color: 0xFF1493, emissive: 0xFF1493, emissiveIntensity: 1.0 });
  const torusMat2 = new THREE.MeshStandardMaterial({ color: 0xFFFF00, emissive: 0xFFFF00, emissiveIntensity: 1.0 });
  for (const [tx, ty, tz, mat] of [
    [ox - 12, 5, oz - 14.5, torusMat1],
    [ox + 12, 5, oz - 14.5, torusMat2],
    [ox,      8, oz - 14.5, torusMat1],
  ]) {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.14, 8, 16), mat);
    torus.position.set(tx, ty, tz);
    scene.add(torus);
  }

  // ── TKTS red steps — solid ────────────────────────────────────────────────────
  for (let step = 0; step <= 5; step++) {
    const sw = 12 - step * 0.5;
    const sh = 0.35;
    const sd = 0.9;
    const sy = step * sh + sh / 2;
    const sz = 12 - step * 0.7;
    bx(0xCC2200, 0, sy, sz, sw, sh, sd);
    registerSolid(solidObjects, ox, oz + sz, sw / 2 + 0.05, sd / 2 + 0.05);
  }
  // TKTS back wall
  bx(0xAA1100, 0, 1.2, 8.5, 12, 2.4, 0.4);
  registerSolid(solidObjects, ox, oz + 8.5, 6.2, 0.4);
  // TKTS booth top canopy + sign
  emissive(0xCC2200, 0xFF2200, 0, 2.6, 12, 12, 0.2, 0.9);
  label('TKTS', 0, 3.5, 11.4, 4, 1.2);

  // ── Newsstands (solid) ────────────────────────────────────────────────────────
  for (const [nx, nz] of [[-10,-11],[-6,-11],[6,-11],[10,-11],[-10,9],[10,9]]) {
    bx(0x444444, nx, 1.0, nz, 1.4, 2.0, 0.9);
    bx(0x333333, nx, 2.2, nz, 1.5, 0.35, 1.0);
    // Magazine front panel
    emissive(0xFFCC00, 0xFFDD44, nx, 1.3, nz - 0.46, 1.2, 1.6, 0.05);
    registerSolid(solidObjects, ox + nx, oz + nz, 0.75, 0.55);
  }

  // ── Pretzel carts (solid) ─────────────────────────────────────────────────────
  for (const [cx, cz] of [[-11.5,3],[11.5,3],[-11.5,-8],[11.5,-8]]) {
    bx(0x886633, cx, 0.5, cz, 1.2, 0.9, 0.8);
    bx(0x553300, cx, 0.95, cz, 1.3, 0.12, 0.9);
    registerSolid(solidObjects, ox + cx, oz + cz, 0.7, 0.55);
    const cartPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x777777 }));
    cartPole.position.set(ox + cx, 1.8, oz + cz);
    scene.add(cartPole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.55, 8),
      new THREE.MeshLambertMaterial({ color: 0xDD3333 }));
    canopy.position.set(ox + cx, 3.2, oz + cz);
    scene.add(canopy);
    // Striped canopy ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 6, 10),
      new THREE.MeshLambertMaterial({ color: 0xFFFFFF }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(ox + cx, 3.0, oz + cz);
    scene.add(ring);
  }

  // ── Police booth (solid) ──────────────────────────────────────────────────────
  bx(0x1C3A6B, -13, 1.5, 11, 1.6, 3.0, 1.6);
  bx(0xEEEEEE, -13, 3.2,  11, 1.7, 0.35, 1.7);
  bx(0x2255AA, -13, 1.5,  11, 1.5, 2.6, 0.05); // front window
  emissive(0x0044FF, 0x2266FF, -13, 3.55, 11, 0.8, 0.3, 1.65); // light bar
  registerSolid(solidObjects, ox - 13, oz + 11, 0.9, 0.9);

  // ── Pedestrian barriers (solid metal rails) ───────────────────────────────────
  for (const [bx_, bz_] of [[-5, -13],[5,-13],[-5,13],[5,13],[-5,0],[5,0]]) {
    bx(0x555555, bx_, 0.5, bz_, 3.0, 1.0, 0.12);
    registerSolid(solidObjects, ox + bx_, oz + bz_, 1.55, 0.15);
  }
  // Barrier posts
  for (const [bx_, bz_] of [[-5,-13],[5,-13],[-5,13],[5,13],[-5,0],[5,0]]) {
    for (const px of [-1.3, 0, 1.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6),
        new THREE.MeshLambertMaterial({ color: 0x666666 }));
      post.position.set(ox + bx_ + px, 0.55, oz + bz_);
      scene.add(post);
    }
  }

  // ── Taxi cabs (solid) ─────────────────────────────────────────────────────────
  const taxiPositions = [
    [-10.5, 13.5], [-6.5, 13.5], [-2.5, 13.5], [1.5, 13.5],
    [-10.5,-13.5], [-6.5,-13.5], [-2.5,-13.5], [1.5,-13.5],
  ];
  for (const [tx, tz_] of taxiPositions) {
    // Body
    bx(0xF5C518, tx, 0.55, tz_, 3.6, 1.1, 1.8);
    // Roof
    bx(0xE8B800, tx, 1.2, tz_, 2.4, 0.6, 1.6);
    // Taxi light on roof
    emissive(0xFFFF99, 0xFFFFAA, tx, 1.65, tz_, 0.9, 0.3, 0.5);
    // Wheels (visual only)
    for (const [wx, wz_] of [[-1.3, 0.7],[1.3, 0.7],[-1.3,-0.7],[1.3,-0.7]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8),
        new THREE.MeshLambertMaterial({ color: 0x111111 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(ox + tx + wx, 0.28, oz + tz_ + wz_);
      scene.add(wheel);
    }
    registerSolid(solidObjects, ox + tx, oz + tz_, 1.95, 1.0);
  }

  // ── Broadway marquee arch at z=-15 (solid posts) ─────────────────────────────
  bx(0x222222, -8, 6, -15, 1.2, 12, 1.2);
  bx(0x222222,  8, 6, -15, 1.2, 12, 1.2);
  bx(0x111111,  0, 12, -15, 18.4, 1.8, 1.2);
  registerSolid(solidObjects, ox - 8, oz - 15, 0.7, 0.7);
  registerSolid(solidObjects, ox + 8, oz - 15, 0.7, 0.7);
  // Marquee fascia
  emissive(0xFFEE00, 0xFFFF44, 0, 12, -15, 17.6, 1.4, 1.0);
  label('BROADWAY  TIMES SQUARE', 0, 12, -15.7, 8, 1.0);
  // Bulbs
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xFFFFF0, emissive: 0xFFFFCC, emissiveIntensity: 1.0 });
  for (let bi = 0; bi < 12; bi++) {
    const bpx = -8.5 + bi * (17 / 11);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), bulbMat);
    bulb.position.set(ox + bpx, 11.1, oz - 15);
    scene.add(bulb);
  }
  for (const by of [2, 4, 6, 8, 10, 12]) {
    for (const bpx of [-8.7, 8.7]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), bulbMat);
      bulb.position.set(ox + bpx, by, oz - 15);
      scene.add(bulb);
    }
  }
  // Theater name boards on posts
  emissive(0x111111, 0xFF2200, -8, 3, -15.7, 1.0, 3.0, 0.15);
  emissive(0x111111, 0x2200FF,  8, 3, -15.7, 1.0, 3.0, 0.15);

  // ── High-quality Broadway arch canvas sign ────────────────────────────────
  {
    const bwC = document.createElement('canvas');
    bwC.width = 2048; bwC.height = 512;
    const bwCtx = bwC.getContext('2d');
    bwCtx.fillStyle = '#000000'; bwCtx.fillRect(0, 0, 2048, 512);
    bwCtx.fillStyle = '#CC0000';
    bwCtx.fillRect(0, 0, 2048, 40); bwCtx.fillRect(0, 472, 2048, 40);
    bwCtx.fillRect(0, 0, 40, 512);  bwCtx.fillRect(2008, 0, 40, 512);
    bwCtx.fillStyle = '#FFD700';
    bwCtx.font = 'bold 60px Arial';
    for (let si = 0; si < 8; si++) bwCtx.fillText('★', 60 + si * 270, 100);
    bwCtx.font = '900 220px "Arial Black", Impact, sans-serif';
    bwCtx.textAlign = 'center'; bwCtx.textBaseline = 'middle'; bwCtx.lineJoin = 'round';
    bwCtx.strokeStyle = '#FFD700'; bwCtx.lineWidth = 12; bwCtx.strokeText('BROADWAY', 1024, 310);
    bwCtx.fillStyle = '#FFFFFF'; bwCtx.fillText('BROADWAY', 1024, 310);
    bwCtx.font = 'bold 56px Arial'; bwCtx.fillStyle = '#FFD700';
    bwCtx.fillText('★  THE GREAT WHITE WAY  ★', 1024, 445);
    const bwTex = new THREE.CanvasTexture(bwC);
    bwTex.minFilter = THREE.LinearFilter; bwTex.needsUpdate = true;
    const bwSign = new THREE.Mesh(
      new THREE.BoxGeometry(14, 3.2, 0.10),
      [new THREE.MeshLambertMaterial({ color: 0x000000 }),
       new THREE.MeshLambertMaterial({ color: 0x000000 }),
       new THREE.MeshLambertMaterial({ color: 0x000000 }),
       new THREE.MeshLambertMaterial({ color: 0x000000 }),
       new THREE.MeshBasicMaterial({ map: bwTex }),
       new THREE.MeshBasicMaterial({ map: bwTex }),
      ],
    );
    bwSign.position.set(ox, 6.5, oz - 15.1);
    scene.add(bwSign);
  }

  // ── Street-level wall signs (flat, no poles) ─────────────────────────────────
  // Mounted flush on tower faces at street level. rotY chosen so face 4 faces plaza center.
  flatSign('BROADWAY',  -15.05, 6, -4, 4.5, 2.0, Math.PI / 2);   // west tower, east face
  flatSign('COCA-COLA', -15.05, 6,  4, 4.5, 2.0, Math.PI / 2);   // west tower, east face lower
  flatSign('MTV',        15.05, 6, -4, 4.5, 2.0,-Math.PI / 2);   // east tower, west face
  flatSign('NIKE',       15.05, 6,  4, 4.5, 2.0,-Math.PI / 2);   // east tower, west face lower
  flatSign('PEPSI',      -5, 6,-15.05, 5.0, 2.0, 0);              // north face, facing south
  flatSign('SEPHORA',     5, 6,-15.05, 5.0, 2.0, 0);              // north face east, facing south

  // ── Theater marquees on tower ground floors ───────────────────────────────────
  // West tower marquee
  emissive(0x220022, 0xFF00FF, -15.2, 4, -6, 0.10, 5, 6, Math.PI / 2);
  label('PHANTOM', -16, 5.5, -6, 4, 1.0);
  label('OF THE OPERA', -16, 4, -6, 3.5, 0.8);
  // East tower marquee
  emissive(0x001122, 0x0088FF, 15.2, 4, -6, 0.10, 5, 6, -Math.PI / 2);
  label('HAMILTON', 16, 5.5, -6, 4, 1.0);
  label('TONIGHT 8PM', 16, 4, -6, 3.5, 0.8);
  // North tower marquee (facing south)
  emissive(0x001100, 0x00FF88, 0, 4, -15.2, 9, 4, 0.10, 0);
  label('MOULIN ROUGE', 0, 5, -15.6, 5, 1.0);

  // ── News ticker crawl band (low-level, on north faces) ─────────────────────────
  emissive(0x000011, 0x0033FF, -14.1, 3.5, -5, 0.12, 1.0, 7.6, Math.PI / 2);
  emissive(0x000011, 0x0033FF,  14.1, 3.5, -5, 0.12, 1.0, 7.6, -Math.PI / 2);
  emissive(0x000011, 0x0033FF,  0, 3.5, -15.1, 9.6, 1.0, 0.12, 0);

  // ── Point lights for ambiance — kept tight + dim so they accent
  // Times Square without flooding adjacent blocks.
  const glow1 = new THREE.PointLight(0xff8833, 0.6, 24);
  glow1.position.set(ox, 10, oz);
  scene.add(glow1);
  const glow2 = new THREE.PointLight(0x4488ff, 0.4, 20);
  glow2.position.set(ox - 10, 6, oz - 10);
  scene.add(glow2);
  const glow3 = new THREE.PointLight(0xff2288, 0.3, 18);
  glow3.position.set(ox + 10, 6, oz + 10);
  scene.add(glow3);

  // ── Ground-floor storefronts on outer tower bases ──────────────────────────
  // Tower grid: NW[-14,-14,w=8,d=8] NE[14,-14,w=8,d=8] SW[-14,14] SE[14,14]
  //             W[-15,0,w=6,d=10]   E[15,0,w=6,d=10]
  // Face offset = half-depth + 0.1 clearance
  flatSign('STARBUCKS',      -14, 2.8, -18.1, 7.6, 2.8, Math.PI);      // NW outer south
  flatSign('MCDONALDS',       14, 2.8, -18.1, 7.6, 2.8, Math.PI);      // NE outer south
  flatSign('WALGREENS',      -14, 2.8,  18.1, 7.6, 2.8, 0);            // SW outer north
  flatSign('BANK OF AMERICA', 14, 2.8,  18.1, 7.6, 2.8, 0);            // SE outer north
  // Originally these two signs hung on the middle-west / middle-east towers,
  // but those towers were removed when we widened the avenues into the
  // square. Re-pin them to the OUTER faces of the corner towers (which still
  // exist) so they hang flush against a real wall instead of mid-air.
  flatSign('HARD ROCK CAFE', -18.1, 2.8, -14, 7, 2.8, Math.PI / 2);   // NW tower west face
  flatSign('ESPN ZONE',       18.1, 2.8, -14, 7, 2.8, -Math.PI / 2);  // NE tower east face
}

// ── Generic interior rooms ────────────────────────────────────────────────────

function buildGenericInteriors(scene, enterables, _SO) {
  function _b(grp, color, x, y, z, w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z); grp.add(m);
  }
  function _c(grp, color, x, y, z, r, h) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z); grp.add(m);
  }
  // NPC spawn positions per room type (relative to room center)
  const SPAWN_POS = {
    Cafe:         [[-3, 1.5], [3, 2],    [ 0, -5]],
    Diner:        [[-2,-4.5], [2,-4.5],  [-4, -1]],
    Gym:          [[ 0,  0],  [4, -3],   [-4,  3]],
    Office:       [[-4, -1],  [4,  1],   [ 0, -6]],
    // Shop interior intentionally empty — Morton stands at the back of the
    // room (z=-4.5) and the player walks straight north from the entry door
    // (z≈9) to reach him. Random crowd NPCs in this path would obscure or
    // intercept the first-shop interaction.
    Shop:         [],
    Bar:          [[ 0, -5],  [3, -2],   [-4, -6]],
    Gallery:      [[-2,  0],  [4, -2],   [ 0,  5]],
    Laundry:      [[ 2,  3],  [-2, 5],   [ 4, -2]],
    Pharmacy:     [[ 3,  2],  [-3, -2],  [ 0,  6]],
    'Hotel Lobby':[[ 0,  3],  [-4,  0],  [ 4, -4]],
    KFC:          [[-5,  5],  [ 5,  5],  [ 0,  2]],
    Bodega:       [[-5,  5],  [ 5,  5],  [-5,  0]],
    Museum:       [[ 0, -3],  [ 5,  2],  [-5, -1]],
    Barbershop:   [[-3,  0],  [ 3, -1],  [ 0, -5]],
  };

  function furnish(grp, type) {
    switch (type) {
      case 'Cafe':
        _b(grp, 0x8b6340,  0, 0.55,-7, 10, 1.1, 1);
        for (const [tx, tz] of [[-4, 0],[0, 3],[4,-1]]) {
          _c(grp, 0x8b6340, tx, 0.8, tz, 0.6, 0.12);
          _c(grp, 0x888899, tx, 0.37, tz, 0.05, 0.75);
          _b(grp, 0x333333, tx-1, 0.3, tz, 0.5, 0.6, 0.5);
          _b(grp, 0x333333, tx+1, 0.3, tz, 0.5, 0.6, 0.5);
        }
        break;
      case 'Diner':
        _b(grp, 0x8b6340, 0, 0.55,-6, 12, 1.1, 0.8);
        for (let sx=-5; sx<=5; sx+=2.5) _c(grp, 0x888899, sx, 0.5,-4.5, 0.3, 1.0);
        for (const bz of [3,-2]) {
          _b(grp, 0x332211,-5, 0.3, bz, 3, 0.6, 0.8);
          _b(grp, 0x332211, 5, 0.3, bz, 3, 0.6, 0.8);
        }
        break;
      case 'Gym':
        for (const [mx,mz] of [[-4,-2],[0,-2],[4,-2],[-4,3],[4,3]])
          _b(grp, 0x336644, mx, 0.05, mz, 3, 0.1, 4);
        for (let wx=-6; wx<=6; wx+=2) _c(grp, 0x888899, wx, 0.3, 6.5, 0.3, 0.6);
        _c(grp, 0xcc3322,-7, 2.0,-5, 0.4, 2.5);
        break;
      case 'Office':
        for (const [dx,dz] of [[-4,-3],[4,-3],[-4,3],[4,3]]) {
          _b(grp, 0x8b6340, dx, 0.75, dz, 3.5, 0.1, 2);
          _b(grp, 0x333333, dx, 0.3, dz+1.5, 0.5, 0.6, 0.5);
          _b(grp, 0x222244, dx, 1.2, dz+1.45, 0.5, 0.9, 0.08);
        }
        break;
      case 'Shop': {
        // ── MORTON'S SHOP — wood-paneled storefront with a counter ────────
        // North wall: tall wooden shelf wall (kept from the old generic shop)
        _b(grp, 0x6a3a1c, 0, 2, -9.6, 18, 4, 0.3);
        // East/west wall shelves with darker oak finish + brass shelf rails
        _b(grp, 0x5a2f12,-9, 2, 0, 0.3, 4, 10);
        _b(grp, 0x5a2f12, 9, 2, 0, 0.3, 4, 10);
        for (let sh=0.9; sh<4; sh+=1.0) {
          _b(grp, 0xccaa77,-9, sh, 0, 0.35, 0.06, 9.5);
          _b(grp, 0xccaa77, 9, sh, 0, 0.35, 0.06, 9.5);
          _b(grp, 0xccaa77, 0, sh, -9.4, 17, 0.06, 0.35);
        }
        // L-shaped wooden counter where Morton stands (south side)
        _b(grp, 0x6a3a1c, -3, 0.55, -3, 7, 1.1, 1.4);
        _b(grp, 0x6a3a1c,  4, 0.55, -3, 5, 1.1, 1.4);
        // Counter-top brass trim
        _b(grp, 0xC9A24A, -3, 1.13, -3, 7.05, 0.06, 1.45);
        _b(grp, 0xC9A24A,  4, 1.13, -3, 5.05, 0.06, 1.45);
        // Brass cash register on the counter
        _b(grp, 0x886622, 5, 1.5, -3, 1.0, 0.7, 0.7);
        _b(grp, 0xC9A24A, 5, 1.95, -3, 0.7, 0.2, 0.5);   // top register drawer trim
        // Glowing demo "products" along the inner shelf — one per booster,
        // each color-keyed to its shop card (Sprint = green, Radar = cyan,
        // Armor = grey-blue, Sword = silver, Tracker = gold)
        const PROD = [
          { col:0x44dd66, x:-7,  z:-9.2 },   // Sprint Feet
          { col:0x66ccdd, x:-3.5,z:-9.2 },   // Radar
          { col:0x6688aa, x: 0,  z:-9.2 },   // Armor
          { col:0xcccccc, x: 3.5,z:-9.2 },   // Sword
          { col:0xFFD700, x: 7,  z:-9.2 },   // Ancient Tracker
        ];
        for (const p of PROD) {
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 1.2, 0.6),
            new THREE.MeshStandardMaterial({ color:p.col, emissive:p.col, emissiveIntensity:0.35 }),
          );
          m.position.set(p.x, 1.6, p.z);
          grp.add(m);
        }
        // Hanging pendant lamp directly over the counter
        _b(grp, 0x4a3a20, 0, 4, -2.5, 0.16, 0.04, 0.16);   // mount
        _b(grp, 0xC9A24A, 0, 3.0, -2.5, 0.05, 1.0, 0.05);  // chain
        const lampShade = new THREE.Mesh(
          new THREE.ConeGeometry(0.55, 0.5, 8),
          new THREE.MeshStandardMaterial({ color:0x8B4513, emissive:0xff9933, emissiveIntensity:0.7 }),
        );
        lampShade.position.set(0, 2.5, -2.5);
        lampShade.rotation.x = Math.PI;
        grp.add(lampShade);
        // Warm point light attached to the room group (local coords — `ox`
        // and `oz` aren't in scope here; we'd ReferenceError and crash the
        // whole World constructor at startup).
        const shopLight = new THREE.PointLight(0xffaa44, 1.4, 22);
        shopLight.position.set(0, 2.4, -2.5);
        grp.add(shopLight);
        // Wood-burned "MORTON'S SHOP" sign on the north wall
        const mscanvas = document.createElement('canvas');
        mscanvas.width = 1024; mscanvas.height = 256;
        const msctx = mscanvas.getContext('2d');
        msctx.fillStyle = '#3a2010'; msctx.fillRect(0, 0, 1024, 256);
        msctx.strokeStyle = '#C9A24A'; msctx.lineWidth = 8;
        msctx.strokeRect(12, 12, 1000, 232);
        msctx.font = 'bold 110px "Georgia", serif';
        msctx.textAlign = 'center'; msctx.textBaseline = 'middle';
        msctx.fillStyle = '#FFD27A';
        msctx.fillText("MORTON'S SHOP", 512, 100);
        msctx.font = 'italic 36px "Georgia", serif';
        msctx.fillStyle = '#C9A24A';
        msctx.fillText('— smart spenders win —', 512, 195);
        const mstex = new THREE.CanvasTexture(mscanvas);
        mstex.minFilter = THREE.LinearFilter;
        const msMat = new THREE.MeshBasicMaterial({ map: mstex, transparent: true, side: THREE.DoubleSide });
        const msSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), msMat);
        msSign.position.set(0, 3.3, -9.4);
        grp.add(msSign);
        break;
      }
      case 'Bar':
        _b(grp, 0x332211, 0, 1.0,-7, 12, 1.0, 1.0);
        _b(grp, 0x332211,-7, 1.0,-2, 1.0, 1.0, 9);
        for (let bx=-4; bx<=4; bx+=2) _c(grp, 0x888899, bx, 0.45,-5.5, 0.28, 0.9);
        _b(grp, 0xeeeeee, 0, 2.2,-9, 8, 0.12, 0.2);
        _b(grp, 0xeeeeee, 0, 3.0,-9, 8, 0.12, 0.2);
        break;
      case 'Gallery':
        for (const [px,pz] of [[-5,-3],[5,-3],[-5,4],[5,4]]) {
          _c(grp, 0xeeeeee, px, 0.75, pz, 0.5, 1.5);
          _c(grp, 0x888899, px, 1.6,  pz, 0.35, 0.2);
        }
        for (const fx of [-5, 0, 5]) {
          _b(grp, 0xddbbaa, fx, 3,-9.5, 3, 2.5, 0.1);
          _b(grp, 0x888899, fx, 3,-9.45, 2.6, 2.1, 0.06);
        }
        break;
      case 'Laundry':
        for (let lx=-7; lx<=7; lx+=3) {
          _b(grp, 0xccddee, lx, 0.7,-7, 2.5, 1.4, 0.8);
          _c(grp, 0x888899, lx, 0.8,-6.55, 0.55, 0.08);
        }
        _b(grp, 0x8b6340, 0, 0.35, 5, 10, 0.12, 1);
        _b(grp, 0x8b6340,-9, 0.35, 0, 1, 0.12, 8);
        break;
      case 'Pharmacy':
        // Shelving aisles
        for (let ax=-6; ax<=6; ax+=3) {
          _b(grp, 0xdddddd, ax, 1.0, 0, 0.3, 2.0, 8);
          for (let sh=0.5; sh<2; sh+=0.65) _b(grp, 0xccddee, ax, sh, 0, 0.36, 0.06, 7.8);
        }
        // Pharmacy counter
        _b(grp, 0x336699, 0, 1.0,-8, 12, 2.0, 1.2);
        break;
      case 'Hotel Lobby':
        // Reception desk (U-shape)
        _b(grp, 0x8b6340, 0, 1.1,-7, 8, 0.15, 1.5);
        _b(grp, 0x8b6340,-4.5, 1.1,-5.5, 1.5, 0.15, 4);
        _b(grp, 0x8b6340, 4.5, 1.1,-5.5, 1.5, 0.15, 4);
        // Lobby chairs + coffee table
        for (const [cx,cz] of [[-5,3],[5,3],[-5,6],[5,6]]) {
          _b(grp, 0x554433, cx, 0.4, cz, 1.8, 0.8, 1.8);
        }
        _b(grp, 0x8b7355, 0, 0.3, 4.5, 2.5, 0.6, 1.4);
        // Column pillars
        for (const [px,pz] of [[-7,-3],[7,-3],[-7,7],[7,7]]) {
          _c(grp, 0xddddcc, px, 2.0, pz, 0.45, 4.0);
        }
        break;
      case 'KFC':
        // Ordering counter along north wall (red)
        _b(grp, 0xcc0000, 0, 1.0,-7.5, 14, 2.0, 1.2);
        _b(grp, 0xff2200, 0, 2.1,-7.5, 14, 0.12, 1.2);   // counter top edge
        // Menu boards above counter
        _b(grp, 0x111111,-4.5, 3.5,-9.8, 5.5, 2.5, 0.1);
        _b(grp, 0xdd1111,-4.5, 3.5,-9.8, 5.3, 2.3, 0.08);
        _b(grp, 0x111111, 4.5, 3.5,-9.8, 5.5, 2.5, 0.1);
        _b(grp, 0xdd1111, 4.5, 3.5,-9.8, 5.3, 2.3, 0.08);
        // Kitchen divider behind counter
        _b(grp, 0xdddddd, 0, 1.0,-5.5, 14, 2.0, 0.2);
        // Fryer units (kitchen side)
        _b(grp, 0x888888,-6, 1.0,-4.5, 2.5, 2.0, 1.5);
        _b(grp, 0x888888,-2, 1.0,-4.5, 2.5, 2.0, 1.5);
        // KFC bucket prop on counter
        _b(grp, 0xff6600, 4.5, 2.2,-7.5, 0.8, 0.9, 0.8);
        // Dining tables + chairs in customer area
        for (const [tx,tz] of [[-5, 3],[-5, 7],[5, 3],[5, 7]]) {
          _c(grp, 0xcc0000, tx, 0.8, tz, 0.55, 0.12);
          _c(grp, 0x888899, tx, 0.4, tz, 0.04, 0.8);
          for (const [cx,cz] of [[tx-1.2,tz],[tx+1.2,tz],[tx,tz-1.2],[tx,tz+1.2]]) {
            _b(grp, 0xcc1111, cx, 0.3, cz, 0.5, 0.6, 0.5);
          }
        }
        break;
      case 'Bodega': {
        // ── FLEET FEET — sneaker store. Toned-down palette so the room
        // reads as a sneaker shop without the white walls + bright pendants
        // washing out everything. Charcoal walls + a single orange accent
        // band carry the brand without overwhelming the eye.
        _b(grp, 0x2a2a2e, 0, 2.0, -9.6, 18, 4.0, 0.3);   // charcoal feature wall
        _b(grp, 0xff6633, 0, 1.4, -9.55, 17, 0.45, 0.32); // narrow orange accent band
        _b(grp, 0x4a4a52,-9, 2.0,  0,    0.3, 4.0, 10);   // muted grey side walls
        _b(grp, 0x4a4a52, 9, 2.0,  0,    0.3, 4.0, 10);
        // Floating shelf rails — black metal — and color-coded shoe boxes per
        // tier sitting on the shelves. Three rows on each side.
        const TIER_COLS = [0x4a6b8a, 0x4a8a4a, 0x6a4a8a, 0xaa5530, 0x9a8030, 0x6a5a4a];
        for (let row = 0; row < 3; row++) {
          const sy = 0.85 + row * 1.1;
          _b(grp, 0x222222,-9, sy, 0, 0.32, 0.05, 9.4);  // black shelf rail
          _b(grp, 0x222222, 9, sy, 0, 0.32, 0.05, 9.4);
          for (let bz = -3.5; bz <= 3.5; bz += 1.4) {
            const c = TIER_COLS[(row * 3 + Math.round(bz / 1.4 + 4)) % TIER_COLS.length];
            _b(grp, c, -8.65, sy + 0.18, bz, 0.55, 0.30, 1.05);  // shoe box left
            _b(grp, c,  8.65, sy + 0.18, bz, 0.55, 0.30, 1.05);  // shoe box right
          }
        }
        // L-shaped counter (mirror of Morton's so the shopkeeper has space)
        _b(grp, 0x3a3a3e, -3, 0.55, -3, 7, 1.1, 1.4);
        _b(grp, 0x3a3a3e,  4, 0.55, -3, 5, 1.1, 1.4);
        _b(grp, 0xcc5522, -3, 1.13, -3, 7.05, 0.06, 1.45);   // dimmer orange counter trim
        _b(grp, 0xcc5522,  4, 1.13, -3, 5.05, 0.06, 1.45);
        // Display plinth in the middle of the floor showcasing a featured pair
        _b(grp, 0x111111, 0, 0.45, 3, 1.6, 0.9, 1.2);
        _b(grp, 0xb89030, 0, 1.05, 3, 0.9, 0.20, 0.70);     // muted gold sneaker on plinth
        // Hanging pendant lights — toned-down emissive so they suggest light
        // without baking the whole room. One central pendant instead of three.
        _b(grp, 0x222222, 0, 4.0, -2.5, 0.10, 0.04, 0.10);
        const shade = new THREE.Mesh(
          new THREE.ConeGeometry(0.42, 0.40, 8),
          new THREE.MeshStandardMaterial({ color:0x4a3018, emissive:0xaa5520, emissiveIntensity:0.30 }),
        );
        shade.position.set(0, 3.2, -2.5);
        shade.rotation.x = Math.PI;
        grp.add(shade);
        // Single warm point light, half the previous intensity
        const ffLight = new THREE.PointLight(0xffaa66, 0.6, 18);
        ffLight.position.set(0, 2.6, 0);
        grp.add(ffLight);
        // FLEET FEET sign on the charcoal feature wall — warm-orange text
        // with thin matching trim, no bright bands or white background.
        const ffcanvas = document.createElement('canvas');
        ffcanvas.width = 1024; ffcanvas.height = 256;
        const ffctx = ffcanvas.getContext('2d');
        ffctx.fillStyle = '#1a1a1c'; ffctx.fillRect(0, 0, 1024, 256);
        ffctx.strokeStyle = '#cc5522'; ffctx.lineWidth = 6;
        ffctx.strokeRect(10, 10, 1004, 236);
        ffctx.font = 'bold 120px "Impact", "Arial Black", sans-serif';
        ffctx.textAlign = 'center'; ffctx.textBaseline = 'middle';
        ffctx.fillStyle = '#e88040';
        ffctx.fillText('FLEET FEET', 512, 110);
        ffctx.font = 'italic 26px "Arial", sans-serif';
        ffctx.fillStyle = '#a06030';
        ffctx.fillText('— dress your soles —', 512, 200);
        const fftex = new THREE.CanvasTexture(ffcanvas);
        fftex.minFilter = THREE.LinearFilter;
        const ffMat = new THREE.MeshBasicMaterial({ map: fftex, transparent: true, side: THREE.DoubleSide });
        const ffSign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), ffMat);
        ffSign.position.set(0, 3.2, -9.4);
        grp.add(ffSign);
        break;
      }
      case 'Museum':
        // Pedestals with artifacts
        for (const [px,pz] of [[-5,-4],[0,-4],[5,-4],[-5,2],[5,2]]) {
          _c(grp, 0xddddcc, px, 0.7, pz, 0.6, 1.4);
          _b(grp, 0x4a3820, px, 1.6, pz, 0.9, 0.9, 0.9);
        }
        // Hanging banner
        _b(grp, 0x3344aa, 0, 3.2,-9.5, 4, 1.8, 0.08);
        // Velvet rope stanchions
        for (const [rx,rz] of [[-3,-1],[3,-1],[-3,4],[3,4]]) {
          _c(grp, 0xddaa44, rx, 0.6, rz, 0.06, 1.2);
        }
        break;
      case 'Barbershop': {
        // Barber chairs (3)
        for (let bx=-5; bx<=5; bx+=5) {
          _c(grp, 0xcc2222, bx, 0.6, -3, 0.7, 1.2);
          _b(grp, 0x333333, bx, 1.1, -3, 1.3, 0.9, 0.6);
          _b(grp, 0x888888, bx, 1.65,-3, 1.3, 0.25, 0.5);
        }
        _b(grp, 0xaaccee, 0, 2.0,-9.3, 12, 4.0, 0.08); // mirror wall
        const poleW = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 8),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        poleW.position.set(8, 1.1, 8); grp.add(poleW);
        const stripeR = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 8),
          new THREE.MeshLambertMaterial({ color: 0xcc1111 }));
        stripeR.position.set(8, 1.5, 8); grp.add(stripeR);
        _b(grp, 0x554433, 7, 0.45, 3, 2.5, 0.9, 0.9); // waiting bench
        break;
      }
    }
  }

  // Furniture AABBs per room type — {cx, cz, hw, hd} relative to room local origin (0,0)
  const FLOOR_PROPS = {
    Cafe:         [{cx: 0, cz:-7, hw:5,    hd:0.5 },
                   // tables
                   {cx:-4, cz: 0, hw:0.6, hd:0.6}, {cx:0, cz: 3, hw:0.6, hd:0.6}, {cx:4, cz:-1, hw:0.6, hd:0.6}],
    Diner:        [{cx: 0, cz:-6, hw:6,    hd:0.4 },
                   // counter stools
                   {cx:-5, cz:-4.5, hw:0.3, hd:0.3}, {cx:-2.5, cz:-4.5, hw:0.3, hd:0.3},
                   {cx: 0, cz:-4.5, hw:0.3, hd:0.3}, {cx: 2.5, cz:-4.5, hw:0.3, hd:0.3},
                   {cx: 5, cz:-4.5, hw:0.3, hd:0.3},
                   // booths
                   {cx:-5, cz: 3, hw:1.5, hd:0.4}, {cx: 5, cz: 3, hw:1.5, hd:0.4},
                   {cx:-5, cz:-2, hw:1.5, hd:0.4}, {cx: 5, cz:-2, hw:1.5, hd:0.4}],
    Gym:          [{cx: 6.5, cz: 6.5, hw:0.3, hd:0.3},
                   {cx:-7,   cz: 6.5, hw:0.3, hd:0.3},
                   // punching bag
                   {cx:-7, cz:-5, hw:0.4, hd:0.4}],
    Office:       [{cx:-4, cz:-3, hw:1.75, hd:1   }, {cx:4, cz:-3, hw:1.75, hd:1 },
                   {cx:-4, cz: 3, hw:1.75, hd:1   }, {cx:4, cz: 3, hw:1.75, hd:1 }],
    Shop:         [{cx:-9, cz: 0, hw:0.15, hd:5   }, {cx:9, cz: 0, hw:0.15, hd:5 },
                   {cx: 0, cz:-9, hw:9,    hd:0.15},
                   // L-shaped Morton's counter
                   {cx:-3, cz:-3, hw:3.55, hd:0.75},
                   {cx: 4, cz:-3, hw:2.55, hd:0.75}],
    Bar:          [{cx: 0, cz:-7, hw:6,    hd:0.5 }, {cx:-7, cz:-2, hw:0.5, hd:4.5},
                   // bar stools
                   {cx:-4, cz:-5.5, hw:0.3, hd:0.3}, {cx:-2, cz:-5.5, hw:0.3, hd:0.3},
                   {cx: 0, cz:-5.5, hw:0.3, hd:0.3}, {cx: 2, cz:-5.5, hw:0.3, hd:0.3},
                   {cx: 4, cz:-5.5, hw:0.3, hd:0.3}],
    Gallery:      [// 4 sculpture pedestals
                   {cx:-5, cz:-3, hw:0.55, hd:0.55}, {cx: 5, cz:-3, hw:0.55, hd:0.55},
                   {cx:-5, cz: 4, hw:0.55, hd:0.55}, {cx: 5, cz: 4, hw:0.55, hd:0.55}],
    Laundry:      [{cx: 0, cz:-7, hw:7,    hd:0.4 }, {cx:-9, cz: 0, hw:0.5, hd:4  },
                   {cx: 0, cz: 5, hw:5,    hd:0.5 }],
    Pharmacy:     [{cx: 0, cz:-8, hw:6,    hd:0.6 },
                   // all 5 shelving aisles (every 3 units from -6 to +6)
                   {cx:-6, cz: 0, hw:0.36, hd:4 }, {cx:-3, cz: 0, hw:0.36, hd:4 },
                   {cx: 0, cz: 0, hw:0.36, hd:4 }, {cx: 3, cz: 0, hw:0.36, hd:4 },
                   {cx: 6, cz: 0, hw:0.36, hd:4 }],
    'Hotel Lobby':[{cx: 0, cz:-7, hw:4,    hd:0.75}, {cx:-4.5, cz:-5.5, hw:0.75, hd:2}, {cx:4.5, cz:-5.5, hw:0.75, hd:2},
                   // corner columns
                   {cx:-7, cz:-3, hw:0.5, hd:0.5}, {cx:7, cz:-3, hw:0.5, hd:0.5},
                   {cx:-7, cz: 7, hw:0.5, hd:0.5}, {cx:7, cz: 7, hw:0.5, hd:0.5},
                   // lobby chairs
                   {cx:-5, cz: 3, hw:0.9, hd:0.9}, {cx: 5, cz: 3, hw:0.9, hd:0.9},
                   {cx:-5, cz: 6, hw:0.9, hd:0.9}, {cx: 5, cz: 6, hw:0.9, hd:0.9},
                   // coffee table
                   {cx: 0, cz: 4.5, hw:1.25, hd:0.7}],
    KFC:          [{cx:0, cz:-7.5, hw:7, hd:0.6}, {cx:0, cz:-5.5, hw:7, hd:0.1},
                   // kitchen equipment
                   {cx:-6, cz:-4.5, hw:1.25, hd:0.75}, {cx:-2, cz:-4.5, hw:1.25, hd:0.75},
                   // dining tables (4)
                   {cx:-5, cz: 3, hw:0.55, hd:0.55}, {cx:-5, cz: 7, hw:0.55, hd:0.55},
                   {cx: 5, cz: 3, hw:0.55, hd:0.55}, {cx: 5, cz: 7, hw:0.55, hd:0.55}],
    // Fleet Feet — sneaker store. Side shelf walls, brand feature wall behind
    // the counter, L-shaped checkout counter, and a centerpiece display plinth.
    Bodega:       [{cx:-9, cz: 0, hw:0.15, hd:5   }, {cx:9,  cz: 0, hw:0.15, hd:5 },
                   {cx: 0, cz:-9, hw:5,    hd:0.15},
                   {cx:-3, cz:-3, hw:3.5,  hd:0.7 }, {cx:4,  cz:-3, hw:2.5, hd:0.7},
                   {cx: 0, cz: 3, hw:0.8,  hd:0.6 }],
    Museum:       [// 5 pedestals
                   {cx:-5, cz:-4, hw:0.6, hd:0.6}, {cx: 0, cz:-4, hw:0.6, hd:0.6},
                   {cx: 5, cz:-4, hw:0.6, hd:0.6}, {cx:-5, cz: 2, hw:0.6, hd:0.6},
                   {cx: 5, cz: 2, hw:0.6, hd:0.6}],
    Barbershop:   [{cx:-5, cz:-3, hw:0.7,  hd:0.7 }, {cx:0, cz:-3, hw:0.7, hd:0.7}, {cx:5, cz:-3, hw:0.7, hd:0.7},
                   // waiting bench
                   {cx: 7, cz: 3, hw:1.25, hd:0.45}],
  };

  const WALL_CLR  = { Cafe:0xd4b896, Diner:0xddcc99, Gym:0x778866, Office:0x99aabb,
                      Shop:0xccaa88, Bar:0x554433,   Gallery:0xeeeeee, Laundry:0x88aabb,
                      Pharmacy:0xe8f0f8, 'Hotel Lobby':0xf0ead8, KFC:0xcc1111,
                      Bodega:0x222222, Museum:0xf0ece4, Barbershop:0xe8eecc };
  const FLOOR_CLR = { Cafe:0x8b7355, Diner:0x666655, Gym:0x445533,  Office:0x556677,
                      Shop:0x776655, Bar:0x332211,   Gallery:0xdddddd, Laundry:0x445566,
                      Pharmacy:0xeeeeff, 'Hotel Lobby':0xc8aa88, KFC:0x333333,
                      Bodega:0x444444, Museum:0xd4c8a8, Barbershop:0x999966 };
  const ROOM_LIGHT= { Cafe:0xfff5e0, Diner:0xffe8c8, Gym:0xe0f0e0, Office:0xf0f0ff,
                      Shop:0xfff8e0, Bar:0xff8822,   Gallery:0xffffff, Laundry:0xe8f0ff,
                      Pharmacy:0xffffff, 'Hotel Lobby':0xffd080, KFC:0xff5500,
                      Bodega:0xcc8855, Museum:0xf8f0e0, Barbershop:0xffeedd };

  const interiors = {};
  const npcSpawns = [];
  const exitMat = new THREE.MeshStandardMaterial({
    color: 0xffe060, emissive: 0xffe060, emissiveIntensity: 0.85,
  });

  enterables.forEach(({ id, name: typeName, cityReturnPos: cityRetPos, exitYaw: eYaw }, i) => {
    const ox = INTERIOR_BASE_X + (3 + i) * 200;
    const oz = 0;
    const grp = new THREE.Group();

    const wallMat  = new THREE.MeshLambertMaterial({ color: WALL_CLR[typeName]  ?? 0xcccccc, side: THREE.BackSide });
    const floorMat = new THREE.MeshLambertMaterial({ color: FLOOR_CLR[typeName] ?? 0x888888 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
    floor.rotation.x = -Math.PI / 2; grp.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(20, 20),
      new THREE.MeshLambertMaterial({ color: 0xddddcc }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 4; grp.add(ceil);

    for (const { pos, rotY } of [
      { pos:[0,2,-10], rotY:0 }, { pos:[0,2,10], rotY:Math.PI },
      { pos:[-10,2,0], rotY:Math.PI/2 }, { pos:[10,2,0], rotY:-Math.PI/2 },
    ]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(20, 4), wallMat);
      w.position.set(...pos); w.rotation.y = rotY; grp.add(w);
    }

    // Ceiling light for this room
    const rLight = new THREE.PointLight(ROOM_LIGHT[typeName] ?? 0xffffff, 0.7, 22);
    rLight.position.set(ox, 3.8, oz);
    scene.add(rLight);

    // Override the in-world label for the two re-skinned shops so the room
    // signage matches the shopkeeper / brand inside.
    const DISPLAY_NAME = {
      Bodega: 'FLEET FEET',
      Shop:   "MORTON'S SHOP",
    };
    const labelText = DISPLAY_NAME[typeName] ?? typeName.toUpperCase();
    const lbl = makeLabel(labelText, { fontSize: 60, width: 512, height: 128, textColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 6 });
    lbl.position.set(0, 3.3, -3); lbl.scale.set(4, 1, 1); grp.add(lbl);

    const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.8, 0.2), exitMat);
    exitDoor.position.set(0, 1.4, 9.85); grp.add(exitDoor);

    furnish(grp, typeName);

    // World-space NPC spawn positions for this interior
    for (const [rx, rz] of (SPAWN_POS[typeName] ?? [])) {
      npcSpawns.push({ x: ox + rx, y: 0, z: oz + rz, intId: id });
    }

    grp.position.set(ox, 0, oz);
    scene.add(grp);

    const colliders = [
      new THREE.Box3(new THREE.Vector3(ox-10,0,oz-10.3), new THREE.Vector3(ox+10,4,oz-9.7)),
      new THREE.Box3(new THREE.Vector3(ox-10,0,oz+ 9.7), new THREE.Vector3(ox+10,4,oz+10.3)),
      new THREE.Box3(new THREE.Vector3(ox-10.3,0,oz-10), new THREE.Vector3(ox-9.7,4,oz+10)),
      new THREE.Box3(new THREE.Vector3(ox+ 9.7,0,oz-10), new THREE.Vector3(ox+10.3,4,oz+10)),
    ];

    // Flat solid objects for new player collision
    const intSolids = [];
    registerSolid(intSolids, ox,       oz - 10, 10,  0.3); // N wall
    registerSolid(intSolids, ox - 5.5, oz + 10, 4.5, 0.3); // S wall left of door
    registerSolid(intSolids, ox + 5.5, oz + 10, 4.5, 0.3); // S wall right of door
    registerSolid(intSolids, ox - 10,  oz,      0.3, 10);  // W wall
    registerSolid(intSolids, ox + 10,  oz,      0.3, 10);  // E wall
    for (const { cx, cz, hw, hd } of (FLOOR_PROPS[typeName] ?? [])) {
      registerSolid(intSolids, ox + cx, oz + cz, hw, hd);
    }

    interiors[id] = {
      group: grp,
      playerSpawn:      new THREE.Vector3(ox, 0, oz + 7.5),
      entryYaw:         0,
      exitDoorWorldPos: new THREE.Vector3(ox, 1.5, oz + 9.85),
      cityReturnPos:    cityRetPos,
      exitYaw:          eYaw ?? Math.PI,
      colliders,
      solidObjects:     intSolids,
    };
  });

  return { interiors, npcSpawns };
}

// ── Emissive landmark doors (entry points) ────────────────────────────────────

// Returns array of door descriptors used each frame for proximity checks.
function buildLandmarkDoors(scene) {
  const doorDefs = [
    { id: 'esb',      name: 'Empire State Building', pos: new THREE.Vector3( 0,  1.5,   8.2) },
    { id: 'chrysler', name: 'Chrysler Building',      pos: new THREE.Vector3(40,  1.5,  27.15) },
    { id: 'wtc',      name: 'One World Trade Center', pos: new THREE.Vector3( 0,  1.5, -165.9) },
    { id: 'gc',       name: 'Grand Central Terminal', pos: new THREE.Vector3(75,  1.5, -24.8) },
  ];

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffe060, emissive: 0xffe060, emissiveIntensity: 0.85,
  });

  for (const def of doorDefs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), mat);
    mesh.position.copy(def.pos);
    scene.add(mesh);
  }

  return doorDefs;
}

// ── Interior rooms ────────────────────────────────────────────────────────────
// Each interior is a 20×20 room placed at (INTERIOR_BASE_X + idx*200, 0, 0).
// The player is teleported here on entry and back to cityReturnPos on exit.

function buildInteriors(scene, _SO) {
  const defs = [
    { id: 'esb',      name: 'EMPIRE STATE BUILDING', color: 0x888898,
      cityReturnPos: new THREE.Vector3(0, 0, 13) },
    { id: 'chrysler', name: 'CHRYSLER BUILDING',      color: 0x9999aa,
      cityReturnPos: new THREE.Vector3(40, 0, 29) },
    { id: 'wtc',      name: 'ONE WORLD TRADE CENTER', color: 0x4a6680,
      cityReturnPos: new THREE.Vector3(0, 0, -160) },
    // Grand Central uses a separate ox slot (1800) to avoid colliding with the
    // generic interiors that start at INTERIOR_BASE_X + 600 (Cafe at 2600).
    { id: 'gc',       name: 'GRAND CENTRAL TERMINAL', color: 0xc8bc98,
      cityReturnPos: new THREE.Vector3(75, 0, -22), customOx: 1800 },
  ];

  const interiors = {};

  defs.forEach(({ id, name, color, cityReturnPos, customOx }, idx) => {
    const ox = customOx ?? (INTERIOR_BASE_X + idx * 200);
    const oz = 0;
    const group = new THREE.Group();

    const lm = (col, emi) => new THREE.MeshLambertMaterial(emi ? { color: col, emissive: emi } : { color: col });
    function gadd(geo, mat, x, y, z, rotY = 0) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rotY) m.rotation.y = rotY;
      group.add(m);
      return m;
    }

    const roomH   = (id === 'esb' || id === 'wtc' || id === 'gc') ? 12 : 10;
    const wallMat  = new THREE.MeshLambertMaterial({ color, side: THREE.BackSide });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x3a3635 });

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), wallMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = roomH;
    group.add(ceiling);

    // 4 walls as PlaneGeometry (BackSide so they render inward)
    const wallDefs = [
      { pos: [0, roomH / 2, -10], rotY: 0 },
      { pos: [0, roomH / 2,  10], rotY: Math.PI },
      { pos: [-10, roomH / 2, 0], rotY:  Math.PI / 2 },
      { pos: [ 10, roomH / 2, 0], rotY: -Math.PI / 2 },
    ];
    for (const { pos, rotY } of wallDefs) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, roomH), wallMat);
      wall.position.set(...pos);
      wall.rotation.y = rotY;
      group.add(wall);
    }

    // ── Room-specific content ──────────────────────────────────────────────────
    if (id === 'esb') {
      // ── MARBLE FLOOR: 5×5 checkerboard ──────────────────────────────────────
      for (let xi = 0; xi < 5; xi++) {
        for (let zi = 0; zi < 5; zi++) {
          const col = (xi + zi) % 2 === 0 ? 0xF5F0E8 : 0x1A1A2A;
          gadd(new THREE.BoxGeometry(3.5, 0.12, 3.5), lm(col), -8 + xi * 3.6, 0.06, -8 + zi * 3.6);
        }
      }

      // ── COFFERED GOLD CEILING: 4×4 panels at y=11.87 ────────────────────────
      for (let xi = 0; xi < 4; xi++) {
        for (let zi = 0; zi < 4; zi++) {
          const panX = -7.5 + xi * 5, panZ = -7.5 + zi * 5;
          gadd(new THREE.BoxGeometry(4.6, 0.28, 4.6), lm(0xB8860B, 0x3A1800), panX, 11.85, panZ);
          gadd(new THREE.BoxGeometry(4.0, 0.12, 4.0), lm(0xD4AF37, 0x442200), panX, 12.0, panZ);
        }
      }
      for (let px = -8; px <= 8; px += 4) gadd(new THREE.BoxGeometry(0.25, 0.12, 20), lm(0xD4AF37), px, 11.94, 0);
      for (let pz = -8; pz <= 8; pz += 4) gadd(new THREE.BoxGeometry(20, 0.12, 0.25), lm(0xD4AF37), 0, 11.94, pz);

      // ── COLUMNS: 8 dark marble with gold capitals ────────────────────────────
      const colPositions = [[-7,-6],[7,-6],[-7,0],[7,0],[-7,6],[7,6],[-3,-9],[3,-9]];
      for (const [cx, cz] of colPositions) {
        gadd(new THREE.BoxGeometry(0.9, 0.3, 0.9),            lm(0x2A2A3A), cx, 0.15, cz);
        gadd(new THREE.CylinderGeometry(0.38, 0.38, 11, 10), lm(0x1A1A2C), cx, 5.5, cz);
        gadd(new THREE.CylinderGeometry(0.58, 0.42, 0.4, 8), lm(0xD4AF37), cx, 11.2, cz);
        gadd(new THREE.BoxGeometry(0.85, 0.2, 0.85),          lm(0xB8960B), cx, 11.5, cz);
      }

      // ── EAST WALL — Elevator bank ─────────────────────────────────────────────
      gadd(new THREE.BoxGeometry(0.3, 12, 9.8), lm(0x2A2028), 7.5, 6, 0); // alcove back panel
      for (let ei = 0; ei < 3; ei++) {
        const ez = -3 + ei * 3;
        gadd(new THREE.BoxGeometry(0.18, 5.0, 2.4), lm(0xD4AF37), 9.65, 2.5, ez);    // gold frame
        gadd(new THREE.BoxGeometry(0.12, 4.4, 1.9), lm(0x7A5500), 9.60, 2.2, ez);    // door panel
        gadd(new THREE.BoxGeometry(0.12, 0.2, 2.0), lm(0xD4AF37), 9.60, 4.65, ez);   // transom
        for (let fi = 0; fi < 7; fi++) {
          const ang = -Math.PI / 2.2 + (fi / 6) * (Math.PI / 1.1);
          const fan = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), lm(0xD4AF37));
          fan.position.set(9.55, 5.4, ez); fan.rotation.z = ang; group.add(fan);
        }
      }
      gadd(new THREE.BoxGeometry(0.12, 12, 0.2), lm(0xD4AF37), 9.63, 6, -1.5);
      gadd(new THREE.BoxGeometry(0.12, 12, 0.2), lm(0xD4AF37), 9.63, 6,  1.5);

      // ── NORTH WALL — Grand reception desk ────────────────────────────────────
      gadd(new THREE.BoxGeometry(9,   1.1,  1.6), lm(0x2A1A0A),  0, 0.55, -7);
      gadd(new THREE.BoxGeometry(9.1, 0.09, 1.7), lm(0xD4AF37),  0, 1.1,  -7);
      gadd(new THREE.BoxGeometry(0.15, 1.1, 1.6), lm(0xD4AF37),  4.5, 0.55, -7);
      gadd(new THREE.BoxGeometry(0.15, 1.1, 1.6), lm(0xD4AF37), -4.5, 0.55, -7);
      // Info sign above desk
      gadd(new THREE.BoxGeometry(6,   0.5, 0.08), lm(0x1A1A2A), 0, 3.5, -9.6);
      gadd(new THREE.BoxGeometry(5.6, 0.4, 0.06), lm(0xD4AF37, 0x4A3000), 0, 3.5, -9.62);

      // ── WEST WALL — Grand staircase (8 steps) ────────────────────────────────
      for (let s = 0; s < 8; s++) {
        const sz = 7.5 - s * 1.0, sy = 0.18 + s * 0.46;
        gadd(new THREE.BoxGeometry(4.5, 0.2,  1.0),  lm(0xC8C0B0), -7.5, sy,        sz);
        gadd(new THREE.BoxGeometry(4.5, 0.46, 0.14), lm(0xA09888), -7.5, sy - 0.11, sz - 0.5);
      }
      // Landing + mezzanine floor
      gadd(new THREE.BoxGeometry(5, 0.22, 4),   lm(0xC8C0B0), -7.5, 3.7,  -1.5);
      gadd(new THREE.BoxGeometry(5, 0.22, 9.5), lm(0x222030), -7.5, 3.7,  -5.75);
      // Mezzanine railing
      for (let pz = -9; pz <= -3; pz += 1.5)
        gadd(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), lm(0xD4AF37), -5.2, 4.15, pz);
      gadd(new THREE.BoxGeometry(0.07, 0.07, 7), lm(0xD4AF37), -5.2, 4.6, -6);
      // Stair handrail posts + rail
      for (let s = 0; s < 8; s += 3)
        gadd(new THREE.CylinderGeometry(0.06, 0.06, 3.8 - s * 0.45, 5), lm(0xD4AF37), -5.3, 2, 7.5 - s * 1.0);
      gadd(new THREE.BoxGeometry(0.07, 0.07, 9), lm(0xD4AF37), -5.3, 3.8, 3.5);

      // ── SOUTH ENTRANCE — Security arch frames ────────────────────────────────
      gadd(new THREE.BoxGeometry(2.8, 3.4, 0.3), lm(0x1A1A2A), -3.8, 1.7, 7.5);
      gadd(new THREE.BoxGeometry(2.8, 3.4, 0.3), lm(0x1A1A2A),  3.8, 1.7, 7.5);
      gadd(new THREE.BoxGeometry(0.3, 0.3, 2.4), lm(0xD4AF37), -3.8, 3.5, 7.5);
      gadd(new THREE.BoxGeometry(0.3, 0.3, 2.4), lm(0xD4AF37),  3.8, 3.5, 7.5);

      // ── WALL DECORATIONS — Art Deco pilasters ────────────────────────────────
      for (let px = -9; px <= 9; px += 4.5) {
        gadd(new THREE.BoxGeometry(0.25, 12, 0.18), lm(0x8B6914), px, 6, -9.9);
        gadd(new THREE.BoxGeometry(0.25, 12, 0.18), lm(0x8B6914), px, 6,  9.9);
      }
      for (let pz = -9; pz <= 9; pz += 4.5)
        gadd(new THREE.BoxGeometry(0.18, 12, 0.25), lm(0x8B6914), -9.9, 6, pz);
      // Horizontal frieze band at y=8
      gadd(new THREE.BoxGeometry(20, 0.4, 0.15), lm(0xD4AF37), 0, 8, -9.92);
      gadd(new THREE.BoxGeometry(20, 0.4, 0.15), lm(0xD4AF37), 0, 8,  9.92);
      gadd(new THREE.BoxGeometry(0.15, 0.4, 20), lm(0xD4AF37), -9.92, 8, 0);
      gadd(new THREE.BoxGeometry(0.15, 0.4, 20), lm(0xD4AF37),  9.92, 8, 0);
      // Wainscoting at y=1.2
      gadd(new THREE.BoxGeometry(20, 0.15, 0.1), lm(0x2A2A3A), 0, 1.2, -9.93);
      gadd(new THREE.BoxGeometry(20, 0.15, 0.1), lm(0x2A2A3A), 0, 1.2,  9.93);
      gadd(new THREE.BoxGeometry(0.1, 0.15, 20), lm(0x2A2A3A), -9.93, 1.2, 0);
      gadd(new THREE.BoxGeometry(0.1, 0.15, 20), lm(0x2A2A3A),  9.93, 1.2, 0);

      // ── LIGHTING — pendant clusters + central chandelier ─────────────────────
      for (const [lx, lz] of [[-5,-4],[0,-4],[5,-4],[-5,4],[0,4],[5,4]]) {
        gadd(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), lm(0x555555), lx, 11.35, lz);
        gadd(new THREE.SphereGeometry(0.28, 8, 8), lm(0xFFF5CC, 0xFFEE99), lx, 10.85, lz);
        gadd(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 10), lm(0xD4AF37), lx, 10.96, lz);
      }
      gadd(new THREE.CylinderGeometry(1.3, 1.3, 0.18, 16), lm(0xD4AF37), 0, 11.1, 0);
      gadd(new THREE.SphereGeometry(0.42, 8, 8), lm(0xFFF5CC, 0xFFEE99), 0, 10.55, 0);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3)
        gadd(new THREE.SphereGeometry(0.18, 6, 6), lm(0xFFF5CC, 0xFFEE99), Math.cos(a)*0.95, 10.65, Math.sin(a)*0.95);

      // Label
      const label = makeLabel('EMPIRE STATE BUILDING  EST. 1931', { fontSize: 38, width: 1024, height: 128, textColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 5 });
      label.position.set(0, 9.5, 3);
      label.scale.set(8, 1, 1);
      group.add(label);

    } else if (id === 'chrysler') {
      // Red/black marble floor 4×4 tile grid
      for (let xi = 0; xi < 4; xi++) {
        for (let zi = 0; zi < 4; zi++) {
          const tileX = -8 + xi * (16 / 3);
          const tileZ = -8 + zi * (16 / 3);
          const col = (xi + zi) % 2 === 0 ? 0x8B0000 : 0x111111;
          gadd(new THREE.BoxGeometry(3.8, 0.12, 3.8), lm(col), tileX, 0.06, tileZ);
        }
      }
      // Wall cladding lower half — dark wood panels on N wall
      for (let row = 0; row < 4; row++) {
        gadd(new THREE.BoxGeometry(0.06, 1.0, 19), lm(0x4A2E0A), -9.97, 0.5 + row * 1.1, 0);
      }
      // E/W wall cladding
      for (let row = 0; row < 4; row++) {
        gadd(new THREE.BoxGeometry(19, 1.0, 0.06), lm(0x4A2E0A), 0, 0.5 + row * 1.1, -9.97);
        gadd(new THREE.BoxGeometry(19, 1.0, 0.06), lm(0x4A2E0A), 0, 0.5 + row * 1.1,  9.97);
      }
      // Ceiling mural panels
      for (const cpx of [-5, 0, 5]) {
        gadd(new THREE.BoxGeometry(6, 0.15, 8), lm(0x8B4513, 0x2A1000), cpx, 9.95, 0);
      }
      // 6 dark red marble columns at [±7,±3] and [±7,0]
      for (const [ccx, ccz] of [[-7,-3],[-7,0],[-7,3],[7,-3],[7,0],[7,3]]) {
        gadd(new THREE.CylinderGeometry(0.35, 0.35, 8, 8), lm(0x6B0000), ccx, 4, ccz);
        gadd(new THREE.CylinderGeometry(0.48, 0.48, 0.2, 8), lm(0xDDDDDD), ccx, 8.1, ccz);
      }
      // Floor medallion center
      gadd(new THREE.CylinderGeometry(3, 3, 0.06, 16), lm(0xFFD700), 0, 0.07, 0);
      gadd(new THREE.CylinderGeometry(2.2, 2.2, 0.07, 16), lm(0xB8860B), 0, 0.075, 0);
      gadd(new THREE.CylinderGeometry(1.4, 1.4, 0.07, 16), lm(0xFFD700), 0, 0.08, 0);
      // 4 amber elevator doors on east wall
      for (let ei = 0; ei < 4; ei++) {
        const ez = -4.5 + ei * 3;
        gadd(new THREE.BoxGeometry(0.1, 4.0, 2.0), lm(0xFFBF00), 9.65, 2, ez);
        gadd(new THREE.BoxGeometry(0.08, 3.7, 1.7), lm(0x5C3317), 9.62, 2, ez);
        // 3 horizontal strips on panel
        for (const sy of [1.2, 2.0, 2.8]) {
          gadd(new THREE.BoxGeometry(0.06, 0.06, 1.65), lm(0xFFBF00, 0x553300), 9.6, sy, ez);
        }
      }
      // 8 wall sconces (2 per wall) at y=2.5, ±5 offset
      const sconcePositions = [
        // N wall (z=-9.7, x=±5)
        [-5, 2.5, -9.7, 0], [5, 2.5, -9.7, 0],
        // S wall (z=9.7, x=±5)
        [-5, 2.5, 9.7, Math.PI], [5, 2.5, 9.7, Math.PI],
        // W wall (x=-9.7, z=±5)
        [-9.7, 2.5, -5, Math.PI / 2], [-9.7, 2.5, 5, Math.PI / 2],
        // E wall (x=9.7, z=±5)
        [9.7, 2.5, -5, -Math.PI / 2], [9.7, 2.5, 5, -Math.PI / 2],
      ];
      for (const [sx, sy, sz, srot] of sconcePositions) {
        gadd(new THREE.BoxGeometry(0.2, 0.4, 0.15), lm(0x554400), sx, sy, sz, srot);
        gadd(new THREE.SphereGeometry(0.15, 6, 6), lm(0xFFE4B5, 0xFFCC88), sx, sy + 0.25, sz);
      }
      // Label
      const label = makeLabel('CHRYSLER BUILDING EST. 1930', { fontSize: 60, width: 512, height: 128, textColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 6 });
      label.position.set(0, 8, 5);
      label.scale.set(4, 1, 1);
      group.add(label);

    } else if (id === 'wtc') {
      // ── 1WTC LOBBY: polished black granite + memorial reflecting pool ──
      // Floor: large dark granite tiles
      for (let xi = 0; xi < 4; xi++) {
        for (let zi = 0; zi < 4; zi++) {
          const tx = -7.5 + xi * 5;
          const tz = -7.5 + zi * 5;
          const col = (xi + zi) % 2 === 0 ? 0x1a1a22 : 0x222230;
          gadd(new THREE.BoxGeometry(4.8, 0.10, 4.8), lm(col), tx, 0.05, tz);
        }
      }

      // Reflecting pool — 6×6 dark recessed water inset
      gadd(new THREE.BoxGeometry(6.4, 0.06, 6.4), lm(0x0a1828), 0, 0.10, 0);
      gadd(new THREE.BoxGeometry(6.0, 0.04, 6.0),
        new THREE.MeshStandardMaterial({ color: 0x1a3d5c, emissive: 0x001a33, emissiveIntensity: 0.5 }),
        0, 0.13, 0);
      // Pool rim
      gadd(new THREE.BoxGeometry(6.6, 0.18, 0.20), lm(0x6a6a72), 0, 0.18, -3.2);
      gadd(new THREE.BoxGeometry(6.6, 0.18, 0.20), lm(0x6a6a72), 0, 0.18,  3.2);
      gadd(new THREE.BoxGeometry(0.20, 0.18, 6.6), lm(0x6a6a72), -3.2, 0.18, 0);
      gadd(new THREE.BoxGeometry(0.20, 0.18, 6.6), lm(0x6a6a72),  3.2, 0.18, 0);

      // Memorial wall — north wall, blue-lit panels
      for (let i = 0; i < 5; i++) {
        const px = -8 + i * 4;
        gadd(new THREE.BoxGeometry(3.6, 4, 0.08),
          new THREE.MeshStandardMaterial({ color: 0x2A5078, emissive: 0x1a4060, emissiveIntensity: 0.45 }),
          px, 5.5, -9.92);
        // Subtle vertical light strip beside each panel
        gadd(new THREE.BoxGeometry(0.06, 6, 0.05),
          new THREE.MeshStandardMaterial({ color: 0xCCEEFF, emissive: 0x88CCFF, emissiveIntensity: 0.8 }),
          px - 1.85, 5.5, -9.88);
      }

      // Tall vertical glass curtain "pillars" suggesting the tower's facade
      for (const [px, pz] of [[-7,-3],[-7,3],[7,-3],[7,3]]) {
        gadd(new THREE.BoxGeometry(0.4, 11.6, 0.4), lm(0x6080a0), px, 5.8, pz);
        // Light at the top
        gadd(new THREE.SphereGeometry(0.18, 6, 6),
          new THREE.MeshStandardMaterial({ color: 0xCCEEFF, emissive: 0x88CCFF, emissiveIntensity: 0.7 }),
          px, 11.4, pz);
      }

      // Long reception/security desk on the inner north side. Player enters
      // from the south door, walks past the reflecting pool toward this desk.
      gadd(new THREE.BoxGeometry(8, 1.0, 1.4), lm(0x111118),  0, 0.5, -7);
      gadd(new THREE.BoxGeometry(8.2, 0.04, 1.5), lm(0x4488aa), 0, 1.02, -7);
      // Three computer monitors inset on the desk top
      for (const mx of [-2.4, 0, 2.4]) {
        gadd(new THREE.BoxGeometry(0.9, 0.6, 0.05),
          new THREE.MeshStandardMaterial({ color: 0x88BBFF, emissive: 0x4488CC, emissiveIntensity: 0.55 }),
          mx, 1.45, -6.4);
      }

      // Visitor benches against the east wall
      for (const bz of [-4, 4]) {
        gadd(new THREE.BoxGeometry(0.9, 0.50, 2.2), lm(0x2A2A30), 8.5, 0.25, bz);
        gadd(new THREE.BoxGeometry(0.9, 0.06, 2.2),
          new THREE.MeshStandardMaterial({ color: 0x44546A, emissive: 0x223040, emissiveIntensity: 0.25 }),
          8.5, 0.55, bz);
      }

      // Velvet-rope queue stanchions guiding visitors toward the elevators
      for (const sz of [-3.5, -1, 1.5, 4]) {
        gadd(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 6),
          new THREE.MeshStandardMaterial({ color: 0xC0C8D0, emissive: 0x707880, emissiveIntensity: 0.2 }),
          -7, 0.5, sz);
      }

      // West-wall elevator bank — 3 slender brushed-steel doors
      for (let ei = 0; ei < 3; ei++) {
        const ez = -3 + ei * 3;
        gadd(new THREE.BoxGeometry(0.12, 5.4, 1.6), lm(0xD0D6E0), -9.6, 2.7, ez);
        gadd(new THREE.BoxGeometry(0.10, 5.0, 1.4), lm(0x4A5460), -9.55, 2.5, ez);
        // Floor indicator strip
        gadd(new THREE.BoxGeometry(0.06, 0.06, 1.3),
          new THREE.MeshStandardMaterial({ color: 0xCCEEFF, emissive: 0x66BBFF, emissiveIntensity: 0.9 }),
          -9.50, 5.5, ez);
      }

      // Ceiling: dark glass with embedded light strips
      for (let xi = 0; xi < 5; xi++) {
        gadd(new THREE.BoxGeometry(0.10, 0.05, 18),
          new THREE.MeshStandardMaterial({ color: 0xAACCEE, emissive: 0x66AADD, emissiveIntensity: 0.7 }),
          -8 + xi * 4, 11.85, 0);
      }

      // Label sign
      const wtclabel = makeLabel('ONE WORLD TRADE CENTER', {
        fontSize: 56, width: 1024, height: 128,
        textColor: '#FFFFFF', strokeColor: '#001a33', strokeWidth: 6,
      });
      wtclabel.position.set(0, 8.5, -9.85);
      wtclabel.scale.set(8, 1, 1);
      group.add(wtclabel);

    } else if (id === 'gc') {
      // ── GRAND CENTRAL MAIN CONCOURSE ──
      // Cream-marble checkerboard floor
      for (let xi = 0; xi < 5; xi++) {
        for (let zi = 0; zi < 5; zi++) {
          const col = (xi + zi) % 2 === 0 ? 0xE8DDC2 : 0xC2B595;
          gadd(new THREE.BoxGeometry(3.6, 0.10, 3.6), lm(col), -8 + xi * 3.6, 0.05, -8 + zi * 3.6);
        }
      }

      // Iconic celestial-blue vaulted ceiling — recreate the vault as nested
      // panels emissive blue-green so the dome reads from below
      gadd(new THREE.BoxGeometry(20, 0.20, 20),
        new THREE.MeshStandardMaterial({ color: 0x3A6890, emissive: 0x1A406A, emissiveIntensity: 0.55 }),
        0, 11.85, 0);
      // Gold zodiac strapwork — concentric gold rings on the ceiling
      for (const r of [3.0, 5.5, 7.8]) {
        gadd(new THREE.TorusGeometry(r, 0.06, 6, 24), lm(0xD4AF37, 0x3a2400),
          0, 11.6, 0);
      }
      // Faint star points (small bright nodes scattered on the dome)
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const rr = 2 + (i % 4) * 1.6;
        const sx = Math.cos(a) * rr, sz = Math.sin(a) * rr;
        gadd(new THREE.SphereGeometry(0.10, 5, 5),
          new THREE.MeshStandardMaterial({ color: 0xFFF4C8, emissive: 0xFFE08A, emissiveIntensity: 0.9 }),
          sx, 11.55, sz);
      }

      // Massive arched windows on E and W walls (legendary GCT light shafts)
      for (const sx of [-1, 1]) {
        // Window glass panel
        gadd(new THREE.BoxGeometry(0.10, 8, 6),
          new THREE.MeshStandardMaterial({ color: 0xCDE4EF, emissive: 0xAACCDD, emissiveIntensity: 0.7 }),
          sx * 9.92, 6, 0);
        // Window cross mullions
        for (const my of [3.5, 6.0, 8.5])
          gadd(new THREE.BoxGeometry(0.13, 0.18, 6.2), lm(0x6A5630), sx * 9.95, my, 0);
        for (const mz of [-2.7, 0, 2.7])
          gadd(new THREE.BoxGeometry(0.13, 8.2, 0.18), lm(0x6A5630), sx * 9.95, 6, mz);
      }

      // The four-faced opal clock at the dead center of the concourse
      const clockMat = new THREE.MeshStandardMaterial({
        color: 0xD4AF37, emissive: 0x3A2400, emissiveIntensity: 0.4,
      });
      gadd(new THREE.CylinderGeometry(0.5, 0.5, 4.5, 8), lm(0x6A5630), 0, 2.25, 0); // pedestal
      gadd(new THREE.SphereGeometry(0.95, 12, 8), clockMat, 0, 5.0, 0); // gold globe
      // Four clock faces
      for (const [fx, fz] of [[0.96, 0], [-0.96, 0], [0, 0.96], [0, -0.96]]) {
        gadd(new THREE.CircleGeometry(0.6, 16),
          new THREE.MeshStandardMaterial({ color: 0xFFF4C8, emissive: 0x554400, emissiveIntensity: 0.4 }),
          fx, 5.0, fz);
      }

      // Information booth — round marble desk under the clock (player can't
      // walk through it; registered solid below)
      gadd(new THREE.CylinderGeometry(1.6, 1.6, 1.0, 12), lm(0xc8bc98), 0, 0.5, 0);
      gadd(new THREE.CylinderGeometry(1.7, 1.7, 0.10, 12), lm(0xD4AF37), 0, 1.05, 0);

      // Brass ticket windows along the south wall — skip the center one
      // (tx=0) so the exit door at (0,1.5,9.85) is clear and reachable.
      for (let ti = 0; ti < 5; ti++) {
        if (ti === 2) continue;     // gap for exit door
        const tx = -8 + ti * 4;
        gadd(new THREE.BoxGeometry(3, 4.5, 0.3), lm(0x4A2E0A), tx, 2.25, 9.8);
        gadd(new THREE.BoxGeometry(2.4, 1.2, 0.20), clockMat, tx, 1.0, 9.7);
        gadd(new THREE.BoxGeometry(2.6, 0.18, 0.18), lm(0xD4AF37), tx, 4.4, 9.65);
      }

      // Departures board — long emissive amber panel on the north wall
      gadd(new THREE.BoxGeometry(15, 1.6, 0.10), lm(0x1a1208), 0, 9.5, -9.85);
      gadd(new THREE.BoxGeometry(14.2, 1.2, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xFFD27A, emissive: 0xFF9D2A, emissiveIntensity: 0.9 }),
        0, 9.5, -9.79);

      // Pendant chandeliers — three brass globes hanging from the dome
      for (const lx of [-5, 0, 5]) {
        gadd(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 5), lm(0x4A2E0A), lx, 10.5, 0);
        gadd(new THREE.SphereGeometry(0.42, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xFFE9A8, emissive: 0xFFC85A, emissiveIntensity: 0.85 }),
          lx, 9.4, 0);
      }

      // Label
      const gclabel = makeLabel('GRAND CENTRAL TERMINAL', {
        fontSize: 50, width: 1024, height: 128,
        textColor: '#FFD27A', strokeColor: '#3a2400', strokeWidth: 6, bgColor: '#1a1208',
      });
      gclabel.position.set(0, 8.0, -9.84);
      gclabel.scale.set(8, 1, 1);
      group.add(gclabel);

    } else {
      // Fallback label for any other room
      const label = makeLabel(name, { fontSize: 60, width: 512, height: 128, textColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 6 });
      label.position.set(0, 7, -3);
      label.scale.set(4, 1, 1);
      group.add(label);
    }

    // Exit door (emissive, on south wall interior)
    const exitMat = new THREE.MeshStandardMaterial({
      color: 0xffe060, emissive: 0xffe060, emissiveIntensity: 0.85,
    });
    const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), exitMat);
    exitDoor.position.set(0, 1.5, 9.85);
    group.add(exitDoor);

    group.position.set(ox, 0, oz);
    scene.add(group);

    // Axis-aligned room colliders (4 walls) in world space
    const colliders = [
      new THREE.Box3(new THREE.Vector3(ox-10, 0, oz-10.3), new THREE.Vector3(ox+10, roomH, oz-9.7)), // N
      new THREE.Box3(new THREE.Vector3(ox-10, 0, oz+ 9.7), new THREE.Vector3(ox+10, roomH, oz+10.3)), // S
      new THREE.Box3(new THREE.Vector3(ox-10.3,0, oz-10),  new THREE.Vector3(ox-9.7, roomH, oz+10)), // W
      new THREE.Box3(new THREE.Vector3(ox+ 9.7,0, oz-10),  new THREE.Vector3(ox+10.3, roomH, oz+10)), // E
    ];

    // Flat solid objects for new player collision (south wall split around door opening)
    const intSolids = [];
    registerSolid(intSolids, ox,        oz - 10, 10,  0.3); // N wall
    registerSolid(intSolids, ox - 5.5,  oz + 10, 4.5, 0.3); // S wall left of door
    registerSolid(intSolids, ox + 5.5,  oz + 10, 4.5, 0.3); // S wall right of door
    registerSolid(intSolids, ox - 10,   oz,      0.3, 10);  // W wall
    registerSolid(intSolids, ox + 10,   oz,      0.3, 10);  // E wall

    if (id === 'esb') {
      // Columns
      for (const [cx, cz] of [[-7,-6],[7,-6],[-7,0],[7,0],[-7,6],[7,6],[-3,-9],[3,-9]])
        registerSolid(intSolids, ox + cx, oz + cz, 0.55, 0.55);
      // Reception desk
      registerSolid(intSolids, ox,       oz - 7,   4.5, 0.9);
      // Elevator alcove back panel (at local x=7.5)
      registerSolid(intSolids, ox + 7.9, oz,       0.4, 5.2);
      // Staircase block (west side, z=2 to 8)
      registerSolid(intSolids, ox - 7.5, oz + 3.5, 2.2, 3.0);
      // Security arch posts
      registerSolid(intSolids, ox - 3.8, oz + 7.5, 1.4, 0.2);
      registerSolid(intSolids, ox + 3.8, oz + 7.5, 1.4, 0.2);
    } else if (id === 'wtc') {
      // Memorial reflecting pool perimeter rim
      registerSolid(intSolids, ox, oz - 3.2, 3.3, 0.15);
      registerSolid(intSolids, ox, oz + 3.2, 3.3, 0.15);
      registerSolid(intSolids, ox - 3.2, oz, 0.15, 3.3);
      registerSolid(intSolids, ox + 3.2, oz, 0.15, 3.3);
      for (const [cx, cz] of [[-7,-3],[-7,3],[7,-3],[7,3]])
        registerSolid(intSolids, ox + cx, oz + cz, 0.25, 0.25);
      registerSolid(intSolids, ox, oz - 7, 4.1, 0.8);
      registerSolid(intSolids, ox - 9.6, oz, 0.15, 5.2);
      // Visitor benches against east wall
      registerSolid(intSolids, ox + 8.5, oz - 4, 0.5, 1.1);
      registerSolid(intSolids, ox + 8.5, oz + 4, 0.5, 1.1);
    } else if (id === 'gc') {
      // Central information-booth marble disc
      registerSolid(intSolids, ox, oz, 1.7, 1.7);
      // 4 ticket-window counters along south wall (center skipped for exit door)
      for (let ti = 0; ti < 5; ti++) {
        if (ti === 2) continue;
        const tx = -8 + ti * 4;
        registerSolid(intSolids, ox + tx, oz + 9.8, 1.5, 0.3);
      }
    }

    interiors[id] = {
      group,
      playerSpawn:      new THREE.Vector3(ox, 0, oz + 7.5),
      entryYaw:         0,
      exitDoorWorldPos: new THREE.Vector3(ox, 1.5, oz + 9.85),
      cityReturnPos,
      exitYaw:          Math.PI,
      colliders,
      solidObjects:     intSolids,
    };
  });

  return interiors;
}

// ── Secret alley (The Ancient One's hiding spot) ─────────────────────────────
// Hidden 2-unit-wide dead-end alley at the FAR NORTH-WEST outskirts of the map.
// Player has to walk to the corner near the Hudson fence to find it.

function buildSecretAlley(scene, solidObjects) {
  // Walls run north-south. Entrance faces +z (south); dead-end at the north (-z).
  // Gap centered on x=-117, between two flanking dark-brick slabs.
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a1b10 });
  const colliders = [];

  const slabs = [
    { cx: -123,   cz: -228, w: 8, h: 68, d: 16 }, // left wall   x=[-127,-119]  z=[-236,-220]
    { cx: -111.5, cz: -228, w: 7, h: 68, d: 16 }, // right wall  x=[-115,-108]  z=[-236,-220]
    { cx: -134,   cz: -228, w: 8, h: 54, d: 16 }, // left flank  x=[-138,-130]
  ];
  for (const s of slabs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), darkMat);
    mesh.position.set(s.cx, s.h / 2, s.cz);
    scene.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(s.cx - s.w / 2, 0, s.cz - s.d / 2),
      new THREE.Vector3(s.cx + s.w / 2, s.h, s.cz + s.d / 2),
    ));
    registerSolid(solidObjects, s.cx, s.cz, s.w / 2, s.d / 2);
  }

  // Dead-end back wall at the NORTH end (z=-236) sealing the alley
  const bw = new THREE.Mesh(
    new THREE.BoxGeometry(2, 68, 2),
    new THREE.MeshLambertMaterial({ color: 0x181010 }),
  );
  bw.position.set(-117, 34, -236.5);
  scene.add(bw);
  colliders.push(new THREE.Box3(
    new THREE.Vector3(-118, 0, -237.5), new THREE.Vector3(-116, 68, -235.5),
  ));
  registerSolid(solidObjects, -117, -236.5, 1, 1);

  // Faint amber light at the dead end — barely bleeds out to the entrance
  const light = new THREE.PointLight(0xff5500, 0.5, 16);
  light.position.set(-117, 3, -232);
  scene.add(light);

  // Near-black overhead cover (makes alley look like pure shadow from outside)
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0a, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(2, 16), roofMat);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(-117, 10, -228);
  scene.add(roof);

  return colliders;
}

// ── Lighting ──────────────────────────────────────────────────────────────────

function setupLighting(scene) {
  // Daylight values tuned for Lambert materials. Ambient+sun > ~1.5
  // washes everything to white because Lambert response saturates.
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xfff5e0, 0.7);
  sun.position.set(100, 150, 80);
  scene.add(sun);
}

// ── Skybox ────────────────────────────────────────────────────────────────────

function setupSky(scene) {
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0xa8cce0, 0.007);
}

// ── Street sign posts at major intersections ─────────────────────────────────

function makeStreetSignPost(scene, solidObjects, x, z, street1, street2) {
  const postMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  // Vertical pole
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), postMat);
  post.position.set(x, 1.8, z);
  scene.add(post);
  registerSolid(solidObjects, x, z, 0.12, 0.12);

  // Two perpendicular crossbars and the two compact street-name signs
  // mounted at their tips like a real NYC street-sign pole.
  const SIGN_W = 1.05;
  const SIGN_H = 0.28;
  const SIGN_T = 0.05;
  const SIGN_Y = 3.40;
  const ARM_LEN = 0.65;             // half of sign width plus a small gap

  [street1, street2].forEach((name, i) => {
    const alongX = (i === 0);

    // Crossbar from pole to sign (one per side so the sign reads from both faces)
    const crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, ARM_LEN, 6),
      postMat,
    );
    crossbar.rotation.z = Math.PI / 2;
    if (alongX) {
      crossbar.position.set(x + ARM_LEN / 2, SIGN_Y, z);
    } else {
      crossbar.rotation.y = Math.PI / 2;
      crossbar.position.set(x, SIGN_Y, z + ARM_LEN / 2);
    }
    scene.add(crossbar);

    // Sign canvas
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#006400'; ctx.fillRect(0, 0, 512, 128);
    ctx.font = 'bold 64px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#003200'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    ctx.strokeText(name.toUpperCase(), 256, 64);
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(name.toUpperCase(), 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const sideMat = new THREE.MeshLambertMaterial({ color: 0x005000 });

    const geo = alongX
      ? new THREE.BoxGeometry(SIGN_W, SIGN_H, SIGN_T)
      : new THREE.BoxGeometry(SIGN_T, SIGN_H, SIGN_W);
    const sign = new THREE.Mesh(
      geo, [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat],
    );
    if (alongX) sign.position.set(x + ARM_LEN, SIGN_Y, z);
    else        sign.position.set(x, SIGN_Y, z + ARM_LEN);
    scene.add(sign);
  });
}

// ── Subway entrance structures ────────────────────────────────────────────────

// Global subway-station registry — main.js reads this to render station icons
// on the map and (with the MetroCard booster) wire the teleport behavior.
window.SUBWAY_STATIONS = window.SUBWAY_STATIONS || [];

function makeSubwayEntrance(scene, solidObjects, x, z, name = 'Subway') {
  // Register the station so the map / teleport system can find it
  window.SUBWAY_STATIONS.push({ name, x, z });
  // Compact 1.8x1.8 footprint fits on a narrow sidewalk strip without spilling
  // into roads or building blocks.
  // (See _make_compact_entrance below.)
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const greenMat = new THREE.MeshLambertMaterial({ color: 0x006400 });
  const globeMat = new THREE.MeshStandardMaterial({ color: 0x00CC00, emissive: 0x008800, emissiveIntensity: 0.8 });

  // Compact stairwell — flat dark patch flush with the sidewalk so the
  // player can walk over it. Footprint is 1.8×1.8 so it fits on a narrow
  // sidewalk strip (~2u wide) without intruding into roads or buildings.
  const stairs = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 1.8), darkMat);
  stairs.position.set(x, 0.04, z);
  scene.add(stairs);
  // No registerSolid for the stair patch — keep it walkable.

  // Green globe lamp post (left)
  const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), greenMat);
  poleL.position.set(x - 1.3, 1.3, z - 1.6);
  scene.add(poleL);
  const globeL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), globeMat);
  globeL.position.set(x - 1.3, 2.7, z - 1.6);
  scene.add(globeL);

  // Green globe lamp post (right)
  const poleR = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), greenMat);
  poleR.position.set(x + 1.3, 1.3, z - 1.6);
  scene.add(poleR);
  const globeR = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), globeMat);
  globeR.position.set(x + 1.3, 2.7, z - 1.6);
  scene.add(globeR);

  // Subway sign
  const subCanvas = document.createElement('canvas');
  subCanvas.width = 1024; subCanvas.height = 256;
  const subCtx = subCanvas.getContext('2d');
  subCtx.fillStyle = '#003399';
  subCtx.fillRect(0, 0, 1024, 256);
  subCtx.fillStyle = '#FFD700';
  subCtx.fillRect(0, 0, 1024, 30); subCtx.fillRect(0, 226, 1024, 30);
  subCtx.font = 'bold 120px "Arial Black", Impact, sans-serif';
  subCtx.textAlign = 'center'; subCtx.textBaseline = 'middle';
  subCtx.strokeStyle = '#000066'; subCtx.lineWidth = 10; subCtx.lineJoin = 'round';
  subCtx.strokeText('NYC SUBWAY', 512, 128);
  subCtx.fillStyle = '#FFFFFF';
  subCtx.fillText('NYC SUBWAY', 512, 128);
  const subTex = new THREE.CanvasTexture(subCanvas);
  subTex.minFilter = THREE.LinearFilter; subTex.needsUpdate = true;
  const subSign = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.6, 0.08),
    [new THREE.MeshLambertMaterial({ color: 0x003399 }),
     new THREE.MeshLambertMaterial({ color: 0x003399 }),
     new THREE.MeshLambertMaterial({ color: 0x003399 }),
     new THREE.MeshLambertMaterial({ color: 0x003399 }),
     new THREE.MeshBasicMaterial({ map: subTex }),
     new THREE.MeshBasicMaterial({ map: subTex }),
    ],
  );
  subSign.position.set(x, 1.8, z - 2.1);
  scene.add(subSign);
}

// ── Midtown building identity banners ────────────────────────────────────────
// Pole-mounted sidewalk identification signs. The y param is ignored — the
// pole stands on the ground and the banner sits at its top, like a real NYC
// landmark wayfinding sign.

function makeMidtownBanner(scene, x, _y, z, name, { bg = '#1A1A2A', fg = '#FFFFFF', rotY = 0 } = {}) {
  // Sign canvas
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 2048, 256);
  ctx.strokeStyle = '#555566'; ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 2036, 244);
  const fs = name.length > 22 ? 72 : name.length > 16 ? 88 : 108;
  ctx.font = `bold ${fs}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000000'; ctx.lineWidth = 8; ctx.strokeText(name, 1024, 128);
  ctx.fillStyle = fg; ctx.fillText(name, 1024, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const bg16 = parseInt(bg.replace('#', ''), 16);
  const sideMat = new THREE.MeshLambertMaterial({ color: bg16 });
  const faceMat = new THREE.MeshBasicMaterial({ map: tex });

  const POLE_H  = 5.4;
  const SIGN_W  = 4.0;
  const SIGN_H  = 0.7;
  const SIGN_Y  = POLE_H - 0.4;
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });

  // Vertical pole anchored on the sidewalk
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.10, POLE_H, 6), poleMat,
  );
  pole.position.set(x, POLE_H / 2, z);
  scene.add(pole);
  window.registerSolid(pole);

  // Crossbar arm extending from the pole to the sign center
  const crossbar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, SIGN_W / 2, 6), poleMat,
  );
  // Orient the crossbar perpendicular to whichever cardinal direction the
  // banner faces (rotY rotates the sign around Y; use it to point the arm).
  const facingX = Math.abs(Math.sin(rotY)) > 0.5;
  if (facingX) {
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(x + SIGN_W / 4, SIGN_Y, z);
  } else {
    crossbar.rotation.z = Math.PI / 2;
    crossbar.rotation.y = Math.PI / 2;
    crossbar.position.set(x, SIGN_Y, z + SIGN_W / 4);
  }
  scene.add(crossbar);

  // The double-sided banner mounted at the tip of the crossbar
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(SIGN_W, SIGN_H, 0.10),
    [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat],
  );
  if (facingX) m.position.set(x + SIGN_W / 2, SIGN_Y, z);
  else         m.position.set(x, SIGN_Y, z + SIGN_W / 2);
  if (rotY) m.rotation.y = rotY;
  scene.add(m);
}

// ── Startup collider overlap audit ────────────────────────────────────────────

function _auditColliders() {
  const list = window.SOLID_COLLIDERS;
  if (!list || list.length === 0) {
    console.log('[FeetDex] Collider audit: SOLID_COLLIDERS empty — no audit');
    return;
  }
  let overlapCount = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i].box.intersectsBox(list[j].box)) {
        overlapCount++;
        if (overlapCount <= 20) console.warn(`[FeetDex] OVERLAP solid ${i} ↔ ${j}`);
      }
    }
  }
  if (overlapCount === 0) console.log(`[FeetDex] Collider audit PASSED — ${list.length} boxes, 0 overlaps`);
  else console.warn(`[FeetDex] Collider audit: ${overlapCount} overlapping pair(s) across ${list.length} boxes`);

  const npcs = window.ALL_NPCS || [];
  let npcOverlaps = 0;
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const d = npcs[i].group.position.distanceTo(npcs[j].group.position);
      if (d < 1.0) npcOverlaps++;
    }
  }
  if (npcOverlaps > 0) console.warn(`[FeetDex] NPC overlap audit: ${npcOverlaps} pair(s) within 1.0 units`);
  else console.log(`[FeetDex] NPC overlap audit PASSED — ${npcs.length} NPCs, 0 close pairs`);
}

// ── New expanded areas ────────────────────────────────────────────────────────

function buildLowerManhattan(scene, solidObjects) {
  // Financial district / WTC memorial area — z ≈ -140 to -200, x ≈ -20 to +20
  const ox = 0, oz = -165;

  // bx(...) places a colored box. solid=true (default) registers it as a player
  // collider; solid=false is for ground/decorative panels you can walk over.
  function bx(color, x, y, z, w, h, d, solid = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(ox + x, y, oz + z);
    scene.add(m);
    if (solid && y > 0.5) {
      registerSolid(solidObjects, ox + x, oz + z, w / 2, d / 2);
    }
  }

  // Ground plane for this district
  const grd = new THREE.Mesh(new THREE.PlaneGeometry(120, 80),
    new THREE.MeshLambertMaterial({ color: 0x444444 }));
  grd.rotation.x = -Math.PI / 2;
  grd.position.set(ox, 0.01, oz);
  scene.add(grd);

  // One World Trade Center — tapered supertall
  bx(0xaabbcc, 0, 80, -10, 18, 160, 18);  // base shaft
  bx(0xbbd4ee, 0, 168, -10, 12, 16, 12);  // upper taper 1
  bx(0xcce8ff, 0, 183, -10, 7, 14, 7);    // upper taper 2
  bx(0xddf0ff, 0, 194, -10, 4, 10, 4);    // spire base
  bx(0xffffff, 0, 200, -10, 1.5, 10, 1.5);// spire tip

  // WTC memorial pool #1 (South Tower footprint)
  bx(0x111111, -8, 0.05, 12, 12, 0.1, 12);
  const pool1 = new THREE.Mesh(new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color:0x1a3d5c, emissive:0x001122, emissiveIntensity:0.4 }));
  pool1.rotation.x = -Math.PI / 2;
  pool1.position.set(ox - 8, 0.08, oz + 12);
  scene.add(pool1);

  // WTC memorial pool #2 (North Tower footprint)
  bx(0x111111, 8, 0.05, 12, 12, 0.1, 12);
  const pool2 = pool1.clone();
  pool2.position.set(ox + 8, 0.08, oz + 12);
  scene.add(pool2);

  // Memorial plaza paving
  for (let px = -2; px <= 2; px++) {
    for (let pz = -2; pz <= 2; pz++) {
      const col = (px + pz) % 2 === 0 ? 0xddddcc : 0xbbbbaa;
      bx(col, px * 3, 0.04, pz * 3, 2.8, 0.08, 2.8);
    }
  }

  // Wall Street: a row of columned facades
  const wsColors = [0xd4c8a8, 0xc4b898, 0xe0d8c0];
  for (let i = 0; i < 5; i++) {
    const wx = -20 + i * 8;
    const ht = 25 + (i % 3) * 8;
    bx(wsColors[i % 3], wx, ht / 2, -22, 7, ht, 6);
    // Columns
    for (let ci = 0; ci < 3; ci++) {
      bx(0xf0e8d0, wx - 2.5 + ci * 2.5, 2, -19, 0.5, 4, 0.5);
    }
  }

  // Battery Park greenery suggestion
  bx(0x3a6a2a, 0, 0.1, 28, 36, 0.2, 14, false);  // grass plane — walkable
  for (const [tx, tz] of [[-12,27],[0,30],[12,27],[-6,32],[6,32],[-14,24],[14,24]]) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.3,3,6),
      new THREE.MeshLambertMaterial({ color:0x5a3a1a }));
    trunk.position.set(ox+tx, 1.5, oz+tz);
    scene.add(trunk);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.2,7,5),
      new THREE.MeshLambertMaterial({ color:0x3a7a2a }));
    canopy.position.set(ox+tx, 4.5, oz+tz);
    scene.add(canopy);
    registerSolid(solidObjects, ox + tx, oz + tz, 0.4, 0.4);
  }

  // Statue of Liberty suggestion (tiny) — at very southern edge
  bx(0x7aaa8a, 0, 4, 38, 1.5, 8, 1.5);  // pedestal+figure (solid)
  bx(0x6a9a7a, 0, 8.5, 38, 0.5, 1, 0.5); // torch arm (solid via height filter)
}

function buildColumbusCircle(scene, solidObjects) {
  const ox = -25, oz = -110;

  function bx(color, x, y, z, w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(ox + x, y, oz + z);
    scene.add(m);
    return m;
  }

  // Circular paved island
  const island = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.2, 24),
    new THREE.MeshLambertMaterial({ color: 0xccbbaa }));
  island.position.set(ox, 0.1, oz);
  scene.add(island);

  // Inner ring road suggestion
  const ringRoad = new THREE.Mesh(new THREE.RingGeometry(10, 14, 24),
    new THREE.MeshLambertMaterial({ color: 0x555555, side: THREE.DoubleSide }));
  ringRoad.rotation.x = -Math.PI / 2;
  ringRoad.position.set(ox, 0.02, oz);
  scene.add(ringRoad);

  // Columbus monument column
  bx(0xd4c8b0, 0, 7,   0, 1.5, 14, 1.5);   // column shaft
  bx(0xc8bc9c, 0, 14.5, 0, 2, 1, 2);        // capital
  bx(0xaaa090, 0, 15.5, 0, 1, 2, 1);        // figure base
  bx(0xbbb0a0, 0, 17, 0, 0.5, 3, 0.5);      // figure

  // Surrounding low buildings
  for (const [dx, dz, w, h, d, col] of [
    [18, 0, 8, 30, 10, 0x888898],
    [-18, 0, 8, 28, 10, 0x9999aa],
    [0, 18, 10, 25, 8, 0x7a8a9a],
    [0, -18, 10, 32, 8, 0x888880],
  ]) {
    const m = bx(col, dx, h/2, dz, w, h, d);
    registerSolid(solidObjects, ox+dx, oz+dz, w/2, d/2);
  }

  // Street lamp posts around the circle
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
    const lx = Math.cos(a) * 11.5, lz = Math.sin(a) * 11.5;
    bx(0x888888, lx, 2, lz, 0.15, 4, 0.15);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0xffff99, emissive: 0xffff44, emissiveIntensity: 1 }));
    lamp.position.set(ox+lx, 4.2, oz+lz);
    scene.add(lamp);
  }
}

function buildGrandCentralExterior(scene, solidObjects) {
  // Relocated from (65, 15) — that position straddled avenue x=90 and cross-
  // street z=20. Now sits inside the block bounded by avenues x=60..90 and
  // cross-streets z=-40..-20. Block inner area is ~21×11; building footprint
  // 20×10 fits cleanly with sidewalk to spare on every side.
  const ox = 75, oz = -30;

  function bx(color, x, y, z, w, h, d, emissive) {
    const mat = emissive
      ? new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.5 })
      : new THREE.MeshLambertMaterial({ color });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(ox + x, y, oz + z);
    scene.add(m);
    return m;
  }

  // Main terminal — Beaux-Arts limestone facade
  bx(0xd4c8a8, 0, 13, 0, 20, 26, 10);
  registerSolid(solidObjects, ox, oz, 10, 5);

  // Setback tower (small attic story above the cornice)
  bx(0xc8bc98, 0, 30, 0, 14, 8, 7);
  registerSolid(solidObjects, ox, oz, 7, 3.5);

  // North facade (toward cross-street z=-20) — three tall arched windows
  for (const wx of [-6, 0, 6]) {
    bx(0x7a9aaa, wx, 12, 5.05, 4, 14, 0.15, 0x334455); // arched glass
    bx(0xc8bc98, wx, 21, 5.05, 5, 1.2, 0.25);          // arch keystone top
  }

  // Entrance steps on the north face (where the door is)
  for (let s = 0; s < 4; s++) {
    bx(0xc0b498, 0, s * 0.35 + 0.18, 5 + s * 0.5, 14, 0.35, 1);
  }

  // Famous Tiffany clock — circular, mounted above the entrance
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 16),
    new THREE.MeshStandardMaterial({ color: 0xccaa44, emissive: 0x664400, emissiveIntensity: 0.4 }));
  clock.position.set(ox, 23, oz + 5.18);
  clock.rotation.x = Math.PI / 2;
  scene.add(clock);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0x554400, emissiveIntensity: 0.3 }));
  face.position.set(ox, 23, oz + 5.34);
  scene.add(face);

  // Sculptural eagle / lamp on each side of the entrance (Mercury, Hercules,
  // Minerva — represented here as simple gilt forms flanking the clock)
  for (const sx of [-7, 7]) {
    bx(0xb8a878, sx, 18, 5.10, 1.6, 4, 0.6);
  }

  // Flanking decorative pilasters
  for (const px of [-9, 9]) {
    bx(0xccc0a0, px, 13, 0, 1.2, 26, 10.4);
    registerSolid(solidObjects, ox + px, oz, 0.6, 5.2);
  }

  // Vanderbilt Ave plaque label on the north (entrance) face
  const lbl = makeLabel('GRAND CENTRAL', { fontSize: 56, width: 512, height: 128,
    textColor: '#D4C8A8', strokeColor: '#5A4000', strokeWidth: 6, bgColor: '#1a1400' });
  lbl.position.set(ox, 4, oz + 5.42);
  lbl.scale.set(5, 1.25, 1);
  scene.add(lbl);
}

function buildHudsonRiver(scene, solidObjects) {
  // Hudson — west side, x ≈ -150 to -240
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 480),
    new THREE.MeshLambertMaterial({
      color: 0x1A3A5C, emissive: 0x0A1A2A, emissiveIntensity: 0.1,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-195, -0.05, 0);
  scene.add(water);

  // Wave-suggestion strips
  for (let wz = -240; wz <= 240; wz += 8) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(88, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2A4A6C }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(-195, 0.02, wz);
    scene.add(strip);
  }

  // Riverfront walkway
  const walkway = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 480),
    new THREE.MeshLambertMaterial({ color: 0x888878 }),
  );
  walkway.rotation.x = -Math.PI / 2;
  walkway.position.set(-146, 0.02, 0);
  scene.add(walkway);

  // Guardrail (solid — player can't pass into water)
  const postMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  for (let pz = -230; pz <= 230; pz += 6) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), postMat);
    post.position.set(-143, 0.55, pz);
    scene.add(post);
    if (pz < 226) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 6), postMat);
      rail.position.set(-143, 1.05, pz + 3);
      scene.add(rail);
    }
  }
  // One long invisible solid AABB along the rail line (more reliable than tiny posts)
  registerSolid(solidObjects, -143, 0, 0.25, 232);

  // Piers + pier sheds (warehouses on piers)
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x4A3728 });
  const shedMat = new THREE.MeshLambertMaterial({ color: 0x3A2A20 });
  for (const pz of [-150, -60, 30, 120]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(28, 0.4, 4), pierMat);
    pier.position.set(-160, 0.2, pz);
    scene.add(pier);
    // Pilings under pier
    for (let px = -150; px >= -180; px -= 5) {
      const piling = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.25, 1.5, 6),
        pierMat,
      );
      piling.position.set(px, -0.7, pz);
      scene.add(piling);
    }
    // Shed
    const shed = new THREE.Mesh(new THREE.BoxGeometry(20, 3, 3.2), shedMat);
    shed.position.set(-160, 1.9, pz);
    scene.add(shed);
  }
}

// Simple cube-and-roof filler buildings for the empty buffer between the grid
// edge (±120) and the river fences / boundary wall. Returns Box3 colliders so
// the buildings can be added to world.colliders (and thus appear on the minimap).
function buildOuterBuffer(scene, solidObjects) {
  const COLORS = [0x9c8b6b, 0x7a7470, 0x8a4a3a, 0x6a5e4f, 0xa49a82, 0x5d6473];
  const colliders = [];

  // Single shared window-grid texture used across all buffer buildings.
  // Each tile is a 4×8 grid of dark-blue rectangles on a tan background.
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 256; winCanvas.height = 256;
  const wctx = winCanvas.getContext('2d');
  wctx.fillStyle = '#888080';
  wctx.fillRect(0, 0, 256, 256);
  wctx.fillStyle = '#1a2030';
  for (let wy = 0; wy < 8; wy++) {
    for (let wx = 0; wx < 4; wx++) {
      wctx.fillRect(wx * 64 + 14, wy * 32 + 6, 36, 22);
    }
  }
  const winTex = new THREE.CanvasTexture(winCanvas);
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  winTex.minFilter = THREE.LinearFilter;
  winTex.needsUpdate = true;

  // Shared door material (dark brown, slight emissive so visible at distance)
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x4a2a14, emissive: 0x331a08, emissiveIntensity: 0.25,
  });

  function _place(cx, cz, w, d, h, colorIdx) {
    const col = COLORS[colorIdx % COLORS.length];

    // Per-building texture clone with repeat tuned to building size
    const tex = winTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(2, Math.round(h / 4)));
    const wallMat = new THREE.MeshLambertMaterial({ color: col, map: tex });

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    body.position.set(cx, h / 2, cz);
    scene.add(body);
    registerSolid(solidObjects, cx, cz, w / 2, d / 2);

    // Tracked collider — used by minimap and NPC spawn exclusion
    colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
      new THREE.Vector3(cx + w / 2, h, cz + d / 2),
    ));

    // Door on the side facing the city (toward x=0 if west buffer, etc.)
    const doorFaceX = cx > 0 ? cx - w / 2 - 0.05 : cx + w / 2 + 0.05;
    const doorFaceZ = cz > 0 ? cz - d / 2 - 0.05 : cz + d / 2 + 0.05;
    // Pick face whose normal points more toward city center
    const useXFace = Math.abs(cx) > Math.abs(cz);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.06), doorMat);
    if (useXFace) {
      door.position.set(doorFaceX, 1.0, cz);
      door.rotation.y = Math.PI / 2;
    } else {
      door.position.set(cx, 1.0, doorFaceZ);
    }
    scene.add(door);

    // Tiny roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.7, 1.2, d * 0.7),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
    );
    roof.position.set(cx, h + 0.6, cz);
    scene.add(roof);
  }

  // Helper: skip if point is too close to any existing landmark / water / boundary feature
  function _skip(cx, cz) {
    if (inLandmarkZone(cx, cz)) return true;
    // Lower Manhattan district (z=-145..-185, x=-25..25)
    if (cx > -25 && cx < 25 && cz > -190 && cz < -140) return true;
    // Hudson river + walkway (x ≤ -141)
    if (cx < -140) return true;
    // East river + walkway (x ≥ 141)
    if (cx > 140) return true;
    // Brooklyn Bridge area (wider buffer so generic buildings nearby don't
    // get phased by buffer fillers)
    if (cx > -90 && cx < -30 && cz > -160 && cz < -35) return true;
    // Secret alley footprint in the NW outskirts (don't block the entrance)
    if (cx > -145 && cx < -100 && cz > -245 && cz < -210) return true;
    return false;
  }

  // North buffer: z from -240 to -125 (above grid)
  // South buffer: z from 125 to 240 (below grid)
  // West buffer: x from -140 to -125 (between grid and river fence)
  // East buffer: x from 125 to 140
  const STEP = 22;
  let seed = 0;

  // Top buffer (north of grid) — start 25u past grid edge so sidewalk trees stay clear
  for (let cz = -145; cz >= -235; cz -= STEP) {
    for (let cx = -110; cx <= 110; cx += STEP) {
      seed++;
      if (_skip(cx, cz)) continue;
      const r = ((seed * 9301 + 49297) % 233280) / 233280;
      const w = 8 + r * 8;
      const d = 8 + ((seed * 17) % 100) / 100 * 8;
      const h = 8 + (((seed * 7919) % 200) / 200) * 26;
      _place(cx, cz, w, d, h, seed);
    }
  }

  // Bottom buffer (south of grid)
  for (let cz = 145; cz <= 235; cz += STEP) {
    for (let cx = -110; cx <= 110; cx += STEP) {
      seed++;
      if (_skip(cx, cz)) continue;
      const r = ((seed * 9301 + 49297) % 233280) / 233280;
      const w = 8 + r * 8;
      const d = 8 + ((seed * 17) % 100) / 100 * 8;
      const h = 8 + (((seed * 7919) % 200) / 200) * 26;
      _place(cx, cz, w, d, h, seed);
    }
  }

  // West/East thin strips (only x just outside ±120, before rivers)
  for (let cx of [-130, 130]) {
    for (let cz = -100; cz <= 100; cz += STEP) {
      seed++;
      if (_skip(cx, cz)) continue;
      const w = 8;
      const d = 12;
      const h = 10 + (((seed * 7919) % 200) / 200) * 20;
      _place(cx, cz, w, d, h, seed);
    }
  }

  return colliders;
}

function buildEastRiver(scene, solidObjects) {
  // East River — east side, x ≈ 150 to 240
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(95, 480),
    new THREE.MeshLambertMaterial({
      color: 0x1A3050, emissive: 0x0A1828, emissiveIntensity: 0.08,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(197, -0.05, 0);
  scene.add(water);

  for (let wz = -240; wz <= 240; wz += 8) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(93, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2A446C }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(197, 0.02, wz);
    scene.add(strip);
  }

  // Eastern riverfront walkway
  const walkway = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 480),
    new THREE.MeshLambertMaterial({ color: 0x888878 }),
  );
  walkway.rotation.x = -Math.PI / 2;
  walkway.position.set(146, 0.02, 0);
  scene.add(walkway);

  const postMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
  for (let pz = -230; pz <= 230; pz += 6) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), postMat);
    post.position.set(143, 0.55, pz);
    scene.add(post);
    if (pz < 226) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 6), postMat);
      rail.position.set(143, 1.05, pz + 3);
      scene.add(rail);
    }
  }
  // Solid wall along east river fence
  registerSolid(solidObjects, 143, 0, 0.25, 232);

  // Roosevelt Island — narrow strip in middle of East River
  const island = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.4, 60),
    new THREE.MeshLambertMaterial({ color: 0x3A6B35 }),
  );
  island.position.set(180, 0.2, -10);
  scene.add(island);

  // Apartment building on the island
  const apt = new THREE.Mesh(
    new THREE.BoxGeometry(4, 14, 18),
    new THREE.MeshLambertMaterial({ color: 0xC8B890 }),
  );
  apt.position.set(180, 7, -10);
  scene.add(apt);
  registerSolid(solidObjects, 180, -10, 2, 9);

  // Sister Smallpox Hospital ruin — south end of island
  const ruin = new THREE.Mesh(
    new THREE.BoxGeometry(4, 5, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a6a55 }),
  );
  ruin.position.set(180, 2.7, 18);
  scene.add(ruin);
  registerSolid(solidObjects, 180, 18, 2, 3);

  // Tramway tower — north end
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 12, 1.5),
    new THREE.MeshLambertMaterial({ color: 0x6e6e78 }),
  );
  tower.position.set(180, 6, -38);
  scene.add(tower);
  registerSolid(solidObjects, 180, -38, 0.75, 0.75);
}

// ── World class ───────────────────────────────────────────────────────────────

export class World {
  constructor(scene) {
    setupSky(scene);
    setupLighting(scene);

    const blocks = computeBlocks();
    buildStreets(scene, blocks);
    _buildCrosswalks(scene);

    const SO = []; // flat {minX,maxX,minZ,maxZ} used by player collision
    this.solidObjects = SO;

    // Generic buildings + colliders + enterable list
    const { colliders: bldColliders, enterables } = buildGenericBuildings(scene, blocks, SO);
    this.colliders = bldColliders;

    const propColliders = buildStreetProps(scene, SO);
    for (const c of propColliders) this.colliders.push(c);

    buildSidewalkFurniture(scene, SO);

    // Landmarks (some return a collider box)
    const esbBox          = buildESB(scene, SO);
    const chryslerBox     = buildChrysler(scene, SO);
    const bridgeColliders = buildBrooklynBridge(scene, SO);
    for (const c of bridgeColliders) this.colliders.push(c);
    const treeColliders   = buildCentralPark(scene, SO);
    for (const c of treeColliders) this.colliders.push(c);
    buildTimesSquare(scene, SO);
    buildGrandCentralExterior(scene, SO);
    buildColumbusCircle(scene, SO);
    buildLowerManhattan(scene, SO);
    buildHudsonRiver(scene, SO);
    buildEastRiver(scene, SO);
    const bufferColliders = buildOuterBuffer(scene, SO);
    for (const c of bufferColliders) this.colliders.push(c);

    // Street sign posts at major intersections
    makeStreetSignPost(scene, SO, -1, -1,   '5TH AVE',          '34TH ST');
    makeStreetSignPost(scene, SO,  9, -41,  '7TH AVE',          '42ND ST');
    makeStreetSignPost(scene, SO, 39,  19,  'LEXINGTON AVE',    '42ND ST');
    makeStreetSignPost(scene, SO, -51, 59,  'CENTRAL PARK W',   '72ND ST');
    makeStreetSignPost(scene, SO, -61, -81, 'BROOKLYN BRIDGE',  'CITY HALL');

    // Subway entrances
    // 5 stations named by street number, 4 outer corners + 1 across the
    // street from the ESB south door.
    makeSubwayEntrance(scene, SO,    3.3,   16, '34TH ST');     // south of ESB
    makeSubwayEntrance(scene, SO, -116.7,-116.7, '168TH ST');   // far NW corner
    makeSubwayEntrance(scene, SO,  116.7,-116.7, '138TH ST');   // far NE corner
    makeSubwayEntrance(scene, SO, -116.7, 116.7, '14TH ST');    // far SW corner
    makeSubwayEntrance(scene, SO,  116.7, 116.7, '4TH ST');     // far SE corner

    // Midtown building identity banners
    makeMidtownBanner(scene, -26,  11,  -7, 'ONE PENN PLAZA',        { bg: '#242430', fg: '#E8E8FF' });
    makeMidtownBanner(scene,   8,  11,  12, '30 ROCKEFELLER PLAZA',  { bg: '#1A2A1A', fg: '#FFD700' });
    makeMidtownBanner(scene,  28,  11,   2, 'METLIFE BUILDING',      { bg: '#0A1A30', fg: '#FFFFFF' });
    makeMidtownBanner(scene,  -8,  11,  22, 'RADIO CITY MUSIC HALL', { bg: '#2A1A00', fg: '#FFD700' });
    makeMidtownBanner(scene, -55,  11, -62, 'CITY HALL',             { bg: '#1A2040', fg: '#E8E8FF' });
    makeMidtownBanner(scene,  84,  0, -30, 'GRAND CENTRAL STATION', { bg: '#2A1800', fg: '#FFD700' });

    if (esbBox)      this.colliders.push(esbBox);
    if (chryslerBox) this.colliders.push(chryslerBox);

    const alleyColliders    = buildSecretAlley(scene, SO);
    for (const c of alleyColliders) this.colliders.push(c);

    const boundaryColliders = buildCityBoundary(scene, SO);
    for (const c of boundaryColliders) this.colliders.push(c);

    // Enterable landmark doors + generic building doors
    this.landmarkDoors = buildLandmarkDoors(scene);
    for (const e of enterables) {
      this.landmarkDoors.push({ id: e.id, name: e.name, pos: e.doorPos });
    }

    // Building labels for minimap/map — all enterable buildings with their door position
    this.buildingLabels = this.landmarkDoors.map(d => ({
      name: d.name, wx: d.pos.x, wz: d.pos.z,
    }));

    // Interior rooms (landmark + generic)
    this.interiors = buildInteriors(scene);
    const { interiors: genericInteriors, npcSpawns } = buildGenericInteriors(scene, enterables);
    Object.assign(this.interiors, genericInteriors);
    this.interiorNpcSpawns = npcSpawns;

    // Recompute all Box3 bounds after every group has been positioned and
    // added to the scene — fixes stale boxes for meshes registered before
    // their parent group was positioned.
    window.refreshAllSolids();

    // Startup collider overlap audit (runs after geometry is fully built)
    setTimeout(_auditColliders, 2000);
  }

  // ── Terrain elevation for ramps and bridge deck ──────────────────────────
  getFloorY(x, z, currentY = 0) {
    // North ramp: linear slope from z=-32 (y=0) to z=-46 (y=BRIDGE_DECK_Y)
    if (x >= -63 && x <= -57 && z >= -46 && z <= -32)
      return Math.max(0, ((-z - 32) / 14) * BRIDGE_DECK_Y);
    // Bridge deck + anchorages: flat at BRIDGE_DECK_Y; ground level when underneath
    if (x >= -71 && x <= -49 && z >= -114 && z <= -46)
      return currentY >= BRIDGE_DECK_Y - 1.5 ? BRIDGE_DECK_Y : 0;
    // South ramp: linear slope from z=-128 (y=0) to z=-114 (y=BRIDGE_DECK_Y)
    if (x >= -63 && x <= -57 && z >= -128 && z <= -114)
      return Math.max(0, ((z + 128) / 14) * BRIDGE_DECK_Y);
    return 0;
  }

  // ── Per-frame proximity check ─────────────────────────────────────────────
  // Returns { action, id, name } or null.
  //   action 'near-entry': player is within 3 units of a city-side landmark door
  //   action 'near-exit':  player is within 3 units of an interior exit door

  checkDoorProximity(playerPos) {
    for (const door of this.landmarkDoors) {
      if (playerPos.distanceTo(door.pos) < 3)
        return { action: 'near-entry', id: door.id, name: door.name };
    }
    for (const [id, interior] of Object.entries(this.interiors)) {
      if (playerPos.distanceTo(interior.exitDoorWorldPos) < 3)
        return { action: 'near-exit', id };
    }
    return null;
  }

  // Active collider set depends on whether the player is inside a landmark.
  // main.js calls this to get the correct colliders for the current location.
  getColliders(interiorId = null) {
    if (interiorId && this.interiors[interiorId])
      return this.interiors[interiorId].colliders;
    return this.colliders;
  }

  // Flat solidObjects used by the new cancel-only player collision system.
  getSolids(interiorId = null) {
    if (interiorId && this.interiors[interiorId]?.solidObjects)
      return this.interiors[interiorId].solidObjects;
    return this.solidObjects;
  }

  getInterior(id)  { return this.interiors[id]                            || null; }
  getDoor(id)      { return this.landmarkDoors.find(d => d.id === id)     || null; }
}
