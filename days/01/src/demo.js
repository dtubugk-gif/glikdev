// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready), so a recorder that controls requestAnimationFrame / performance.now gets
// identical frames on every run.

export const DEMOS = ['orbit', 'reveal'];

const lerp = (a, b, k) => a + (b - a) * k;
const DEG = Math.PI / 180;

/**
 * @param {string} name   'orbit' | 'reveal'
 * @param {number} t      seconds
 * @param {{az:number, pol:number, dist:number, target:number[], shift:number, fov:number,
 *          horizon:number, horizonAt:Function, edgeDip:Function}} home  the default framing (main.js)
 * @returns {{az:number, pol:number, dist:number, target:number[], shift:number}
 *          | {position:number[], look:number[], shift:number} | null}
 */
export function demoPose(name, t, home) {
  if (name === 'orbit') {
    // one slow full turn every 36 s around the plate's centre, at the default height
    return { az: home.az + (t / 36) * Math.PI * 2, pol: home.pol, dist: home.dist, target: home.target, shift: home.shift };
  }
  if (name === 'reveal') {
    // 0-6 s, ease-out: high and top-down over the grid, swooping down and levelling out
    // about 3.5 m above the plate, gliding toward the horizon; after 6 s it keeps gliding.
    const u = Math.min(1, Math.max(0, t / 6));
    const k = 1 - (1 - u) ** 3;
    const fx = -Math.sin(home.az), fz = -Math.cos(home.az);       // forward, away from the start view
    const height = lerp(82, 3.5, k);
    const pitch = lerp(82, 4, Math.min(1, k * 1.08)) * DEG;        // degrees below the horizon
    const travel = lerp(-34, 30, k) + 2.5 * Math.max(0, t - 6);     // metres along forward
    const pos = [fx * travel, height, fz * travel];
    const look = [pos[0] + fx * Math.cos(pitch) * 20, height - Math.sin(pitch) * 20, pos[2] + fz * Math.cos(pitch) * 20];
    // lens shift: none while looking down, then the horizon settles at the layout's height
    // (the visible horizon is the plate's far edge, a little below the sky's horizon)
    const endDip = home.edgeDip(3.5, -30, home.az);
    const endShift = home.horizonAt(4 * DEG - endDip, home.fov) - home.horizon;
    return { position: pos, look, shift: lerp(0, endShift, k) };
  }
  return null;
}
