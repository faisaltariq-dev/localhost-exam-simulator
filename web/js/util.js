// Shared helpers. All DOM is built with h(); user text only ever goes in as text nodes.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// Paragraphs, line breaks, fenced code blocks and inline `code`. No HTML is ever interpreted.
export function richText(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text || '').split('\n');
  let para = [];
  let code = null;
  const flushPara = () => {
    while (para.length && !para[para.length - 1].trim()) para.pop();
    if (para.length) {
      const p = h('p', { class: 'rt-p' });
      para.forEach((line, i) => {
        if (i) p.append(h('br'));
        inlineCode(p, line);
      });
      frag.append(p);
    }
    para = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (code === null) { flushPara(); code = []; }
      else { frag.append(h('pre', null, h('code', null, code.join('\n')))); code = null; }
    } else if (code !== null) {
      code.push(line);
    } else if (!line.trim()) {
      flushPara();
    } else {
      para.push(line);
    }
  }
  if (code !== null) frag.append(h('pre', null, h('code', null, code.join('\n'))));
  flushPara();
  return frag;
}

function inlineCode(parent, line) {
  line.split(/(`[^`]+`)/).forEach((part) => {
    if (/^`[^`]+`$/.test(part)) parent.append(h('code', null, part.slice(1, -1)));
    else if (part) parent.append(document.createTextNode(part));
  });
}

// A small markdown renderer for the prompt view: headings, rules, lists (one nested level),
// fenced code, paragraphs, `code` and **bold**. Built with DOM nodes, so text is never parsed as HTML.
export function markdown(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text || '').split('\n');
  let para = null;
  let list = null;
  let sub = null;
  const endBlocks = () => { para = null; list = null; sub = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^\s*```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      endBlocks();
      frag.append(h('pre', null, h('code', null, code.join('\n'))));
    } else if (!line.trim()) {
      para = null;
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      endBlocks();
      frag.append(h(`h${Math.min(m[1].length + 2, 6)}`, null, mdInline(m[2])));
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      endBlocks();
      frag.append(h('hr'));
    } else if ((m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/))) {
      const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      const li = h('li', null, mdInline(m[3]));
      if (m[1].length >= 2 && list && list.lastElementChild) {
        if (!sub) list.lastElementChild.append(sub = h(tag));
        sub.append(li);
      } else {
        if (!list || list.tagName.toLowerCase() !== tag) frag.append(list = h(tag));
        sub = null;
        list.append(li);
      }
      para = null;
    } else if (/^\s{2,}\S/.test(line) && list && list.lastElementChild) {
      ((sub && sub.lastElementChild) || list.lastElementChild).append(' ', mdInline(line.trim()));
    } else {
      list = null;
      sub = null;
      if (para) para.append(' ');
      else frag.append(para = h('p'));
      para.append(mdInline(line.trim()));
    }
  }
  return frag;
}

function mdInline(s) {
  const frag = document.createDocumentFragment();
  s.split(/(`[^`]+`)/).forEach((part) => {
    if (/^`[^`]+`$/.test(part)) {
      frag.append(h('code', null, part.slice(1, -1)));
      return;
    }
    part.split(/(\*\*[^*]+\*\*)/).forEach((p) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) frag.append(h('strong', null, p.slice(2, -2)));
      else if (p) frag.append(document.createTextNode(p));
    });
  });
  return frag;
}

export function plainText(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

export function firstSentence(text, max = 120) {
  const plain = String(text || '').split('\n').find((l) => l.trim() && !/^\s*(```|~~~)/.test(l)) || '';
  const m = plain.replace(/`/g, '').match(/^.*?[.?!](?=\s|$)/);
  let s = (m ? m[0] : plain).trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

export function firstWords(text, n = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ') + (words.length > n ? '…' : '');
}

// 6760 -> "1:52:40"; negative values get a leading minus sign.
export function fmtClock(seconds) {
  const neg = seconds < 0;
  const s = Math.abs(Math.trunc(seconds));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${neg ? '−' : ''}${hh}:${mm}:${ss}`;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function groupLabel(maker, exam) {
  return `${maker} · ${exam}`.toUpperCase();
}

// Grep-like exam search shared by the library and Settings: plain text matches the ID, title and
// group label (ignoring case); /regex/ is tested against the ID and title. A bad regex matches nothing.
export function examMatcher(query) {
  const q = query.trim();
  if (!q) return () => true;
  const m = q.match(/^\/(.+)\/$/);
  if (m) {
    let re;
    try { re = new RegExp(m[1], 'i'); } catch (e) { return () => false; }
    return (e) => [e.id, e.title, e.made_by, e.flavour].some((v) => v && re.test(v));
  }
  const s = q.toLowerCase();
  return (e) => `${e.id} ${e.title} ${groupLabel(e.maker, e.exam)} ${e.made_by || ''} ${e.flavour || ''}`.toLowerCase().includes(s);
}

// Tally marks: one stroke per attempt, every fifth is a diagonal across the previous four.
// greenIndex is the 0-based position of the green attempt, or -1.
export function tallySvg(count, greenIndex = -1) {
  const NS = 'http://www.w3.org/2000/svg';
  const width = Math.max(1, Math.ceil(count / 5)) * 34;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} 20`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', 20);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${count} attempt${count === 1 ? '' : 's'}${greenIndex >= 0 ? `, attempt ${greenIndex + 1} green` : ''}`);
  for (let i = 0; i < count; i++) {
    const gx = Math.floor(i / 5) * 34 + 2;
    const pos = i % 5;
    const line = document.createElementNS(NS, 'line');
    const coords = pos < 4 ? [gx + pos * 7, 2, gx + pos * 7, 18] : [gx - 3, 15, gx + 24, 5];
    ['x1', 'y1', 'x2', 'y2'].forEach((k, j) => line.setAttribute(k, coords[j]));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('class', i === greenIndex ? 'tally-green' : 'tally-mark');
    svg.append(line);
  }
  return svg;
}

