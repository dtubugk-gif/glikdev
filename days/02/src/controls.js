// Orbit camera rig: drag / touch to orbit, wheel / pinch to zoom, WASD and arrow keys.
// The pivot stays on the plate's centre; distance and tilt are clamped and the camera stays above the ground.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class OrbitRig {
  /**
   * @param {import('../vendor/three/three.module.js').PerspectiveCamera} camera
   * @param {HTMLElement} dom element that receives pointer and wheel input
   * @param {{target:number[], minPolar:number, maxPolar:number, onInteract?:Function}} opts
   */
  constructor(camera, dom, opts) {
    this.camera = camera;
    this.dom = dom;
    this.target = opts.target.slice();
    this.minPolar = opts.minPolar;
    this.maxPolar = opts.maxPolar;
    this.minHeight = opts.minHeight ?? 1.5;          // never closer than this to the ground
    this.minDist = 12;
    this.maxDist = 120;
    this.onInteract = opts.onInteract || (() => {});
    // current and goal pose (damped toward the goal)
    this.az = 0; this.pol = 1.1; this.dist = 50;
    this.goal = { az: 0, pol: 1.1, dist: 50 };
    this.enabled = true;
    this.keys = new Set();
    this.pointers = new Map();
    this.pinchStart = 0;
    this.pinchDist = 0;
    this._bind();
  }

  setLimits(minDist, maxDist) {
    this.minDist = minDist;
    this.maxDist = maxDist;
    this.goal.dist = clamp(this.goal.dist, minDist, maxDist);
    this.dist = clamp(this.dist, minDist, maxDist);
  }

  /** True when no input is active and the camera has settled. */
  idle() {
    return this.pointers.size === 0 && this.keys.size === 0 &&
      Math.abs(this.goal.az - this.az) < 1e-4 && Math.abs(this.goal.pol - this.pol) < 1e-4 &&
      Math.abs(this.goal.dist - this.dist) < 1e-3;
  }

  /** Largest tilt that keeps the camera at least `minHeight` above the ground at this distance. */
  safePolar(dist) {
    const c = (this.minHeight - this.target[1]) / Math.max(dist, 1e-6);
    return Math.min(this.maxPolar, c >= 1 ? this.minPolar : Math.acos(Math.max(-1, c)));
  }

  /** Jump (no damping) to a pose. */
  setPose({ az, pol, dist }) {
    this.az = this.goal.az = az;
    this.dist = this.goal.dist = clamp(dist, this.minDist, this.maxDist);
    this.pol = this.goal.pol = Math.min(clamp(pol, this.minPolar, this.maxPolar), this.safePolar(this.dist));
  }

  _interact() { this.onInteract(); }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      try { el.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.pinchDist = this.goal.dist;
      }
      this._interact();
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) {
        const h = Math.max(320, el.clientHeight);
        this.goal.az -= ((cur.x - prev.x) / h) * Math.PI * 1.1;
        this.goal.pol = clamp(this.goal.pol - ((cur.y - prev.y) / h) * Math.PI * 0.8, this.minPolar, this.maxPolar);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.goal.dist = clamp(this.pinchDist * (this.pinchStart / d), this.minDist, this.maxDist);
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchStart = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0015);
      this.goal.dist = clamp(this.goal.dist * k, this.minDist, this.maxDist);
      this._interact();
    }, { passive: false });

    const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'];
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target && e.target.closest && e.target.closest('dialog, input, textarea, [contenteditable]')) return;
      if (!KEYS.includes(e.code)) return;
      e.preventDefault();
      this.keys.add(e.code);
      this._interact();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Advance damping and keyboard motion by dt seconds and place the camera. */
  update(dt) {
    const k = this.keys;
    if (k.size) {
      const rot = 1.2 * dt, zoom = Math.exp(1.1 * dt);
      if (k.has('KeyA') || k.has('ArrowLeft')) this.goal.az -= rot;
      if (k.has('KeyD') || k.has('ArrowRight')) this.goal.az += rot;
      if (k.has('KeyW') || k.has('ArrowUp')) this.goal.dist = clamp(this.goal.dist / zoom, this.minDist, this.maxDist);
      if (k.has('KeyS') || k.has('ArrowDown')) this.goal.dist = clamp(this.goal.dist * zoom, this.minDist, this.maxDist);
      if (k.has('KeyQ')) this.goal.pol = clamp(this.goal.pol - rot * 0.6, this.minPolar, this.maxPolar);
      if (k.has('KeyE')) this.goal.pol = clamp(this.goal.pol + rot * 0.6, this.minPolar, this.maxPolar);
    }
    // never below the ground: tilt up when close and low
    const safe = Math.min(this.safePolar(this.goal.dist), this.safePolar(this.dist));
    if (this.goal.pol > safe) this.goal.pol = safe;
    const a = 1 - Math.exp(-dt * 9);
    this.az += (this.goal.az - this.az) * a;
    this.pol += (this.goal.pol - this.pol) * a;
    this.dist += (this.goal.dist - this.dist) * a;
    if (this.pol > safe) this.pol = safe;
    if (Math.abs(this.az) > TAU * 4) { const w = Math.round(this.az / TAU) * TAU; this.az -= w; this.goal.az -= w; }
    placeCamera(this.camera, this.target, this.az, this.pol, this.dist);
  }
}

/** Put a camera on a sphere around target (azimuth from +Z toward +X, polar from +Y). */
export function placeCamera(camera, target, az, pol, dist) {
  const s = Math.sin(pol);
  camera.position.set(
    target[0] + dist * s * Math.sin(az),
    target[1] + dist * Math.cos(pol),
    target[2] + dist * s * Math.cos(az),
  );
  camera.lookAt(target[0], target[1], target[2]);
}
