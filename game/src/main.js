// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. main.js wires the modules together and owns the raycast: the camera, the spread
// and the hit are here; the damage numbers live in weapon.js and the consequences in
// game.js. ?shot=start|play|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SPAWNS, SITE } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createGame } from './game.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 24, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders, SPAWNS.ember[1]);
const weapon = createWeapon(camera);
const raycaster = new THREE.Raycaster();
raycaster.far = 140;

let game;
const bots = createBots(scene, world, audio, {
  damagePlayer: (amount, part) => game.damagePlayer(amount, part, null),
  damageBot: (bot, amount, part) => game.damageBot(bot, amount, part, false),
});
game = createGame(world, bots, audio);

const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const grenadeOrigin = new THREE.Vector3();
const grenadeDirection = new THREE.Vector3();
const body = player.state;
const markerHoldMs = shot ? 4000 : 90;

const emberRoam = [3, 4, 5, 7, 8, 10, 13, 14, 16];
const slagRoam = [12, 13, 14, 15, 16, 17, 18, 19, 20];
const emberEnemies = [];
const slagEnemies = [];

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let stepTimer = 0;
let fov = 74;

function spawnBots() {
  bots.buildBot('ember', SPAWNS.ember[0][0], SPAWNS.ember[0][1], 0, seed * 7 + 1);
  bots.buildBot('ember', SPAWNS.ember[2][0], SPAWNS.ember[2][1], 0, seed * 7 + 2);
  bots.buildBot('slag', SPAWNS.slag[0][0], SPAWNS.slag[0][1], Math.PI, seed * 7 + 3);
  bots.buildBot('slag', SPAWNS.slag[1][0], SPAWNS.slag[1][1], Math.PI, seed * 7 + 4);
  bots.buildBot('slag', SPAWNS.slag[2][0], SPAWNS.slag[2][1], Math.PI, seed * 7 + 5);
  bots.buildBot('slag', -13, -4, Math.PI, seed * 7 + 6);
  emberEnemies.length = 0;
  slagEnemies.length = 0;
  emberEnemies.push({ kind: 'player' });
  for (const bot of bots.bots) {
    if (bot.team === 'slag') emberEnemies.push({ kind: 'bot', bot });
    else slagEnemies.push({ kind: 'bot', bot });
  }
}

spawnBots();
scene.add(game.explosionLight);

// One context object for the bot simulation, built once and reused every fixed step —
// the closures read the live enemy arrays and player state at call time.
const botCtx = {
  enemiesOf: (other) => (other.team === 'ember' ? slagEnemies : emberEnemies),
  playerAlive: false,
  playerPos: body.position,
  playerSpeed: 0,
  playerCrouching: false,
  roamNodes: (other) => (other.team === 'ember' ? emberRoam : slagRoam),
  smokeClouds: game.smokeClouds,
};

function syncBotCtx() {
  botCtx.playerAlive = game.state.playerAlive;
  botCtx.playerSpeed = player.groundSpeed();
  botCtx.playerCrouching = body.crouching;
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const targetFov = body.aiming && input.state.aiming ? 56 : 74;
  fov += (targetFov - fov) * 0.18;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dryFire();
    return false;
  }
  const def = weapon.def();
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits[0];
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part === 'head' ? 'head' : 'torso';
    const amount = part === 'head' ? def.damage * def.headMult : def.damage;
    const killed = bot.alive;
    game.damageBot(bot, amount, part, true);
    audio.hit(killed && bot.health <= 0);
    hud.hitMarker(bot.health <= 0, markerHoldMs);
  } else if (hit) {
    // A wall stops the bullet; the world says nothing back.
  }
  weapon.pullTrigger();
  player.recoil(def.kick * (0.9 + random() * 0.2), (random() * 2 - 1) * def.kick * 0.3);
  audio.shot(def.id);
  bots.hearNoise(body.position, 26, 'slag');
  hud.setAmmo(weapon.state.ammo[weapon.state.current].mag, weapon.state.ammo[weapon.state.current].reserve);
  return true;
}

function throwGrenade() {
  const type = weapon.throwGrenade();
  if (!type) return;
  camera.getWorldDirection(grenadeDirection);
  grenadeOrigin.copy(camera.position);
  game.throwGrenade(type, grenadeOrigin, grenadeDirection);
  hud.setGrenades(weapon.state.grenades.frag, weapon.state.grenades.smoke, weapon.state.selectedGrenade);
}

