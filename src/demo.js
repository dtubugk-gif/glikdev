// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready), so a recorder that controls requestAnimationFrame / performance.now gets
// identical frames on every run.

export const DEMOS = ['orbit', 'reveal'];

const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * c * (c * (c * 6 - 15) + 10); };
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * @param {string} name   'orbit' | 'reveal'
 * @param {number} t      seconds
 * @param {{az:number, pol:number, dist:number, target:number[], sign:number[]}} home  the default framing
 * @returns {{az:number, pol:number, dist:number, target:number[]}|null}
 */
export function demoPose(name, t, home) {
  if (name === 'orbit') {
    // one full turn every 30 s, gently breathing in height and distance
    const az = home.az + (t / 30) * Math.PI * 2;
    return {
      az,
      pol: home.pol + 0.05 * Math.sin(t * 0.42),
      dist: home.dist * (1.0 + 0.04 * Math.sin(t * 0.3)),
      target: home.target,
    };
  }
  if (name === 'reveal') {
    // 0-9 s: from high and far, a slow push-in that ends close on the signpost; then holds.
    const k = smooth(t / 9);
    const near = Math.max(0, (k - 0.55) / 0.45);
    const tgt = home.target.map((v, i) => lerp(v, home.sign[i], smooth(near)));
    return {
      az: home.az - 0.55 + 0.62 * k,
      pol: lerp(0.62, home.pol + 0.18, k),
      dist: lerp(home.dist * 1.75, home.dist * 0.34, k),
      target: tgt,
    };
  }
  return null;
}
