// A tiny DOM stand-in for node:test. It supports only what daylog.js may use and
// throws on innerHTML / outerHTML / insertAdjacentHTML, so any HTML parsing path fails the tests.

class FakeText {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
  get textContent() { return this.data; }
}

export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.attributes = new Map();
    this.parentNode = null;
    this.className = '';
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(value) {
    this.childNodes = [];
    const text = value == null ? '' : String(value);
    if (text !== '') this._adopt(new FakeText(text));
  }
  set innerHTML(_v) { throw new Error('innerHTML is not allowed'); }
  get innerHTML() { throw new Error('innerHTML is not allowed'); }
  set outerHTML(_v) { throw new Error('outerHTML is not allowed'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML is not allowed'); }
  _adopt(node) {
    if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter((n) => n !== node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  appendChild(node) { return this._adopt(node); }
  append(...nodes) {
    for (const n of nodes) this._adopt(typeof n === 'string' ? new FakeText(n) : n);
  }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  querySelectorAll(selector) {
    // Only ".class" selectors are needed by the tests.
    const cls = selector.startsWith('.') ? selector.slice(1) : null;
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (cls && c.className.split(/\s+/).includes(cls)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

export class FakeDocument {
  createElement(tag) { return new FakeElement(tag, this); }
  createTextNode(text) { return new FakeText(text); }
}

export function makeList() {
  const doc = new FakeDocument();
  return doc.createElement('ol');
}
