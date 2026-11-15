// The map: FOUNDRY, a dusk industrial yard — two lanes and a mid, one bombsite, cover
// everywhere a fight should happen. Every solid box is a player collider and a surface a
// bullet stops on. Waypoints form the graph the bots walk; the site box is where the bomb
// is planted. Teal steel, furnace orange, one low sun.
import * as THREE from 'three';
import { PALETTE, makeTextures } from './palette.js';

const MAP_HALF_X = 18;
const MAP_HALF_Z = 14;
const WALL_HEIGHT = 5;

export const SITE = { minX: -7, maxX: 7, minZ: -14, maxZ: -9 };
export const SPAWNS = {
  ember: [[-4, 12], [0, 12.6], [4, 12]],
  slag: [[-6, -12.4], [0, -13], [6, -12.4]],
};

// Waypoint nodes (x, z) and the edges between them, by node index. Bots walk this graph.
export const WAYPOINTS = {
  nodes: [
    [-4, 12], [0, 12.6], [4, 12], // 0-2 ember spawn
    [-10, 10], [0, 8], [10, 10], // 3-5 low lanes
    [-13, 4], [0, 2], [13, 4], // 6-8 mid
    [-13, -4], [0, -4], [13, -4], // 9-11 high lanes
    [-10, -9], [0, -6.5], [10, -9], // 12-14 site approach
    [-4, -11.5], [0, -12], [4, -11.5], // 15-17 site
    [13, -11], // 18 catwalk
    [-6, -12.6], [6, -12.6], // 19-20 slag spawn
  ],
  edges: [
    [0, 3], [0, 4], [1, 4], [2, 4], [2, 5],
    [3, 6], [4, 7], [5, 8],
    [6, 9], [7, 10], [8, 11],
    [9, 12], [10, 13], [11, 14],
    [12, 15], [13, 16], [14, 17],
    [15, 16], [16, 17],
    [13, 14], [10, 12],
    [11, 18], [14, 18], [17, 18],
    [15, 19], [16, 20], [17, 20], [19, 20],
    [12, 9], [14, 11],
  ],
};

