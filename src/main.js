// Glikdev. Glue: URL modes, UI, Day log, the world, the kitty (Day 2) and the render loop. The title
// card and the Day log come from days.json at runtime (the newest entry), so a new day only adds an entry there.
//   ?demo=orbit | reveal | kitty | kittycall | kittypet | kittywalk | kittytoken | kittydress | kittyfish ...
//                                scripted camera (and kitty), driven only by frame time (for filming)
//   ?tokens=1                    (filming) show the friendship token counter even with ?ui=0
//   ?wear=crown,bowtie,wings     (filming, posters) she starts with these on
//   ?have=6                      (filming) the token counter starts at 6
//   ?view=first                  first person instead of the third-person camera
//   ?ui=0                        hide every piece of UI
//   ?tag=Mochi&tagAt=1.5         (filming) show the kitty's name tag, popping in at tagAt seconds
//   ?capture=short               Shorts layout: record at 360x640 CSS with deviceScaleFactor 3
// window.renderFrame(t) renders the frame at t seconds (used by frame-exact recorders);
// window.__ready resolves once the world has drawn its first frame.
// Cache safety: index.html loads this file as src/main.js?v=<build> and maps every module to the same
// ?v= through its import map; data and model URLs below get the same stamp (deploy.mjs writes it).
import { renderDayLog, renderHeadline, latestDay } from './daylog.js';
import { DEMOS, demoPose, KITTY_DEMOS } from './demo.js';
import { createWallet, rewardFor, penaltyFor, ITEMS, NEW_ITEM, itemById, SKINS, skinById, ATOM_BOX } from './tokens.js';
import { createMind, sayWhy, describeMind } from './kittymind.js';
import { emoteSVG } from './emotes.js';

// Set this to the channel's URL once it exists (for example 'https://www.youtube.com/@glikdev').
const CHANNEL_URL = 'https://www.youtube.com/@glikdev';

const params = new URLSearchParams(location.search);
const demo = DEMOS.includes(params.get('demo')) ? params.get('demo') : null;
const showUI = params.get('ui') !== '0';
const short = params.get('capture') === 'short';
const cine = short && params.get('cine') === '1';   // Shorts: film through a lens with depth of field (world.js)
const root = document.documentElement;
if (!showUI) root.classList.add('no-ui');
if (demo) root.classList.add('demo');
if (short) root.classList.add('capture-short');

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const hintEl = $('hint');

const BUILD = new URL(import.meta.url).searchParams.get('v') || '';
const stamped = (url) => (BUILD ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(BUILD)}` : url);
// Each day's update must show up at once. GitHub Pages lets a browser keep the page (and so the old
// build's models) for 10 minutes; so at start the page is fetched again, past the cache, and if the build
// online is newer, it is loaded instead. Recordings and demos never do this; once per build at most.
(async () => {
  if (!BUILD || params.has('demo') || params.get('capture')) return;
  try {
    const r = await fetch(`${location.pathname}?fresh=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const live = /src="src\/main\.js\?v=([A-Za-z0-9._-]+)"/.exec(await r.text())?.[1];
    if (!live || live === BUILD) return;
    let tried = null;
    try { tried = sessionStorage.getItem('glikdev.fresh'); sessionStorage.setItem('glikdev.fresh', live); } catch { /* no storage: still fine */ }
    if (tried === live) return;                          // already tried this one: never loop
    const next = new URL(location.href);
    next.searchParams.set('v', live);                    // a new address the browser has not kept
    location.replace(next.href);
  } catch { /* offline: carry on with what we have */ }
})();
// a snapshot lives at days/NN/: its links to other days go back to the site root first
const SITE_ROOT = /\/days\/\d+\/(?:index\.html)?$/.test(location.pathname) ? '../../' : '';

let resolveReady;
window.__ready = new Promise((r) => { resolveReady = r; });
let onCopyChange = () => {};

// ---------------------------------------------------------------- Day log + title card
const dialog = $('daylog');
const list = $('daylog-list');
const daysLoaded = fetch(stamped('days.json'), { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(`days.json ${r.status}`); return r.json(); })
  .then((days) => {
    renderDayLog(list, days, { root: SITE_ROOT });
    renderHeadline({ day: document.querySelector('.title-day'), line: document.querySelector('.title-line'), bubble: document.querySelector('.bubble') }, days);
    const last = latestDay(days);
    if (last && typeof last.alt === 'string' && last.alt.trim()) $('world').setAttribute('aria-label', last.alt.trim());
    onCopyChange();
    return days;
  })
  .catch(() => {
    const li = document.createElement('li');
    li.className = 'daylog-empty';
    li.textContent = 'The Day log could not be loaded. Reload to try again.';
    list.replaceChildren(li);
    return null;
  });

const openBtn = $('daylog-open');
openBtn.addEventListener('click', () => {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
});
$('daylog-close').addEventListener('click', () => (dialog.close ? dialog.close() : dialog.removeAttribute('open')));
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => openBtn.focus());

const channel = $('channel');
if (CHANNEL_URL) { channel.href = CHANNEL_URL; channel.hidden = false; }

// ---------------------------------------------------------------- the kitty's name and needs (this device only)
const CARE_KEY = 'glikdev.kitty.v1';
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
function loadCare() {
  try {
    const d = JSON.parse(localStorage.getItem(CARE_KEY) || 'null');
    if (!d || typeof d !== 'object') return null;
    return d;
  } catch { return null; }
}
function saveCare(d) { try { localStorage.setItem(CARE_KEY, JSON.stringify(d)); } catch { /* private mode: fine */ } }
// Day 3: her friendship tokens and what she owns and wears (this device only)
const WALLET_KEY = 'glikdev.tokens.v1';
function loadWallet() { try { return JSON.parse(localStorage.getItem(WALLET_KEY) || 'null'); } catch { return null; } }
function saveWallet(w) { try { localStorage.setItem(WALLET_KEY, JSON.stringify(w)); } catch { /* private mode: fine */ } }
const filmTokens = params.get('tokens') === '1';
// ?wear=crown,bowtie  (filming, posters) she has these on from the start; the purse is not touched
const paramWear = {};
for (const id of (params.get('wear') || '').split(',')) { const it = itemById(id.trim()); if (it) paramWear[it.slot] = it.id; }
// the cats you can choose (the ginger kitty is Day 2's own; the other two are the owner's picks)
const CATS = {
  // (her fur shells are off since the Day 3 rework: a clean storybook coat reads better than speckled strands;
  //  ?fur=10 turns them back on for a look)
  ginger: { label: 'Ginger', url: 'models/kitty.glb', fur: 'models/kitty_fur.png', shells: 0, head: 1.14 },   // head: kitten proportions
  realistic: { label: 'Realistic', url: 'models/cat_realistic.glb' },
  tabby: { label: 'Tabby', url: 'models/cat_toti.glb' },
};
const THUMB = { ginger: 'models/thumb_ginger.webp', realistic: 'models/thumb_realistic.webp', tabby: 'models/thumb_toti.webp' };
// Day 5: fur skins, bought with atom tokens (tokens.js SKINS). Each is the ginger kitty in another coat
// (models/skins/<id>.webp, art/day05/make_skins.py, which also prints the eyelid colour that goes with it).
const SKIN_LID = { silver: '#9ea4ad', tuxedo: '#1f1f25', atomic: '#83b255' };
for (const k of SKINS) {
  CATS[k.id] = { ...CATS.ginger, label: k.name, base: 'ginger', skin: k.id, lid: SKIN_LID[k.id] };
  THUMB[k.id] = `models/skins/thumb_${k.id}.webp`;
}
/** the cat whose fit and sizes this one uses (a skin is the ginger kitty) */
const baseCat = (k) => CATS[k]?.base || k;
const catOf = (k) => (Object.hasOwn(CATS, k) ? k : null);
const filmTag = cleanName(params.get('tag'));
const filmTagAt = Number(params.get('tagAt')) || 0;

// ---------------------------------------------------------------- failure states
function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();   // release the probe context
    return true;
  } catch { return false; }
}

function showFallback() {
  root.classList.add('no-webgl');
  $('fallback').hidden = false;
  statusEl.hidden = true;
  resolveReady(false);
}

function showLoadError(err) {
  console.warn('Glikdev: the world did not load', err);
  statusEl.textContent = 'The world didn’t load. Check your connection and reload.';
  statusEl.classList.add('is-error');
  statusEl.hidden = false;
  resolveReady(false);
}

