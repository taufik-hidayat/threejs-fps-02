// Bots: waypoint walkers that see, hear and shoot back — never aimbots. Each bot has a
// state (hold, patrol, investigate, engage), a path over the waypoint graph, a reaction
// delay before its first shot, and burst fire whose hit chance falls with distance,
// target speed and its own movement. Defenders hold the site; attackers push it; when
// the bomb is planted the defenders converge to defuse it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS } from './world.js';

const BOT_HEALTH = 100;
const BOT_SPEED_WALK = 3.2;
const BOT_SPEED_PUSH = 4.4;
const SENSE_INTERVAL = 0.15;
const SIGHT_RANGE = 46;
const SIGHT_HALF_FOV = 1.05;
const REACT_MIN = 0.28;
const REACT_MAX = 0.55;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.11;
const BURST_PAUSE = 0.85;

// Breadth-first path over the waypoint graph. Preallocated queue and parent arrays.
const queue = new Int32Array(64);
const parent = new Int32Array(64);
const seen = new Uint8Array(64);

function findPath(from, to) {
  if (from === to) return [];
  const nodes = WAYPOINTS.nodes;
  const edges = WAYPOINTS.edges;
  seen.fill(0);
  let head = 0;
  let tail = 0;
  queue[tail] = from;
  tail += 1;
  seen[from] = 1;
  parent[from] = -1;
  while (head < tail) {
    const current = queue[head];
    head += 1;
    for (let e = 0; e < edges.length; e += 1) {
      const edge = edges[e];
      let next = -1;
      if (edge[0] === current) next = edge[1];
      else if (edge[1] === current) next = edge[0];
      if (next === -1 || seen[next]) continue;
      seen[next] = 1;
      parent[next] = current;
      if (next === to) {
        const path = [];
        let node = to;
        while (node !== -1) {
          path.unshift(node);
          node = parent[node];
        }
        return path;
      }
      queue[tail] = next;
      tail += 1;
    }
  }
  return [to];
}

