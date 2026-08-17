import * as THREE from 'three';

const SPEED = 3.4;
const BOT_RADIUS = 0.4;
const HEIGHT = 1.8;
const EYE = 1.55;
const DETECT_RANGE = 34;
const FOV = Math.PI * 0.75; // wide-ish so bots aren't trivially flanked
const FIRE_RANGE = 40;
const BOT_DEFUSE_TIME = 6;
const PLANT_TIME = 3.5;

const ctMat = new THREE.MeshStandardMaterial({ color: 0x4a78c9, roughness: 0.6 });
const tMat = new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.6 });

export class Bot {
  constructor(team, spawnPos, role) {
    this.team = team; // 'CT' | 'T'
    this.role = role; // 'carrier' | 'normal' (carrier is the T that plants)
    this.health = 100;
    this.alive = true;
    this.state = 'ADVANCE';
    this.facing = team === 'CT' ? Math.PI : 0;
    this.fireCooldown = 0;
    this.engageMemory = 0; // time since player last seen
    this.defuseProgress = 0;
    this.plantProgress = 0;
    this.path = [];
    this.pathIndex = 0;
    this.holdTimer = Math.random() * 2;

    this.mesh = new THREE.Group();
    const bodyGeo = new THREE.CapsuleGeometry(BOT_RADIUS, HEIGHT - BOT_RADIUS * 2, 4, 8);
    const body = new THREE.Mesh(bodyGeo, team === 'CT' ? ctMat : tMat);
    body.position.y = HEIGHT / 2;
    this.mesh.add(body);
    const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const head = new THREE.Mesh(headGeo, team === 'CT' ? ctMat : tMat);
    head.position.y = HEIGHT - 0.1;
    this.mesh.add(head);
    this.mesh.position.copy(spawnPos);
    this.mesh.userData.hitRadius = 0.55;
    // mesh.position is the FEET of the bot; hitscan aims at approximate torso center.
    this.mesh.userData.hitCenterOffset = 1.0;
    this.mesh.userData.dead = false;
    this.mesh.userData.bot = this;
  }

  get eyePos() {
    return new THREE.Vector3(this.mesh.position.x, EYE, this.mesh.position.z);
  }

