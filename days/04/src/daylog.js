// Day log: one list item per day of the series. Pure DOM, text only.
// Every value that came from a viewer (title, idea, name) is written with textContent,
// so names like "<img onerror=...>" show up as the literal characters they are.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-19" -> "Nov 19, 2026". Anything that is not an ISO date is shown as given. */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : String(iso);
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const validDays = (days) => (Array.isArray(days)
  ? days.filter((d) => d && typeof d === 'object' && Number.isInteger(Number(d.day)) && Number(d.day) >= 1)
  : []);

/** "@leafy", "leafy" and "@@leafy" all become "@leafy"; empty or missing gives "". */
export function handle(by) {
  const name = typeof by === 'string' ? by.trim().replace(/^@+/, '').trim() : '';
  return name ? `@${name}` : '';
}

/** Relative link to a day's playable snapshot: days/NN/ (NN zero-padded), from the site root. */
export function dayHref(day, root = '') {
  return `${root}days/${String(Math.trunc(Number(day))).padStart(2, '0')}/`;
}

/** The newest valid entry (highest day number), or null. */
export function latestDay(days) {
  const v = validDays(days);
  return v.length ? v.reduce((a, b) => (Number(b.day) > Number(a.day) ? b : a)) : null;
}

/**
 * Write the title card from the newest Day log entry: "Day N.", its headline (or title), and the
 * bubble "What should Day N+1 add? Comment it." Leaves the static HTML alone when there is no entry.
 * @param {{day:HTMLElement, line:HTMLElement, bubble:HTMLElement}} els
 */
export function renderHeadline(els, days) {
  const d = latestDay(days);
  if (!d) return false;
  const n = Number(d.day);
  if (els.day) els.day.textContent = `Day ${n}.`;
  const line = String(d.headline ?? d.title ?? '').trim();
  if (els.line && line) els.line.textContent = line;
  if (els.bubble) els.bubble.textContent = `What should Day ${n + 1} add? Comment it.`;
  return true;
}

/**
 * Render the Day log into `listEl` (an <ol> or <ul>), replacing what was there.
 * @param {HTMLElement} listEl
 * @param {{day:number,date:string,title:string,idea:string,by:string|null}[]} days
 * @param {{root?:string}} [opts]  root: path from this page to the site root ("" or "../../")
 */
export function renderDayLog(listEl, days, { root = '' } = {}) {
  const doc = listEl.ownerDocument;
  const valid = validDays(days);

  if (valid.length === 0) {
    listEl.replaceChildren(el(doc, 'li', 'daylog-empty', 'No days yet'));
    return;
  }

  const items = [...valid]
    .sort((a, b) => Number(a.day) - Number(b.day))
    .map((d) => {
      const li = el(doc, 'li', 'daylog-entry');

      const head = el(doc, 'div', 'daylog-head');
      head.append(el(doc, 'span', 'daylog-day', `Day ${Number(d.day)}`));
      const time = el(doc, 'time', 'daylog-date', formatDate(d.date));
      time.setAttribute('datetime', String(d.date ?? ''));
      head.append(time);
      li.append(head);

      const title = el(doc, 'p', 'daylog-title', String(d.title ?? ''));
      title.setAttribute('dir', 'auto');
      li.append(title);

      const idea = el(doc, 'p', 'daylog-idea', String(d.idea ?? ''));
      idea.setAttribute('dir', 'auto');
      li.append(idea);

      const name = handle(d.by);
      const by = el(doc, 'p', 'daylog-by', name ? 'idea by ' : 'idea by: ');
      if (name) {
        const nameEl = el(doc, 'span', 'daylog-name', name);
        nameEl.setAttribute('dir', 'auto');
        by.append(nameEl);
      } else {
        by.append(el(doc, 'span', 'daylog-nobody', 'nobody yet'));
      }
      li.append(by);

      // the playable copy of that day; text and address come from the day number only
      const n = Math.trunc(Number(d.day));
      const play = el(doc, 'a', 'daylog-play', 'Play this day');
      play.setAttribute('href', dayHref(n, root));
      play.setAttribute('aria-label', `Play Day ${n}`);
      li.append(play);
      return li;
    });

  listEl.replaceChildren(...items);
}
