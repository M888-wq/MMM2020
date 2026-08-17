import * as THREE from 'three';

const EYE_STAND = 1.7;
const EYE_CROUCH = 1.1;
const HEIGHT_STAND = 1.9;
const HEIGHT_CROUCH = 1.4;
const RADIUS = 0.4;

// Player.position tracks the FEET (ground contact point). The camera is
// placed at feet + current eye height, which eases toward the stand/crouch
// target each frame for a smooth crouch transition.
export class Player {
  constructor(camera, domElement, colliders) {
    this.camera = camera;
    this.dom = domElement;
    this.colliders = colliders;

    this.position = new THREE.Vector3(0, 0, -40); // feet
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.keys = new Set();
    this.crouching = false;
    this.sprinting = false;
    this.onGround = true;
    this.eyeHeight = EYE_STAND;

    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.team = 'CT';
    this.money = 800;

    this.locked = false;

    this._bindInput();
  }

  _bindInput() {
    window.addEventListener('keydown', e => this.keys.add(e.code));
    window.addEventListener('keyup', e => this.keys.delete(e.code));

    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      const sens = 0.0022;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
  }

  requestLock() {
    this.dom.requestPointerLock();
  }

  respawn(feetPos, team, facingYaw = 0) {
    this.position.set(feetPos.x, 0, feetPos.z);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.onGround = true;
    this.eyeHeight = EYE_STAND;
    this.yaw = facingYaw;
    this.pitch = 0;
    if (team) this.team = team;
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true; // died
    }
    return false;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  get moveSpeedFrac() {
    const v = this.velocity.clone(); v.y = 0;
    return Math.min(1, v.length() / 6);
  }

  update(dt) {
    if (!this.alive) {
      this.camera.position.copy(this.eyePosition);
      return;
    }
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    this.crouching = this.keys.has('ControlLeft') || this.keys.has('KeyC');
    this.sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.crouching;

    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    // Movement input relative to yaw
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW')) iz -= 1;
    if (this.keys.has('KeyS')) iz += 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    const inputLen = Math.hypot(ix, iz);
    if (inputLen > 0) { ix /= inputLen; iz /= inputLen; }

    const speed = this.crouching ? 2.6 : (this.sprinting ? 6.5 : 4.5);
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wishDir = new THREE.Vector3()
      .addScaledVector(forward, -iz)
      .addScaledVector(right, ix);
    if (wishDir.lengthSq() > 0) wishDir.normalize();

    this.velocity.x = wishDir.x * speed;
    this.velocity.z = wishDir.z * speed;

    if (this.onGround && this.keys.has('Space')) {
      this.velocity.y = 6.5;
      this.onGround = false;
    }
    this.velocity.y -= 18 * dt;
    if (this.velocity.y < -30) this.velocity.y = -30;

    this._moveWithCollision(dt);

    this.camera.position.copy(this.eyePosition);
  }

  _bodyBounds(pos) {
    const r = RADIUS;
    const h = this.crouching ? HEIGHT_CROUCH : HEIGHT_STAND;
    return {
      min: new THREE.Vector3(pos.x - r, pos.y, pos.z - r),
      max: new THREE.Vector3(pos.x + r, pos.y + h, pos.z + r),
    };
  }

  _intersectsAny(pos) {
    const { min, max } = this._bodyBounds(pos);
    for (const c of this.colliders) {
      if (min.x < c.max.x && max.x > c.min.x &&
          min.y < c.max.y && max.y > c.min.y &&
          min.z < c.max.z && max.z > c.min.z) {
        return c;
      }
    }
    return null;
  }

  _moveWithCollision(dt) {
    const pos = this.position;

    // X axis
    pos.x += this.velocity.x * dt;
    if (this._intersectsAny(pos)) pos.x -= this.velocity.x * dt;

    // Z axis
    pos.z += this.velocity.z * dt;
    if (this._intersectsAny(pos)) pos.z -= this.velocity.z * dt;

    // Y axis
    const dy = this.velocity.y * dt;
    pos.y += dy;
    const hit = this._intersectsAny(pos);
    if (hit) {
      pos.y -= dy;
      if (dy < 0) {
        pos.y = hit.max.y;
        this.onGround = true;
      } else {
        pos.y = hit.min.y - (this.crouching ? HEIGHT_CROUCH : HEIGHT_STAND);
      }
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }
  }
}