function buy(id) {
  if (id === 'rifle' || id === 'smg' || id === 'sniper') {
    if (game.buyWeapon(id) && weapon.buy(id)) {
      weapon.switchTo(id);
      refreshWeaponHud();
    }
  } else if (id === 'frag' || id === 'smoke') {
    if (game.buyGrenade(id)) {
      weapon.state.grenades[id] += 1;
      hud.setGrenades(weapon.state.grenades.frag, weapon.state.grenades.smoke, weapon.state.selectedGrenade);
    }
  } else if (id === 'armor') {
    game.buyArmor();
  }
  hud.setMoney(game.state.money);
}

function refreshWeaponHud() {
  const slot = weapon.state.ammo[weapon.state.current];
  hud.setAmmo(slot.mag, slot.reserve);
  hud.setWeapon(weapon.def().name);
  hud.setGrenades(weapon.state.grenades.frag, weapon.state.grenades.smoke, weapon.state.selectedGrenade);
}

function handleEvents() {
  const drained = game.drainEvents();
  for (const event of drained) {
    if (event.type === 'roundStart') {
      player.respawn(SPAWNS.ember[1][0], SPAWNS.ember[1][1], 0);
      weapon.resetRound();
      weapon.refillReserve();
      refreshWeaponHud();
      hud.setHealth(game.state.playerHealth);
      hud.setArmor(game.state.armor);
      hud.setMoney(game.state.money);
      hud.setScore(event.wins, event.round);
      if (!shot) {
        hud.showBuyMenu(true, game.state.money, weapon.state.owned, weapon.state.grenades);
        hud.showBanner(`ROUND ${event.round}`, 'Buy your loadout — B opens the shop', 3000);
      }
      if (document.pointerLockElement) document.exitPointerLock();
      syncCamera();
    } else if (event.type === 'roundLive') {
      hud.showBuyMenu(false);
      hud.showBanner(`ROUND ${game.state.round} — LIVE`, 'Plant the bomb at Site A', 2400);
      hud.hideOverlay();
      if (!input.state.locked && !shot) hud.showOverlay('paused', {});
    } else if (event.type === 'roundEnd') {
      hud.showBuyMenu(false);
      hud.showBanner(event.winner === 'ember' ? 'ROUND WON' : 'ROUND LOST', event.reason, 3200);
      if (!shot) hud.showOverlay('roundEnd', event);
    } else if (event.type === 'matchEnd') {
      hud.showBuyMenu(false);
      hud.showOverlay('matchEnd', event);
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (event.type === 'kill') {
      hud.killFeed(event.text);
      hud.setMoney(game.state.money);
    } else if (event.type === 'playerHurt') {
      hud.setHealth(event.health);
      hud.setArmor(event.armor);
      hud.damageFlash();
    } else if (event.type === 'playerDown') {
      hud.showOverlay('down', {});
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (event.type === 'bombPlanted') {
      hud.showBanner('BOMB PLANTED', 'Defend it until it detonates', 3000);
      hud.killFeed('Bomb planted at Site A');
    } else if (event.type === 'botHit') {
      hud.setAmmo(weapon.state.ammo[weapon.state.current].mag, weapon.state.ammo[weapon.state.current].reserve);
    }
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    hud.showBuyMenu(false);
  } else if (game.state.phase === 'round' && game.state.playerAlive) {
    hud.showOverlay('paused', {});
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.state.phase === 'menu') {
    game.startMatch();
    return;
  }
  if (game.state.phase === 'matchEnd') {
    game.startMatch();
    return;
  }
  if (game.state.phase === 'roundEnd') {
    return;
  }
  input.requestLock();
});
hud.onBuy((id) => buy(id));
// DEPLOY ends the buy phase early: hide the shop, go live, and take the pointer.
document.getElementById('deploy').addEventListener('click', () => {
  if (game.state.phase !== 'buy') return;
  audio.unlock();
  hud.showBuyMenu(false);
  game.beginRound();
  input.requestLock();
});

function step(dt) {
  elapsed += dt;
  const planting = input.state.keys.has('KeyE');
  const aiming = input.state.aiming && weapon.state.current !== 'pistol';
  player.step(dt, input.state.keys, aiming);
  weapon.step(dt, input.state.aiming);
  game.step(dt, elapsed, {
    position: body.position,
    planting,
  });
  if (!game.state.freezeBots) {
    syncBotCtx();
    bots.step(dt, elapsed, botCtx);
  }
  // Footsteps: a soft tick per stride while moving on the ground.
  const speed = player.groundSpeed();
  if (speed > 1 && body.onGround) {
    stepTimer -= dt * speed;
    if (stepTimer <= 0) {
      stepTimer = 2.2;
      audio.step(speed > 4.5);
    }
  }
  // Weapon switching and actions (edge-triggered).
  if (input.wasPressed('Digit1')) {
    if (weapon.switchTo('pistol')) refreshWeaponHud();
  }
  if (input.wasPressed('Digit2')) {
    if (weapon.switchTo('rifle')) refreshWeaponHud();
  }
  if (input.wasPressed('Digit3')) {
    if (weapon.switchTo('smg')) refreshWeaponHud();
  }
  if (input.wasPressed('Digit4')) {
    if (weapon.switchTo('sniper')) refreshWeaponHud();
  }
  if (input.wasPressed('KeyQ')) {
    weapon.state.selectedGrenade = weapon.state.selectedGrenade === 'frag' ? 'smoke' : 'frag';
    hud.setGrenades(weapon.state.grenades.frag, weapon.state.grenades.smoke, weapon.state.selectedGrenade);
  }
  if (input.wasPressed('KeyG')) throwGrenade();
  if (input.wasPressed('KeyR')) {
    if (weapon.reload()) audio.reload();
  }
  if (input.wasPressed('KeyB') && game.state.phase === 'buy') {
    hud.showBuyMenu(true, game.state.money, weapon.state.owned, weapon.state.grenades);
  }
  if (input.wasPressed('Digit5')) buy('frag');
  if (input.wasPressed('Digit6')) buy('smoke');
  if (input.wasPressed('Digit7')) buy('armor');
  handleEvents();
  // HUD readouts, every fixed step.
  hud.setHealth(game.state.playerHealth);
  hud.setArmor(game.state.armor);
  hud.setMoney(game.state.money);
  hud.setScore(game.state.wins, game.state.round);
  hud.setGrenades(weapon.state.grenades.frag, weapon.state.grenades.smoke, weapon.state.selectedGrenade);
  const bomb = game.state.bomb;
  if (bomb.status === 'planted') hud.setBomb('planted', 0, bomb.timer);
  else if (bomb.status === 'defused' || bomb.status === 'exploded') hud.setBomb(bomb.status, 0, 0);
  else hud.setBomb('carried', 0, 0);
  hud.setPlantHint(
    game.state.phase === 'round' && game.state.playerAlive && bomb.status === 'carried' && game.inSite(body.position),
    bomb.plantProgress / 3,
  );
  if (game.state.phase === 'buy') hud.setTimer(`BUY ${Math.max(0, Math.ceil(game.state.timer))}s`);
  else if (game.state.phase === 'round') hud.setTimer(`${Math.floor(Math.max(0, game.state.timer) / 60)}:${String(Math.floor(Math.max(0, game.state.timer) % 60)).padStart(2, '0')}`);
  else hud.setTimer('—');
  const spreadPx = 6 + weapon.spread(speed, !body.onGround, input.state.aiming, body.crouching) * 900;
  hud.setCrosshairGap(Math.min(34, spreadPx));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const def = weapon.def();
    if (input.state.firing && input.state.locked && game.state.phase === 'round' && game.state.playerAlive && weapon.ready()) {
      shoot(shot ? 0 : weapon.spread(player.groundSpeed(), !body.onGround, input.state.aiming, body.crouching));
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuyMenu(false);
  body.pitch = 0;
  body.yaw = 0;
  game.startMatch();
  game.state.phase = 'round';
  game.state.timer = 100;
  game.state.freezeBots = false;
  for (const bot of bots.bots) {
    if (bot.team === 'ember') {
      bot.state = 'patrol';
      bots.setPath(bot, 16);
    }
  }
  if (name === 'play' || name === 'end') {
    settle(2);
    body.position.set(0, 0, 8);
    settle(20);
    const targets = bots.bots.filter((bot) => bot.team === 'slag' && bot.alive);
    const count = name === 'play' ? 1 : targets.length;
    for (let index = 0; index < count; index += 1) {
      const bot = targets[index % targets.length];
      for (let round = 0; round < 4; round += 1) {
        aimAt(new THREE.Vector3(bot.group.position.x, 1.35, bot.group.position.z));
        shoot(0);
        if (round < 3) settle(8);
      }
      settle(6);
    }
    if (name === 'play') {
      settle(12);
    } else {
      settle(40);
      hud.showBanner('ROUND WON', 'Enemy team eliminated', 4000);
    }
  } else {
    body.position.set(0.6, 0, 12.6);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -11));
    hud.showOverlay('start', {});
  }
  hud.setScore(game.state.wins, game.state.round);
  refreshWeaponHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

refreshWeaponHud();
hud.setHealth(100);
hud.setArmor(0);
hud.setMoney(game.state.money);
hud.setScore({ ember: 0, slag: 0 }, 0);
hud.setTimer('—');
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
