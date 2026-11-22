// Day 3: the kitty shop, a real place on the plate (the owner's idea: "the shop you open by going to a
// physical shop"). models/shop.glb was built in Blender (art/day03/build_shop.py). Walk up to its counter
// and the wardrobe opens (just getting close is enough).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';

/** Where it stands (metres) and which way its counter faces (toward the middle of the plate). */
export const SHOP = { x: 25, z: -27, scale: 14 };
SHOP.rot = Math.atan2(-SHOP.x, -SHOP.z);
// in its own frame (+Z = out of the counter): the walls, the spot you stand on, how near counts as "at the shop"
const BOX = { cz: -0.3, hx: 7.6, hz: 4.4 };
const STAND = 7.4, NEAR = 15, LEAVE = 20;       // within NEAR of the building (any side) the shop opens; past LEAVE it can open again
const toWorld = (lx, lz) => {
  const c = Math.cos(SHOP.rot), s = Math.sin(SHOP.rot);
  return { x: SHOP.x + c * lx + s * lz, z: SHOP.z - s * lx + c * lz };
};
/** the walls, for walking round (player.js outOfBox) */
export const SHOP_BOX = { ...toWorld(0, BOX.cz), hx: BOX.hx, hz: BOX.hz, rot: SHOP.rot };
/** the doormat in front of the counter */
export const SHOP_DOOR = toWorld(0, STAND);
/** a place for the kitty to wait, beside the doormat */
export const SHOP_WAIT = toWorld(-6.5, STAND + 3.5);
export const atShop = (x, z) => Math.hypot(x - SHOP_BOX.x, z - SHOP_BOX.z) < NEAR;
export const leftShop = (x, z) => Math.hypot(x - SHOP_BOX.x, z - SHOP_BOX.z) > LEAVE;
/** Keep a spot the kitty is sent to out of the building (she is big: a wide berth). */
export function outOfShop(x, z, berth = 11.5) {
  const dx = x - SHOP_BOX.x, dz = z - SHOP_BOX.z, d = Math.hypot(dx, dz);
  if (d >= berth) return { x, z };
  const front = toWorld(0, 1);                              // pushed out toward the front, never behind the walls
  const fx = front.x - SHOP.x, fz = front.z - SHOP.z;
  const ux = d > 0.5 ? dx / d : fx, uz = d > 0.5 ? dz / d : fz;
  return { x: SHOP_BOX.x + ux * berth, z: SHOP_BOX.z + uz * berth };
}

/** @param {{scene:THREE.Scene, url:string, renderer:THREE.WebGLRenderer}} o */
export async function createShop(o) {
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const env = skyReflections(o.renderer);
  const aniso = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
  const group = gltf.scene;
  group.name = 'Shop';
  group.position.set(SHOP.x, 0, SHOP.z);
  group.rotation.y = SHOP.rot;
  group.scale.setScalar(SHOP.scale);
  group.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    for (const mat of [].concat(m.material)) {
      if (mat.map) mat.map.anisotropy = aniso;
      mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.1 : 0.5;
      if (mat.transparent) { mat.depthWrite = false; m.castShadow = false; }
    }
  });
  o.scene.add(group);
  // a soft patch of shade on the ground under and around it (the sun's shadow map follows the player)
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 20, 64, 64, 63);
  gr.addColorStop(0, 'rgba(38,32,28,0.55)'); gr.addColorStop(0.7, 'rgba(38,32,28,0.28)'); gr.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  shade.rotation.x = -Math.PI / 2;
  shade.rotation.z = SHOP.rot;
  shade.scale.set(23, 17, 1);
  shade.position.set(SHOP_BOX.x, 0.03, SHOP_BOX.z);
  shade.renderOrder = 1;
  o.scene.add(shade);

  const box = new THREE.Box3(new THREE.Vector3(-BOX.hx, 0, BOX.cz - BOX.hz), new THREE.Vector3(BOX.hx, 11.5, BOX.cz + BOX.hz + 2.5));
  const inv = new THREE.Matrix4(), local = new THREE.Ray(), hit = new THREE.Vector3();
  const frame = new THREE.Matrix4().makeRotationY(SHOP.rot).setPosition(SHOP.x, 0, SHOP.z);
  inv.copy(frame).invert();
  return {
    group,
    /** does this ray (world space) hit the building? */
    pick(ray) { local.copy(ray).applyMatrix4(inv); return !!local.intersectBox(box, hit); },
  };
}
