import * as THREE from 'three';

// A compact arena in the spirit of a CS:GO map: two spawns, a mid area,
// two bombsites (A / B) with crate cover, connected by open lanes.
// Everything solid is registered as an AABB in `colliders` for movement
// collision and as a mesh in `shootables`-eligible group `solids` for raycasts.

const wallMat = new THREE.MeshStandardMaterial({ color: 0x555b66, roughness: 0.9 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 1 });
const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3d, roughness: 0.8 });
const siteAMat = new THREE.MeshStandardMaterial({ color: 0x6b3030, roughness: 1 });
const siteBMat = new THREE.MeshStandardMaterial({ color: 0x2f4a63, roughness: 1 });

export function buildMap(scene) {
  const colliders = []; // { min: Vector3, max: Vector3 }
  const solids = new THREE.Group();
  scene.add(solids);

  function addBox(cx, cy, cz, sx, sy, sz, mat, collide = true) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    solids.add(mesh);
    if (collide) {
      colliders.push({
        min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
        max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
      });
    }
    return mesh;
  }

  const BOUND = 46; // half-extent of the arena
  const WALL_H = 8;

  // Floor
  addBox(0, -0.5, 0, BOUND * 2, 1, BOUND * 2, floorMat, false);
  const floorCollider = { min: new THREE.Vector3(-BOUND, -1, -BOUND), max: new THREE.Vector3(BOUND, 0, BOUND) };
  colliders.push(floorCollider);

  // Perimeter walls
  addBox(0, WALL_H / 2, -BOUND, BOUND * 2, WALL_H, 1, wallMat);
  addBox(0, WALL_H / 2, BOUND, BOUND * 2, WALL_H, 1, wallMat);
  addBox(-BOUND, WALL_H / 2, 0, 1, WALL_H, BOUND * 2, wallMat);
  addBox(BOUND, WALL_H / 2, 0, 1, WALL_H, BOUND * 2, wallMat);

  // Mid dividing walls to create lanes (A lane / mid / B lane), leaving
  // openings so bots and player can cross between lanes.
  addBox(14, WALL_H / 2, -6, 1, WALL_H, 44, wallMat);   // wall between mid and A lane (gap near z=20)
  addBox(-14, WALL_H / 2, -6, 1, WALL_H, 44, wallMat);  // wall between mid and B lane

  // Cover crates scattered around
  const crateSpots = [
    [6, 1, 10], [-6, 1, 14], [0, 1, 0], [20, 1, 5], [-20, 1, 5],
    [6, 1, -20], [-6, 1, -18], [28, 1, -10], [-28, 1, -10],
    [0, 1, -30], [10, 1, 30], [-10, 1, 28], [-2, 1, 20], [2, 1, -8],
  ];
  crateSpots.forEach(([x, y, z]) => addBox(x, y, z, 2, 2, 2, crateMat));

  // Bombsite A (east side) marker floor + light walls forming a room
  addBox(30, 0.02, -25, 16, 0.05, 16, siteAMat, false);
  addBox(30, WALL_H / 2, -33, 16, WALL_H, 1, wallMat);
  addBox(38, WALL_H / 2, -25, 1, WALL_H, 16, wallMat);

  // Bombsite B (west side) marker floor + light walls forming a room
  addBox(-30, 0.02, -25, 16, 0.05, 16, siteBMat, false);
  addBox(-30, WALL_H / 2, -33, 16, WALL_H, 1, wallMat);
  addBox(-38, WALL_H / 2, -25, 1, WALL_H, 16, wallMat);

  const bombsites = [
    { name: 'A', center: new THREE.Vector3(30, 0, -25), radius: 9 },
    { name: 'B', center: new THREE.Vector3(-30, 0, -25), radius: 9 },
  ];

  // All positions below are FEET-level (y=0 ground contact), matching
  // Player/Bot conventions.
  const spawns = {
    CT: [
      new THREE.Vector3(4, 0, -40), new THREE.Vector3(-4, 0, -40),
      new THREE.Vector3(8, 0, -42), new THREE.Vector3(-8, 0, -42),
      new THREE.Vector3(0, 0, -43),
    ],
    T: [
      new THREE.Vector3(4, 0, 40), new THREE.Vector3(-4, 0, 40),
      new THREE.Vector3(8, 0, 42), new THREE.Vector3(-8, 0, 42),
      new THREE.Vector3(0, 0, 43),
    ],
  };

  // Waypoints used by bot AI to path from spawns toward bombsites.
  const waypoints = {
    CT: [
      new THREE.Vector3(0, 0, -40),
      new THREE.Vector3(0, 0, -20),
      new THREE.Vector3(0, 0, 0),
    ],
    T: [
      new THREE.Vector3(0, 0, 40),
      new THREE.Vector3(0, 0, 20),
      new THREE.Vector3(0, 0, 0),
    ],
    toA: [new THREE.Vector3(0, 0, -10), new THREE.Vector3(20, 0, -18), new THREE.Vector3(30, 0, -25)],
    toB: [new THREE.Vector3(0, 0, -10), new THREE.Vector3(-20, 0, -18), new THREE.Vector3(-30, 0, -25)],
  };

  // Ambient lighting for the arena
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x4a3d2c, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4da, 1.3);
  sun.position.set(40, 60, 20);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.5);
  fill.position.set(-30, 40, -40);
  scene.add(fill);

  return { colliders, solids, bombsites, spawns, waypoints, bounds: BOUND };
}
