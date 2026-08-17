import * as THREE from 'three';

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Knife', price: 0, damage: 40, range: 2.2,
    fireDelay: 0.5, magSize: Infinity, reserve: Infinity, reloadTime: 0,
    spread: 0, auto: false, color: 0xcccccc, viewSize: [0.06, 0.06, 0.5],
  },
  pistol: {
    id: 'pistol', name: 'Pistol', price: 0, damage: 26, range: 60,
    fireDelay: 0.18, magSize: 12, reserve: 36, reloadTime: 1.4,
    spread: 0.018, auto: false, color: 0x9aa1ab, viewSize: [0.15, 0.22, 0.48],
  },
  smg: {
    id: 'smg', name: 'SMG', price: 1200, damage: 22, range: 45,
    fireDelay: 0.09, magSize: 30, reserve: 90, reloadTime: 2.0,
    spread: 0.03, auto: true, color: 0xa4abb3, viewSize: [0.15, 0.19, 0.75],
  },
  rifle: {
    id: 'rifle', name: 'Rifle', price: 2700, damage: 34, range: 90,
    fireDelay: 0.1, magSize: 30, reserve: 90, reloadTime: 2.3,
    spread: 0.022, auto: true, color: 0xb08e5a, viewSize: [0.16, 0.19, 0.92],
  },
};

export const ARMOR = { id: 'armor', name: 'Kevlar Vest', price: 650, amount: 60 };

export class WeaponSystem {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.owned = { knife: true, pistol: true };
    this.ammo = {}; // id -> { mag, reserve }
    Object.values(WEAPONS).forEach(w => {
      this.ammo[w.id] = { mag: w.magSize, reserve: w.reserve };
    });
    this.current = 'pistol';
    this.cooldown = 0;
    this.reloading = 0;
    this.spreadHeat = 0;

    this.raycaster = new THREE.Raycaster();

    this._buildViewmodel();
  }

  _buildViewmodel() {
    this.viewGroup = new THREE.Group();
    this.camera.add(this.viewGroup);
    this.viewMesh = null;
    this._restyleForWeapon();
    this.basePos = new THREE.Vector3(0.28, -0.22, -0.5);
    this.viewGroup.position.copy(this.basePos);
    this.recoilOffset = new THREE.Vector3();
    this.bobT = 0;
  }

  _restyleForWeapon() {
    if (this.viewMesh) this.viewGroup.remove(this.viewMesh);
    const def = WEAPONS[this.current];
    const [sx, sy, sz] = def.viewSize;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    // Emissive so the viewmodel reads clearly regardless of world lighting
    // (it sits right against the camera, in its own shadow otherwise).
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.4, metalness: 0.3,
      emissive: def.color, emissiveIntensity: 1.0,
    });
    this.viewMesh = new THREE.Mesh(geo, mat);
    this.viewMesh.position.set(0, 0, -sz / 2);
    this.viewGroup.add(this.viewMesh);
  }

  own(id) { this.owned[id] = true; }

  switchTo(id) {
    if (!this.owned[id] || id === this.current) return;
    this.current = id;
    this.reloading = 0;
    this._restyleForWeapon();
  }

  cycle(dir) {
    const order = ['knife', 'pistol', 'smg', 'rifle'].filter(id => this.owned[id]);
    let idx = order.indexOf(this.current);
    idx = (idx + dir + order.length) % order.length;
    this.switchTo(order[idx]);
  }

  get def() { return WEAPONS[this.current]; }
  get ammoState() { return this.ammo[this.current]; }

  startReload() {
    const def = this.def;
    const a = this.ammoState;
    if (def.magSize === Infinity) return;
    if (a.mag >= def.magSize || a.reserve <= 0 || this.reloading > 0) return;
    this.reloading = def.reloadTime;
  }

  update(dt, moveSpeedFrac) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const def = this.def, a = this.ammoState;
        const need = def.magSize - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }
    this.spreadHeat = Math.max(0, this.spreadHeat - dt * 2.2);

    // viewmodel bob + recoil recovery
    this.bobT += dt * (4 + moveSpeedFrac * 6);
    const bobX = Math.sin(this.bobT) * 0.015 * moveSpeedFrac;
    const bobY = Math.abs(Math.cos(this.bobT)) * 0.012 * moveSpeedFrac;
    this.recoilOffset.lerp(new THREE.Vector3(), dt * 8);
    this.viewGroup.position.set(
      this.basePos.x + bobX + this.recoilOffset.x,
      this.basePos.y + bobY + this.recoilOffset.y,
      this.basePos.z + this.recoilOffset.z
    );
  }

  canFire() {
    const def = this.def, a = this.ammoState;
    return this.cooldown <= 0 && this.reloading <= 0 && (def.magSize === Infinity || a.mag > 0);
  }

  // Fires a hitscan shot. `targets` is an array of THREE.Object3D (bots) with userData.hitRadius.
  // Returns { hit: bool, killed: bool, target } for the caller to apply game logic.
  fire(targets, solids) {
    if (!this.canFire()) {
      if (this.ammoState && this.ammoState.mag <= 0 && this.def.magSize !== Infinity) this.startReload();
      return null;
    }
    const def = this.def;
    this.cooldown = def.fireDelay;
    if (def.magSize !== Infinity) this.ammoState.mag -= 1;

    // recoil kick
    this.recoilOffset.z += 0.06;
    this.recoilOffset.y += 0.02;

    const spread = def.spread + this.spreadHeat;
    this.spreadHeat = Math.min(0.12, this.spreadHeat + 0.012);

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.raycaster.set(origin, dir);
    this.raycaster.far = def.range;

    // Check bot hits first, but respect wall occlusion.
    let best = null;
    for (const t of targets) {
      if (t.userData.dead) continue;
      const pos = t.getWorldPosition(new THREE.Vector3());
      pos.y += t.userData.hitCenterOffset || 0;
      const toTarget = pos.clone().sub(origin);
      const dist = toTarget.length();
      if (dist > def.range) continue;
      toTarget.normalize();
      const angle = toTarget.angleTo(dir);
      const hitRadius = t.userData.hitRadius || 0.5;
      const angularSize = Math.atan2(hitRadius, dist);
      if (angle > angularSize) continue;
      // occlusion check against solids
      const occ = new THREE.Raycaster(origin, toTarget, 0, dist - 0.2);
      const hits = occ.intersectObjects(solids.children, false);
      if (hits.length > 0) continue;
      if (!best || dist < best.dist) best = { target: t, dist };
    }

    if (best) {
      const headshot = Math.random() < 0.18;
      const dmg = headshot ? def.damage * 1.9 : def.damage;
      return { hit: true, target: best.target, damage: dmg, headshot };
    }
    return { hit: false };
  }
}
