// Day 6: little effects that make things feel alive (the owner: "make the game as a beautiful animations").
//   dust      soft puffs that roll out along the ground: a pounce lands, you run, a cat pulls up
//   sparkle   storybook stars that pop out and twinkle up: something new is bought, put on, earned
// Every effect is logged with the clock time it starts, and drawn from that time alone, so a recording that
// jumps to any frame shows exactly the same thing.
import * as THREE from '../vendor/three/three.module.js';

function tex(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const puffTex = () => tex((g) => {
  const r = g.createRadialGradient(64, 60, 6, 64, 64, 60);
  r.addColorStop(0, 'rgba(252,247,238,0.95)'); r.addColorStop(0.55, 'rgba(238,229,214,0.6)'); r.addColorStop(1, 'rgba(238,229,214,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
// a four-pointed star with a dark ink line, like the hearts: it reads as drawn, not as a glow
const starTex = (fill) => tex((g) => {
  g.translate(64, 64);
  const star = () => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 15 : 50;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  };
  g.lineJoin = 'round';
  star(); g.lineWidth = 12; g.strokeStyle = '#fff8ec'; g.stroke();
  star(); g.fillStyle = fill; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2f2620'; g.stroke();
});

const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** @param {{scene:THREE.Scene}} o */
export function createFX(o) {
  const group = new THREE.Group();
  group.name = 'FX';
  o.scene.add(group);
  const make = (map, n) => Array.from({ length: n }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false }));
    s.visible = false; group.add(s); return s;
  });
  const puffs = make(puffTex(), 36);
  const golds = make(starTex('#ffd35c'), 14), creams = make(starTex('#fff3c4'), 10), pinks = make(starTex('#ffb4c8'), 8);
  let log = [], n = 0;
  return {
    group,
    /** a ring of dust where something lands (size 1 = a cat's pounce); `dir` (radians) leans it one way */
    dust(t, x, z, size = 1, count = 6, dir = null) {
      for (let k = 0; k < count; k++) {
        const a = dir == null ? (k / count) * Math.PI * 2 + hash(n + k) * 0.6 : dir + (hash(n + k) - 0.5) * 1.6;
        log.push({ kind: 'dust', t: t + hash(n + k * 3) * 0.05, x, z, vx: Math.sin(a), vz: Math.cos(a), size: size * (0.75 + 0.5 * hash(n + k * 7)), life: 0.7 + 0.35 * size });
      }
      n += count;
    },
    /** stars that pop out round a point and twinkle up */
    sparkle(t, x, y, z, count = 7, spread = 2.4) {
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + hash(n + k) * 0.8, up = 0.4 + hash(n + k * 5) * 0.9;
        log.push({ kind: 'star', t: t + k * 0.035, x, y, z, vx: Math.sin(a), vz: Math.cos(a), up, spread, tint: (n + k) % 3,
          spin: (hash(n + k * 9) - 0.5) * 4, size: 0.85 + 0.5 * hash(n + k * 11), life: 1.05 });
      }
      n += count;
    },
    reset() { log = []; n = 0; },
    busy() { return log.length > 0; },
    update(t) {
      let ip = 0;
      const used = [0, 0, 0];
      const stars = [golds, creams, pinks];
      for (const e of log) {
        const a = t - e.t;
        if (a < 0 || a > e.life) continue;
        const u = a / e.life;
        if (e.kind === 'dust') {
          if (ip >= puffs.length) continue;
          const s = puffs[ip++], k = 1 - (1 - u) ** 2.4;
          s.visible = true;
          s.position.set(e.x + e.vx * k * 2.6 * e.size, 0.3 + k * 0.9 * e.size, e.z + e.vz * k * 2.6 * e.size);
          s.scale.setScalar((0.7 + k * 1.9) * e.size);
          s.material.opacity = 0.7 * (1 - u) ** 1.3;
          s.material.rotation = e.vx * 2 + k;
        } else {
          const pool = stars[e.tint];
          if (used[e.tint] >= pool.length) continue;
          const s = pool[used[e.tint]++];
          const out = 1 - (1 - Math.min(1, a / 0.35)) ** 3;
          s.visible = true;
          s.position.set(e.x + e.vx * out * e.spread, e.y + out * 0.8 + a * e.up * 2.2, e.z + e.vz * out * e.spread);
          // pop in with an overshoot, twinkle, shrink away
          const pop = a < 0.18 ? 1 + 2.7 * (a / 0.18 - 1) ** 3 + 1.7 * (a / 0.18 - 1) ** 2 : 1;
          const tw = 0.85 + 0.15 * Math.sin(a * 22 + e.spin * 3);
          s.scale.setScalar(Math.max(0.01, pop * tw * e.size * 0.95 * (u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1)));
          s.material.rotation = e.spin * a;
          s.material.opacity = 1;
        }
      }
      for (let i = ip; i < puffs.length; i++) puffs[i].visible = false;
      stars.forEach((pool, j) => { for (let i = used[j]; i < pool.length; i++) pool[i].visible = false; });
      if (log.length > 120 || (log.length && t - log[0].t > 3)) log = log.filter((e) => t - e.t <= e.life + 0.1);
    },
  };
}
