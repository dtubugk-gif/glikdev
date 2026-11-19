// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready), so a recorder that controls requestAnimationFrame / performance.now gets
// identical frames on every run.

export const DEMOS = ['orbit', 'reveal'];

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * @param {string} name   'orbit' | 'reveal'
 * @param {number} t      seconds
 * @param {{az:number, pol:number, dist:number, target:number[], sign:number[], signDist:number,
 *          shift:number, signShift:number}} home  the default framing (from main.js)
 * @returns {{az:number, pol:number, dist:number, target:number[], shift:number}|null}
 */
export function demoPose(name, t, home) {
  if (name === 'orbit') {
    // one full turn every 30 s, gently breathing in height and distance
    return {
      az: home.az + (t / 30) * Math.PI * 2,
      pol: home.pol + 0.05 * Math.sin(t * 0.42),
      dist: home.dist * (1.0 + 0.04 * Math.sin(t * 0.3)),
      target: home.target,
      shift: home.shift,
    };
  }
  if (name === 'reveal') {
    // 6 s ease-out push-in: from high and wide straight onto the sign, then hold.
    const u = Math.min(1, Math.max(0, t / 6));
    const k = 1 - (1 - u) ** 3;
    const logD = lerp(Math.log(home.dist * 1.5), Math.log(home.signDist), k);
    return {
      az: home.az - 0.5 + 0.5 * k,
      pol: lerp(0.95, 1.42, k),
      dist: Math.exp(logD),
      target: home.target.map((v, i) => lerp(v, home.sign[i], k)),
      shift: lerp(home.shift, home.signShift, k),
    };
  }
  return null;
}
