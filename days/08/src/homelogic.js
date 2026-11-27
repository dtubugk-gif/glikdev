// Day 8 (idea by @Darkbacon155: "a place for both cats and a owner"): the home, as numbers. A cottage with a
// wide arched door; inside are her bed (the Day 3 bolster bed, moved in), Mochi's basket and your own bed.
// No three.js here: where it stands, its walls, and the way in and out for anyone walking (you, her, Mochi), so
// nobody ever walks through a wall. home.js draws it; the tests check these rules.
//
// The house's own frame: origin = the middle of its floor, +Z = out of the front door, +X = its right as you look
// out of the door. World = HOME + rotY(HOME.rot) * local (three.js: x' = c*x + s*z, z' = -s*x + c*z).
// The model is models/home.glb (art/day08/build_home.py), drawn x14 like the shop; numbers here are world metres.

export const HOME = { x: -56, z: -14, scale: 14 };
// its front looks between the middle of the plate and where the camera starts, so the start view sees it at three
// quarters; far enough back that it sits low on the horizon, not behind the day's title
HOME.rot = Math.atan2(56, 14 + 20);

/** The building: outer and inner half-sizes, the door's half-width and the height of its arch, the eaves. */
export const HOUSE = { ox: 19.6, oz: 11.6, ix: 18.4, iz: 10.4, door: 7.5, apex: 9, eave: 10.5, ridge: 19 };

const C = Math.cos(HOME.rot), S = Math.sin(HOME.rot);
/** local (house frame) → world */
export function homeFrame(lx, lz) { return { x: HOME.x + C * lx + S * lz, z: HOME.z - S * lx + C * lz }; }
/** world → local */
export function toLocal(x, z) { const dx = x - HOME.x, dz = z - HOME.z; return { x: C * dx - S * dz, z: S * dx + C * dz }; }
/** a direction in the house frame → world */
const dirWorld = (lx, lz) => ({ x: C * lx + S * lz, z: -S * lx + C * lz });
const FRONT = dirWorld(0, 1);

// ---------------------------------------------------------------- what is inside (local spots, world copies below)
/** her bed (models/bed.glb): its middle, its front turned to the door */
export const HER_BED_AT = { ...homeFrame(2, -4), rot: HOME.rot };
/** Mochi's basket: middle, cushion radius, outer radius, cushion height, the way out of its low front */
export const BASKET = { ...homeFrame(13.2, -5.2), r: 2.6, outer: 3.6, h: 0.55, ex: FRONT.x, ez: FRONT.z, local: { x: 13.2, z: -5.2 } };
/** your bed: middle, width and length, mattress top, the pillow end (the back wall), and a spot beside it */
export const OWNER_BED = { local: { x: -11.5, z: -5.6 }, w: 5.2, l: 8.6, top: 1.9, ...homeFrame(-11.5, -5.6) };
/** you lie with your head on the pillow, facing the room: heading toward the headboard (local -Z) */
OWNER_BED.heading = Math.atan2(-FRONT.x, -FRONT.z);
/** where you lie (the root goes here, on the mattress); a little toward the head end */
OWNER_BED.lie = homeFrame(-11.5, -6.6);
/** where you stand to get in: beside it, on the room's side */
OWNER_BED.side = homeFrame(-11.5 + 2.6 + 2.4, -5.0);
/** the outside doormat, and a spot just inside the door */
export const DOOR_OUT = homeFrame(0, HOUSE.oz + 3.6);
export const DOOR_IN = homeFrame(0, HOUSE.iz - 3.4);
/** the middle of the house, for the camera and the lens */
export const HOME_MIDDLE = homeFrame(0, 0);

// ---------------------------------------------------------------- walls (for you: player.js boxes)
const box = (lx, lz, hx, hz) => ({ ...homeFrame(lx, lz), hx, hz, rot: HOME.rot });
const T = (HOUSE.ox - HOUSE.ix) / 2;                       // half a wall's thickness
/** the walls as boxes: back, left, right, and the two pieces of the front either side of the door */
export const WALL_BOXES = [
  box(0, -(HOUSE.iz + T), HOUSE.ox, T),
  box(-(HOUSE.ix + T), 0, T, HOUSE.oz),
  box(HOUSE.ix + T, 0, T, HOUSE.oz),
  box(-(HOUSE.door + HOUSE.ox) / 2, HOUSE.iz + T, (HOUSE.ox - HOUSE.door) / 2, T),
  box((HOUSE.door + HOUSE.ox) / 2, HOUSE.iz + T, (HOUSE.ox - HOUSE.door) / 2, T),
];
/** your bed, which you walk round (until you get into it) */
export const OWNER_BED_BOX = box(OWNER_BED.local.x, OWNER_BED.local.z, OWNER_BED.w / 2, OWNER_BED.l / 2);
/** Mochi's basket, which you walk round */
export const BASKET_CIRCLE = { x: BASKET.x, z: BASKET.z, r: BASKET.outer * 0.92 };