// Small line icons drawn as inline SVG (24×24 grid, stroked with the current text colour).
const ICONS = {
  copy: [['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }],
    ['path', { d: 'M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  download: [['path', { d: 'M12 3v12' }], ['path', { d: 'm7 10 5 5 5-5' }], ['path', { d: 'M5 21h14' }]],
  gear: [['path', { d: gearPath() }], ['circle', { cx: 12, cy: 12, r: 3 }]],
};

// Eight evenly spaced trapezoid teeth around a ring.
function gearPath() {
  const rad = (deg) => (deg * Math.PI) / 180;
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const c = k * 45;
    [[7.4, c - 15], [10, c - 8], [10, c + 8], [7.4, c + 15]].forEach(([r, a]) => {
      pts.push(`${(12 + r * Math.cos(rad(a))).toFixed(2)} ${(12 + r * Math.sin(rad(a))).toFixed(2)}`);
    });
  }
  return `M${pts.join(' L')} Z`;
}

export function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon', 'aria-hidden': 'true' };
  Object.entries(attrs).forEach(([k, v]) => svg.setAttribute(k, v));
  ICONS[name].forEach(([tag, a]) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
    svg.append(el);
  });
  return svg;
}

// An icon-only copy button. Shows a check when copied; if the clipboard is blocked, it runs
// onBlocked (which should select the text) and hints at ⌘C instead.
export function copyButton(getText, onBlocked) {
  const btn = h('button', { class: 'btn icon-btn', type: 'button', title: 'Copy', 'aria-label': 'Copy' }, icon('copy'));
  const reset = () => setTimeout(() => {
    clear(btn, icon('copy'));
    btn.title = 'Copy';
  }, 1600);
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      clear(btn, icon('check'));
      btn.title = 'Copied';
    } catch (err) {
      onBlocked();
      clear(btn, icon('copy'), h('span', { class: 'small' }, '⌘C'));
      btn.title = 'Selected: press ⌘C';
    }
    reset();
  });
  return btn;
}

// An icon-only button that saves text as a file, built in the page (no server round trip).
export function downloadButton(getText, filename) {
  return h('button', {
    class: 'btn icon-btn', type: 'button', title: `Download ${filename}`, 'aria-label': `Download ${filename}`,
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = URL.createObjectURL(new Blob([getText()], { type: 'text/markdown;charset=utf-8' }));
      const a = h('a', { href: url, download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  }, icon('download'));
}

// Selects all text inside el (used when the clipboard API is refused).
export function selectText(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Makes el accept dropped files. Crossing a child element fires dragleave on the parent, so a
// depth counter keeps the highlight steady instead of flickering on and off.
export function dropTarget(el, onFiles) {
  let depth = 0;
  el.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth += 1;
    el.classList.add('over');
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('over');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    el.classList.remove('over');
    onFiles([...e.dataTransfer.files]);
  });
}

// A File | Paste switch above two alternative views (only one is shown at a time).
export function fileOrPaste(fileView, pasteView, label) {
  const buttons = [['file', 'File'], ['paste', 'Paste']].map(([mode, text]) => h('button', {
    type: 'button', dataset: { mode }, onclick: () => show(mode),
  }, text));
  function show(mode) {
    fileView.hidden = mode !== 'file';
    pasteView.hidden = mode !== 'paste';
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  }
  show('file');
  return h('div', { class: 'intake-box' },
    h('div', { class: 'seg mode-toggle', role: 'group', 'aria-label': label }, buttons),
    fileView, pasteView);
}

// Window-level guard: dropping outside a drop zone must not open the file in the tab,
// and the cursor should say "no drop" there instead of "copy".
export function blockStrayDrops(e) {
  e.preventDefault();
  const inZone = e.target instanceof Element && e.target.closest('.dropzone');
  if (e.type === 'dragover' && !inZone) e.dataTransfer.dropEffect = 'none';
}

// In-page confirm dialog (never window.confirm). Resolves true/false.
export function confirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlays');
    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    };
    const confirmBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => done(true) }, confirmLabel);
    const overlay = h('div', { class: 'overlay' },
      h('div', { class: 'scrim', onclick: () => done(false) }),
      h('div', { class: 'dialog confirm', role: 'alertdialog', 'aria-label': title },
        h('h3', null, title),
        body ? h('div', null, body) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, cancelLabel),
          confirmBtn)));
    document.addEventListener('keydown', onKey, true);
    root.append(overlay);
    confirmBtn.focus();
  });
}
