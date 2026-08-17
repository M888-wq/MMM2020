import { WEAPONS, ARMOR } from './weapons.js';

export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const KILL_REWARD = 300;
export const ROUND_WIN_BONUS = 3250;
export const ROUND_LOSS_BASE = 1400;
export const ROUND_LOSS_STEP = 500;
export const PLANT_BONUS = 800; // bonus reward when T plants (win or lose)

export function clampMoney(v) {
  return Math.max(0, Math.min(MAX_MONEY, Math.round(v)));
}

export function lossBonus(consecutiveLosses) {
  const steps = Math.min(consecutiveLosses, 4);
  return ROUND_LOSS_BASE + ROUND_LOSS_STEP * steps;
}

// Attempts a purchase; mutates player.money and grants the item via weaponSystem/player.
// Returns true if the purchase succeeded.
export function attemptPurchase(id, kind, player, weaponSystem) {
  if (kind === 'armor') {
    if (player.money < ARMOR.price) return false;
    if (player.armor >= ARMOR.amount) return false;
    player.money = clampMoney(player.money - ARMOR.price);
    player.armor = ARMOR.amount;
    return true;
  }
  const def = WEAPONS[id];
  if (!def) return false;
  if (player.money < def.price) return false;
  player.money = clampMoney(player.money - def.price);
  weaponSystem.own(id);
  weaponSystem.ammo[id].mag = def.magSize;
  weaponSystem.ammo[id].reserve = def.reserve;
  weaponSystem.switchTo(id);
  return true;
}
