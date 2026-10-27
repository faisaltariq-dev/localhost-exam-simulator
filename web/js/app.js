// Boot, settings and hash routing. Views are separate modules loaded on demand, so each one
// can be rebuilt on its own: library.js, exam.js, results.js (settings.js opens from the library).
import { api } from './api.js';
import { h, clear } from './util.js';

const root = document.getElementById('app');
const ROUTES = [
  { pattern: /^#?\/?$/, module: './library.js' },
  { pattern: /^#\/take\/([a-z0-9]+-[a-z0-9]+-[1-9][0-9]*)$/, module: './exam.js' },
  { pattern: /^#\/results\/([a-z0-9]+-[a-z0-9]+-[1-9][0-9]*)\/([1-9][0-9]*)$/, module: './results.js' },
];

const ctx = {
  api,
  settings: null,
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  applySettings(settings) {
    ctx.settings = settings;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.style = settings.style;
  },
};

let current = null; // { view, hash }
let bypassGuard = false;

async function render() {
  const hash = location.hash || '#/';
  // A view can refuse to be left (the exam asks before discarding an attempt).
  if (current && current.view.guard && !bypassGuard && current.hash !== hash) {
    const prev = current.hash;
    const allowed = await current.view.guard();
    if (!allowed) {
      history.replaceState(null, '', prev);
      return;
    }
  }
  bypassGuard = false;
  if (current && current.view.cleanup) current.view.cleanup();
  current = null;
  document.getElementById('overlays').replaceChildren();

  const routeMatch = ROUTES.map((r) => ({ r, m: hash.match(r.pattern) })).find((x) => x.m);
  if (!routeMatch) {
    clear(root, h('div', { class: 'empty-view' }, 'Page not found. ', h('a', { href: '#/' }, 'Back to the library')));
    return;
  }
  let view;
  try {
    view = await import(routeMatch.r.module);
  } catch (err) {
    clear(root, h('div', { class: 'empty-view' }, 'This part of the app is not built yet.'));
    return;
  }
  current = { view, hash };
  try {
    await view.render(root, ctx, ...routeMatch.m.slice(1));
  } catch (err) {
    clear(root, h('div', { class: 'empty-view' }, `Something went wrong: ${err.message}`));
  }
}

// Lets a guarded view (the exam) navigate away after it has asked for itself.
ctx.leave = (hash) => {
  bypassGuard = true;
  ctx.navigate(hash);
};

async function boot() {
  try {
    ctx.applySettings(await api.getSettings());
  } catch (err) {
    clear(root, h('div', { class: 'empty-view' }, 'Cannot reach the local server. Is python3 server.py running?'));
    return;
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