/** Is (x, z) inside the house (the room, not the walls)? `pad` shrinks the room. */
export function inHouse(x, z, pad = 0) {
  const p = toLocal(x, z);
  return Math.abs(p.x) < HOUSE.ix - pad && Math.abs(p.z) < HOUSE.iz - pad;
}
/** Is (x, z) by the house (inside, in the walls, or within `r` of them)? */
export function byHouse(x, z, r = 0) {
  const p = toLocal(x, z);
  return Math.abs(p.x) < HOUSE.ox + r && Math.abs(p.z) < HOUSE.oz + r;
}

// ---------------------------------------------------------------- the way in and out
/** where a point is: 'in' the room, 'out' of the building, or in the doorway (counts as whichever side it leans) */
function side(p) {
  if (Math.abs(p.x) < HOUSE.ix && Math.abs(p.z) < HOUSE.iz) return 'in';
  if (Math.abs(p.x) < HOUSE.door && p.z >= HOUSE.iz - 1e-6 && p.z <= HOUSE.oz + 1e-6) return p.z < (HOUSE.iz + HOUSE.oz) / 2 ? 'in' : 'out';
  return 'out';
}
/** does the segment a-b (local) pass through the building's outer box grown by `r` (a body's half-width; less a hair,
 *  so someone sliding along a wall at exactly r still sees past it)? */
