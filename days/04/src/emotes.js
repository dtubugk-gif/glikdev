// The kitty's feelings as little emoji faces (the owner: "she will make me an angry emoji. Make her have
// emotions"). Drawn here as SVG in the game's own style (ink outline, flat fills), so they look the same on
// every phone and PC instead of depending on the device's emoji font. Pure strings: no DOM, no three.js.
//
//   emoteSVG('angry')  ->  '<svg ...>...</svg>'     EMOTES lists every face there is.

const INK = '#2f2620', FACE = '#ffd24d', HOT = '#f2765a', PINK = '#f06b78', BLUE = '#7cc4e8', WHITE = '#fffaf0';
const S = `fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
const eye = (x, y = 15.6, rx = 1.9, ry = 2.5) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${INK}"/>`;
const eyes = (y, rx, ry) => eye(12.4, y, rx, ry) + eye(23.6, y, rx, ry);
const heart = (x, y, k = 1) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0 3.6C-3.4 1.2-4.6-.4-4.6-2.1A2.5 2.5 0 0 1 0-3.2 2.5 2.5 0 0 1 4.6-2.1C4.6-.4 3.4 1.2 0 3.6Z" fill="${PINK}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`;
const zed = (x, y, k) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0 0h5L0 6h5" ${S}/>`;
const drop = (x, y) => `<path d="M${x} ${y}c1.9 2.6 2.6 3.8 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.2.7-2.4 2.6-5Z" fill="${BLUE}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`;
const tongue = (x, y, r = 0) => `<path transform="translate(${x} ${y}) rotate(${r})" d="M-2.6 0h5.2v2.4a2.6 2.6 0 0 1-5.2 0Z" fill="${PINK}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`;

/** every face: what is drawn on top of the round head (36 x 36) */
const FACES = {
  // nothing much: a small smile
  content: () => eyes() + `<path d="M12.5 22.2Q18 26.4 23.5 22.2" ${S}/>`,
  // eyes squeezed shut with joy, a big open grin
  happy: () => `<path d="M9.8 16.4Q12.4 12.4 15 16.4M21 16.4Q23.6 12.4 26.2 16.4" ${S}/>`
    + `<path d="M11 20.6Q18 30.4 25 20.6Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M14.6 25.6Q18 23.4 21.4 25.6Q18 28.6 14.6 25.6Z" fill="${PINK}"/>`,
  // hearts for eyes
  loving: () => heart(12.2, 15.6, 1.05) + heart(23.8, 15.6, 1.05) + `<path d="M12 22.6Q18 28.4 24 22.6" ${S}/>`,
  // a wink and her tongue out
  playful: () => eye(12.4) + `<path d="M21 16.2Q23.6 13.6 26.2 16.2" ${S}/>` + `<path d="M11.6 21.4Q18 26.6 24.4 21.4" ${S}/>` + tongue(19.4, 23.9, -8),
  // heavy lids and a yawn coming
  sleepy: () => `<path d="M9.8 15.2Q12.4 17.6 15 15.8M21 15.8Q23.6 17.6 26.2 15.2" ${S}/>`
    + `<ellipse cx="18" cy="23.8" rx="2.3" ry="2.9" fill="${INK}"/>` + zed(26.6, 4.4, 0.72),
  // fast asleep
  asleep: () => `<path d="M9.8 16Q12.4 18.8 15 16M21 16Q23.6 18.8 26.2 16" ${S}/>`
    + `<path d="M15.4 23.6Q18 25 20.6 23.6" ${S}/>` + zed(24.8, 6.6, 0.62) + zed(28.6, 1.6, 0.86),
  // licking her lips
  hungry: () => eyes(15.2) + `<path d="M11.6 21.6Q18 26.8 24.4 21.6" ${S}/>` + tongue(22.6, 23.2, -32) + drop(12.6, 24.2),
  // not angry any more, not pleased either: flat brows, eyes aside, a flat mouth
  grumpy: () => `<path d="M9.4 12.4H15.6M20.4 12.4H26.6" ${S}/>` + eye(13.6, 16.2, 1.7, 2) + eye(24.8, 16.2, 1.7, 2)
    + `<path d="M13 24.4Q18 22.8 23 24.4" ${S}/>`,
  // brows down, a hard frown
  angry: () => `<path d="M8.8 11.4L15.6 14.4M27.2 11.4L20.4 14.4" ${S}/>` + eyes(17, 1.9, 2.2)
    + `<path d="M12.4 25.6Q18 20.8 23.6 25.6" ${S}/>`,
  // red in the face, teeth showing
  furious: () => `<path d="M8.4 10.8L15.8 14.6M27.6 10.8L20.2 14.6" ${S}/>` + eyes(17.2, 2, 2.2)
    + `<path d="M11.8 21.6H24.2V26H11.8Z" fill="${WHITE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M15.9 21.6V26M20.1 21.6V26" stroke="${INK}" stroke-width="1.5"/>`,
  // brows up in the middle, a small frown, one tear
  sad: () => `<path d="M9.4 13.6L15 11.6M26.6 13.6L21 11.6" ${S}/>` + eyes(16.8, 1.8, 2.3)
    + `<path d="M13.4 25.4Q18 22 22.6 25.4" ${S}/>` + drop(25.4, 19.2),
};

export const EMOTES = Object.keys(FACES);

/** The face for a feeling, as an SVG string (36 x 36 units; size it with CSS). Unknown ids give the calm face. */
export function emoteSVG(id) {
  const k = FACES[id] ? id : 'content';
  return `<svg class="emote-face emote-${k}" viewBox="0 0 36 36" aria-hidden="true">`
    + `<circle cx="18" cy="18" r="15.4" fill="${k === 'furious' ? HOT : FACE}" stroke="${INK}" stroke-width="2.4"/>`
    + FACES[k]() + '</svg>';
}
