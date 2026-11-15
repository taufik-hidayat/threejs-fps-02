// The look plan for FOUNDRY, in one place: a dusk foundry, teal steel against furnace
// orange. Every colour in the game is one of these names, and every surface texture is
// painted here on a canvas — no external images, no network.
import * as THREE from 'three';

export const PALETTE = {
  sky: '#0d1b21',
  ground: '#232a2e',
  wall: '#2e3a3f',
  steel: '#4a5a61',
  darkSteel: '#222b30',
  rust: '#7a4a28',
  furnace: '#ff7a1a',
  ember: '#ffb347',
  hazard: '#f2c230',
  ink: '#e8f0ee',
  muted: '#8fa3a8',
  enemy: '#e5484d',
  friendly: '#35c4b5',
  smoke: '#9aa5a3',
};

export function shade(name) {
  return PALETTE[name];
}

// A deterministic speckle painter: the same seed always paints the same texture.
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

function canvasTexture(size, painter, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  painter(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, random, base, dots, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < dots; i += 1) {
    const v = Math.floor(random() * 42) - 21;
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${alpha})`;
    ctx.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1 + Math.floor(random() * 2), 1 + Math.floor(random() * 2));
  }
}

export function makeTextures() {
  const random = mulberry32(20261115);
  const concrete = canvasTexture(256, (ctx, size) => {
    speckle(ctx, size, random, '#2b3236', 2600, 0.10);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();
  }, 6, 6);
  const floor = canvasTexture(256, (ctx, size) => {
    speckle(ctx, size, random, '#232a2e', 2200, 0.09);
    // Large floor plates with worn seams and a few oil stains.
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo((i * size) / 2, 0);
      ctx.lineTo((i * size) / 2, size);
      ctx.moveTo(0, (i * size) / 2);
      ctx.lineTo(size, (i * size) / 2);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const r = 18 + random() * 42;
      const gradient = ctx.createRadialGradient(x, y, 2, x, y, r);
      gradient.addColorStop(0, 'rgba(0,0,0,0.28)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 8, 8);
  const metal = canvasTexture(256, (ctx, size) => {
    speckle(ctx, size, random, '#46545b', 1400, 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (i * size) / 4);
      ctx.lineTo(size, (i * size) / 4);
      ctx.stroke();
    }
    // Rivets along the seams.
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        ctx.beginPath();
        ctx.arc((j * size) / 8 + 16, (i * size) / 4 + 8, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, 2, 2);
  const hazard = canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#17191b';
    for (let i = -2; i < 6; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 32, size);
      ctx.lineTo(i * 32 + 32, 0);
      ctx.lineTo(i * 32 + 48, 0);
      ctx.lineTo(i * 32 + 16, size);
      ctx.closePath();
      ctx.fill();
    }
  }, 1, 1);
  const rust = canvasTexture(256, (ctx, size) => {
    speckle(ctx, size, random, '#5d3a22', 3200, 0.14);
    ctx.fillStyle = 'rgba(122,74,40,0.5)';
    for (let i = 0; i < 9; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const r = 12 + random() * 30;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 2, 2);
  return { concrete, floor, metal, hazard, rust };
}
