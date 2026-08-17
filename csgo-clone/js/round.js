import * as THREE from 'three';
import { spawnBots } from './bots.js';
import { KILL_REWARD, ROUND_WIN_BONUS, lossBonus, clampMoney, PLANT_BONUS } from './economy.js';
import { SFX } from './audio.js';

const BUY_TIME = 12;
const ROUND_TIME = 100;
const FUSE_TIME = 38;
const END_TIME = 3.5;
const WINS_NEEDED = 4;
const CT_BOT_COUNT = 3;
const T_BOT_COUNT = 4;
const DEFUSE_TIME = 7;

export class RoundManager {
  constructor(scene, mapData, hud, player, weaponSystem) {
    this.scene = scene;
    this.map = mapData;
    this.hud = hud;
    this.player = player;
    this.weapons = weaponSystem;

    this.scoreCT = 0;
    this.scoreT = 0;
    this.lossStreakCT = 0;
    this.lossStreakT = 0;

    this.phase = 'BUY';
    this.timer = BUY_TIME;
    this.bots = [];
    this.bombState = { planted: false, position: null, fuse: FUSE_TIME };
    this.attackSite = null;
    this.matchOver = false;
    this.defuseHeld = false;
    this.playerDefuseProgress = 0;
    this.playerPlantProgress = 0;

    this._buildBombMesh();
  }