function crosses(a, b, r = 0) {
  const hx = HOUSE.ox + r - 0.06, hz = HOUSE.oz + r - 0.06;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [p, q] of [[-dx, a.x + hx], [dx, hx - a.x], [-dz, a.z + hz], [dz, hz - a.z]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-6;
}

/** does the segment p-q (one end in the room, one outside) pass through the door, a body's width clear of its posts? */
function throughDoor(p, q, r) {
  const lo = p.z <= q.z ? p : q, hi = p.z <= q.z ? q : p;
  if (hi.z < HOUSE.iz - 1e-6) return false;               // (both in front of the wall's inside face: not a crossing)
  const k = HOUSE.door - Math.min(r * 0.8, HOUSE.door * 0.5);
  const xAt = (z) => {
    if (z <= lo.z) return lo.x;
    if (z >= hi.z) return hi.x;
    return lo.x + (hi.x - lo.x) * ((z - lo.z) / (hi.z - lo.z));
  };
  return Math.abs(xAt(HOUSE.iz)) < k && Math.abs(xAt(HOUSE.oz)) < k && Math.abs(lo.x) < HOUSE.ix && lo.z > -HOUSE.iz;
}
/** someone standing in the doorway (outside of its middle) is, for seeing past the walls, just out of the front */
function outFront(p, r) {
  if (Math.abs(p.x) < HOUSE.door && p.z > HOUSE.iz - 1e-6 && p.z < HOUSE.oz + r) return { x: p.x, z: HOUSE.oz + r };
  return p;
}

/**
 * Where to head next on the way from (x, z) to (tx, tz), for someone `r` metres round (half their width):
 * straight there if nothing is in the way; otherwise round a corner of the house, or in or out through the door.
 * Returns { x, z } (world): the target itself, or a waypoint.
 */
export function route(x, z, tx, tz, r = 2) {
  const a = toLocal(x, z), b = toLocal(tx, tz);
  // a quick answer for the usual case: both outside, the house not in the way
  const sa = side(a), sb = side(b);
  if (sa === 'out' && sb === 'out' && !crosses(a, b, r)) return { x: tx, z: tz };
  if (sa === 'in' && sb === 'in') return { x: tx, z: tz };
  const m = r + 1.2;                                       // corners and the door's two spots, a body's width clear
  const nodes = [a, b,
    { x: HOUSE.ox + m, z: HOUSE.oz + m }, { x: -HOUSE.ox - m, z: HOUSE.oz + m },
    { x: HOUSE.ox + m, z: -HOUSE.oz - m }, { x: -HOUSE.ox - m, z: -HOUSE.oz - m },
    { x: 0, z: HOUSE.oz + m + 1 },                         // 6: just out of the door
    { x: 0, z: HOUSE.iz - m - 1 },                         // 7: just in
  ];
  const sides = nodes.map(side);
  sides[6] = 'out'; sides[7] = 'in';
  // a waypoint already reached (within a stride of it): plan on from it, as if standing right on it
  let reached = -1;
  for (let i = 2; i < nodes.length; i++) if (Math.hypot(nodes[i].x - a.x, nodes[i].z - a.z) < 1.5) { reached = i; break; }
  if (reached > 0) { nodes[0] = { ...nodes[reached] }; sides[0] = sides[reached]; }
  const sees = (i, j) => {
    const p = nodes[i], q = nodes[j];
    if (sides[i] !== sides[j]) return throughDoor(p, q, r);   // in and out: only through the door
    if (sides[i] === 'in') return true;                    // the room is one open box
    return !crosses(outFront(p, r), outFront(q, r), r);
  };
  // the shortest way through these eight spots (Dijkstra; tiny)
  const n = nodes.length, dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
  dist[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === 1) break;
    for (let v = 0; v < n; v++) {
      if (done[v] || !sees(u, v)) continue;
      // a waypoint already reached (within a stride of it) is passed by; each extra hop costs a little, so a
      // straight line is never broken by a waypoint that happens to sit on it
      if (v === reached) continue;
      const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z) + (v > 1 ? 0.75 : 0);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  if (dist[1] === Infinity) return { x: tx, z: tz };       // (never: every spot can reach the door)
  let v = 1;
  while (prev[v] !== 0 && prev[v] !== -1) v = prev[v];
  if (v === 1) return { x: tx, z: tz };
  return homeFrame(nodes[v].x, nodes[v].z);
}

/**
 * Keep someone `r` metres round out of the walls (and, with `furniture`, off your bed and Mochi's basket):
 * returns [x, z]. Inside they stay in the room; outside they stay outside; the doorway is open.
 */
export function collide(x, z, r = 2, furniture = null) {
  const p = toLocal(x, z);
  let { x: lx, z: lz } = p;
  if (Math.abs(lx) < HOUSE.ox + r && Math.abs(lz) < HOUSE.oz + r) {
    const inDoor = Math.abs(lx) < HOUSE.door && lz > HOUSE.iz - r && lz < HOUSE.oz + r;
    if (inDoor) {
      const k = Math.max(0.2, HOUSE.door - r);              // between the posts: not into them
      if (Math.abs(lx) > k) lx = Math.sign(lx) * k;
    } else if (Math.abs(lx) < HOUSE.ix && Math.abs(lz) < HOUSE.iz) {
      // in the room: not into the walls (the front wall only either side of the door)
      lx = Math.max(-(HOUSE.ix - r), Math.min(HOUSE.ix - r, lx));
      lz = Math.max(-(HOUSE.iz - r), lz);
      if (Math.abs(lx) >= HOUSE.door - r * 0.5 || lz < HOUSE.iz - r) lz = Math.min(HOUSE.iz - r, lz);
    } else {
      // outside (or in a wall): out to the nearest face
      const px = HOUSE.ox + r - Math.abs(lx), pz = HOUSE.oz + r - Math.abs(lz);
      if (px < pz) lx = Math.sign(lx || 1) * (HOUSE.ox + r); else lz = Math.sign(lz || 1) * (HOUSE.oz + r);
    }
  }
  if (furniture) {
    if (furniture.bed !== false) {                          // your bed: a box
      const bx = OWNER_BED.local.x, bz = OWNER_BED.local.z, hx = OWNER_BED.w / 2 + r, hz = OWNER_BED.l / 2 + r;
      const dx = lx - bx, dz = lz - bz;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        if (hx - Math.abs(dx) < hz - Math.abs(dz)) lx = bx + Math.sign(dx || 1) * hx; else lz = bz + Math.sign(dz || 1) * hz;
      }
    }
    if (furniture.basket !== false) {                       // the basket: round
      const dx = lx - BASKET.local.x, dz = lz - BASKET.local.z, d = Math.hypot(dx, dz), rr = BASKET.outer + r * 0.8;
      if (d < rr && d > 1e-4) { lx = BASKET.local.x + (dx / d) * rr; lz = BASKET.local.z + (dz / d) * rr; }
    }
  }
  if (lx === p.x && lz === p.z) return [x, z];
  const w = homeFrame(lx, lz);
  return [w.x, w.z];
}

/** A spot someone is sent to (a stroll, a place to wait) moved off the walls, your bed and the basket. */
export function outOfHome(x, z, r = 3) {
  const [a, b] = collide(x, z, r, { bed: true, basket: true });
  return { x: a, z: b };
}

/** Bombs never land on the house (atombox.js landSpot keepOut): one circle round it all. */
export const HOME_KEEP = [{ x: HOME.x, z: HOME.z, r: Math.hypot(HOUSE.ox, HOUSE.oz) + 3 }];

/** Day 8: bedtime. A cosy nap together pays this many coins, once everyone has been asleep this long (s). */
export const NAP = { coins: 3, after: 6, every: 90 };