// ---------------------------------------------------------------- the world
async function start() {
  if (!hasWebGL2()) { showFallback(); return; }

  let mods;
  try {
    mods = await Promise.all([import('./world.js'), import('./controls.js'), import('../vendor/three/three.module.js')]);
  } catch (err) { showLoadError(err); return; }
  const [{ createRenderer, createWorld, PLATE }, { OrbitRig, placeCamera }, THREE] = mods;
  const kittyMods = Promise.all([import('./kitty.js'), import('./kittyaudio.js')]);
  const fxMod = import('./fx.js').catch(() => null);

  const canvas = $('world');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const maxDpr = coarse ? 1.5 : 2;
  const dpr = () => Math.min(window.devicePixelRatio || 1, short ? 4.5 : maxDpr);   // Shorts are filmed at 3, punched-in shots at up to 4.5

  let renderer;
  try { renderer = createRenderer(canvas, { lowPower: coarse }); } catch { showFallback(); return; }

  let world;
  try {
    world = await createWorld({ renderer, modelUrl: stamped('models/day1.glb'), phone: coarse || innerWidth < 760, cine });
  } catch (err) { showLoadError(err); return; }
  const { camera } = world;
  let fx = null;                                           // Day 6: dust and sparkles (fx.js)
  try { fx = (await fxMod)?.createFX({ scene: world.scene }) ?? null; } catch { fx = null; }
  const fxHead = new THREE.Vector3();
  world.setAnimate(demo ? true : !reducedMotion);

  let hinted = false, looked = false;
  // Orbit the centre of the plate. The start view looks along the grid at a slight angle,
  // so the lines run off toward the horizon in perspective.
  const target = [0, PLATE.topY, 0];
  const home = { az: 0.32, pol: 1.05, dist: 32, height: 16, target, shift: 0, shiftX: 0, fov: 60, horizon: 0.42 };
  let follow = true;                                       // the camera follows the kitty until you move it (Day 3: always you)
  let camZoom = 1, firstPerson = false, tagMinY = 0;
  const eye = new THREE.Vector3(), lookAtPt = new THREE.Vector3();
  let onFree = () => {};
  const rig = new OrbitRig(camera, canvas, { target, minPolar: 0.22, maxPolar: 1.52, minHeight: 1.5,
    bounds: PLATE.half - 8, onInteract: () => { looked = true; },
    onPan: () => { if (follow) { follow = false; onFree(); } } });

  // Where the horizon lands for a camera pitched down by `pitch` (radians) with vertical fov `fov` (deg),
  // as a fraction of the height from the top, before any lens shift.
  const horizonAt = (pitch, fov) => 0.5 - 0.5 * Math.tan(pitch) / Math.tan((fov * Math.PI) / 360);
  // How far below the true horizon the plate's far edge sits (radians), seen from a camera at
  // `height` and horizontal distance `back` from the centre, looking along azimuth az toward it.
  function edgeDip(height, back, az) {
    const fx = -Math.sin(az), fz = -Math.cos(az);
    const px = Math.sin(az) * back, pz = Math.cos(az) * back;
    const tx = fx ? ((Math.sign(fx) * PLATE.half) - px) / fx : Infinity;
    const tz = fz ? ((Math.sign(fz) * PLATE.half) - pz) / fz : Infinity;
    return Math.atan2(height, Math.min(tx, tz));
  }

  // Frame the plate for the current screen: camera height and pitch, then a vertical lens shift
  // that puts the horizon below the title (portrait: 38-45% of the height).
  function layout() {
    const w = innerWidth, h = innerHeight;
    world.resize(w, h, dpr());
    const aspect = w / h;
    const portrait = aspect < 0.85;
    const wide = aspect >= 1.3;
    const spec = portrait
      ? { fov: 62, pitch: 30, height: 16, horizon: short ? 0.44 : 0.42 }
      : wide ? { fov: 46, pitch: 26, height: 15, horizon: h < 500 ? 0.45 : 0.4 }
        : { fov: 54, pitch: 28, height: 16, horizon: 0.41 };
    if (portrait && showUI) {
      // keep the horizon below the bubble, however long the day's headline is
      const b = document.querySelector('.bubble')?.getBoundingClientRect();
      if (b && b.height) root.style.setProperty('--hint-top', `${Math.round(b.bottom + 30)}px`);   // the hint sits just under it
      if (b && b.height) tagMinY = Math.round(b.bottom + 100);
      if (b && b.height) spec.horizon = Math.min(short ? 0.6 : 0.45, Math.max(spec.horizon, (b.bottom + 34) / h));
    }
    camera.fov = spec.fov;
    const pitch = (spec.pitch * Math.PI) / 180;
    home.fov = spec.fov;
    home.pol = Math.PI / 2 - pitch;
    home.height = spec.height;
    home.dist = spec.height / Math.cos(home.pol);
    home.horizon = spec.horizon;
    // the visible horizon is the plate's far edge: put that line at spec.horizon
    home.shift = horizonAt(pitch - edgeDip(spec.height, spec.height / Math.tan(pitch), home.az), spec.fov) - spec.horizon;
    home.shiftX = 0;
    rig.setLimits(camZoom !== 1 ? 12 : 6, camZoom !== 1 ? 64 : 170);   // locked on the player: never far away
    if (firstPerson) { camera.fov = portrait ? 66 : wide ? 52 : 58; setShift(0, 0); } else setShift(home.shift, 0);
  }
  function setShift(sy, sx = 0) {
    const w = innerWidth, h = innerHeight;
    camera.setViewOffset(w, h, sx * w, sy * h, w, h);
    camera.updateProjectionMatrix();
  }
  home.horizonAt = horizonAt;
  home.edgeDip = edgeDip;
  layout();
  rig.setPose(home);
  // web fonts change the bubble's height: frame again once they are in
  // web fonts and the day's copy change the bubble's height: frame again (unless someone is already looking around)
  const reframe = () => { layout(); if (!looked) rig.setPose({ az: rig.goal.az, pol: home.pol, dist: home.dist * camZoom }); };
  document.fonts?.ready.then(reframe);
  onCopyChange = reframe;
  addEventListener('resize', () => {
    const before = home.dist;
    layout();
    rig.goal.dist *= home.dist / before;
    rig.dist = rig.goal.dist;
    rig.setLimits(rig.minDist, rig.maxDist);               // clamps both ends, current and goal
  });

  // ------------------------------------------------------------ the kitty (Day 2, idea by @lifediamond888)
  let kitty = null, audio = null;
  const kd = demo ? KITTY_DEMOS[demo] : null;
  const live = !demo && !short;
  const saved = live ? loadCare() : null;
  const care = {
    name: cleanName(saved?.name) || 'Kitty',
    muted: !!saved?.muted,
    // (a fur skin that was never bought on this device is not hers: back to her own coat)
    cat: catOf(params.get('cat')) || (catOf(saved?.cat) && (!CATS[saved.cat].skin || createWallet(loadWallet()).ownsSkin(CATS[saved.cat].skin)) ? saved.cat : null) || 'ginger',
    mindHint: !!saved?.mindHint,                           // has been told once that she has a mind of her own
  };
  const catOpts = (k) => ({ key: baseCat(k), skin: CATS[k].skin ? { url: stamped(`models/skins/${CATS[k].skin}.webp`), lid: CATS[k].lid } : null,
    headScale: CATS[k].head ?? 1, url: stamped(CATS[k].url), furUrl: CATS[k].fur ? stamped(CATS[k].fur) : null, furLayers: params.has('fur') ? Math.max(0, Math.min(16, Number(params.get('fur')) || 0)) : (CATS[k].shells ?? (coarse ? 6 : 10)) });
  let needs;
  if (saved && Number.isFinite(saved.hunger) && Number.isFinite(saved.happy)) {
    const away = Math.max(0, Math.min(3600, (Date.now() - (Number(saved.at) || Date.now())) / 1000));
    needs = { hunger: Math.min(1, saved.hunger + away / 240), happy: Math.max(0, saved.happy - away / 900) };
  }
  // her mind (Day 3): who she is and what she has learned are hers for good, kept with the rest on this device.
  // ?mind=0 switches it off (she does as she is told, as on Day 2); ?mind=<number> gives one particular cat.
  const mindParam = params.get('mind');
  // A recording whose demo has a mind (demo.js `mind`) gets the same fresh cat every time it starts over.
  const filmMind = kd?.mind ? () => { const m = createMind({ seed: kd.mind.seed }); if (kd.mind.sleepy != null) m.sleepy = kd.mind.sleepy; return m; } : null;
  const mind = live && mindParam !== '0'
    ? createMind(mindParam ? { seed: Number(mindParam) >>> 0 } : { seed: (Math.random() * 2 ** 32) >>> 0, saved: saved?.mind })
    : filmMind;
  const herMind = () => kitty?.brain.mind || null;        // the mind she has right now
  const filmFeel = params.get('feel') === '1' && !!filmMind;   // filming: show her emoji and her thought
  let clockMs = 0;                                        // recordings: the film's own clock
  const nowMs = () => (demo ? clockMs : performance.now());
  try {
    const [{ createKitty }, { createKittyAudio }] = await kittyMods;
    const ground = Math.sin(home.pol) * home.dist;
    const first = { scene: world.scene, renderer, toysUrl: stamped('models/toys.glb'),
      start: kd ? kd.start(home) : { x: 0, z: 0, heading: home.az, mode: 'sit' },
      script: kd ? kd.script : null,
      viewer: kd ? kd.viewer(home) : [Math.sin(home.az) * ground, Math.cos(home.az) * ground],
      needs: kd ? kd.needs : needs, mind };
    kitty = await createKitty({ ...first, ...catOpts(care.cat) }).catch((err) => {
      if (care.cat === 'ginger') throw err;             // her chosen cat did not load: the ginger kitty instead
      console.warn('Glikdev: that cat did not load, back to the ginger kitty', err);
      care.cat = 'ginger';
      return createKitty({ ...first, ...catOpts('ginger') });
    });
    const focus = new THREE.Vector3();
    // the sun's shadows follow her, or the middle between her and you
    world.setShadowFocus(() => (player ? focus.set((player.x + kitty.brain.x) / 2, 0, (player.z + kitty.brain.z) / 2) : kitty.focus(focus)), 22);
    const fishAt = new THREE.Vector3();
    world.setCineSubjects(() => {
      const list = [[kitty.brain.x, 0.32, kitty.brain.z]];
      try {                                              // you and the rod join a few frames after her
        if (player) list.push([player.x, 0.9, player.z]);
        if (friend && fd) list.push([friend.brain.x, 0.3, friend.brain.z]);
        if (wand?.fish?.visible) list.push(wand.fish.getWorldPosition(fishAt).toArray());
        if (atomBox && demo && demo.startsWith('atom')) list.push(...atomBox.subjects());
        if (blast?.dead(kitty.t)) return [blast.ghostAt(kitty.t)];     // you are a ghost: the lens is on it
      } catch { /* not made yet */ }
      return list;
    });
    if (live) {
      audio = createKittyAudio({ url: stamped });
      audio.setMuted(care.muted);
      const head = new THREE.Vector3();
      kitty.on((e) => {
        const d = camera.position.distanceTo(kitty.headPosition(head));
        head.project(camera);                              // where she is on screen: her sounds sit there, left to right
        audio.event(e, Math.max(0, Math.min(1, (70 - d) / 50)), head.z < 1 ? Math.max(-1, Math.min(1, head.x)) * 0.7 : 0);
      });
      // every button, chip and card gives a small tick
      addEventListener('click', (ev) => { if (ev.target?.closest?.('button, a.chip, .daylog-play')) audio.event({ type: 'click' }); }, true);
      // Day 6: the windows (the Day log, naming her, choosing the cat) open and close with a soft sound of their own
      for (const id of ['daylog', 'namer', 'catpick']) {
        const d = $(id);
        new MutationObserver(() => audio.event({ type: d.open ? 'ui-open' : 'ui-close' })).observe(d, { attributes: true, attributeFilter: ['open'] });
      }
    }
  } catch (err) { console.warn('Glikdev: the kitty did not load', err); kitty = null; }

  // ------------------------------------------------------------ the shop and you (Day 3: the owner's ideas)
  let player = null, store = null, town = null, bedThing = null, PLAYER_EYE = 4;
  let friend = null;                                       // Day 6: her friend (friend.js); made once the player is in
  const pd = kd ? kd.player : null;                        // a recording shows the player only when its demo says so
  try { town = await import('./town.js'); } catch (err) { console.warn('Glikdev: the shop did not load', err); }
  const building = town ? town.createShop({ scene: world.scene, url: stamped('models/shop.glb'), renderer })
    .then((s) => { store = s; }).catch((err) => { console.warn('Glikdev: the shop did not load', err); town = null; }) : null;
  // her bed (Day 3): once it stands there she is told where it is (she sleeps on it, and steps up onto its cushion)
  const bedding = town && kitty ? town.createBed({ scene: world.scene, url: stamped('models/bed.glb'), renderer })
    .then((b) => { bedThing = b; kitty.setBed(town.BED_SPOT); }).catch((err) => { console.warn('Glikdev: her bed did not load', err); }) : null;
  // Day 5 (idea by @elenaabrosimova1968; the owner's rule for getting them): atom bombs fall at you; dodge one and
  // it leaves an atom box where it landed; tap the box for an atom token. `atomBox` is the whole field of them.
  let atomMod = null, atomBox = null, atomFX = null, wantBox = -1, atomDue = [], nextDrop = null, dropped = 0, bonkAt = null;
  // ...and the one that lands on you: you are gone, the whole world blows up, and then it is back (blast.js)
  let blast = null;
  const boxing = kitty ? (async () => {
    try {
      atomMod = await import('./atombox.js');
      const [box, { createTokenFX }] = await Promise.all([
        atomMod.createAtomField({ scene: world.scene, url: stamped('models/atombox.glb'), bombUrl: stamped('models/atombomb.glb'), renderer }), import('./outfits.js')]);
      atomFX = createTokenFX({ scene: world.scene, camera, token: box.token });
      atomBox = box;
      const { createBlast } = await import('./blast.js');
      blast = createBlast({ scene: world.scene, renderer, ghostUrl: stamped('models/player_ghost.glb'), cover: $('boom'), word: $('boom-word') });
    } catch (err) { console.warn('Glikdev: the atom bombs and boxes did not load', err); atomBox = null; }
  })() : null;
  if (!live) await boxing;
  if (!live) await building;                               // recordings: it is there from the first frame
  if (!live) await bedding;
  if (kitty && (live || pd)) {
    try {
      const { createPlayer, PLAYER } = await import('./player.js');
      PLAYER_EYE = PLAYER.eye;
      player = await createPlayer({ scene: world.scene, url: stamped('models/player.glb'),
        start: pd ? pd.start : (params.get('view') === 'first' ? { x: 6, z: 17.5, heading: Math.atan2(-6, -17.5) } : { x: 7.5, z: 7, heading: home.az }),
        boxes: town ? [town.SHOP_BOX] : [],
        circles: [() => ({ x: kitty.brain.x, z: kitty.brain.z, r: 2.8 }), ...(town ? [() => town.BED_CIRCLE] : []),
          () => (friend ? friend.circle() : { x: 0, z: 0, r: 0 }),
          ...[0, 1, 2].map((i) => () => (atomBox ? atomBox.circle(i) : { x: 0, z: 0, r: 0 }))],
        script: pd ? pd.script || [] : null,
        onStep: (running) => { audio?.event({ type: 'footstep', strong: running }); if (running && kitty) fx?.dust(kitty.t, player.x, player.z, 0.42, 3, player.heading + Math.PI); } });
      rig.moveKeys = false;
      rig.canPan = false;                                  // the camera is yours: it cannot wander off
      if (live && params.get('view') === 'first') {
        // first person (tried on Day 3; kept behind ?view=first): the camera is your eyes, your body is hidden
        firstPerson = true;
        player.setBodyVisible(false);
        rig.minHeight = -1e6;                              // (no orbit to keep above the ground)
        rig.minPolar = 0.95; rig.maxPolar = 2.0;
        const az0 = Math.atan2(player.x - kitty.brain.x, player.z - kitty.brain.z);   // facing your kitty
        rig.setPose({ az: az0, pol: Math.PI / 2 + 0.03, dist: 30 });
        layout();
      } else {
        // third person (the owner's final choice): locked on you. Drag turns it round you, pinch or scroll zooms.
        camZoom = 0.8;                                     // a little closer than the wide Day 2 view
        rig.target[0] = player.x; rig.target[2] = player.z;
        rig.setLimits(12, 64);
        rig.setPose({ az: home.az, pol: home.pol, dist: home.dist * camZoom });
      }
    } catch (err) { console.warn('Glikdev: the player did not load', err); player = null; }
  }
  // ------------------------------------------------------------ the fish on a stick (Day 4, idea by @Darkbacon155)
  // You hold the stick (player.js); the fish on its line is her toy (kittybrain.js); wand.js draws the fish and the line.
  let wand = null, wandOn = false;
  const wanding = kitty && player ? (async () => {
    try {
      const { createWand } = await import('./wand.js');
      wand = await createWand({ scene: world.scene, url: stamped('models/wand.glb'), renderer });
      player.giveRod(wand.rod);
    } catch (err) { console.warn('Glikdev: the fish on a stick did not load', err); wand = null; }
  })() : null;
  // ------------------------------------------------------------ her friend (Day 6, idea by @2warp-e8u)
  // A cream kitten that stays by her side (friendbrain.js decides, friend.js draws). The first time it is seen on
  // this device it comes running in from far away to meet her.
  const FRIEND_FAR = { x: -46, z: -58 };
  const friendMet = !!saved?.friendMet;
  care.friendName = cleanName(saved?.friendName) || 'Mochi';
  const fd = kd ? kd.friend : null;                        // a recording shows the friend when its demo says so
  const friendWorld = () => {
    const b = kitty.brain, h = kitty.headPosition(), y = b.yarn;
    return {
      kitty: { x: b.x, z: b.z, heading: b.heading, head: [h.x, h.y, h.z], mode: b.mode, asleep: b.isAsleep(),
        moving: ['walk', 'trot', 'run'].includes(b.mode) && b.goal !== 'ask',
        playing: !!y && !y.hang && (b.goal === 'yarn' || ['pounce', 'bat'].includes(b.mode) || y.flying > 0 || !!y.air),
        eating: b.mode === 'eat' || b.goal === 'eat', yarn: y ? { x: y.x, z: y.z } : null,
        bowl: b.bowl ? { x: b.bowl.x, z: b.bowl.z, eatenAt: b.bowl.eatenAt } : null },
      player: player ? { x: player.x, z: player.z } : null,
      bed: town && bedThing ? town.BED_SPOT : null,
      keepOut: town ? (x, z) => { const p = town.outOfShop(x, z, 10); return [p.x, p.z]; } : null,
    };
  };
  const friending = kitty && (live || fd) ? (async () => {
    try {
      const { createFriend } = await import('./friend.js');
      const b = kitty.brain;
      const start = fd?.start ? fd.start : !live || friendMet
        ? { x: b.x + Math.cos(b.heading) * 7.5, z: b.z - Math.sin(b.heading) * 7.5, heading: b.heading, mode: 'sit' }
        : { ...FRIEND_FAR, heading: Math.atan2(b.x - FRIEND_FAR.x, b.z - FRIEND_FAR.z), mode: 'idle', timer: 1 };
      friend = await createFriend({ scene: world.scene, url: stamped('models/friend.glb'), infoUrl: stamped('models/friend.json'), renderer,
        start, seed: fd?.seed ?? 11, hello: fd ? !!fd.hello : live && !friendMet, helloDelay: fd ? 0 : 2.5, script: fd?.script || null });
      friend.on(onFriend);
    } catch (err) { console.warn('Glikdev: her friend did not load', err); friend = null; }
  })() : null;
  if (!live) await friending;
  kitty?.on((e) => { if (e.type !== 'reset') friend?.onKitty(e); });
  /** what her friend just did: its sounds, her answer, hearts and tokens */
  let friendPaidAt = -1e9;
  const friendHead = new THREE.Vector3();
  function onFriend(e) {
    if (audio) {
      friend.headPosition(friendHead);
      const d = camera.position.distanceTo(friendHead);
      friendHead.project(camera);
      audio.event(e, Math.max(0, Math.min(1, (70 - d) / 50)), friendHead.z < 1 ? Math.max(-1, Math.min(1, friendHead.x)) * 0.7 : 0);
    }
    if (e.type === 'nuzzle' || e.type === 'boop' || e.type === 'friend-hello') {
      friend.headPosition(friendHead);
      const long = e.type === 'nuzzle';
      kitty.brain.cuddled(friendHead.x, friendHead.y, friendHead.z, long ? 2.8 : 1.6, long);
      if (!long) audio?.event({ type: 'trill', who: 'kitty' }, 0.8);
    }
    if (['pet', 'nuzzle', 'friend-hello'].includes(e.type)) for (let k = 0; k < (e.type === 'nuzzle' ? 2 : 3); k++) audio?.event({ type: 'heart', k, delay: (e.type === 'nuzzle' ? 0.9 : 0.1) + k * 0.24 }, 0.8);
    if (e.type === 'friend-hello') { friend.headPosition(friendHead); fx?.sparkle(kitty.t, friendHead.x, friendHead.y + 1, friendHead.z, 8, 3); }
    if (e.type === 'friend-hello' && live) {
      care.friendMet = true; persist();
      player?.cheer();
      flashHint(`${care.name} has a friend! Meet ${care.friendName} · ${coarse ? 'Tap' : 'Click'} it to pet it`, 8000);
    }
    // petting it: it purrs, and that is worth a friendship token now and then
    if (e.type === 'purr' && e.t - friendPaidAt > 12) {
      friendPaidAt = e.t;
      wallet.earn(1);
      tokenFX?.spawn(kitty.t, friend.headPosition(friendHead), 1);
      audio?.event({ type: 'token', n: 1 });
      repaintShop();
      if (live) saveWallet(wallet);
    }
  }
  /** tell your arm where the fish is (the rod points at it once it is out) */
  const aimRod = () => { const y = kitty.brain.yarn; player.setAim(y?.wand ? [y.x, y.y, y.z] : null, !!y?.wand && !y.hang, !!y?.wand && !!y.dangle); };
  /** recordings: you and the kitty are stepped together, so the line always runs from where your hand really is */
  const syncPlayer = (bt) => { player.simulateTo(bt); if (wandOn) { kitty.setWandTip(player.tip()); aimRod(); } };
  const kittyBusy = () => { const b = kitty.brain; return ['eat', 'pounce', 'bat'].includes(b.mode) || b.goal === 'eat' || b.goal === 'yarn' || !!(b.yarn?.held && !b.yarn.hang); };
  let wantShop = false, shopArmed = true, openShop = () => {}, repaintShop = () => {};
  /** you walk there; she comes along (unless she is busy), to a spot beside where you are going */
  function walkTo(x, z) {
    wantShop = false; wantBox = -1;
    player.goTo(x, z);
    const b = kitty.brain;
    if (kittyBusy() || Math.hypot(x - b.x, z - b.z) < 13) return;
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz) || 1;
    const spot = { x: x - (dz / d) * 5.5 - (dx / d) * 2, z: z + (dx / d) * 5.5 - (dz / d) * 2 };
    const p = town ? town.outOfShop(spot.x, spot.z) : spot;
    kitty.call(p.x, p.z, { quiet: true });               // she may come along, or not: it is up to her
  }
  /** Day 6: you tapped a cat that is close by: you crouch and stroke it */
  function petNear(x, z) { if (player && Math.hypot(player.x - x, player.z - z) < 12) player.petAt(x, z); }
  /** atom box number i opens (at t on the kitty's clock): its token leaves it a moment later */
  function openBox(i, t = kitty.t) {
    if (!atomBox || !atomBox.open(i, t)) return;
    atomDue.push({ t: t + atomMod.TIMING.tokenAt, i });
    const B = atomBox.box(i); if (B) fx?.sparkle(t + 0.2, B.x, 3.2, B.z, 7, 2.6);
    audio?.unlock();
    audio?.event({ type: 'box-open' });
  }
  /** you tapped atom box i: walk up to it first, then it opens */
  function tapBox(i) {
    const B = atomBox?.box(i);
    if (!B) return;
    if (!player) { openBox(i); return; }
    const dx = player.x - B.x, dz = player.z - B.z, d = Math.hypot(dx, dz) || 1;
    if (d < atomMod.NEAR) { wantBox = -1; player.faceTo(B.x, B.z); openBox(i); return; }
    wantShop = false;
    player.goTo(B.x + (dx / d) * atomMod.STAND, B.z + (dz / d) * atomMod.STAND);      // the near side of it
    wantBox = i;
    flashHint('Off to the atom box!', 2600);
  }
  /** an atom bomb is let go, aimed at where you stand (never onto the shop, her bed, her, or a box that waits) */
  function dropBomb(t = kitty.t) {
    if (!atomBox || !player || !atomBox.canDrop()) return false;
    const keep = [{ x: kitty.brain.x, z: kitty.brain.z, r: 6 }];
    if (town) keep.push({ x: town.SHOP_BOX.x, z: town.SHOP_BOX.z, r: 15 }, { x: town.BED_CIRCLE.x, z: town.BED_CIRCLE.z, r: town.BED_CIRCLE.r + 4 });
    for (const i of [0, 1, 2]) { const c = atomBox.circle(i); if (c.r) keep.push({ x: c.x, z: c.z, r: 7.5 }); }
    const p = atomMod.landSpot(player.x, player.z, keep);
    if (!atomBox.drop(t, p.x, p.z)) return false;
    dropped++;
    audio?.event({ type: 'bomb-fall', delay: Math.max(0, ATOM_BOX.fall - 1.6) });   // it whistles down (the whistle is 1.6 s long)
    if (live) flashHint(dropped <= 2 ? (coarse ? 'Look out above! An atom bomb: tap the ground to step out of the dark ring' : 'Look out above! An atom bomb: walk out of the dark ring')
      : 'Look out above!', dropped <= 2 ? 5000 : 2200);
    return true;
  }
  /** off to the shop: its doormat; the wardrobe opens when you get there */
  function goShop() {
    if (!player || !town) { openShop(); return; }
    if (town.atShop(player.x, player.z)) { player.faceTo(town.SHOP.x, town.SHOP.z); openShop(); return; }
    player.goTo(town.SHOP_DOOR.x, town.SHOP_DOOR.z);
    wantShop = true; wantBox = -1;
    if (!kittyBusy()) kitty.call(town.SHOP_WAIT.x, town.SHOP_WAIT.z, { quiet: true });
    flashHint('Off to the shop!', 2600);
  }
  // ------------------------------------------------------------ friendship tokens and her wardrobe (Day 3, idea by @Kowffe)
  // filming: ?have=6 starts the counter at 6, so it keeps counting up from one clip of a Short to the next
  const filmHave = Math.max(0, Math.floor(Number(params.get('have')) || 0));
  // (Day 4's fish on a stick is bought in the shop like any toy; recordings get it from their script)
  const freshWallet = () => createWallet(live ? loadWallet() : { ...(kd?.wallet ?? {}), ...(filmHave ? { tokens: filmHave } : {}) });
  let wallet = freshWallet(), wardrobe = null, tokenFX = null, rewardState = {}, filmWear = { ...paramWear };
  let pendingLoss = 0;                                     // tokens just lost, not yet shown under the counter
  let flashHint = () => {};
  const tokenHead = new THREE.Vector3();
  const tokensEl = $('tokens'), tokensCount = $('tokens-count'), tokensIcon = $('tokens-icon');
  const showTokens = !!kitty && (filmTokens || (showUI && !demo && !short));
  /** the toy that is out takes the yarn's place in her game */
  function applyToy() {
    if (!kitty) return;
    const it = itemById({ ...wallet.wearing, ...filmWear }.toy);
    const useWand = !!(it?.wand && wand && player);      // the fish on a stick: in your hand, not on the floor
    if (useWand) kitty.setToy(wand.stub, it);
    else if (wardrobe) { const toy = it && !it.wand ? it : null; kitty.setToy(toy ? wardrobe.part(toy.id) : null, toy || {}); }
    if (useWand === wandOn) return;
    wandOn = useWand;
    player.setWand(wandOn);
    if (wandOn) kitty.setWandTip(player.tip());
    kitty.setWand(wandOn);
    wand.setOn(wandOn);
    if (wandOn) aimRod();
    onWand(wandOn);
  }
  let onWand = () => {};
  const toyOut = () => itemById({ ...wallet.wearing, ...filmWear }.toy);
  if (kitty) {
    kitty.on((e) => {
      if (e.type === 'reset') {                            // a recording starting over
        wallet = freshWallet(); rewardState = {}; filmWear = { ...paramWear };
        tokenFX?.reset();
        atomBox?.reset(); atomFX?.reset(); atomDue = []; nextDrop = null; dropped = 0; bonkAt = null;
        fx?.reset();
        blast?.reset();
        wand?.event(e, null);
        wardrobe?.dress({ ...wallet.wearing, ...filmWear });
        applyToy();
        return;
      }
      if ((e.type === 'thud' || e.type === 'swat') && toyOut()?.jingle) audio?.event({ type: 'jingle' });
      if (e.type === 'pet' || e.type === 'eaten') for (let k = 0; k < 3; k++) audio?.event({ type: 'heart', k, delay: 0.1 + k * 0.22 });   // her hearts float up
      if (e.type === 'land') { const b = kitty.brain; fx?.dust(e.t, b.x + Math.sin(b.heading) * 2.2, b.z + Math.cos(b.heading) * 2.2, 1.1, 7); audio?.event({ type: 'dust' }); }
      if (e.type === 'cast') { player?.cast(e.x, e.z); audio?.event({ type: 'toss', speed: e.speed }); }   // your arm flicks the rod
      if (e.type === 'dangle') audio?.event({ type: 'jingle' });
      if (e.type === 'reeled') audio?.event({ type: 'click' });
      wand?.event(e, kitty.brain.yarn);                    // stars, rings, squash: the fish's own little effects
      if (e.type === 'swat' && toyOut()?.id === 'toymouse') audio?.event({ type: 'squeak' });
      // filming: an atom bomb falls on a given spot; the box it left is tapped
      if (e.type === 'script' && e.what.type === 'bomb') { atomBox?.drop(e.t, e.what.x, e.what.z, e.what.rot ?? null); audio?.event({ type: 'bomb-fall', delay: Math.max(0, ATOM_BOX.fall - 1.6) }); return; }
      if (e.type === 'script' && e.what.type === 'atom') {
        // (a recording may jump straight to a later frame: the bomb before it has to have landed first)
        atomBox?.update(e.t, player ? { x: player.x, z: player.z } : null);
        const i = atomBox ? atomBox.firstReady() : -1;
        if (i >= 0) openBox(i, e.t);
        return;
      }
      if (e.type === 'script' && e.what.type === 'wear') { // filming: straight onto her, no shopping
        const it = itemById(e.what.id);
        const slot = it ? it.slot : e.what.slot;
        if (slot) { filmWear[slot] = it ? it.id : null; wardrobe?.dress({ ...wallet.wearing, ...filmWear }, e.t); applyToy(); }
        return;
      }
      // she is cross, angry, furious or sad with you: that costs tokens
      const lost = wallet.lose(penaltyFor(e, rewardState));
      if (lost > 0) {
        pendingLoss += lost;
        audio?.event({ type: 'lose' });
        repaintShop();
        if (live) {
          saveWallet(wallet);
          const how = { grumpy: 'is a bit cross with you', angry: 'is angry with you', furious: 'is furious with you', sad: 'is sad' }[e.id];
          flashHint(`${care.name} ${how}: you lost ${lost} token${lost === 1 ? '' : 's'}. ${e.id === 'sad' ? 'Pet her or play with her' : 'Feed her, or give her time'}`, 7000);
        }
        return;
      }
      if (e.pal) return;                                   // (her friend made her purr, not you: no token)
      const n = rewardFor(e, rewardState);
      if (n <= 0) return;
      const first = wallet.earned === 0, could = wallet.canBuy(NEW_ITEM);
      wallet.earn(n);
      tokenFX?.spawn(e.t, kitty.headPosition(tokenHead), n);
      fx?.sparkle(e.t, tokenHead.x, tokenHead.y + 0.6, tokenHead.z, 3 + n, 1.6);
      audio?.event({ type: 'token', n });
      repaintShop();                                       // a token landing while the shop is open: its prices keep up
      if (live) {
        saveWallet(wallet);
        if (first) flashHint(coarse ? 'A friendship token! Tap the coin to dress her up' : 'A friendship token! Click the coin to dress her up', 7000);
        // the token that makes the day's new thing affordable: say so, once
        else if (!could && wallet.canBuy(NEW_ITEM) && player) flashHint(`You can buy the ${itemById(NEW_ITEM).name.toLowerCase()} now! ${coarse ? 'Tap' : 'Click'} the coin to go to the shop`, 8000);
      }
    });
    const dressing = (async () => {
      try {
        const { createWardrobe, createTokenFX } = await import('./outfits.js');
        wardrobe = await createWardrobe({ kitty, glbUrl: stamped('models/outfits.glb'), fitUrl: stamped('models/outfits_fit.json'), cat: baseCat(care.cat), renderer });
        tokenFX = createTokenFX({ scene: world.scene, camera, token: wardrobe.token });
        wardrobe.dress({ ...wallet.wearing, ...filmWear });
        applyToy();
      } catch (err) { console.warn('Glikdev: the wardrobe did not load', err); wardrobe = null; tokenFX = null; }
    })();
    if (!live) await dressing;                             // recordings: every frame has it; live play does not wait for it
    if (wanding) { if (live) wanding.then(applyToy); else { await wanding; applyToy(); } }
  }
  if (showTokens) {
    tokensEl.hidden = false;
    if (filmTokens && (!showUI || short)) tokensEl.classList.add('is-filmed');
  }
  // Day 5: the atom tokens' own counter (under the friendship tokens); tap it for the fur skins
  const atomsEl = $('atoms'), atomsCount = $('atoms-count'), atomsIcon = $('atoms-icon');
  const filmAtoms = params.get('atoms') === '1';
  const showAtoms = !!kitty && (filmAtoms || (showUI && !demo && !short));
  if (showAtoms) {
    atomsEl.hidden = false;
    if (filmAtoms && (!showUI || short)) atomsEl.classList.add('is-filmed');
  }
  let shownAtoms = null, atomBumpAt = -10, atomRight = -1;
  const atomHud = { x: 0, y: 0 }, atomFrom = new THREE.Vector3();
  function paintAtoms(t) {
    // bombs land (on you, or beside you: then a box is there), boxes come and go
    for (const ev of atomBox ? atomBox.update(t, player ? { x: player.x, z: player.z } : null) : []) {
      audio?.event({ type: 'bomb-land' });
      if (ev.hit) {
        bonkAt = ev.t;
        // it got you: the whole world goes up (the kitty, the shop, her bed, the boxes, the plate itself)
        if (blast && player) {
          blast.start(ev.t, ev.x, ev.z, player.x, player.z, [
            { obj: world.model, plate: true }, { obj: kitty.root, live: true }, { obj: atomBox.group }, friend ? { obj: friend.root, live: true } : null,
            store ? { obj: store.group } : null, bedThing ? { obj: bedThing.group } : null]);
          player.stop();
          wantBox = -1; wantShop = false;
          audio?.event({ type: 'boom' });
          dismissHint();
        } else {
          audio?.event({ type: 'nope' });
          if (live) flashHint('Bonk! It got you, so no box this time. Step out of the dark ring before it lands', 6000);
        }
      } else if (live && ev.box >= 0 && wallet.atoms === 0 && !SKINS.some((k) => wallet.ownsSkin(k.id))) {
        flashHint(coarse ? 'You dodged it! Tap the box it left behind' : 'You dodged it! Click the box it left behind', 7000);
      }
    }
    // hit: you are squashed flat for a moment (then you are gone, and your ghost is up, until the world is back)
    if (player) {
      const a = bonkAt == null ? 9 : t - bonkAt;
      const sq = a >= 0 && a < 1.2 ? 1 - 0.5 * Math.exp(-a * 4.5) * Math.cos(a * 15) : 1;
      player.root.scale.set(1 + (1 - sq) * 0.45, sq, 1 + (1 - sq) * 0.45);
    }
    if (blast) {
      const b = blast.update(t, camera);
      if (player && !firstPerson) player.setBodyVisible(!(b.dead && t - (bonkAt ?? t) > 0.1));
      if (b.reload) {
        nextDrop = t + ATOM_BOX.every;
        if (live) flashHint('Boom! The whole world blew up… and here it is again. Step out of the dark ring next time', 7000);
      }
    }
    // the token leaves the chunk a moment after the lid opens
    while (atomBox && atomDue.length && t >= atomDue[0].t) {
      const due = atomDue.shift();
      const first = wallet.atoms === 0 && !SKINS.some((k) => wallet.ownsSkin(k.id));
      wallet.earnAtoms(ATOM_BOX.gives);
      atomFX?.spawn(due.t, atomBox.tokenFrom(due.i, due.t, atomFrom), 1);
      audio?.event({ type: 'atom' });
      repaintCats();
      if (live) {
        saveWallet(wallet);
        const cheapest = SKINS.find((k) => !wallet.ownsSkin(k.id));
        if (first) flashHint(coarse ? 'An atom token! They buy new fur for your kitty: tap the atom counter' : 'An atom token! They buy new fur for your kitty: click the atom counter', 8000);
        else if (cheapest && wallet.atoms === cheapest.price) flashHint(`You can buy the ${cheapest.name.toLowerCase()} fur now! ${coarse ? 'Tap' : 'Click'} the atom counter`, 8000);
      }
    }
    let hud = null;
    if (showAtoms) {
      const r = atomsIcon.getBoundingClientRect();
      if (r.width) { atomHud.x = ((r.left + r.width / 2) / innerWidth) * 2 - 1; atomHud.y = 1 - ((r.top + r.height / 2) / innerHeight) * 2; hud = atomHud; }
    }
    const flying = atomFX ? atomFX.update(t, hud) : 0;
    if (!showAtoms) return;
    const n = Math.max(0, wallet.atoms - flying);
    if (n !== shownAtoms) {
      if (shownAtoms !== null && n > shownAtoms) atomBumpAt = t;
      shownAtoms = n;
      atomsCount.textContent = String(n);
      atomsEl.setAttribute('aria-label', `Atom tokens: ${n}. See the fur skins`);
    }
    // beside the friendship tokens, on their left, however wide their number is
    if (showTokens && !atomsEl.classList.contains('is-filmed')) {
      const r = Math.round(innerWidth - tokensEl.getBoundingClientRect().left + 8);
      if (r !== atomRight && r > 0) { atomRight = r; atomsEl.style.right = `${r}px`; }
    }
    const a = (t - atomBumpAt) / 0.32;
    atomsIcon.style.transform = a >= 0 && a < 1 ? `scale(${(1 + 0.34 * Math.sin(a * Math.PI)).toFixed(3)})` : '';
  }
  let repaintCats = () => {};
  // the counter: shows what has landed (tokens still in the air are not counted yet) and bumps as each one lands
  let shownTokens = null, bumpAt = -10, lossAt = -10;
  const lossEl = $('tokens-loss');
  const hudPoint = { x: 0, y: 0 };
  function paintTokens(t) {
    let hud = null;
    if (showTokens) {
      const r = tokensIcon.getBoundingClientRect();
      if (r.width) { hudPoint.x = ((r.left + r.width / 2) / innerWidth) * 2 - 1; hudPoint.y = 1 - ((r.top + r.height / 2) / innerHeight) * 2; hud = hudPoint; }
    }
    const flying = tokenFX ? tokenFX.update(t, hud) : 0;
    if (!showTokens) return;
    const n = Math.max(0, wallet.tokens - flying);
    if (n !== shownTokens) {
      if (shownTokens !== null && n > shownTokens) bumpAt = t;
      shownTokens = n;
      tokensCount.textContent = String(n);
      tokensEl.setAttribute('aria-label', `Friendship tokens: ${n}. Go to the shop`);
    }
    const a = (t - bumpAt) / 0.32;
    tokensIcon.style.transform = a >= 0 && a < 1 ? `scale(${(1 + 0.34 * Math.sin(a * Math.PI)).toFixed(3)})` : '';
    // tokens lost: a red "−2" drops out from under the counter and fades (worked out from the clock, so recordings match)
    if (pendingLoss) { lossEl.textContent = `\u2212${pendingLoss}`; pendingLoss = 0; lossAt = t; }
    const l = (t - lossAt) / 1.6;
    const losing = l >= 0 && l < 1;
    if (losing !== !lossEl.hidden) { lossEl.hidden = !losing; tokensEl.classList.toggle('is-losing', losing); }
    if (losing) {
      const pop = Math.min(1, l / 0.12);
      lossEl.style.opacity = (l < 0.7 ? 1 : 1 - (l - 0.7) / 0.3).toFixed(3);
      lossEl.style.transform = `translateY(${(l * 16).toFixed(1)}px) scale(${(0.6 + 0.4 * pop + 0.18 * Math.sin(pop * Math.PI)).toFixed(3)})`;
    }
  }

  const kittyState = () => {
    const b = kitty.brain, h = kitty.headPosition();
    return { x: b.x, z: b.z, heading: b.heading, head: [h.x, h.y, h.z],
      bowl: b.bowl ? { x: b.bowl.x, z: b.bowl.z } : null, yarn: b.yarn ? { x: b.yarn.x, y: b.yarn.y, z: b.yarn.z } : null,
      player: player ? { x: player.x, z: player.z } : null,
      friend: friend ? (() => { const h = friend.headPosition(); return { x: friend.brain.x, z: friend.brain.z, heading: friend.brain.heading, head: [h.x, h.y, h.z], mode: friend.brain.mode }; })() : null };
  };

  // taps: on the kitty = pet her; on the ground = call her there (a drag or a pinch is not a tap)
  const taps = new Map();
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function rayAt(cx, cy) {
    camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, 1 - (cy / innerHeight) * 2), camera);
    return ray.ray;
  }
  // the yarn: press on it and drag to carry it (it lifts off the floor), let go while moving to throw it
  let carry = null, thrownOnce = false;
  const holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function carryPoint(cx, cy) {
    holdPlane.constant = -kitty.yarnHoldHeight;            // the plane the carried yarn's centre moves in
    const p = rayAt(cx, cy).intersectPlane(holdPlane, hit);
    if (!p) return null;
    const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    if (d > 260) return null;                              // the pointer is up near the horizon: ignore it
    return { x: p.x, z: p.z };
  }
  if (kitty && !demo) {
    // capture phase: this runs before the camera's own drag, so grabbing the yarn never turns the view
    canvas.addEventListener('pointerdown', (e) => {
      if (carry || e.button > 0) return;
      if (kitty.pick(rayAt(e.clientX, e.clientY)) !== 'yarn') return;
      carry = { id: e.pointerId, x: e.clientX, y: e.clientY, live: false, samples: [] };
      rig.enabled = false;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* gone already */ }
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      if (!carry || e.pointerId !== carry.id) return;
      if (!carry.live) {
        if (Math.hypot(e.clientX - carry.x, e.clientY - carry.y) < 6) return;
        if (!kitty.grabYarn()) { carry = null; rig.enabled = true; return; }
        carry.live = true;
        canvas.style.cursor = 'grabbing';
        audio?.unlock();
        dismissHint();
      }
      const p = carryPoint(e.clientX, e.clientY);
      if (!p) return;
      kitty.holdYarn(p.x, p.z);
      const now = e.timeStamp || performance.now();
      carry.samples.push({ t: now, x: p.x, z: p.z });
      while (carry.samples.length > 2 && now - carry.samples[0].t > 110) carry.samples.shift();
    });
    const letGo = (e) => {
      if (!carry || e.pointerId !== carry.id) return;
      const c = carry;
      carry = null;
      rig.enabled = true;
      canvas.style.cursor = '';
      if (!c.live) return;                                 // just a tap on it: the tap handler below plays
      // the throw: how fast the hand was moving over the last ~0.1 s
      let vx = 0, vz = 0;
      const s = c.samples, now = e.timeStamp || performance.now();
      if (s.length >= 2 && now - s[s.length - 1].t < 90) {
        const a = s[0], b = s[s.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
        vx = (b.x - a.x) / dt; vz = (b.z - a.z) / dt;
      }
      const sp = Math.hypot(vx, vz);
      // a flick on screen is fast on the ground: tone it down; a lob, higher when harder; a slow let-go just drops it
      const k = 0.6, f = Math.min(sp * k, 36);
      kitty.throwYarn(vx * k, vz * k, f < 2 ? 0 : 3 + f * 0.3);
      thrownOnce = true;
      hideYarnHint();
    };
    canvas.addEventListener('pointerup', letGo);
    canvas.addEventListener('pointercancel', letGo);
    canvas.addEventListener('lostpointercapture', letGo);
    canvas.addEventListener('pointerdown', (e) => {
      taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), multi: taps.size > 0 || e.button > 0 || e.shiftKey });
      if (taps.size > 1) for (const v of taps.values()) v.multi = true;
      audio?.unlock();
    });
    const end = (e) => {
      const d = taps.get(e.pointerId);
      taps.delete(e.pointerId);
      if (blast?.dead(kitty.t)) return;                    // you are a ghost just now
      if (e.type !== 'pointerup' || !d || d.multi || taps.size) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 450) return;
      const r = rayAt(e.clientX, e.clientY);
      const what = kitty.pick(r);
      if (what === 'kitty') { kitty.pet(); petNear(kitty.brain.x, kitty.brain.z); dismissHint(); return; }
      if (friend?.pick(r)) { petNear(friend.brain.x, friend.brain.z); friend.pet(player ? { x: player.x, z: player.z } : { x: camera.position.x, z: camera.position.z }); dismissHint(); return; }
      if (what === 'yarn') { kitty.play(); dismissHint(); return; }
      const bi = atomBox ? atomBox.pick(r) : -1;
      if (bi >= 0) { tapBox(bi); dismissHint(); return; }
      if (store && store.pick(r)) { goShop(); dismissHint(); return; }
      if (r.intersectPlane(groundPlane, hit) && Math.abs(hit.x) < PLATE.half - 4 && Math.abs(hit.z) < PLATE.half - 4) {
        if (player) { backToHer(); walkTo(hit.x, hit.z); }
        else { const p = town ? town.outOfShop(hit.x, hit.z) : hit; kitty.call(p.x, p.z); }
        dismissHint();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    if (!coarse) {
      canvas.addEventListener('pointermove', (e) => {
        if (e.buttons || carry) return;
        const r = rayAt(e.clientX, e.clientY);
        const what = kitty.pick(r);
        canvas.style.cursor = what === 'yarn' ? 'grab' : what || friend?.pick(r) || (atomBox && atomBox.pick(r) >= 0) || (store && store.pick(r)) ? 'pointer' : '';
      });
    }
  }

  // ------------------------------------------------------------ looking after her: buttons, name tag, rename
  const ftag = $('ftag'), ftagName = $('ftag-name'), ftagFace = $('ftag-face');
  const tag = $('nametag'), tagName = $('nametag-name'), tagHearts = $('nametag-hearts'), tagSr = $('nametag-sr');
  // the free camera: once you move it yourself, this brings it back to her (and so does C, or Pet / Feed / Play)
  const followBtn = $('follow'), followName = $('follow-name');
  function backToHer() {
    if (follow) return;
    follow = true;
    rig.release();
    followBtn.hidden = true;
  }
  onFree = () => {
    if (!kitty || demo || short || !showUI) return;
    followName.textContent = player ? 'you' : care.name;
    followBtn.hidden = false;
    dismissHint();
  };
  followBtn.addEventListener('click', () => { backToHer(); canvas.focus?.(); });
  // WASD and the arrow keys walk you (as seen from the camera)
  const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const held = new Set();
  let steering = false;
  if (player && live) {
    addEventListener('keydown', (e) => {
      if (!MOVE[e.code] || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.closest?.('dialog, input, textarea, [contenteditable]')) return;
      e.preventDefault();
      held.add(e.code);
      wantShop = false; wantBox = -1;
      backToHer();
      dismissHint();
    });
    addEventListener('keyup', (e) => held.delete(e.code));
    addEventListener('blur', () => held.clear());
  }
  function steerPlayer() {
    if (!held.size) { if (steering) { steering = false; player.steer(0, 0); } return; }
    let r = 0, f = 0;
    for (const k of held) { r += MOVE[k][0]; f += MOVE[k][1]; }
    const s = Math.sin(rig.az), c = Math.cos(rig.az);       // the camera looks along (-sin az, -cos az); its right is (cos az, -sin az)
    player.steer(c * r - s * f, -s * r - c * f);
    steering = true;
  }
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyC' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target?.closest?.('dialog, input, textarea, [contenteditable]')) return;
    backToHer();
  });
  const careEl = $('care'), hungryBadge = $('care-hungry'), soundBtn = $('care-sound');
  const namer = $('namer'), namerInput = $('namer-input');
  const heartEls = Array.from({ length: 5 }, () => { const i = document.createElement('i'); tagHearts.append(i); return i; });
  let shownHearts = -1, shownHungry = null;
  function showName(n) { tagName.textContent = n; followName.textContent = player ? 'you' : n; }
  function persist() {
    if (!kitty || !live) return;
    const b = kitty.brain;
    saveCare({ name: care.name, muted: care.muted, cat: care.cat, hunger: +b.hunger.toFixed(3), happy: +b.happy.toFixed(3), at: Date.now(),
      friendName: care.friendName, ...(care.friendMet || friendMet ? { friendMet: true } : {}),
      ...(care.mindHint ? { mindHint: true } : {}),
      ...(mind && !mindParam ? { mind: mind.toJSON() } : saved?.mind ? { mind: saved.mind } : {}) });
  }
  if (kitty && (filmTag || (showUI && !demo))) {
    showName(filmTag || care.name);
    if (filmTag) tag.classList.add('is-filmed');
    tag.hidden = false;
  }
  if (kitty && showUI && !demo && !short) {
    careEl.hidden = false;
    root.classList.add('has-care');
    const act = (fn) => () => { audio?.unlock(); backToHer(); fn(); dismissHint(); };
    // Space (or F) casts the fish: to her when she is near, otherwise straight ahead of you
    addEventListener('keydown', (e) => {
      if ((e.code !== 'Space' && e.code !== 'KeyF') || !wandOn || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.closest?.('dialog, input, textarea, button, a, [contenteditable]')) return;
      e.preventDefault();
      audio?.unlock();
      const b = kitty.brain, h = player.heading;
      if (Math.hypot(b.x - player.x, b.z - player.z) < 20) kitty.play();      // to her (or dangled in front of her, when she is close)
      else kitty.cast(player.x + Math.sin(h) * 11, player.z + Math.cos(h) * 11);
      dismissHint();
    });
    $('care-pet').addEventListener('click', act(() => kitty.pet()));
    $('care-feed').addEventListener('click', act(() => kitty.feed()));
    $('care-play').addEventListener('click', act(() => kitty.play()));
    const paintSound = () => {
      soundBtn.setAttribute('aria-pressed', String(!care.muted));
      soundBtn.setAttribute('aria-label', care.muted ? 'Sound off' : 'Sound on');
    };
    paintSound();
    soundBtn.addEventListener('click', () => {
      care.muted = !care.muted;
      audio?.unlock();
      audio?.setMuted(care.muted);
      paintSound();
      persist();
    });
    let naming = 'kitty';                                  // whose name the dialog is changing (Day 6: or her friend's)
    const setNaming = (who) => {
      naming = who;
      $('namer-title').textContent = who === 'friend' ? 'Name her friend' : 'Name your kitty';
      $('namer-label').textContent = who === 'friend' ? 'Its name' : 'Her name';
    };
    ftag.addEventListener('click', () => {
      setNaming('friend');
      namerInput.value = care.friendName === 'Mochi' ? '' : care.friendName;
      namerInput.placeholder = 'Mochi';
      $('mind').hidden = true;
      if (typeof namer.showModal === 'function') namer.showModal(); else namer.setAttribute('open', '');
      namerInput.focus();
    });
    tag.addEventListener('click', () => {
      setNaming('kitty');
      namerInput.value = care.name === 'Kitty' ? '' : care.name;
      namerInput.placeholder = 'Kitty';
      showMind();
      if (typeof namer.showModal === 'function') namer.showModal(); else namer.setAttribute('open', '');
      namerInput.focus();
    });
    $('namer-cancel').addEventListener('click', () => namer.close());
    $('namer-form').addEventListener('submit', () => {
      if (naming === 'friend') {
        care.friendName = cleanName(namerInput.value) || 'Mochi';
        ftagName.textContent = care.friendName;
        persist();
        friend?.pet(player ? { x: player.x, z: player.z } : null);   // it likes its new name
        audio?.event({ type: 'sparkle' });
        return;
      }
      care.name = cleanName(namerInput.value) || 'Kitty';
      showName(care.name);
      persist();
      kitty.pet({ sure: true });                          // she likes her new name
      $('thought-who').textContent = `${care.name}: `;
    });
    namer.addEventListener('click', (e) => { if (e.target === namer) namer.close(); });
    namer.addEventListener('close', () => (naming === 'friend' ? ftag : tag).focus());

    // choosing the cat: the new one loads, then takes her place (same name, needs and spot)
    const picker = $('catpick'), catsEl = $('cats'), catStatus = $('cat-status'), catBtn = $('care-cat');
    const cards = Object.entries(CATS).map(([k, c]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-card';
      b.dataset.cat = k;
      const img = document.createElement('img');
      img.src = stamped(THUMB[k]); img.alt = ''; img.width = 480; img.height = 400; img.decoding = 'async';
      const name = document.createElement('span');
      name.textContent = c.label;
      b.append(img, name);
      if (c.skin) {                                        // a fur skin: its price in atom tokens, until it is hers
        const price = document.createElement('span');
        price.className = 'cat-price';
        const coin = document.createElement('img');
        coin.src = stamped('models/shop/atomtoken.webp'); coin.alt = ''; coin.width = 22; coin.height = 22;
        const n = document.createElement('b');
        n.textContent = String(skinById(c.skin).price);
        price.append(coin, n);
        b.append(price);
      }
      catsEl.append(b);
      return b;
    });
    const hasCat = (k) => !CATS[k].skin || wallet.ownsSkin(CATS[k].skin);
    const paintCats = () => cards.forEach((b) => {
      const k = b.dataset.cat, c = CATS[k];
      b.setAttribute('aria-pressed', String(k === care.cat));
      if (!c.skin) return;
      const price = skinById(c.skin).price, mine = hasCat(k);
      b.dataset.state = mine ? 'owned' : wallet.canBuySkin(c.skin) ? 'buy' : 'dear';
      b.setAttribute('aria-label', mine ? `${c.label} fur: hers` : `${c.label} fur: ${price} atom tokens${wallet.canBuySkin(c.skin) ? '. Buy it' : ', not enough yet'}`);
    });
    paintCats();
    repaintCats = paintCats;
    atomsEl.addEventListener('click', () => { audio?.unlock(); catBtn.click(); });
    let switching = false;
    catBtn.addEventListener('click', () => {
      catStatus.textContent = '';
      if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
      (cards.find((b) => b.dataset.cat === care.cat) || cards[0]).focus();
    });
    catsEl.addEventListener('click', async (e) => {
      const card = e.target.closest('.cat-card');
      if (!card || switching) return;
      const k = card.dataset.cat;
      if (k === care.cat) { picker.close(); return; }
      if (!hasCat(k)) {                                    // a fur skin she does not have yet: buy it with atom tokens
        const sk = skinById(CATS[k].skin);
        if (!wallet.buySkin(sk.id)) {
          audio?.event({ type: 'nope' });
          const need = sk.price - wallet.atoms;
          catStatus.textContent = `${need} more atom token${need === 1 ? '' : 's'} for the ${sk.name.toLowerCase()} fur. Dodge an atom bomb, then tap the box it leaves.`;
          return;
        }
        saveWallet(wallet);
        audio?.unlock();
        audio?.event({ type: 'buy' });
        paintCats();
      }
      switching = true;
      card.classList.add('is-loading');
      catsEl.setAttribute('aria-busy', 'true');
      catStatus.textContent = `Bringing the ${CATS[k].label.toLowerCase()} cat…`;
      try {
        await kitty.setCat(catOpts(k));
        care.cat = k;
        paintCats();
        persist();
        catStatus.textContent = '';
        picker.close();
        kitty.pet({ sure: true });                        // hello, new cat
      } catch (err) {
        console.warn('Glikdev: that cat did not load', err);
        catStatus.textContent = 'That cat didn’t load. Check your connection and try again.';
      } finally {
        switching = false;
        card.classList.remove('is-loading');
        catsEl.removeAttribute('aria-busy');
      }
    });
    $('catpick-close').addEventListener('click', () => picker.close());
    picker.addEventListener('click', (e) => { if (e.target === picker) picker.close(); });
    picker.addEventListener('close', () => catBtn.focus());
    // ---------------------------------------------------------- the wardrobe: spend tokens, dress her (Day 3)
    const shop = $('shop'), shopGrid = $('shop-grid'), shopToys = $('shop-toys'), shopItems = $('shop-items'), shopStatus = $('shop-status'), shopHave = $('shop-have');
    const shopCards = ITEMS.map((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shop-card';
      b.dataset.item = it.id;
      const img = document.createElement('img');
      img.src = stamped(`models/shop/${it.id}.webp`); img.alt = ''; img.width = 320; img.height = 320; img.decoding = 'async'; img.loading = 'lazy';
      const name = document.createElement('span');
      name.className = 'shop-name';
      name.textContent = it.name;
      const tag = document.createElement('span');
      tag.className = 'shop-tag';
      b.append(img, name, tag);
      if (it.id === NEW_ITEM) { b.dataset.new = '1'; shopToys.prepend(b); }   // the day's new thing: first among the toys
      else (it.slot === 'toy' ? shopToys : shopGrid).append(b);
      return { it, b, tag };
    });
    let shownNew = false;
    const paintShop = () => {
      shopHave.textContent = String(wallet.tokens);
      for (const { it, b, tag } of shopCards) {
        const owned = wallet.owns(it.id), on = wallet.isWearing(it.id);
        b.dataset.state = on ? 'on' : owned ? 'owned' : wallet.canBuy(it.id) ? 'buy' : 'dear';
        b.setAttribute('aria-pressed', String(on));
        const isToy = it.slot === 'toy';
        tag.textContent = on ? (isToy ? 'Put away' : 'Take off') : owned ? (isToy ? 'Use' : 'Wear') : String(it.price);
        b.setAttribute('aria-label', on ? (isToy ? `${it.name}: it is out. Put it away` : `${it.name}: she is wearing it. Take it off`)
          : owned ? (isToy ? `${it.name}: hers. Play with it` : `${it.name}: hers. Put it on`)
            : `${it.name}: ${it.price} tokens${wallet.canBuy(it.id) ? '. Buy it' : ', not enough yet'}`);
      }
    };
    repaintShop = () => { if (shop.open) paintShop(); };
    const dressNow = (sound) => {
      saveWallet(wallet);
      for (const k of Object.keys(filmWear)) delete filmWear[k];   // what she chose in the shop wins over ?wear=
      wardrobe?.dress(wallet.wearing, kitty.t);
      applyToy();
      audio?.unlock();
      audio?.event({ type: sound });
      kitty.headPosition(fxHead); fx?.sparkle(kitty.t, fxHead.x, fxHead.y, fxHead.z, 9, 3.2); audio?.event({ type: 'sparkle' });
      if (sound === 'buy') setTimeout(() => player?.cheer(), 350);   // you jump for joy
      paintShop();
      shop.close();
      backToHer();
    };
    openShop = () => {
      if (shop.open) return;
      shopStatus.textContent = '';
      paintShop();
      if (typeof shop.showModal === 'function') shop.showModal(); else shop.setAttribute('open', '');
      audio?.unlock();
      audio?.event({ type: 'shop-open' });
      dismissHint();
      if (!shownNew && !wallet.owns(NEW_ITEM)) {             // the first look inside: the new thing is in view
        shownNew = true;
        shopCards.find((c) => c.it.id === NEW_ITEM)?.b.scrollIntoView({ block: 'nearest' });
      }
    };
    tokensEl.addEventListener('click', () => { audio?.unlock(); goShop(); });
    shopItems.addEventListener('click', (e) => {
      const card = e.target.closest('.shop-card');
      if (!card) return;
      const it = itemById(card.dataset.item);
      if (wallet.isWearing(it.id)) { wallet.takeOff(it.slot); dressNow('wear'); return; }
      if (wallet.owns(it.id)) { wallet.wear(it.id); dressNow('wear'); if (it.slot === 'toy') setTimeout(() => kitty.play(), 500); return; }
      if (wallet.buy(it.id)) { dressNow('buy'); if (it.slot === 'toy') setTimeout(() => kitty.play(), 500); return; }
      audio?.event({ type: 'nope' });
      const need = it.price - wallet.tokens;
      shopStatus.textContent = `${need} more token${need === 1 ? '' : 's'} for the ${it.name.toLowerCase()}. Pet her, feed her or play with her to earn them.`;
    });
    $('shop-close').addEventListener('click', () => shop.close());
    shop.addEventListener('click', (e) => { if (e.target === shop) shop.close(); });
    shop.addEventListener('close', () => { audio?.event({ type: 'shop-close' }); tokensEl.focus(); canvas.focus?.(); });
    flashHint = (text, ms) => {
      clearTimeout(yarnHintTimer);
      hintEl.textContent = text;
      hintEl.dataset.yarn = '1';
      hintEl.hidden = false;
      hintEl.classList.remove('is-gone');
      yarnHintTimer = setTimeout(hideYarnHint, ms);
    };
    setInterval(persist, 4000);
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  }
  // ------------------------------------------------------------ what is on her mind (Day 3: she has one)
  // A small thought bubble over her name tag: what she wants ("Hungry", "Wants to play"), and for a moment her
  // answer when she turns you down ("Not hungry", "Too sleepy") or gives in ("Oh, all right").
  const thoughtEl = $('thought'), thoughtText = $('thought-text');
  const wantBtn = { cuddle: $('care-pet'), play: $('care-play') };
  let thoughtNow = '', thoughtKind = '', flash = null, thoughtAt = 0, stayedAt = -1e9, askHinted = {};
  function setThought(text, kind) {
    if (text === thoughtNow && kind === thoughtKind) return;
    thoughtNow = text; thoughtKind = kind;
    if (text) thoughtText.textContent = text;
    thoughtEl.classList.toggle('is-no', kind === 'no');
    thoughtEl.classList.toggle('is-want', kind === 'want');
    thoughtEl.classList.toggle('is-out', !text);
  }
  function flashThought(text, kind, seconds = 2.6) {
    if (!text || !mind) return;
    flash = { text, kind, until: nowMs() + seconds * 1000 };
    setThought(text, kind);
  }
  /** her standing thought, a few times a second (a flash sits on top of it until it runs out) */
  function think(now) {
    if (!mind || !kitty || thoughtEl.hidden) return;
    if (flash && now < flash.until) return;
    flash = null;
    if (now - thoughtAt < 250 && thoughtNow) return;
    thoughtAt = now;
    const th = herMind()?.thought(kitty.brain.sense());
    setThought(th ? th.text : '', th ? th.kind || 'want' : '');
  }
  if (mind && kitty) {
    $('thought-who').textContent = `${care.name}: `;
    thoughtEl.classList.add('is-out');
    thoughtEl.hidden = !((showUI && !demo && !short) || filmFeel);
    if (filmFeel) thoughtEl.classList.add('is-filmed');
    kitty.on((e) => {
      if (e.type === 'reset') { flash = null; thoughtAt = 0; emoteUntil = 0; setThought('', ''); return; }   // a recording starting over
      if (e.type === 'decide') {
        if (e.quiet) {                                      // she was only expected to tag along
          if (!e.yes && e.why === 'mood' && e.t - stayedAt > 20) { stayedAt = e.t; flashThought('Staying here', 'no', 2.2); }
          return;
        }
        flashThought(sayWhy(e), e.yes ? 'ok' : 'no');
        if (!e.yes && !care.mindHint) {                     // the first no: say once what is going on
          care.mindHint = true;
          flashHint(`${care.name} has a mind of her own. ${coarse ? 'Tap' : 'Click'} her name to see it`, 7000);
          persist();
        }
      } else if (e.type === 'ask') {
        wantBtn[e.what]?.classList.add('is-wanted');
        if (!askHinted[e.what]) {
          askHinted[e.what] = true;
          flashHint(e.what === 'cuddle' ? `${care.name} came over for a cuddle. Pet her!` : `${care.name} wants a game. Tap Play!`, 6000);
        }
      } else if (e.type === 'answered' || e.type === 'ask-end') {
        wantBtn[e.what]?.classList.remove('is-wanted');
      }
    });
  }

  // ------------------------------------------------------------ how she feels (Day 3: she has feelings)
  // A little face in her name tag always shows it; when a feeling starts, the same face pops up big over her head.
  const emoteEl = $('emote'), faceEl = $('nametag-face');
  const POPS = new Set(['happy', 'loving', 'playful', 'sleepy', 'hungry', 'grumpy', 'angry', 'furious', 'sad']);
  let emoteUntil = 0, feelWord = '';
  function showFeeling(id, word) {
    faceEl.innerHTML = emoteSVG(id);
    feelWord = word;
    shownHungry = null;                                     // the tag's spoken label is written again
    if (!POPS.has(id) || emoteEl.hidden) return;
    emoteEl.innerHTML = emoteSVG(id);
    emoteEl.classList.remove('is-pop');
    void emoteEl.offsetWidth;                               // start the pop again from the top
    emoteEl.classList.add('is-pop');
    emoteUntil = nowMs() + 2800;
  }
  if (mind && kitty) {
    emoteEl.hidden = !((showUI && !demo && !short) || filmFeel);
    if (filmFeel) emoteEl.classList.add('is-filmed');
    showFeeling('content', 'Content');
    kitty.on((e) => {
      if (e.type === 'feel') showFeeling(e.id, e.word);
      else if (e.type === 'woken' && e.angry) flashThought('You woke me up!', 'no', 3.4);
    });
  }

  /** the "her mind" card under her name: who she is, how she feels, what she has learned */
  function showMind() {
    const card = $('mind');
    if (!herMind()) { card.hidden = true; return; }
    const d = describeMind(herMind(), kitty.brain.sense());
    $('mind-title').textContent = `${care.name}'s mind`;
    $('mind-temper').textContent = d.temper.join(' · ');
    const face = document.createElement('span');
    face.className = 'mind-face';
    face.innerHTML = emoteSVG(d.feeling);
    $('mind-feels').replaceChildren(face, d.feels);
    $('mind-trust').replaceChildren(...Array.from({ length: 5 }, (_, k) => { const i = document.createElement('i'); if (k >= d.trust) i.className = 'off'; return i; }));
    $('mind-trust-sr').textContent = `${d.trust} of 5`;
    $('mind-likes').textContent = d.likes;
    $('mind-habits').textContent = d.habits.length ? `${d.habits.join('. ')}.` : 'None yet. She is still settling in.';
    card.hidden = false;
  }
  // Day 6: her friend's name over its head (under hers, when the two would overlap)
  const fPos = new THREE.Vector3();
  let ftagOn = false, ftagFeel = '';
  function placeFriendTag() {
    if (!friend || !showUI || demo || short) { if (ftagOn) { ftag.hidden = true; ftagOn = false; } return; }
    if (!ftagOn) { ftag.hidden = false; ftagOn = true; ftagName.textContent = care.friendName; }
    const fb = friend.brain;
    const feel = fb.mode === 'sleep' ? 'sleepy' : fb.mode === 'purr' || fb.mode === 'nuzzle' ? 'loving' : ['playbow', 'hop', 'tumble'].includes(fb.mode) ? 'playful' : 'happy';
    if (feel !== ftagFeel) { ftagFeel = feel; ftagFace.innerHTML = emoteSVG(feel); }
    friend.headPosition(fPos);
    fPos.y += 2.1;
    fPos.project(camera);
    const vis = fPos.z < 1 && Math.abs(fPos.x) < 1.15 && Math.abs(fPos.y) < 1.15 && !blast?.dead(kitty.t);
    ftag.style.visibility = vis ? 'visible' : 'hidden';
    if (!vis) return;
    const edge = Math.min(70, innerWidth / 2);
    const x = Math.max(edge, Math.min(innerWidth - edge, (fPos.x + 1) / 2 * innerWidth));
    let y = Math.max(tagMinY, (1 - fPos.y) / 2 * innerHeight);
    // her tag (and what floats over it) wins the spot: the friend's tag tucks in under it
    if (!tag.hidden && tag.style.visibility !== 'hidden') {
      const a = tag.getBoundingClientRect(), w = ftag.offsetWidth || 120, h = ftag.offsetHeight || 34;
      if (Math.abs(x - (a.left + a.width / 2)) < (a.width + w) / 2 + 6 && y > a.top - 6 && y - h < a.bottom + 6) y = a.bottom + h + 8;
    }
    ftag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  // every frame: the tag floats over her head; hearts and the hungry badge follow her needs
  const tagPos = new THREE.Vector3();
  const HAT_LIFT = { strawhat: 0.5, flowercrown: 0.35, crown: 0.75, wizardhat: 1.6 };
  function placeTag(t) {
    if (tag.hidden || !kitty) return;
    kitty.headPosition(tagPos);
    tagPos.y += 2.6 + (HAT_LIFT[wardrobe?.wearing.hat] ?? 0);   // above her hat, when she has one on
    tagPos.project(camera);
    const vis = tagPos.z < 1 && Math.abs(tagPos.x) < 1.2 && Math.abs(tagPos.y) < 1.2;
    let s = 1;
    if (filmTag) s = t < filmTagAt ? 0 : Math.min(1, 1 + 2.7 * (Math.min(1, (t - filmTagAt) / 0.45) - 1) ** 3 + 1.7 * (Math.min(1, (t - filmTagAt) / 0.45) - 1) ** 2);
    tag.style.visibility = vis && s > 0.01 ? 'visible' : 'hidden';
    const room = thoughtNow && !thoughtEl.hidden ? 44 : 0;                                        // her thought sits on top of the tag
    const edge = Math.min(84, innerWidth / 2);                                                    // the tag stays whole when she is at the side of the picture
    const rawX = (tagPos.x + 1) / 2 * innerWidth;
    const x = live && mind ? Math.max(edge, Math.min(innerWidth - edge, rawX)) : rawX;                    // (recordings keep the tag exactly where it was)
    const faceUp = live && !emoteEl.hidden && nowMs() < emoteUntil;                               // the big face is showing over her tag
    let floor = tagMinY + room + (faceUp && tagMinY ? 26 : 0);                                    // never up over the title card
    if (live && !hintEl.hidden && !hintEl.classList.contains('is-gone')) {                        // nor over a message that is showing (phones held upright: it sits under the title)
      const hr = hintEl.getBoundingClientRect();
      const stack = faceUp ? (room ? 148 : 104) : room ? 82 : 36;                                 // her tag, her thought and the big face, as high as they reach
      if (hr.height && hr.top < innerHeight / 2) floor = Math.max(floor, hr.bottom + 6 + stack);
    }
    const y = Math.max(floor, (1 - tagPos.y) / 2 * innerHeight);
    tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
    if (!emoteEl.hidden) {                                  // the big face: over the bubble, or over the tag
      const on = vis && nowMs() < emoteUntil;
      emoteEl.classList.toggle('is-on', on);
      let pop = '';                                         // filming: the pop is worked out from the film's clock, frame by frame
      if (on && filmFeel) {
        const age = (nowMs() - (emoteUntil - 2800)) / 1000, k = Math.min(1, age / 0.32);
        const sc = age < 0.32 ? 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2 : age > 2.5 ? Math.max(0, 1 - (age - 2.5) / 0.3) : 1;
        pop = ` scale(${Math.max(0, sc).toFixed(3)})`;
      }
      if (on) emoteEl.style.transform = `translate(${x.toFixed(1)}px, ${(y - (room ? (filmFeel ? 112 : 92) : (filmFeel ? 60 : 48))).toFixed(1)}px) translate(-50%, -100%)${pop}`;
    }
    if (!thoughtEl.hidden) {
      thoughtEl.style.visibility = vis ? 'visible' : 'hidden';
      thoughtEl.style.transform = `translate(${x.toFixed(1)}px, ${(y - (filmFeel ? 64 : 52)).toFixed(1)}px) translate(-50%, -100%)`;
    }
    const b = kitty.brain;
    const hearts = Math.max(1, Math.round(b.happy * 5));
    if (hearts !== shownHearts) {
      shownHearts = hearts;
      heartEls.forEach((el, k) => el.classList.toggle('off', k >= hearts));
    }
    const hungry = b.hunger > 0.7;
    if (hungry !== shownHungry) {
      shownHungry = hungry;
      hungryBadge.hidden = !hungry;
      tagSr.textContent = `, ${feelWord ? `feeling ${feelWord.toLowerCase()}, ` : ''}happiness ${hearts} of 5${hungry ? ', hungry' : ''}. Rename${mind ? ', and see her mind' : ''}`;
    }
  }

  // hint, until the first tap that does something
  if (showUI && !demo && !short) {
    hintEl.textContent = kitty && player
      ? (!friendMet                                                        // the day's new thing (Day 6): her friend
        ? (coarse ? `Tap the ground to walk there · New: ${care.name} has a friend! Tap it to pet it`
          : `Click the ground or use WASD to walk · New: ${care.name} has a friend! Click it to pet it`)
        : wallet.atoms === 0 && !SKINS.some((k) => wallet.ownsSkin(k.id))    // Day 5: atom bombs and boxes
        ? (coarse ? 'Tap the ground to walk there · Tap your kitty to pet her · Dodge the atom bombs'
          : 'Click the ground or use WASD to walk · Click your kitty to pet her · Dodge the atom bombs')
        : !wallet.owns(NEW_ITEM)
        ? (coarse ? 'Tap the ground to walk there · Tap your kitty to pet her · In the shop: a fish on a stick'
          : 'Click the ground or use WASD to walk · Click your kitty to pet her · In the shop: a fish on a stick')
        : coarse ? 'Tap the ground to walk there · Tap your kitty to pet her · Walk to the shop to spend tokens'
          : 'Click the ground or use WASD to walk · Drag to look around · Click your kitty to pet her')
      : kitty ? (coarse ? 'Tap the ground to call the kitty · Tap her to pet her · Two fingers to move'
        : 'Click the ground to call the kitty · Click her to pet her · Drag to look around · Right-drag or WASD to move')
      : (coarse ? 'Drag to look around · Two fingers to move and zoom' : 'Drag to look around · Right-drag or WASD to move · Scroll to zoom');
    hintEl.hidden = false;
  }
  // the fish on a stick is in your hand: say how to play with it (until the first thing you do)
  onWand = (on) => {
    if (!on || !(showUI && !demo && !short)) return;
    const how = coarse ? 'Tap Play to cast your fish, or to dangle it when she is close · Drag the fish to fling it'
      : 'Space or Play casts your fish, or dangles it when she is close · Drag the fish to fling it · WASD to walk';
    if (hinted) flashHint(how, 10000);                     // just bought, or taken out again: say it for a while
    else hintEl.textContent = how;
  };
  if (wandOn) onWand(true);
  function dismissHint() {
    if (hinted) return;
    hinted = true;
    if (!hintEl.dataset.yarn) hintEl.classList.add('is-gone');
  }
  // the first time the yarn comes out: how to throw it (until you do, or for 9 s)
  let yarnHinted = false, yarnHintTimer = 0;
  function hideYarnHint() {
    clearTimeout(yarnHintTimer);
    if (!hintEl.dataset.yarn) return;
    delete hintEl.dataset.yarn;
    hintEl.classList.add('is-gone');
  }
  if (kitty && showUI && !demo && !short) {
    kitty.on((e) => {
      if (e.type !== 'yarn' || yarnHinted || thrownOnce) return;
      if (herMind()?.lastDecision?.verb === 'play' && !herMind().lastDecision.yes) return;   // she turned the game down: not the moment for this tip
      yarnHinted = true;
      setTimeout(() => {
        if (thrownOnce || wandOn) return;                  // (the fish on a stick has its own tip)
        hintEl.textContent = toyOut() ? 'Drag the toy and let go to throw it' : 'Drag the yarn ball and let go to throw it';
        hintEl.dataset.yarn = '1';
        hintEl.hidden = false;
        hintEl.classList.remove('is-gone');
        yarnHintTimer = setTimeout(hideYarnHint, 9000);
      }, 1100);
    });
  }

  // ------------------------------------------------------------ loop
  let t0 = null, last = null, external = false, skip = false;
  const interest = new THREE.Vector3();
  const lead = [0, 0];                                    // how far the camera leans toward the fish on its line
  function step(t, dt) {
    let ks = 0;
    if (kitty && mind && player) kitty.setFriend(player.x, player.z);      // so she can come over to you
    if (wandOn && !demo) kitty.setWandTip(player.tip());                   // the line runs from the tip of your stick
    if (kitty) ks = demo ? kitty.simulateTo(t, player || friend ? (bt) => { if (player) syncPlayer(bt); friend?.stepTo(bt, friendWorld); } : null) : kitty.advance(dt, camera.position);
    let fs = 0;                                            // her friend: in lockstep with her in recordings
    if (friend) fs = demo ? friend.stepTo(kitty.t, friendWorld) : friend.advance(dt, friendWorld());
    clockMs = t * 1000;
    if (mind) think(nowMs());
    if (player) {
      if (demo) player.simulateTo(t);
      else {
        if (!blast?.dead(kitty.t)) steerPlayer();
        player.advance(dt);
        // close to the shop: it opens (once per visit; walk away and come back to open it again)
        if (town && shopArmed && town.atShop(player.x, player.z)) {
          shopArmed = false; wantShop = false;
          player.stop();
          player.faceTo(town.SHOP.x, town.SHOP.z);
          openShop();
        } else if (town && !shopArmed && town.leftShop(player.x, player.z)) shopArmed = true;
        // you walked up to the atom box you tapped: it opens
        if (wantBox >= 0 && atomBox) {
          const B = atomBox.box(wantBox);
          if (!B || B.opened) wantBox = -1;
          else if (Math.hypot(player.x - B.x, player.z - B.z) < atomMod.NEAR - 1.2) {
            const i = wantBox;
            wantBox = -1;
            player.stop();
            player.faceTo(B.x, B.z);
            openBox(i);
          }
        }
        // the next atom bomb: a while after the last one, not while a window is open or you are at the shop
        if (atomBox && live) {
          if (nextDrop == null) nextDrop = kitty.t + ATOM_BOX.first;
          if (kitty.t >= nextDrop) {
            const calm = !document.querySelector('dialog[open]') && !(town && town.atShop(player.x, player.z));
            nextDrop = kitty.t + (calm && dropBomb() ? ATOM_BOX.every + (dropped % 3) * 2 : 2);
          }
        }
      }
      if (wandOn) aimRod();
    }
    if (kitty && !demo && follow) {                        // the camera keeps you in the middle (before Day 3: the kitty)
      const f = kitty.interest(interest);
      if (player) {
        f.set(player.x, 0, player.z);                       // third person: locked on you
        // ...leaning toward your fish while it is out on its line, so the chase stays in the picture
        const y = wandOn ? kitty.brain.yarn : null;
        let lx = 0, lz = 0;
        if (y?.wand && !y.hang) { const dx = y.x - player.x, dz = y.z - player.z, d = Math.hypot(dx, dz) || 1, kk = Math.min(0.45, 6.5 / d); lx = dx * kk; lz = dz * kk; }
        const kl = 1 - Math.exp(-dt * 2.2);
        lead[0] += (lx - lead[0]) * kl; lead[1] += (lz - lead[1]) * kl;
        f.x += lead[0]; f.z += lead[1];
      }
      const k = 1 - Math.exp(-dt * (player ? 7 : 1.8));
      rig.target[0] += (f.x - rig.target[0]) * k;
      rig.target[2] += (f.z - rig.target[2]) * k;
    }
    if (demo) {
      const pose = demoPose(demo, t, home, kitty ? kittyState() : null) || demoPose('orbit', t, home);
      setShift(pose.shift, 0);
      if (pose.position) {
        camera.position.set(...pose.position);
        camera.lookAt(...pose.look);
      } else {
        placeCamera(camera, pose.target, pose.az, pose.pol, pose.dist);
      }
    } else {
      rig.update(dt);
      if (firstPerson && player) {
        const w = player.walker;
        // walking to a tapped spot (or turning to the shop): your eyes turn the way you go, unless you are looking around
        if ((w.target || w.face) && rig.pointers.size === 0 && !held.size) {
          let d = (w.heading + Math.PI) - rig.goal.az;
          d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          rig.goal.az += d * (1 - Math.exp(-dt * 2.6));
        }
        const pitch = rig.pol - Math.PI / 2;               // up is positive
        const bob = w.moving() ? 0.07 * Math.sin(w.t * (w.speed > 6 ? 15 : 9)) : 0;
        eye.set(player.x, PLAYER_EYE + bob, player.z);
        lookAtPt.set(eye.x - Math.sin(rig.az) * Math.cos(pitch), eye.y + Math.sin(pitch), eye.z - Math.cos(rig.az) * Math.cos(pitch));
        camera.position.copy(eye);
        camera.lookAt(lookAtPt);
      }
    }
    if (kitty) {
      kitty.finish(camera.position, ks); placeTag(t);
      friend?.finish(demo ? Math.max(fs, ks) : fs); placeFriendTag();
      if (wand && player) wand.update(dt, kitty.t, kitty.brain.yarn, player.heading);
      wardrobe?.update(kitty.t);
      camera.updateMatrixWorld();
      paintTokens(kitty.t);
      paintAtoms(kitty.t);
    }
    if (kitty) fx?.update(kitty.t);
    world.update(t);
    world.render();
  }
  function frame(ts) {
    if (external) return;
    requestAnimationFrame(frame);
    // Day 6: a device that cannot keep up with the finished picture (glow, grade) gets the plain one. Measured on
    // the browser's own frame clock over 150 frames a few seconds in, once (never in a recording)
    if (!demo && world.finishing && perf.n >= 0 && !document.hidden) {
      if (perf.at != null && t0 != null && ts - t0 > 3000) { const d = ts - perf.at; if (d < 250) { perf.sum += d; perf.n++; } }
      perf.at = ts;
      if (perf.n >= 150) {
        if (perf.sum / perf.n > 24) { world.setQuality('plain'); console.info('Glikdev: plain picture for this device'); }
        perf.n = -1;
      }
    }
    if (t0 === null) { t0 = ts; last = ts; }
    const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    if (dialog.open) { last = ts; return; }                // nothing to see behind the Day log
    // when nobody is touching the camera, 30 fps is plenty
    if (!demo && rig.idle() && !player?.busy() && !(kitty && (kitty.busy() || friend?.busy() || fx?.busy() || tokenFX?.busy() || atomFX?.busy() || atomBox?.busy(kitty.t) || blast?.active(kitty.t) || wardrobe?.busy(kitty.t) || (wandOn && wand.busy())))) { skip = !skip; if (skip) return; }
    last = ts;
    step((ts - t0) / 1000, dt);
    // Day 6: a device that cannot keep up with the finished picture (glow, grade) gets the plain one; checked over
    // two seconds of busy frames, once, a few seconds in (never in a recording)
  }
  const perf = { sum: 0, n: 0, at: null };
  // Recorders call this instead of the rAF loop: the frame at exactly t seconds.
  window.renderFrame = (t) => {
    external = true;
    step(Number(t) || 0, 1 / 30);
  };

  // handles for tests and for the days to come
  const v = new THREE.Vector3();
  window.__glikdev = {
    world, rig, home, daysLoaded, build: BUILD, kitty,
    get audio() { return audio; },
    get wallet() { return wallet; }, get wardrobe() { return wardrobe; }, get player() { return player; }, get store() { return store; },
    get wand() { return wand; }, get wandOn() { return wandOn; },
    get friend() { return friend; }, get fx() { return fx; },
    get atomBox() { return atomBox; }, get atomMod() { return atomMod; }, get blast() { return blast; },
    /** Screen height fraction (from the top) of the visible horizon: the plate's far edge. */
    horizonFrac() {
      camera.updateMatrixWorld();
      const f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0;
      if (f.lengthSq() < 1e-8) return null;
      f.normalize();
      const p = camera.position;
      const tx = f.x ? (Math.sign(f.x) * PLATE.half - p.x) / f.x : Infinity;
      const tz = f.z ? (Math.sign(f.z) * PLATE.half - p.z) / f.z : Infinity;
      v.set(p.x + f.x * Math.min(tx, tz), 0, p.z + f.z * Math.min(tx, tz)).project(camera);
      return (1 - v.y) / 2;
    },
    /** Screen height fraction (from the top) where the true (sky) horizon is drawn right now. */
    skyHorizonFrac() {
      camera.updateMatrixWorld();
      const f = camera.getWorldDirection(new THREE.Vector3());
      f.y = 0;
      if (f.lengthSq() < 1e-8) return null;                // looking straight down
      f.normalize().multiplyScalar(1e5).add(camera.position);
      f.y = camera.position.y;
      v.copy(f).project(camera);
      return (1 - v.y) / 2;
    },
    cameraHeight() { return camera.position.y; },
    /** Size in CSS px of one 4 m grid cell on the ground at a screen point (fractions 0-1). */
    gridCellPx(sx = 0.5, sy = 0.8) {
      camera.updateMatrixWorld();
      ray.setFromCamera(new THREE.Vector2(sx * 2 - 1, 1 - sy * 2), camera);
      const hit = ray.ray.intersectPlane(groundPlane, new THREE.Vector3());
      if (!hit) return 0;
      const a = hit.clone().project(camera), b = hit.clone().add(new THREE.Vector3(4, 0, 0)).project(camera);
      const c = hit.clone().add(new THREE.Vector3(0, 0, 4)).project(camera);
      const px = (p, q) => Math.hypot((p.x - q.x) * innerWidth / 2, (p.y - q.y) * innerHeight / 2);
      return Math.max(px(a, b), px(a, c));
    },
  };

  step(0, 0);
  statusEl.hidden = true;
  root.classList.add('world-ready');
  requestAnimationFrame(frame);
  await daysLoaded;                                        // the title card shows the right day before "ready"
  resolveReady(true);
}

start().catch(showLoadError);