  _buildBombMesh() {
    const geo = new THREE.SphereGeometry(0.22, 10, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0x550000 });
    this.bombMesh = new THREE.Mesh(geo, mat);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
  }

  startMatch() {
    this.scoreCT = 0; this.scoreT = 0;
    this.lossStreakCT = 0; this.lossStreakT = 0;
    this.matchOver = false;
    this.player.money = 800;
    this._startRound();
  }

  _clearBots() {
    for (const b of this.bots) this.scene.remove(b.mesh);
    this.bots = [];
  }

  _startRound() {
    this.phase = 'BUY';
    this.timer = BUY_TIME;
    this.bombState = { planted: false, position: null, fuse: FUSE_TIME };
    this.bombMesh.visible = false;
    this.defuseHeld = false;
    this.playerDefuseProgress = 0;
    this.playerPlantProgress = 0;
    this.hud.setBombStatus('');

    this._clearBots();
    this.attackSite = Math.random() < 0.5 ? this.map.bombsites[0] : this.map.bombsites[1];

    const round = this.scoreCT + this.scoreT + 1;
    const tBots = spawnBots('T', T_BOT_COUNT, this.map.spawns.T, 0);
    // spawns.CT[0] is reserved for the player, so bots start from index 1.
    const ctBots = spawnBots('CT', CT_BOT_COUNT, this.map.spawns.CT.slice(1));
    this.bots = [...tBots, ...ctBots];
    this.bots.forEach(b => this.scene.add(b.mesh));

    // Give bots progressively better loadouts after the opening rounds
    // (cosmetic only — combat stats are static in bots.js).

    const toSite = this.attackSite.name === 'A' ? this.map.waypoints.toA : this.map.waypoints.toB;
    tBots.forEach(b => b.setPath([...this.map.waypoints.T, ...toSite]));
    ctBots.forEach((b, i) => {
      // Half defend the likely site, half hold mid.
      if (i % 2 === 0) {
        const site = i % 4 === 0 ? this.map.bombsites[0] : this.map.bombsites[1];
        const wp = site.name === 'A' ? this.map.waypoints.toA : this.map.waypoints.toB;
        b.setPath([...this.map.waypoints.CT, ...wp]);
      } else {
        b.setPath([...this.map.waypoints.CT]);
      }
    });

    // Reset loadouts each round (force-buy style) but keep money.
    this.weapons.owned = { knife: true, pistol: true };
    this.weapons.current = 'pistol';
    this.weapons.ammo.pistol.mag = 12; this.weapons.ammo.pistol.reserve = 36;
    this.weapons._restyleForWeapon();
    this.player.armor = 0;

    const spawn = this.map.spawns.CT[0];
    this.player.respawn(spawn, 'CT', Math.PI); // face south, into the map, away from the back wall

    this.hud.updateScore(this.scoreCT, this.scoreT);
    this.hud.showBanner(`Round ${round} — Buy phase`, 2000);
  }

  _endRound(winner, reason) {
    this.phase = 'END';
    this.timer = END_TIME;
    if (winner === 'CT') {
      this.scoreCT++; this.lossStreakCT = 0; this.lossStreakT++;
      this.player.money = clampMoney(this.player.money + ROUND_WIN_BONUS);
      SFX.roundWin();
    } else {
      this.scoreT++; this.lossStreakT = 0; this.lossStreakCT++;
      this.player.money = clampMoney(this.player.money + lossBonus(this.lossStreakCT));
      SFX.roundLose();
    }
    this.hud.updateScore(this.scoreCT, this.scoreT);
    this.hud.showBanner(`${winner === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} win — ${reason}`, 3200);
    this.hud.addKillFeed(`Round over: ${reason}`);

    if (this.scoreCT >= WINS_NEEDED || this.scoreT >= WINS_NEEDED) {
      this.matchOver = true;
    }
  }

  registerBotKilled(bot) {
    this.hud.addKillFeed(`You eliminated a ${bot.team === 'T' ? 'Terrorist' : 'Counter-Terrorist'}`);
    this.player.money = clampMoney(this.player.money + KILL_REWARD);
    SFX.hitFlesh();
    this._checkEliminationWin();
  }

  playerDied(killer) {
    this.hud.addKillFeed(`You were eliminated${killer ? ' by a Terrorist' : ''}`);
    this._checkEliminationWin();
  }

  _checkEliminationWin() {
    if (this.phase !== 'LIVE' && this.phase !== 'PLANTED') return;
    const tAlive = this.bots.some(b => b.team === 'T' && b.alive);
    const ctAlive = this.bots.some(b => b.team === 'CT' && b.alive) || this.player.alive;

    if (!ctAlive) {
      this._endRound('T', 'Counter-Terrorists eliminated');
      return;
    }
    if (!tAlive && !this.bombState.planted) {
      this._endRound('CT', 'Terrorists eliminated');
    }
  }

  _onPlantComplete(position) {
    this.bombState.planted = true;
    this.bombState.position = position.clone();
    this.bombState.position.y = 0.15;
    this.bombState.fuse = FUSE_TIME;
    this.bombMesh.visible = true;
    this.bombMesh.position.copy(this.bombState.position);
    this.phase = 'PLANTED';
    this.timer = FUSE_TIME;
    this.hud.showBanner(`Bomb planted — Site ${this.attackSite.name}!`, 2500);
    this.hud.addKillFeed('The bomb has been planted.');
    this.player.money = clampMoney(this.player.money + PLANT_BONUS * 0.3); // small partial credit for the team play
  }

  _tryPlayerDefuse(dt) {
    if (!this.bombState.planted || !this.player.alive) { this.defuseHeld = false; this.playerDefuseProgress = 0; return; }
    const dist = new THREE.Vector2(
      this.player.position.x - this.bombState.position.x,
      this.player.position.z - this.bombState.position.z
    ).length();
    const holding = this.player.keys.has('KeyE') && dist < 2.2;
    if (holding) {
      this.playerDefuseProgress += dt;
      if (Math.floor(this.playerDefuseProgress * 4) !== Math.floor((this.playerDefuseProgress - dt) * 4)) SFX.defuseTick();
      const pct = Math.min(100, Math.round((this.playerDefuseProgress / DEFUSE_TIME) * 100));
      this.hud.setBombStatus(`Defusing... ${pct}%`);
      if (this.playerDefuseProgress >= DEFUSE_TIME) {
        this._endRound('CT', 'Bomb defused');
      }
    } else {
      if (this.playerDefuseProgress > 0) this.hud.setBombStatus('Defuse interrupted');
      this.playerDefuseProgress = 0;
    }
  }

  update(dt) {
    if (this.matchOver) return;

    if (this.phase === 'BUY') {
      this.timer -= dt;
      this.hud.updateTimer(this.timer);
      if (this.timer <= 0) {
        this.phase = 'LIVE';
        this.timer = ROUND_TIME;
        this.hud.showBanner('Round live!', 1200);
      }
      return;
    }

    if (this.phase === 'LIVE') {
      this.timer -= dt;
      this.hud.updateTimer(this.timer);
      this._updateBots(dt);
      if (this.timer <= 0) {
        this._endRound('CT', 'Time expired');
      }
      return;
    }

    if (this.phase === 'PLANTED') {
      this.bombState.fuse -= dt;
      this.timer = this.bombState.fuse;
      this.hud.updateTimer(this.timer);
      if (Math.floor(this.bombState.fuse * 2) !== Math.floor((this.bombState.fuse + dt) * 2)) SFX.plantTick();
      this._updateBots(dt);
      this._tryPlayerDefuse(dt);
      if (this.bombState.fuse <= 0) {
        SFX.explode();
        this._endRound('T', 'Bomb detonated');
      }
      return;
    }

    if (this.phase === 'END') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.matchOver) return; // main.js shows match-over screen
        this._startRound();
      }
      return;
    }
  }

  _updateBots(dt) {
    const ctx = {
      player: this.player,
      solids: this.map.solids,
      colliders: this.map.colliders,
      bombsite: this.attackSite,
      bombState: this.bombState,
      onPlayerHit: (dmg, bot) => {
        const died = this.player.takeDamage(dmg);
        this.hud.flashDamage();
        if (died) this.playerDied(bot);
      },
      onPlantProgress: (frac) => {
        if (Math.floor(frac * 20) % 3 === 0) SFX.plantTick();
        this.hud.setBombStatus(`Terrorist planting... ${Math.round(frac * 100)}%`);
      },
      onPlantComplete: (pos) => this._onPlantComplete(pos),
      onDefuseProgress: (bot, frac) => {
        this.hud.setBombStatus(`Enemy defusing... ${Math.round(frac * 100)}%`);
      },
      onDefuseComplete: () => this._endRound('CT', 'Bomb defused'),
    };

    for (const b of this.bots) b.update(dt, ctx);
  }
}