export function createWorld(scene) {
  const textures = makeTextures();
  const group = new THREE.Group();
  scene.add(group);

  const concrete = new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.95, metalness: 0.02 });
  const floorMat = new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.9, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ map: textures.metal, roughness: 0.55, metalness: 0.55 });
  const rust = new THREE.MeshStandardMaterial({ map: textures.rust, roughness: 0.85, metalness: 0.25 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.darkSteel), roughness: 0.6, metalness: 0.6 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.8, metalness: 0.1 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.furnace),
    emissive: new THREE.Color(PALETTE.furnace),
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ember),
    emissive: new THREE.Color(PALETTE.ember),
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(radiusTop, radiusBottom, height, x, y, z, material, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter walls.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(MAP_HALF_X * 2 + 0.8, 0.4, MAP_HALF_Z * 2 + 0.8), floorMat);
  floor.position.set(0, -0.2, 0);
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push(new THREE.Box3().setFromObject(floor));
  shootables.push(floor);
  box(0.6, WALL_HEIGHT, MAP_HALF_Z * 2 + 0.8, -MAP_HALF_X - 0.3, WALL_HEIGHT / 2, 0, concrete);
  box(0.6, WALL_HEIGHT, MAP_HALF_Z * 2 + 0.8, MAP_HALF_X + 0.3, WALL_HEIGHT / 2, 0, concrete);
  box(MAP_HALF_X * 2 + 0.8, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, -MAP_HALF_Z - 0.3, concrete);
  box(MAP_HALF_X * 2 + 0.8, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, MAP_HALF_Z + 0.3, concrete);

  // Mid wall at z = 0 with a centre gap (mid) and a side gap on the east lane.
  box(14, WALL_HEIGHT, 0.6, -11, WALL_HEIGHT / 2, 0, concrete);
  box(10, WALL_HEIGHT, 0.6, 13, WALL_HEIGHT / 2, 0, concrete);
  box(0.6, WALL_HEIGHT, 6, 8, WALL_HEIGHT / 2, 3, concrete);

  // Site wall at z = -8 with two doors and a centre pillar.
  box(11, WALL_HEIGHT, 0.6, -12.5, WALL_HEIGHT / 2, -8, concrete);
  box(11, WALL_HEIGHT, 0.6, 12.5, WALL_HEIGHT / 2, -8, concrete);
  box(1.4, WALL_HEIGHT, 1.4, 0, WALL_HEIGHT / 2, -8, darkSteel);

  // The furnace: a tall rusted block on the west wall with a glowing mouth.
  box(4.5, 4.4, 2.2, -15.6, 2.2, -10.5, rust);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 1.4), glowMat);
  mouth.position.set(-13.3, 1.1, -10.5);
  group.add(mouth);
  // Furnace chimney.
  cylinder(0.7, 0.9, 3.2, -15.6, 6, -10.5, darkSteel, 10);

  // Catwalk platform over the east side of the site (jump up, 0.85 m).
  box(6, 0.85, 4, 13, 0.425, -11, metal);
  box(6, 0.15, 0.15, 13, 1.35, -13, darkSteel, false);
  box(0.15, 0.15, 4, 16, 1.35, -11, darkSteel, false);

  // Cover crates: low (crouch behind), tall (full block), stacked.
  const crate = (x, z, size, height) => box(size, height, size, x, height / 2, z, metal);
  crate(-6, 4, 1.2, 1.1);
  crate(6, 4, 1.2, 1.1);
  crate(-10, -4, 1.2, 1.1);
  crate(10, -4, 1.2, 1.1);
  crate(-3, -4, 1.2, 1.1);
  crate(3, -4, 1.2, 1.1);
  crate(-13, 8, 1.6, 2.2);
  crate(13, 8, 1.6, 2.2);
  crate(-6, -11.5, 1.2, 1.1);
  crate(6, -11.5, 1.2, 1.1);
  crate(-2.5, 8, 1.2, 1.1);
  crate(2.5, 8, 1.2, 1.1);
  // Stacked pair on mid.
  crate(-1.5, 2, 1.2, 1.1);
  box(1.2, 1.1, 1.2, -1.5, 1.65, 2, metal);
  box(1.2, 1.1, 1.2, 1.5, 1.65, 2, metal);
  crate(1.5, 2, 1.2, 1.1);

  // Barrels (cylinders) as soft cover near the lanes.
  cylinder(0.55, 0.55, 1.15, -8, 0.575, 7, rust);
  cylinder(0.55, 0.55, 1.15, -6.8, 0.575, 7.6, darkSteel);
  cylinder(0.55, 0.55, 1.15, 8, 0.575, -6.5, rust);
  cylinder(0.55, 0.55, 1.15, -8.5, 0.575, -11, darkSteel);

  // Pipes along the east wall, high up.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, MAP_HALF_Z * 2, 10), darkSteel);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(17.4, 3.6, 0);
  pipe.castShadow = true;
  group.add(pipe);
  const pipe2 = pipe.clone();
  pipe2.position.set(17.4, 3.0, 0);
  group.add(pipe2);

  // Hazard strip marking the bombsite floor.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(14, 0.06, 0.5), hazardMat);
  strip.position.set(0, 0.03, -9);
  strip.receiveShadow = true;
  group.add(strip);

  // SITE A sign: painted canvas texture on a board over the site doors.
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512;
  signCanvas.height = 128;
  const sctx = signCanvas.getContext('2d');
  sctx.fillStyle = '#17191b';
  sctx.fillRect(0, 0, 512, 128);
  sctx.strokeStyle = '#ff7a1a';
  sctx.lineWidth = 6;
  sctx.strokeRect(6, 6, 500, 116);
  sctx.fillStyle = '#ff7a1a';
  sctx.font = 'bold 64px system-ui, sans-serif';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('SITE A', 256, 66);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 1.1, 0.12),
    new THREE.MeshStandardMaterial({ map: signTexture, emissive: new THREE.Color('#ffffff'), emissiveMap: signTexture, emissiveIntensity: 0.55, roughness: 0.6 }),
  );
  sign.position.set(0, 4.1, -7.6);
  group.add(sign);

  // Hanging lamps over the lanes (emissive boxes, no light of their own except two).
  const lampPositions = [[-10, 4.4, 8], [10, 4.4, 8], [0, 4.4, 2], [-10, 4.4, -4], [10, 4.4, -4], [0, 4.4, -11.5]];
  for (const [x, y, z] of lampPositions) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.9), lampMat);
    lamp.position.set(x, y, z);
    group.add(lamp);
  }

  // Lighting: teal dusk sky, one low orange sun with shadows, furnace glow, cool fill.
  const sky = new THREE.HemisphereLight(new THREE.Color('#7fb8c4'), new THREE.Color('#1a2426'), 0.75);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb347'), 2.4);
  sun.position.set(-14, 16, 18);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f8f9e'), 0.5);
  fill.position.set(12, 10, -12);
  scene.add(fill);
  const furnaceLight = new THREE.PointLight(new THREE.Color(PALETTE.furnace), 26, 16, 1.8);
  furnaceLight.position.set(-12.6, 1.6, -10.5);
  scene.add(furnaceLight);
  const siteLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 14, 12, 1.8);
  siteLight.position.set(0, 3.6, -11.5);
  scene.add(siteLight);

  return {
    colliders,
    shootables,
    group,
    furnaceLight,
    siteBox: new THREE.Box3(
      new THREE.Vector3(SITE.minX, 0, SITE.minZ),
      new THREE.Vector3(SITE.maxX, 3, SITE.maxZ),
    ),
  };
}
