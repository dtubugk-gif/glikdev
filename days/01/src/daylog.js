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

/**
 * Render the Day log into `listEl` (an <ol> or <ul>), replacing what was there.
 * @param {HTMLElement} listEl
 * @param {{day:number,date:string,title:string,idea:string,by:string|null}[]} days
 */
export function renderDayLog(listEl, days) {
  const doc = listEl.ownerDocument;
  const valid = Array.isArray(days)
    ? days.filter((d) => d && typeof d === 'object' && Number.isFinite(Number(d.day)))
    : [];

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

      const by = el(doc, 'p', 'daylog-by', 'idea by: ');
      const name = typeof d.by === 'string' ? d.by.trim() : '';
      if (name) {
        const nameEl = el(doc, 'span', 'daylog-name', name);
        nameEl.setAttribute('dir', 'auto');
        by.append(nameEl);
      } else {
        by.append(el(doc, 'span', 'daylog-nobody', 'nobody yet'));
      }
      li.append(by);
      return li;
    });

  listEl.replaceChildren(...items);
}