  setPath(points) {
    this.path = points.slice();
    this.pathIndex = 0;
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.mesh.userData.dead = true;
      this.mesh.visible = false;
      return true;
    }
    return false;
  }

  _hasLineOfSight(fromPos, toPos, solids) {
    const dir = toPos.clone().sub(fromPos);
    const dist = dir.length();
    dir.normalize();
    const ray = new THREE.Raycaster(fromPos, dir, 0.1, dist - 0.1);
    const hits = ray.intersectObjects(solids.children, false);
    return hits.length === 0;
  }

  _canSeePlayer(player, solids) {
    if (!player.alive) return false;
    const eye = this.eyePos;
    const target = player.eyePosition;
    const toTarget = target.clone().sub(eye);
    const dist = toTarget.length();
    if (dist > DETECT_RANGE) return false;
    toTarget.normalize();
    const facingDir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const angle = Math.acos(THREE.MathUtils.clamp(facingDir.dot(new THREE.Vector3(toTarget.x, 0, toTarget.z).normalize()), -1, 1));
    if (angle > FOV / 2 && this.state !== 'ENGAGE') return false;
    if (!this._hasLineOfSight(eye, target, solids)) return false;
    return true;
  }

  _moveTowards(target, dt, colliders) {
    const pos = this.mesh.position;
    const to = new THREE.Vector3(target.x - pos.x, 0, target.z - pos.z);
    const dist = to.length();
    if (dist < 0.35) return true; // reached
    to.normalize();
    this.facing = Math.atan2(to.x, to.z);

    const step = SPEED * dt;
    const nx = pos.x + to.x * step;
    const nz = pos.z + to.z * step;

    const collides = (x, z) => {
      const min = new THREE.Vector3(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
      const max = new THREE.Vector3(x + BOT_RADIUS, HEIGHT, z + BOT_RADIUS);
      for (const c of colliders) {
        if (min.x < c.max.x && max.x > c.min.x &&
            min.y < c.max.y && max.y > c.min.y &&
            min.z < c.max.z && max.z > c.min.z) return true;
      }
      return false;
    };

    if (!collides(nx, pos.z)) pos.x = nx;
    if (!collides(pos.x, nz)) pos.z = nz;
    return false;
  }

  _lookAt(target, dt) {
    const pos = this.mesh.position;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += THREE.MathUtils.clamp(diff, -dt * 6, dt * 6);
  }

  _tryShoot(player, dt) {
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return null;
    const dist = this.eyePos.distanceTo(player.eyePosition);
    if (dist > FIRE_RANGE) return null;
    this.fireCooldown = 0.55 + Math.random() * 0.35;
    const falloff = THREE.MathUtils.clamp(1 - dist / FIRE_RANGE, 0.15, 1);
    const hitChance = 0.28 + falloff * 0.4;
    if (Math.random() < hitChance) {
      const dmg = 10 + Math.random() * 14;
      return dmg;
    }
    return null;
  }

  // Main AI tick. Context carries shared world refs.
  update(dt, ctx) {
    if (!this.alive) return;
    const { player, solids, colliders, bombsite, bombState } = ctx;

    const seesPlayer = this._canSeePlayer(player, solids);
    if (seesPlayer) {
      this.engageMemory = 1.2;
      this.state = 'ENGAGE';
    } else if (this.engageMemory > 0) {
      this.engageMemory -= dt;
    } else if (this.state === 'ENGAGE') {
      this.state = 'ADVANCE';
    }

    if (this.state === 'ENGAGE') {
      this._lookAt(player.eyePosition, dt);
      if (seesPlayer) {
        const dmg = this._tryShoot(player, dt);
        if (dmg) ctx.onPlayerHit(dmg, this);
      }
      return; // hold position while engaging
    }

    // Bomb-planted behavior
    if (bombState && bombState.planted) {
      if (this.team === 'CT') {
        const bombPos = bombState.position;
        const reached = this._moveTowards(bombPos, dt, colliders);
        if (reached) {
          this.state = 'DEFUSE';
          this.defuseProgress += dt;
          ctx.onDefuseProgress(this, this.defuseProgress / BOT_DEFUSE_TIME);
          if (this.defuseProgress >= BOT_DEFUSE_TIME) ctx.onDefuseComplete();
        }
        return;
      } else {
        // T bots hold near the site after planting
        if (this.path.length === 0) this.setPath([bombState.position]);
        this._moveTowards(bombState.position, dt, colliders);
        this._lookAt(this.mesh.position.clone().add(new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing))), dt);
        return;
      }
    }

    // Bomb carrier plants once at the site
    if (this.team === 'T' && this.role === 'carrier' && !bombState.planted) {
      const distToSite = new THREE.Vector2(this.mesh.position.x - bombsite.center.x, this.mesh.position.z - bombsite.center.z).length();
      if (distToSite < bombsite.radius * 0.7) {
        this.state = 'PLANT';
        this.plantProgress += dt;
        ctx.onPlantProgress(this.plantProgress / PLANT_TIME);
        if (this.plantProgress >= PLANT_TIME) ctx.onPlantComplete(this.mesh.position.clone());
        return;
      }
    }

    // Regular pathing
    if (this.path.length > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      const reached = this._moveTowards(target, dt, colliders);
      if (reached) this.pathIndex++;
    } else {
      // idle sway near current spot
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        this.holdTimer = 2 + Math.random() * 2;
        this.facing += (Math.random() - 0.5) * 1.2;
      }
    }
  }
}

export function spawnBots(team, count, spawnPoints, carrierIndex = -1) {
  const bots = [];
  for (let i = 0; i < count; i++) {
    const pos = spawnPoints[i % spawnPoints.length].clone();
    pos.x += (Math.random() - 0.5) * 2;
    pos.z += (Math.random() - 0.5) * 2;
    const role = i === carrierIndex ? 'carrier' : 'normal';
    bots.push(new Bot(team, pos, role));
  }
  return bots;
}