function nearestNode(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < WAYPOINTS.nodes.length; i += 1) {
    const dx = WAYPOINTS.nodes[i][0] - x;
    const dz = WAYPOINTS.nodes[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

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

export function createBots(scene, world, audio, hooks) {
  const losRay = new THREE.Raycaster();
  losRay.far = SIGHT_RANGE;
  const losDir = new THREE.Vector3();
  const losOrigin = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const moveDir = new THREE.Vector3();
  const tracerFrom = new THREE.Vector3();
  const tracerTo = new THREE.Vector3();

  // Segment-sphere test: does the sight line from `from` to `to` pass through a smoke
  // cloud? A cloud blocks vision even though bullets fly straight through it.
  function blockedBySmoke(from, to, clouds) {
    if (!clouds) return false;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const lenSq = dx * dx + dy * dy + dz * dz;
    for (const cloud of clouds) {
      const cx = cloud.position.x - from.x;
      const cy = cloud.position.y - from.y;
      const cz = cloud.position.z - from.z;
      let t = lenSq > 0 ? (cx * dx + cy * dy + cz * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const px = from.x + dx * t - cloud.position.x;
      const py = from.y + dy * t - cloud.position.y;
      const pz = from.z + dz * t - cloud.position.z;
      const radius = 4.5;
      if (px * px + py * py + pz * pz < radius * radius) return true;
    }
    return false;
  }

  // Tracer pool: 10 reusable lines, no allocation while fighting.
  const tracers = [];
  const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0 });
  for (let i = 0; i < 10; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  function fireTracer(from, to) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracers.length;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.visible = true;
    tracer.line.material.opacity = 0.75;
    tracer.life = 0.09;
  }

  const bodyMaterial = {
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.friendly), roughness: 0.6, metalness: 0.1 }),
    slag: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.6, metalness: 0.1 }),
  };
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.05 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.darkSteel), roughness: 0.8, metalness: 0.2 });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#111417'), roughness: 0.6, metalness: 0.4 });
  const torsoGeometry = new THREE.BoxGeometry(0.56, 0.72, 0.32);
  const headGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.72, 0.2);
  const gunGeometry = new THREE.BoxGeometry(0.08, 0.1, 0.62);

  const bots = [];
  const hitMeshes = [];
  let botCount = 0;

  function buildBot(team, x, z, yaw, seed) {
    const random = mulberry32(seed);
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial[team]);
    torso.position.y = 1.08;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.62;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(legGeometry, legMaterial);
    legL.position.set(-0.14, 0.36, 0);
    const legR = new THREE.Mesh(legGeometry, legMaterial);
    legR.position.set(0.14, 0.36, 0);
    const gun = new THREE.Mesh(gunGeometry, gunMaterial);
    gun.position.set(0.28, 1.15, -0.2);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      id: botCount,
      team,
      group,
      torso,
      head,
      gun,
      health: BOT_HEALTH,
      alive: true,
      state: 'hold',
      node: nearestNode(x, z),
      path: [],
      pathIndex: 0,
      destination: -1,
      speed: BOT_SPEED_WALK,
      yaw,
      target: null,
      targetPos: new THREE.Vector3(),
      lastSeen: new THREE.Vector3(),
      senseAt: random() * SENSE_INTERVAL,
      reactAt: 0,
      burstLeft: 0,
      shotAt: 0,
      burstPauseAt: 0,
      strafeAt: 0,
      strafeDir: 1,
      crouching: false,
      fall: 0,
      random,
      walkPhase: random() * 6,
      holdUntil: 0,
    };
    botCount += 1;
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    return true;
  }

  function setPath(bot, destinationNode) {
    if (destinationNode < 0) return;
    bot.destination = destinationNode;
    bot.path = findPath(bot.node, destinationNode);
    bot.pathIndex = 0;
  }

  function pickRoamNode(bot, nodes) {
    const node = nodes[Math.floor(bot.random() * nodes.length)];
    setPath(bot, node);
    bot.state = 'patrol';
  }

  function canSee(bot, targetPos, targetEye, context) {
    toTarget.copy(targetPos);
    toTarget.y = targetEye;
    toTarget.sub(bot.group.position);
    toTarget.y -= 1.35;
    const distance = toTarget.length();
    if (distance > SIGHT_RANGE) return false;
    const forwardX = -Math.sin(bot.yaw);
    const forwardZ = -Math.cos(bot.yaw);
    const dirX = toTarget.x / (distance || 1);
    const dirZ = toTarget.z / (distance || 1);
    if (forwardX * dirX + forwardZ * dirZ < Math.cos(SIGHT_HALF_FOV)) return false;
    losOrigin.set(bot.group.position.x, 1.35, bot.group.position.z);
    if (blockedBySmoke(losOrigin, targetPos, context.smokeClouds)) return false;
    losDir.copy(toTarget).normalize();
    losRay.set(losOrigin, losDir);
    const hits = losRay.intersectObjects(world.shootables, false);
    return hits.length === 0 || hits[0].distance > distance - 0.4;
  }

  function step(dt, time, context) {
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.75;
        if (tracer.life <= 0) tracer.line.visible = false;
      }
    }
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
        continue;
      }
      // --- senses, staggered per bot ---
      bot.senseAt -= dt;
      if (bot.senseAt <= 0) {
        bot.senseAt = SENSE_INTERVAL;
        let found = null;
        let foundPos = null;
        const enemies = context.enemiesOf(bot);
        for (const enemy of enemies) {
          if (enemy.kind === 'player') {
            if (!context.playerAlive) continue;
            if (canSee(bot, context.playerPos, 1.5, context)) {
              found = enemy;
              foundPos = context.playerPos;
              break;
            }
          } else if (enemy.bot.alive) {
            const pos = enemy.bot.group.position;
            if (canSee(bot, pos, 1.5, context)) {
              found = enemy;
              foundPos = pos;
              break;
            }
          }
        }
        if (found) {
          if (bot.target !== found) {
            bot.target = found;
            bot.reactAt = time + REACT_MIN + bot.random() * (REACT_MAX - REACT_MIN);
            bot.burstLeft = 0;
          }
          bot.lastSeen.copy(foundPos);
          bot.targetPos.copy(foundPos);
          bot.state = 'engage';
        } else if (bot.state === 'engage') {
          bot.target = null;
          bot.state = 'investigate';
          setPath(bot, nearestNode(bot.lastSeen.x, bot.lastSeen.z));
        }
      }

      // --- movement ---
      let moving = false;
      let speed = bot.speed;
      if (bot.state === 'engage' && bot.target) {
        // Face the target; strafe to be a harder target.
        const dx = bot.targetPos.x - bot.group.position.x;
        const dz = bot.targetPos.z - bot.group.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        bot.strafeAt -= dt;
        if (bot.strafeAt <= 0) {
          bot.strafeAt = 0.9 + bot.random() * 1.1;
          bot.strafeDir = bot.random() < 0.5 ? -1 : 1;
        }
        const strafe = bot.strafeDir * 1.6;
        moveDir.set(-Math.cos(bot.yaw) * strafe, 0, Math.sin(bot.yaw) * strafe);
        bot.group.position.x += moveDir.x * dt;
        bot.group.position.z += moveDir.z * dt;
        moving = Math.abs(strafe) > 0.1;
        // Do not walk through walls: clamp back if inside a collider.
        resolveCollision(bot);
      } else if (bot.path.length > 0 && bot.pathIndex < bot.path.length) {
        const node = WAYPOINTS.nodes[bot.path[bot.pathIndex]];
        const dx = node[0] - bot.group.position.x;
        const dz = node[1] - bot.group.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.7) {
          bot.node = bot.path[bot.pathIndex];
          bot.pathIndex += 1;
          if (bot.pathIndex >= bot.path.length) {
            bot.path = [];
            if (bot.state === 'patrol') bot.holdUntil = time + 1 + bot.random() * 2.5;
            if (bot.state === 'investigate') {
              bot.state = 'patrol';
              bot.holdUntil = time + 0.8;
            }
          }
        } else {
          bot.yaw = Math.atan2(-dx, -dz);
          const stepLen = Math.min(speed * dt, dist);
          bot.group.position.x += (dx / dist) * stepLen;
          bot.group.position.z += (dz / dist) * stepLen;
          moving = true;
          resolveCollision(bot);
        }
      } else if (bot.state === 'patrol' && time >= bot.holdUntil) {
        pickRoamNode(bot, context.roamNodes(bot));
      } else if (bot.state === 'hold') {
        // Defenders crouch behind cover sometimes; scan by slowly turning.
        bot.yaw += Math.sin(time * 0.5 + bot.id) * dt * 0.25;
      }
      bot.group.rotation.y = bot.yaw;
      // Walk cycle: legs swing, body bobs — cheap, no allocation.
      bot.walkPhase += dt * (moving ? 9 : 2);
      const swing = moving ? Math.sin(bot.walkPhase) * 0.35 : 0;
      bot.group.children[2].rotation.x = swing;
      bot.group.children[3].rotation.x = -swing;

      // --- combat ---
      if (bot.state === 'engage' && bot.target && time >= bot.reactAt) {
        if (bot.burstLeft <= 0 && time >= bot.burstPauseAt) {
          bot.burstLeft = BURST_MIN + Math.floor(bot.random() * (BURST_MAX - BURST_MIN + 1));
          bot.shotAt = time;
        }
        if (bot.burstLeft > 0 && time >= bot.shotAt) {
          bot.burstLeft -= 1;
          bot.shotAt = time + SHOT_GAP;
          if (bot.burstLeft === 0) bot.burstPauseAt = time + BURST_PAUSE;
          fireShot(bot, context);
        }
      }
    }
  }

  const colliderProbe = new THREE.Box3();
  function resolveCollision(bot) {
    colliderProbe.min.set(bot.group.position.x - 0.34, 0.05, bot.group.position.z - 0.34);
    colliderProbe.max.set(bot.group.position.x + 0.34, 1.7, bot.group.position.z + 0.34);
    for (const collider of world.colliders) {
      if (!colliderProbe.intersectsBox(collider)) continue;
      // Push out along the smallest penetration axis.
      const pushX = Math.min(colliderProbe.max.x - collider.min.x, collider.max.x - colliderProbe.min.x);
      const pushZ = Math.min(colliderProbe.max.z - collider.min.z, collider.max.z - colliderProbe.min.z);
      if (pushX < pushZ) {
        bot.group.position.x += colliderProbe.min.x < collider.min.x ? -pushX : pushX;
      } else {
        bot.group.position.z += colliderProbe.min.z < collider.min.z ? -pushZ : pushZ;
      }
      bot.path = [];
      return;
    }
  }

  function fireShot(bot, context) {
    const target = bot.target;
    if (!target) return;
    tracerFrom.set(bot.group.position.x + 0.28, 1.35, bot.group.position.z);
    let targetPos;
    let targetSpeed = 0;
    let targetCrouching = false;
    if (target.kind === 'player') {
      targetPos = context.playerPos;
      targetSpeed = context.playerSpeed;
      targetCrouching = context.playerCrouching;
    } else {
      targetPos = target.bot.group.position;
      targetSpeed = 3;
    }
    const dx = targetPos.x - bot.group.position.x;
    const dz = targetPos.z - bot.group.position.z;
    const distance = Math.hypot(dx, dz);
    let chance = 0.58 - Math.max(0, distance - 10) * 0.016;
    if (targetSpeed > 3.5) chance -= 0.14;
    if (targetCrouching) chance -= 0.1;
    if (bot.state === 'engage' && bot.path.length > 0) chance -= 0.06;
    chance = Math.max(0.06, Math.min(0.72, chance));
    const hit = bot.random() < chance;
    const head = hit && bot.random() < 0.12;
    // Miss point: scatter around the target so the tracer reads as a near miss.
    tracerTo.set(
      targetPos.x + (bot.random() * 2 - 1) * (hit ? 0.2 : 1.2),
      (hit ? 1.35 : 1.2 + bot.random() * 0.7),
      targetPos.z + (bot.random() * 2 - 1) * (hit ? 0.2 : 1.2),
    );
    fireTracer(tracerFrom, tracerTo);
    audio.shot('rifle', true);
    if (!hit) return;
    const amount = head ? 88 : 22;
    if (target.kind === 'player') hooks.damagePlayer(amount, head ? 'head' : 'torso', bot);
    else hooks.damageBot(target.bot, amount, head ? 'head' : 'torso', bot);
  }

  return {
    bots,
    hitMeshes,
    buildBot,
    damage,
    setPath,
    step,
    hearNoise(position, radius, team) {
      for (const bot of bots) {
        if (!bot.alive || bot.team !== team || bot.state === 'engage') continue;
        const dx = bot.group.position.x - position.x;
        const dz = bot.group.position.z - position.z;
        if (dx * dx + dz * dz > radius * radius) continue;
        bot.state = 'investigate';
        setPath(bot, nearestNode(position.x, position.z));
      }
    },
    aliveCount(team) {
      let count = 0;
      for (const bot of bots) if (bot.alive && bot.team === team) count += 1;
      return count;
    },
    reset(fallReset) {
      for (const bot of bots) {
        bot.health = BOT_HEALTH;
        bot.alive = true;
        bot.fall = 0;
        bot.state = 'hold';
        bot.target = null;
        bot.path = [];
        bot.pathIndex = 0;
        bot.burstLeft = 0;
        bot.group.rotation.x = 0;
        bot.group.position.y = 0;
        bot.group.visible = true;
      }
      if (fallReset) botCount = 0;
    },
  };
}
