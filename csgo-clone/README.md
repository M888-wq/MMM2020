# Strike Tactics

A browser-based, CS:GO-inspired tactical FPS. Pure HTML/CSS/JavaScript (ES
modules) and [Three.js](https://threejs.org/) — no build step, no backend.

This is **single-player against bots**, not a networked multiplayer clone —
real CS:GO-style multiplayer needs authoritative server netcode, which is a
different project. What's here is the full round-based loop: movement and
gunplay, a buy-menu economy, and bomb plant/defuse rounds against an AI team
and an AI enemy team.

## Run it

Any static file server works (ES module imports need `http://`, not
`file://`):

```
cd csgo-clone
python3 -m http.server 8000
# then open http://localhost:8000
```

or `npx http-server -p 8000`.

## How a match works

- You play Counter-Terrorist. 3 CT bots are your teammates; 4 T bots are the
  enemy team.
- Each round: a short **buy phase**, then the round goes **live** on a timer.
- Terrorist bots head for a randomly chosen bombsite (A or B) and plant. Once
  planted, hold **E** near the bomb to defuse before the fuse runs out.
- A round ends when: one team is fully eliminated (unless the bomb is
  planted — then only defusing, detonation, or wiping the remaining CTs ends
  it), the bomb detonates, the bomb is defused, or the round timer expires
  with no plant (CT win).
- First team to **4 round wins** takes the match.
- Money comes from kills, round wins, and a scaling loss bonus (more after
  consecutive losses) — spend it in the buy menu (**B**) each round. Loadouts
  reset to pistol/knife every round (force-buy style); money persists.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Shift | Sprint |
| Ctrl / C | Crouch |
| Space | Jump |
| Left click | Fire |
| R | Reload |
| 1 / 2 / 3 | Knife / Pistol-or-SMG / Rifle |
| B | Buy menu |
| E (hold) | Defuse the bomb, when planted and nearby |
| Esc | Release the mouse |

## Code layout

```
index.html        Page shell, HUD markup, import map (vendored Three.js)
style.css         All HUD/menu/buy-menu styling
js/main.js        Wires everything up: renderer, input, game loop
js/map.js         Arena geometry, colliders, spawns, bot waypoints, bombsites
js/player.js       First-person controller: look, move, collide, jump/crouch
js/weapons.js      Weapon stats, hitscan firing, the gun viewmodel
js/bots.js         Bot AI: pathing, line-of-sight, shooting, plant/defuse
js/round.js        Round state machine: buy/live/planted/end, win conditions
js/economy.js      Money, purchases, round bonuses
js/hud.js          DOM HUD (health/ammo/money/timer/killfeed/buy menu)
js/audio.js        Small synthesized SFX (WebAudio, no asset files)
js/vendor/         Vendored Three.js build (see THREE_LICENSE)
```

## Notable simplifications

- No real multiplayer — bots stand in for both teams.
- Map is a single compact arena (two bombsites, cover crates, a mid lane),
  not a recreation of any specific CS:GO map.
- No grenades, no per-weapon recoil patterns, no armor penetration model —
  hitscan damage with simple falloff and a flat armor-absorption rule.
- Bots use straight-line waypoint pathing with box-collision avoidance, not
  full navmesh pathfinding.
