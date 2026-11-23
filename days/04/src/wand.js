// Day 4: the fish on a stick (idea by @Darkbacon155: "Can you please make a fish toy on a stick").
// models/wand.glb was built in Blender (art/day04/build_wand.py, wand_fish.py): WandRod (with WandTip, the ring
// the line leaves from) and WandFish (with FishLoop, where the line ties on).
//
// Who does what:
//   player.js    holds the rod in your right hand (createWand().rod is handed to player.giveRod)
//   kittybrain   moves the fish: it is her toy (brain.yarn with wand: true), tied to the rod's tip by a line
//   this file    draws the fish where the brain says it is (upright, nose first, her back up the line when she
//                hangs or flies), and the line from the rod's tip to the loop on her back.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { YARN } from './kittybrain.js';
import { HOLD } from './player.js';
import { skyReflections } from './outfits.js';

const S = HOLD.scale, SF = HOLD.fishScale;
const FISH_LOW = 0.0268 * SF;        // her lowest point below the middle of her body (build_wand.py prints it)
const SEG = 22, SIDES = 5, LINE_R = 0.036;
const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

/**
 * @param {{scene:THREE.Scene, url:string, renderer?:THREE.WebGLRenderer}} o
 */
export async function createWand(o) {
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const need = (n) => { const x = gltf.scene.getObjectByName(n); if (!x) throw new Error(`wand.glb has no ${n}`); return x; };
  const rodMesh = need('WandRod'), tipNode = need('WandTip'), fishMesh = need('WandFish'), loopNode = need('FishLoop');
  const aniso = Math.min(8, o.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  const env = o.renderer ? skyReflections(o.renderer) : null;
  gltf.scene.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;                       // they move with your hand and the line
    for (const mat of [].concat(m.material)) {
      if (mat.map) mat.map.anisotropy = aniso;
      if (env) { mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.15 : 0.5; }
    }
  });
  const rod = new THREE.Group();
  rod.name = 'Wand';
  rod.scale.setScalar(S);
  rodMesh.position.set(0, 0, 0);
  rod.add(rodMesh);
  rod.visible = false;
  const fish = new THREE.Group();
  fish.name = 'WandFish';
  fish.scale.setScalar(SF);
  fishMesh.position.set(0, 0, 0);
  fish.add(fishMesh);
  fish.visible = false;
  o.scene.add(fish);
  const stub = new THREE.Group();                  // takes the yarn ball's place in kitty.js (the fish is drawn here instead)
  stub.name = 'WandFishStub';

  // the line: a thin tube from the tip to the loop, rebuilt every frame (it sags when it is slack)
  const pos = new Float32Array((SEG + 1) * SIDES * 3), idx = [];
  for (let i = 0; i < SEG; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k, b = i * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const line = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f0705a', roughness: 0.75 }));
  line.name = 'WandLine';
  line.frustumCulled = false;
  line.castShadow = false;
  line.visible = false;
  o.scene.add(line);

  let on = false, yaw = 0, started = false;
  const up = new THREE.Vector3(0, 1, 0);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), want = new THREE.Vector3();
  const bx = new THREE.Vector3(), bz = new THREE.Vector3(), basis = new THREE.Matrix4();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const curve = (s, sag, out) => {
    out.lerpVectors(A, B, s);
    out.y = Math.max(0.07, out.y - sag * 4 * s * (1 - s));
    return out;
  };

  return {
    /** the rod's model: hand it to player.giveRod() */
    rod,
    /** what kitty.setToy() gets while the fish is out (the fish itself is drawn by this file) */
    stub,
    fish,
    setOn(v) { on = !!v; started = false; if (!on) { fish.visible = false; line.visible = false; } },
    get on() { return on; },
    /**
     * Every frame, after the player and the kitty have moved.
     * @param {number} dt       seconds since the last frame
     * @param {number} t        the kitty's clock (s)
     * @param {object|null} y   brain.yarn
     * @param {number} heading  the way you are facing (radians)
     */
    update(dt, t, y, heading) {
      const show = on && !!y?.wand && rod.visible;
      fish.visible = show;
      line.visible = show;
      if (!show) return;
      rod.updateWorldMatrix(true, true);
      tipNode.getWorldPosition(A);
      C.set(y.x, y.y - YARN.radius + FISH_LOW, y.z);
      // which way she faces: nose first when she moves; hanging, she turns slowly this way and that
      const speed = Math.hypot(y.vx, y.vz);
      let wantYaw = yaw;
      if (y.hang) wantYaw = heading + 1.15 + 0.45 * Math.sin(t * 0.7);
      else if (speed > 0.8) wantYaw = Math.atan2(y.vx, y.vz);
      if (!started) { yaw = wantYaw; up.set(0, 1, 0); started = true; }
      yaw += wrap(wantYaw - yaw) * (1 - Math.exp(-dt * (y.hang ? 2.5 : 10)));
      // her back points up the line when she hangs from it or flies on it; on the floor she sits upright
      want.copy(A).sub(C);
      const far = want.length();
      want.normalize();
      const taut = far > y.line - 1.4;
      const w = y.hang ? 1 : (y.air || y.held) ? (taut ? 0.8 : 0.3) : 0.1;
      want.multiplyScalar(w).addScaledVector(WORLD_UP, 1 - w).normalize();
      up.lerp(want, 1 - Math.exp(-dt * 12)).normalize();
      const wig = y.hang ? 0 : 0.22 * Math.sin(t * 15) * Math.min(1, speed / 6);      // she wriggles as she goes
      bz.set(Math.sin(yaw + wig), 0, Math.cos(yaw + wig));
      bz.addScaledVector(up, -bz.dot(up)).normalize();
      bx.crossVectors(up, bz);
      fish.quaternion.setFromRotationMatrix(basis.makeBasis(bx, up, bz));
      fish.position.copy(C);
      fish.updateWorldMatrix(false, true);
      loopNode.getWorldPosition(B);
      // the line: straight when it is taut, hanging in a curve when there is slack
      const d = A.distanceTo(B), slack = Math.max(0, y.line - 0.75 - d);
      const sag = y.hang ? 0 : Math.min(5, 0.42 * Math.sqrt(slack * (slack + 2 * d)));
      for (let i = 0; i <= SEG; i++) {
        const s = i / SEG;
        curve(s, sag, P);
        curve(Math.min(1, s + 0.02), sag, Q);
        tan.copy(Q);
        curve(Math.max(0, s - 0.02), sag, Q);
        tan.sub(Q).normalize();
        side.crossVectors(tan, WORLD_UP);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        nrm.crossVectors(side, tan);
        for (let k = 0; k < SIDES; k++) {
          const a = (k / SIDES) * Math.PI * 2, ca = Math.cos(a) * LINE_R, sa = Math.sin(a) * LINE_R, j = (i * SIDES + k) * 3;
          pos[j] = P.x + side.x * ca + nrm.x * sa;
          pos[j + 1] = P.y + side.y * ca + nrm.y * sa;
          pos[j + 2] = P.z + side.z * ca + nrm.z * sa;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    },
    /** the middle of the fish in the world (for sounds and pictures) */
    fishPosition(out = new THREE.Vector3()) { return out.copy(fish.position); },
  };
}
