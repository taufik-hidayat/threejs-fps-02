// Weapons: four guns with distinct character plus two grenades. Each gun owns its
// numbers (damage, magazine, fire gap, spread, reload, price), its view model and its
// kick. main.js owns the ray and the damage; game.js owns the grenade effects.
// Spread punishes firing on the move: still < crouch < walk < air, and every shot adds
// bloom that recovers when you stop firing. Aiming down sights halves spread.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 4,
    mag: 12, reserve: 999, gap: 0.16, reload: 1.2, auto: true,
    spreadStill: 0.004, spreadMove: 0.03, bloom: 0.003, kick: 0.011, range: 60,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Foundry', price: 2700, damage: 33, headMult: 4,
    mag: 30, reserve: 90, gap: 0.096, reload: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, bloom: 0.0022, kick: 0.013, range: 80,
  },
  smg: {
    id: 'smg', name: 'Rasp-9', price: 1500, damage: 24, headMult: 4,
    mag: 32, reserve: 96, gap: 0.07, reload: 1.6, auto: true,
    spreadStill: 0.004, spreadMove: 0.034, bloom: 0.0028, kick: 0.008, range: 55,
  },
  sniper: {
    id: 'sniper', name: 'Longshot-8', price: 4200, damage: 88, headMult: 4,
    mag: 5, reserve: 15, gap: 1.15, reload: 3.2, auto: false,
    spreadStill: 0.0008, spreadMove: 0.06, bloom: 0.02, kick: 0.05, range: 120,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Furnace Frag', price: 300, radius: 6, damage: 100 },
  smoke: { id: 'smoke', name: 'Slag Smoke', price: 300, radius: 4.5, duration: 12 },
};

const MUZZLE_TIME = 0.06;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.darkSteel), roughness: 0.7, metalness: 0.25 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.furnace), roughness: 0.5, metalness: 0.3 });

  const models = {};
  function buildModel(def) {
    const model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    model.add(receiver, barrel, stock);
    if (def.id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.08), grip);
      mag.position.set(0, -0.14, -0.05);
      model.add(mag);
    }
    if (def.id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), accentMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, -0.05);
      const longBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.28), grip);
      longBarrel.position.set(0, 0.025, -0.62);
      model.add(scope, longBarrel);
    }
    if (def.id === 'pistol') {
      model.scale.set(0.8, 0.8, 0.8);
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.3), accentMat);
      slide.position.set(0, 0.06, -0.05);
      model.add(slide);
    }
    if (def.id === 'rifle') {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.105, 0.05), accentMat);
      band.position.set(0, 0, -0.18);
      model.add(band);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }
  for (const def of Object.values(WEAPONS)) models[def.id] = buildModel(def);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    owned: { pistol: true, rifle: false, smg: false, sniper: false },
    ammo: {
      pistol: { mag: 12, reserve: 999 },
      rifle: { mag: 0, reserve: 0 },
      smg: { mag: 0, reserve: 0 },
      sniper: { mag: 0, reserve: 0 },
    },
    grenades: { frag: 0, smoke: 0 },
    selectedGrenade: 'frag',
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    switchLeft: 0,
    ads: 0,
  };
  models.pistol.visible = true;

  function currentDef() {
    return WEAPONS[state.current];
  }

  function step(dt, aiming) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.ads += ((aiming ? 1 : 0) - state.ads) * Math.min(1, dt * 10);
    const model = models[state.current];
    const baseZ = -0.42 + state.kick;
    const adsX = 0.24 * (1 - state.ads);
    const adsY = -0.2 + 0.045 * state.ads;
    model.position.set(adsX, adsY, baseZ);
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      model.rotation.x = -0.55 * Math.min(1, (currentDef().reload - state.reloadLeft) * 2);
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const def = currentDef();
        const slot = state.ammo[state.current];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    def: currentDef,
    step,
    ready() {
      const slot = state.ammo[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    pullTrigger() {
      const def = currentDef();
      state.cooldown = def.gap;
      state.flash = MUZZLE_TIME;
      state.kick = def.id === 'sniper' ? 0.14 : 0.055;
      state.bloom = Math.min(0.05, state.bloom + def.bloom);
    },
    takeRound() {
      const slot = state.ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      const slot = state.ammo[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    spread(speed, airborne, aiming, crouching) {
      const def = currentDef();
      const move = Math.min(1, speed / 5.4);
      let value = def.spreadStill + move * def.spreadMove + state.bloom;
      if (airborne) value += 0.02;
      if (crouching) value *= 0.75;
      if (aiming) value *= 0.5;
      return value;
    },
    switchTo(id) {
      if (!state.owned[id] || id === state.current || state.reloadLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.switchLeft = 0.35;
      state.cooldown = Math.max(state.cooldown, 0.35);
      return true;
    },
    buy(id) {
      if (state.owned[id]) return false;
      state.owned[id] = true;
      const def = WEAPONS[id];
      state.ammo[id] = { mag: def.mag, reserve: def.reserve };
      return true;
    },
    refillReserve() {
      for (const id of Object.keys(state.ammo)) {
        const def = WEAPONS[id];
        if (state.owned[id]) state.ammo[id].reserve = def.reserve;
      }
    },
    resetRound() {
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.switchLeft = 0;
      if (!state.owned[state.current]) this.switchTo('pistol');
    },
    throwGrenade() {
      const type = state.selectedGrenade;
      if (state.grenades[type] <= 0) return null;
      state.grenades[type] -= 1;
      return type;
    },
  };
}

// A thrown grenade: one object, reused fields, no allocation while it flies.
export function createGrenade() {
  return {
    active: false,
    type: 'frag',
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    fuse: 0,
    bounced: false,
  };
}
