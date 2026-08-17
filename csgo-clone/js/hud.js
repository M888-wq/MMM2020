import { WEAPONS, ARMOR } from './weapons.js';

const BUY_ITEMS = [
  { key: '1', id: 'pistol', label: 'Pistol', kind: 'weapon' },
  { key: '2', id: 'smg', label: 'SMG', kind: 'weapon' },
  { key: '3', id: 'rifle', label: 'Rifle', kind: 'weapon' },
  { key: '4', id: 'armor', label: 'Kevlar Vest', kind: 'armor' },
];

export class HUD {
  constructor() {
    this.el = {
      scoreCT: document.getElementById('score-ct'),
      scoreT: document.getElementById('score-t'),
      timer: document.getElementById('round-timer'),
      banner: document.getElementById('round-banner'),
      killFeed: document.getElementById('kill-feed'),
      health: document.getElementById('health-val'),
      armor: document.getElementById('armor-val'),
      ammoMag: document.getElementById('ammo-mag'),
      ammoReserve: document.getElementById('ammo-reserve'),
      weaponName: document.getElementById('weapon-name'),
      money: document.getElementById('money-val'),
      bombStatus: document.getElementById('bomb-status'),
      buyMenu: document.getElementById('buy-menu'),
      buyGrid: document.getElementById('buy-grid'),
      buyMoney: document.getElementById('buy-money'),
      hitMarker: document.getElementById('hit-marker'),
      damageVignette: document.getElementById('damage-vignette'),
      crosshair: document.getElementById('crosshair'),
      menuOverlay: document.getElementById('menu-overlay'),
      startBtn: document.getElementById('start-btn'),
      lockHint: document.getElementById('pointer-lock-hint'),
    };
    this._buildBuyMenu();
  }

  _buildBuyMenu() {
    this.el.buyGrid.innerHTML = '';
    BUY_ITEMS.forEach(item => {
      const price = item.kind === 'armor' ? ARMOR.price : WEAPONS[item.id].price;
      const div = document.createElement('div');
      div.className = 'buy-item';
      div.dataset.id = item.id;
      div.dataset.kind = item.kind;
      div.innerHTML = `<span class="key">${item.key}</span><div class="name">${item.label}</div><div class="price">${price === 0 ? 'Free' : '$' + price}</div>`;
      this.el.buyGrid.appendChild(div);
    });
  }

  onBuyClick(handler) {
    this.el.buyGrid.querySelectorAll('.buy-item').forEach(div => {
      div.addEventListener('click', () => handler(div.dataset.id, div.dataset.kind));
    });
  }

  setBuyMenuVisible(visible, money) {
    this.el.buyMenu.classList.toggle('hidden', !visible);
    this.el.crosshair.style.display = visible ? 'none' : '';
    if (visible) this.el.buyMoney.textContent = money;
  }

  refreshBuyAffordability(money) {
    this.el.buyGrid.querySelectorAll('.buy-item').forEach(div => {
      const item = BUY_ITEMS.find(i => i.id === div.dataset.id);
      const price = item.kind === 'armor' ? ARMOR.price : WEAPONS[item.id].price;
      div.classList.toggle('disabled', price > money);
    });
  }

  updateScore(ct, t) {
    this.el.scoreCT.textContent = `CT ${ct}`;
    this.el.scoreT.textContent = `T ${t}`;
  }

  updateTimer(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    this.el.timer.textContent = `${m}:${r.toString().padStart(2, '0')}`;
  }

  showBanner(text, ms = 2800) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => this.el.banner.classList.remove('show'), ms);
  }

  addKillFeed(text) {
    const div = document.createElement('div');
    div.className = 'kill-entry';
    div.textContent = text;
    this.el.killFeed.appendChild(div);
    setTimeout(() => div.remove(), 5000);
    while (this.el.killFeed.children.length > 6) this.el.killFeed.removeChild(this.el.killFeed.firstChild);
  }

  updatePlayer(player, weaponSystem) {
    this.el.health.textContent = Math.ceil(player.health);
    this.el.armor.textContent = Math.ceil(player.armor);
    const def = weaponSystem.def;
    const a = weaponSystem.ammoState;
    this.el.ammoMag.textContent = def.magSize === Infinity ? '-' : a.mag;
    this.el.ammoReserve.textContent = def.magSize === Infinity ? '-' : a.reserve;
    this.el.weaponName.textContent = def.name + (weaponSystem.reloading > 0 ? ' (reloading)' : '');
    this.el.money.textContent = player.money;
  }

  setBombStatus(text) {
    this.el.bombStatus.textContent = text || '';
  }

  flashHit() {
    this.el.hitMarker.classList.remove('show');
    void this.el.hitMarker.offsetWidth;
    this.el.hitMarker.classList.add('show');
  }

  flashDamage() {
    this.el.damageVignette.classList.remove('hit');
    void this.el.damageVignette.offsetWidth;
    this.el.damageVignette.classList.add('hit');
    setTimeout(() => this.el.damageVignette.classList.remove('hit'), 50);
  }

  showMenu(show) {
    this.el.menuOverlay.classList.toggle('hidden', !show);
  }

  showLockHint(show) {
    this.el.lockHint.classList.toggle('hidden', !show);
  }
}
