// The match: one state object for rounds, money, the bomb and the win conditions.
// EMBER (you + 2 friendly bots) attacks; SLAG (4 bots) defends Site A. First to 5 round
// wins takes the match (at most 9 rounds). Money comes from kills and round wins and is
// spent in the buy menu between rounds. Events are pushed to `events` for main.js to
// drain each frame into the HUD and the sound board — game.js never touches the DOM.
import * as THREE from 'three';
import { SITE, SPAWNS } from './world.js';
import { WEAPONS, GRENADES, createGrenade } from './weapon.js';

const ROUND_TIME = 100;
const BUY_TIME = 12;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const BOMB_TIME = 35;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const START_MONEY = 800;
const KILL_MONEY = 300;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const PLANT_MONEY = 300;
const ARMOR_PRICE = 650;
const ARMOR_MAX = 50;

const GRENADE_POOL = 4;

export function createGame(world, bots, audio) {
  const state = {
    phase: 'menu', // menu | buy | round | roundEnd | matchEnd
    round: 0,
    wins: { ember: 0, slag: 0 },
    money: START_MONEY,
    armor: 0,
    kills: 0,
    deaths: 0,
    timer: 0,
    bomb: { status: 'carried', plantProgress: 0, defuseProgress: 0, timer: 0, position: new THREE.Vector3() },
    playerAlive: true,
    playerHealth: 100,
    roundReason: '',
    matchWinner: '',
    freezeBots: true,
  };
  const events = [];
  const grenades = [];
  for (let i = 0; i < GRENADE_POOL; i += 1) grenades.push(createGrenade());
  const smokeClouds = [];
  const smokeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#9aa5a3'), transparent: true, opacity: 0.5, roughness: 1, metalness: 0, depthWrite: false,
  });
  const explosionLight = new THREE.PointLight(new THREE.Color('#ff7a1a'), 0, 24, 1.6);
  explosionLight.position.set(0, 2, -11.5);
  let explosionFlash = 0;
  let lastBeepSecond = -1;
  let bombPos = new THREE.Vector3(0, 1, -11.5);

  function push(type, data) {
    events.push({ type, ...data });
  }

  function startMatch() {
    state.phase = 'buy';
    state.round = 0;
    state.wins.ember = 0;
    state.wins.slag = 0;
    state.money = START_MONEY;
    state.armor = 0;
    state.kills = 0;
    state.deaths = 0;
    state.matchWinner = '';
    state.bomb.status = 'carried';
    state.playerAlive = true;
    state.playerHealth = 100;
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.freezeBots = true;
    state.bomb.status = 'carried';
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    state.bomb.timer = 0;
    lastBeepSecond = -1;
    // Respawn everyone at their spawn points.
    const emberSpawns = SPAWNS.ember;
    const slagSpawns = SPAWNS.slag;
    let emberIndex = 0;
    let slagIndex = 0;
    for (const bot of bots.bots) {
      if (bot.team === 'ember') {
        const spawn = emberSpawns[emberIndex % emberSpawns.length];
        emberIndex += 1;
        bot.group.position.set(spawn[0], 0, spawn[1]);
        bot.yaw = Math.PI;
        bot.node = 1;
      } else {
        const spawn = slagSpawns[slagIndex % slagSpawns.length];
        slagIndex += 1;
        bot.group.position.set(spawn[0], 0, spawn[1]);
        bot.yaw = 0;
        bot.node = 19;
      }
      bot.health = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.state = bot.team === 'slag' ? 'hold' : 'patrol';
      bot.target = null;
      bot.path = [];
      bot.pathIndex = 0;
      bot.burstLeft = 0;
      bot.group.rotation.x = 0;
      bot.group.position.y = 0;
    }
    for (const smoke of smokeClouds) smoke.mesh.visible = false;
    smokeClouds.length = 0;
    for (const grenade of grenades) grenade.active = false;
    push('roundStart', { round: state.round, wins: { ...state.wins } });
  }

  function beginRound() {
    state.phase = 'round';
    state.timer = ROUND_TIME;
    state.freezeBots = false;
    // Attackers push the site; defenders hold it.
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      if (bot.team === 'ember') {
        bot.state = 'patrol';
        bots.setPath(bot, 16);
      } else {
        bot.state = 'hold';
      }
    }
    push('roundLive', {});
  }

  function endRound(winner, reason) {
    if (state.phase !== 'round' && state.phase !== 'buy') return;
    state.phase = 'roundEnd';
    state.roundReason = reason;
    state.wins[winner] += 1;
    if (winner === 'ember') {
      state.money += WIN_MONEY;
      audio.roundWin();
    } else {
      state.money += LOSS_MONEY;
      audio.roundLose();
    }
    state.timer = 4;
    state.freezeBots = true;
    push('roundEnd', { winner, reason, wins: { ...state.wins }, money: state.money });
    if (state.wins[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.wins.ember > state.wins.slag ? 'ember' : 'slag';
      state.phase = 'matchEnd';
      push('matchEnd', { winner: state.matchWinner, wins: { ...state.wins } });
    }
  }

  function damagePlayer(amount, part, fromBot) {
    if (!state.playerAlive || state.phase !== 'round') return;
    let remaining = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, remaining * 0.5);
      state.armor -= absorbed;
      remaining -= absorbed;
    }
    state.playerHealth -= remaining;
    audio.hurt();
    push('playerHurt', { health: Math.max(0, state.playerHealth), armor: state.armor });
    if (state.playerHealth <= 0) {
      state.playerHealth = 0;
      state.playerAlive = false;
      state.deaths += 1;
      push('playerDown', {});
      if (bots.aliveCount('ember') === 0 && state.bomb.status !== 'planted') {
        endRound('slag', 'Your team was eliminated.');
      }
    }
  }

  function damageBot(bot, amount, part, fromPlayer) {
    if (!bot.alive) return;
    const killed = bots.damage(bot, amount, part);
    if (fromPlayer) {
      push('botHit', { bot: bot.id, part, killed, health: Math.max(0, bot.health) });
      if (killed) {
        state.kills += 1;
        state.money += KILL_MONEY;
        push('kill', { text: `You eliminated SLAG-${bot.id + 1}${part === 'head' ? ' — headshot' : ''}`, headshot: part === 'head' });
      }
    } else if (killed) {
      push('kill', { text: `SLAG-${bot.id + 1} was eliminated`, headshot: false });
    }
    if (killed && bot.team === 'slag') {
      if (bots.aliveCount('slag') === 0) {
        if (state.bomb.status === 'planted') {
          // No defenders left: the bomb still has to go off.
        } else {
          endRound('ember', 'Enemy team eliminated.');
        }
      }
    }
    if (killed && bot.team === 'ember' && !state.playerAlive && bots.aliveCount('ember') === 0 && state.bomb.status !== 'planted') {
      endRound('slag', 'Your team was eliminated.');
    }
  }

  function inSite(position) {
    return position.x >= SITE.minX && position.x <= SITE.maxX && position.z >= SITE.minZ && position.z <= SITE.maxZ;
  }

  function buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def || state.phase !== 'buy') return false;
    if (state.money < def.price) {
      audio.denied();
      return false;
    }
    state.money -= def.price;
    audio.buy();
    push('bought', { id, money: state.money });
    return true;
  }

  function buyGrenade(type) {
    const def = GRENADES[type];
    if (!def || state.phase !== 'buy') return false;
    if (state.money < def.price) {
      audio.denied();
      return false;
    }
    state.money -= def.price;
    audio.buy();
    push('boughtGrenade', { type, money: state.money });
    return true;
  }

  function buyArmor() {
    if (state.phase !== 'buy' || state.armor >= ARMOR_MAX || state.money < ARMOR_PRICE) {
      audio.denied();
      return false;
    }
    state.money -= ARMOR_PRICE;
    state.armor = ARMOR_MAX;
    audio.buy();
    push('boughtArmor', { money: state.money });
    return true;
  }

  function throwGrenade(type, origin, direction) {
    for (const grenade of grenades) {
      if (grenade.active) continue;
      grenade.active = true;
      grenade.type = type;
      grenade.position.copy(origin);
      grenade.velocity.copy(direction).multiplyScalar(16);
      grenade.velocity.y += 4.5;
      grenade.fuse = type === 'frag' ? 1.4 : 0.9;
      grenade.bounced = false;
      return true;
    }
    return false;
  }

  const grenadeProbe = new THREE.Box3();
  function stepGrenades(dt) {
    for (const grenade of grenades) {
      if (!grenade.active) continue;
      grenade.fuse -= dt;
      grenade.velocity.y -= 16 * dt;
      const nextX = grenade.position.x + grenade.velocity.x * dt;
      const nextY = grenade.position.y + grenade.velocity.y * dt;
      const nextZ = grenade.position.z + grenade.velocity.z * dt;
      grenadeProbe.min.set(nextX - 0.12, nextY - 0.12, nextZ - 0.12);
      grenadeProbe.max.set(nextX + 0.12, nextY + 0.12, nextZ + 0.12);
      let hitWall = false;
      for (const collider of world.colliders) {
        if (grenadeProbe.intersectsBox(collider)) {
          hitWall = true;
          break;
        }
      }
      if (hitWall) {
        grenade.velocity.x *= -0.35;
        grenade.velocity.z *= -0.35;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.35;
        grenade.bounced = true;
      } else {
        grenade.position.set(nextX, nextY, nextZ);
      }
      if (grenade.position.y < 0.12) {
        grenade.position.y = 0.12;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.35;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
        grenade.bounced = true;
      }
      if (grenade.fuse <= 0 || (grenade.type === 'smoke' && grenade.bounced && grenade.fuse <= 0.4)) {
        grenade.active = false;
        if (grenade.type === 'frag') detonate(grenade.position);
        else deploySmoke(grenade.position);
      }
    }
    for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
      const cloud = smokeClouds[i];
      cloud.life -= dt;
      cloud.mesh.material.opacity = Math.min(0.5, cloud.life * 0.2);
      if (cloud.life <= 0) {
        cloud.mesh.visible = false;
        smokeClouds.splice(i, 1);
      }
    }
    if (explosionFlash > 0) {
      explosionFlash = Math.max(0, explosionFlash - dt * 2.2);
      explosionLight.intensity = explosionFlash * 60;
    }
  }

  function detonate(position) {
    audio.explosion();
    explosionFlash = 1;
    explosionLight.position.set(position.x, 1.5, position.z);
    push('explosion', { x: position.x, z: position.z });
    const victims = [];
    if (state.playerAlive) victims.push({ kind: 'player', position: null });
    for (const bot of bots.bots) if (bot.alive) victims.push({ kind: 'bot', bot });
    for (const victim of victims) {
      const pos = victim.kind === 'player' ? state.playerPosition : victim.bot.group.position;
      const distance = Math.hypot(pos.x - position.x, pos.z - position.z);
      if (distance > GRENADES.frag.radius) continue;
      const amount = Math.round(GRENADES.frag.damage * (1 - (distance / GRENADES.frag.radius) * 0.75));
      if (victim.kind === 'player') damagePlayer(amount, 'torso', null);
      else damageBot(victim.bot, amount, 'torso', false);
    }
  }

  function deploySmoke(position) {
    audio.smoke();
    let cloud = smokeClouds.find((c) => !c.mesh.visible);
    if (!cloud) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(GRENADES.smoke.radius, 18, 12), smokeMaterial.clone());
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      world.group.add(mesh);
      cloud = { mesh, life: 0, position: new THREE.Vector3() };
      smokeClouds.push(cloud);
    }
    cloud.mesh.visible = true;
    cloud.mesh.position.set(position.x, 1.4, position.z);
    cloud.mesh.material.opacity = 0.5;
    cloud.life = GRENADES.smoke.duration;
    cloud.position.set(position.x, 1.4, position.z);
    push('smoke', { x: position.x, z: position.z });
  }

  function step(dt, time, player) {
    state.playerPosition = player.position;
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) beginRound();
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0 && state.phase === 'roundEnd') startRound();
      return;
    }
    if (state.phase !== 'round') return;

    // Round timer.
    if (state.bomb.status === 'planted') {
      state.bomb.timer -= dt;
      const second = Math.ceil(state.bomb.timer);
      if (second !== lastBeepSecond && second <= 10 && second > 0) {
        lastBeepSecond = second;
        audio.bombTick();
      }
      if (state.bomb.timer <= 0) {
        detonate(bombPos);
        endRound('ember', 'The bomb detonated.');
        return;
      }
      // Defuse: a defender standing in the site defuses over 5 seconds.
      let defuser = null;
      for (const bot of bots.bots) {
        if (bot.alive && bot.team === 'slag' && inSite(bot.group.position)) {
          defuser = bot;
          break;
        }
      }
      if (defuser) {
        state.bomb.defuseProgress += dt;
        if (Math.floor(state.bomb.defuseProgress * 2) !== Math.floor((state.bomb.defuseProgress - dt) * 2)) audio.defuseBeep();
        if (state.bomb.defuseProgress >= DEFUSE_TIME) {
          state.bomb.status = 'defused';
          endRound('slag', 'The bomb was defused.');
          return;
        }
      } else {
        state.bomb.defuseProgress = Math.max(0, state.bomb.defuseProgress - dt * 2);
      }
    } else {
      state.timer -= dt;
      // Planting: hold E inside the site.
      if (state.playerAlive && player.planting && inSite(player.position)) {
        state.bomb.plantProgress += dt;
        if (Math.floor(state.bomb.plantProgress * 2) !== Math.floor((state.bomb.plantProgress - dt) * 2)) audio.plantBeep(false);
        if (state.bomb.plantProgress >= PLANT_TIME) {
          state.bomb.status = 'planted';
          state.bomb.timer = BOMB_TIME;
          bombPos.set(player.position.x, 1, player.position.z);
          state.bomb.position.copy(bombPos);
          state.money += PLANT_MONEY;
          audio.plantBeep(true);
          push('bombPlanted', { x: bombPos.x, z: bombPos.z });
          // Defenders converge on the site to defuse.
          for (const bot of bots.bots) {
            if (bot.alive && bot.team === 'slag') {
              bot.state = 'patrol';
              bots.setPath(bot, 16);
            }
          }
        }
      } else {
        state.bomb.plantProgress = Math.max(0, state.bomb.plantProgress - dt * 2);
      }
      if (state.timer <= 0) {
        endRound('slag', 'Time expired — defenders hold the site.');
        return;
      }
    }

    stepGrenades(dt);
  }

  return {
    state,
    events,
    smokeClouds,
    explosionLight,
    startMatch,
    startRound,
    beginRound,
    endRound,
    damagePlayer,
    damageBot,
    buyWeapon,
    buyGrenade,
    buyArmor,
    throwGrenade,
    step,
    inSite,
    drainEvents() {
      const drained = events.slice();
      events.length = 0;
      return drained;
    },
  };
}
