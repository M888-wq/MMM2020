import * as THREE from 'three';
import { buildMap } from './map.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { RoundManager } from './round.js';
import { HUD } from './hud.js';
import { attemptPurchase } from './economy.js';
import { SFX } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141821);
scene.fog = new THREE.Fog(0x141821, 40, 95);

const camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.05, 200);
scene.add(camera); // camera must be in the scene graph so its child (the gun viewmodel) renders
const camLight = new THREE.PointLight(0xffffff, 0.6, 12);
camera.add(camLight); // small fill so nearby geometry and the viewmodel read clearly

const mapData = buildMap(scene);
const player = new Player(camera, canvas, mapData.colliders);
const weapons = new WeaponSystem(camera, scene);
const hud = new HUD();
const round = new RoundManager(scene, mapData, hud, player, weapons);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Menu / pointer lock flow ----------
let started = false;
document.getElementById('start-btn').addEventListener('click', () => {
  hud.showMenu(false);
  player.requestLock();
  if (!started) {
    started = true;
    round.startMatch();
  }
});

document.getElementById('pointer-lock-hint').addEventListener('click', () => player.requestLock());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  hud.showLockHint(started && !locked && !buyMenuOpen);
});

// ---------- Buy menu ----------
let buyMenuOpen = false;
function setBuyMenu(open) {
  buyMenuOpen = open && round.phase === 'BUY';
  hud.setBuyMenuVisible(buyMenuOpen, player.money);
  if (buyMenuOpen) {
    hud.refreshBuyAffordability(player.money);
    document.exitPointerLock();
  } else if (started && round.phase !== 'END') {
    player.requestLock();
  }
}
hud.onBuyClick((id, kind) => {
  if (attemptPurchase(id, kind, player, weapons)) {
    hud.refreshBuyAffordability(player.money);
  }
});

// ---------- Input: shooting, reload, weapon switch, buy menu ----------
let firing = false;
let triggerPulled = false; // consumed once per click for semi-auto weapons
canvas.addEventListener('mousedown', e => {
  if (e.button === 0 && player.locked) { firing = true; triggerPulled = true; }
});
window.addEventListener('mouseup', e => { if (e.button === 0) firing = false; });

window.addEventListener('keydown', e => {
  if (e.code === 'KeyR') weapons.startReload();
  if (e.code === 'Digit1') weapons.switchTo('knife');
  if (e.code === 'Digit2') weapons.switchTo(weapons.owned.smg ? 'smg' : 'pistol');
  if (e.code === 'Digit3') weapons.switchTo(weapons.owned.rifle ? 'rifle' : 'pistol');
  if (e.code === 'KeyB') setBuyMenu(!buyMenuOpen);
  if (e.code === 'Escape') { buyMenuOpen = false; hud.setBuyMenuVisible(false); }
});

const shootable = () => round.bots.filter(b => b.alive).map(b => b.mesh);

function fireOnce() {
  const def = weapons.def;
  const result = weapons.fire(shootable(), mapData.solids);
  if (result === null) return;
  SFX.shot(def.id);
  if (result.hit) {
    hud.flashHit();
    const bot = result.target.userData.bot;
    const killed = bot.takeDamage(result.damage);
    if (killed) round.registerBotKilled(bot);
  }
}

function handleFiring() {
  if (!player.alive || !player.locked || buyMenuOpen) return;
  if (!firing) return;
  if (weapons.def.auto) {
    fireOnce();
  } else if (triggerPulled) {
    fireOnce();
    triggerPulled = false;
  }
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (started) {
    if (buyMenuOpen && round.phase !== 'BUY') setBuyMenu(false);
    if (!buyMenuOpen) {
      player.update(dt);
      handleFiring();
    }
    weapons.update(dt, player.moveSpeedFrac);
    round.update(dt);
    hud.updatePlayer(player, weapons);
    if (buyMenuOpen) hud.refreshBuyAffordability(player.money);

    if (round.matchOver && round.phase === 'END' && round.timer <= -0.5) {
      showMatchOver();
    }
  }

  renderer.render(scene, camera);
}

function showMatchOver() {
  started = false;
  document.exitPointerLock();
  const winner = round.scoreCT > round.scoreT ? 'Counter-Terrorists' : 'Terrorists';
  document.querySelector('.menu-panel h1').textContent = 'MATCH OVER';
  document.querySelector('.menu-panel .tagline').textContent =
    `${winner} win the match ${round.scoreCT}-${round.scoreT}. Play again?`;
  document.getElementById('start-btn').textContent = 'Play Again';
  hud.showMenu(true);
  hud.showLockHint(false);
  // Rebuild the start handler as a fresh match trigger.
  const btn = document.getElementById('start-btn');
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', () => {
    hud.showMenu(false);
    player.requestLock();
    started = true;
    round.startMatch();
  });
}

animate();
