// Library: drop zone, prompt block, search, tableau/list of exams, and the selected exam's history.
import { h, clear, groupLabel, tallySvg, fmtDate, fmtClock } from './util.js';

const VIEW_KEY = 'examsim.view';
const SELECTED_KEY = 'examsim.selected';
let state = null;

function stored(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode: fine */ }
}

export async function render(root, ctx) {
  state = {
    ctx, exams: [], query: '', view: stored(VIEW_KEY, 'tableau'), selected: stored(SELECTED_KEY, ''),
    detailToken: 0, promptText: '', els: {},
  };
  window.addEventListener('dragover', blockWindowDrop);
  window.addEventListener('drop', blockWindowDrop);
  clear(root, topbar(), page());
  loadPrompt();
  await reload();
}

export function cleanup() {
  window.removeEventListener('dragover', blockWindowDrop);
  window.removeEventListener('drop', blockWindowDrop);
  state = null;
}

// Dropping a file outside the zone must not navigate the tab away to the file.
function blockWindowDrop(e) { e.preventDefault(); }

async function reload() {
  if (!state) return;
  state.exams = await state.ctx.api.listExams();
  if (!state.exams.some((e) => e.id === state.selected)) state.selected = state.exams.length ? state.exams[0].id : '';
  renderBoard();
  renderDetail();
}

// ---- layout ---------------------------------------------------------------------------

function topbar() {
  const search = h('input', {
    type: 'search', id: 'lib-search', placeholder: 'Search exams: adp, practice 2, /gcp-.*-1/', 'aria-label': 'Search exams',
    autocomplete: 'off', class: 'lib-search',
    oninput: (e) => { state.query = e.target.value; renderBoard(); },
  });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Library view' },
    ['tableau', 'list'].map((v) => h('button', {
      type: 'button', 'aria-pressed': String(state.view === v), dataset: { view: v },
      onclick: () => setView(v),
    }, v === 'tableau' ? 'Tableau' : 'List')));
  state.els.seg = seg;
  return h('header', { class: 'topbar' },
    h('span', { class: 'brand' }, 'Exam Simulator'),
    search, seg,
    h('button', { class: 'btn', type: 'button', onclick: openSettings }, '⚙ Settings'));
}

function page() {
  state.els.notice = h('div', { class: 'lib-notice', hidden: true });
  state.els.board = h('section', { class: 'board', 'aria-label': 'Exams' });
  state.els.detail = h('section', { class: 'detail-slot', 'aria-label': 'Selected exam' });
  return h('div', { class: 'page' },
    h('div', { class: 'intake' }, dropzone(), promptBlock()),
    state.els.notice, state.els.board, state.els.detail);
}

function setView(v) {
  state.view = v;
  store(VIEW_KEY, v);
  state.els.seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  renderBoard();
}

async function openSettings() {
  try {
    const mod = await import('./settings.js');
    mod.open(state.ctx, { onChange: reload });
  } catch (e) {
    showNotice('bad', 'Settings are not built yet.');
  }
}

// ---- drop zone ------------------------------------------------------------------------

function dropzone() {
  const input = h('input', {
    type: 'file', accept: '.md,text/markdown', multiple: true, hidden: true,
    onchange: (e) => { uploadFiles([...e.target.files]); e.target.value = ''; },
  });
  const zone = h('div', {
    class: 'dropzone panel', role: 'button', tabindex: '0', 'aria-label': 'Add an exam file',
    onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      uploadFiles([...e.dataTransfer.files]);
    },
  },
  h('strong', null, 'Drop an exam file here'),
  h('span', { class: 'muted small' }, 'questions-and-answers-<maker>-<exam>-<n>.md · or click to choose'),
  input);
  return zone;
}

async function uploadFiles(files) {
  if (!files.length) return;
  const added = [];
  const failed = [];
  for (const file of files) {
    try {
      added.push(await state.ctx.api.upload(file));
    } catch (err) {
      failed.push({ name: file.name, errors: err.errors || [err.message] });
    }
  }
  const parts = [];
  added.forEach((a) => parts.push(h('div', null,
    `Added ${a.title} (${a.question_count} questions, ${a.domain_count} domains, ${a.duration_minutes} min).`)));
  failed.forEach((f) => parts.push(h('div', null, h('strong', null, `${f.name} was not added:`),
    h('ul', null, f.errors.map((e) => h('li', null, e))))));
  showNotice(failed.length ? 'bad' : 'ok', parts);
  if (added.length) state.selected = added[added.length - 1].id;
  await reload();
}

function showNotice(kind, content) {
  const n = state.els.notice;
  n.className = `lib-notice notice ${kind}`;
  clear(n, h('button', { class: 'notice-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => { n.hidden = true; } }, '×'), content);
  n.hidden = false;
}

// ---- prompt block ---------------------------------------------------------------------

function promptBlock() {
  const pre = h('pre', { class: 'prompt-text' }, 'Loading…');
  const copy = h('button', { class: 'btn copy', type: 'button' }, 'Copy');
  const details = h('details', { class: 'prompt panel' },
    h('summary', null,
      h('span', { class: 'caret', 'aria-hidden': 'true' }, '▶'),
      h('span', { class: 'mono prompt-name' }, 'prompt-for-exam.md'),
      h('span', { class: 'muted small prompt-desc' }, 'Format spec to give any AI with your exam request'),
      copy),
    pre);
  copy.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const label = (text) => {
      copy.textContent = text;
      setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
    };
    try {
      await navigator.clipboard.writeText(state.promptText);
      label('Copied');
    } catch (err) {
      details.open = true;
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      label('Selected · press ⌘C');
    }
  });
  state.els.promptPre = pre;
  return details;
}

async function loadPrompt() {
  try {
    state.promptText = await state.ctx.api.getPrompt();
    if (state) state.els.promptPre.textContent = state.promptText;
  } catch (e) {
    if (state) state.els.promptPre.textContent = 'Could not load prompt-for-exam.md';
  }
}

// ---- board ----------------------------------------------------------------------------

function matcher(query) {
  const q = query.trim();
  if (!q) return () => true;
  const m = q.match(/^\/(.+)\/$/);
  if (m) {
    let re;
    try { re = new RegExp(m[1], 'i'); } catch (e) { return () => false; }
    return (e) => re.test(e.id) || re.test(e.title);
  }
  const s = q.toLowerCase();
  return (e) => `${e.id} ${e.title} ${groupLabel(e.maker, e.exam)}`.toLowerCase().includes(s);
}

function renderBoard() {
  const board = state.els.board;
  if (!state.exams.length) {
    clear(board, h('div', { class: 'empty-view panel' },
      'No exams yet. Drop a file above. The sample in samples/questions-and-answers-sample-demo-1.md is a good first try.'));
    return;
  }
  const hits = state.exams.filter(matcher(state.query));
  if (!hits.length) {
    clear(board, h('div', { class: 'empty-view panel' }, `No exams match "${state.query}".`));
    return;
  }
  if (state.view === 'list') {
    clear(board, h('div', { class: 'listgrid' }, hits.map((e) => card(e, false))));
    return;
  }
  const groups = new Map();
  hits.forEach((e) => {
    const key = `${e.maker}-${e.exam}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  const columns = [...groups.keys()].sort().map((key) => {
    const list = groups.get(key).sort((a, b) => a.number - b.number);
    return h('div', { class: 'column' },
      h('div', { class: 'column-head' },
        h('span', null, groupLabel(list[0].maker, list[0].exam)),
        h('span', { class: 'muted' }, String(list.length))),
      h('div', { class: 'cascade' }, list.map((e, i) => card(e, i < list.length - 1))));
  });
  clear(board, h('div', { class: 'tableau' }, columns));
}

function card(e, strip) {
  const greenIndex = e.attempts_brief.findIndex((a) => a.number === e.green_attempt);
  return h('button', {
    type: 'button', class: `card${strip ? ' strip' : ''}${e.id === state.selected ? ' selected' : ''}`,
    dataset: { id: e.id }, 'aria-pressed': String(e.id === state.selected),
    onclick: () => select(e.id),
  },
  h('div', { class: 'card-top' },
    h('span', { class: 'tally' }, e.attempt_count ? tallySvg(e.attempt_count, greenIndex) : h('span', { class: 'muted small' }, 'not taken yet')),
    e.parse_issue ? h('span', { class: 'flag', title: 'Parse issue flagged, waiting for a fix' }, '🔧') : null),
  h('div', { class: 'card-label' }, groupLabel(e.maker, e.exam)),
  h('div', { class: 'card-title' }, e.title),
  h('div', { class: 'card-meta mono' }, `${e.id} · ${e.question_count} q · ${e.duration_minutes} min`));
}

function select(id) {
  state.selected = id;
  store(SELECTED_KEY, id);
  state.els.board.querySelectorAll('.card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === id);
    c.setAttribute('aria-pressed', String(c.dataset.id === id));
  });
  renderDetail();
}

// ---- selected exam ----------------------------------------------------------------------

async function renderDetail() {
  const slot = state.els.detail;
  const exam = state.exams.find((e) => e.id === state.selected);
  if (!exam) { clear(slot); return; }
  const token = ++state.detailToken;
  let data;
  try {
    data = await state.ctx.api.getAttempts(exam.id);
  } catch (err) {
    clear(slot, h('div', { class: 'notice bad' }, err.message));
    return;
  }
  if (!state || token !== state.detailToken) return;

  const go = () => state.ctx.navigate(`#/take/${exam.id}`);
  const timeNote = exam.duration_minutes !== exam.default_duration_minutes ? ` (changed from ${exam.default_duration_minutes})` : '';
  const rows = data.attempts.slice().reverse().map((a) => h('tr', {
    class: `clickable${a.number === data.green_attempt ? ' green' : ''}`, tabindex: '0',
    onclick: () => state.ctx.navigate(`#/results/${exam.id}/${a.number}`),
    onkeydown: (e) => { if (e.key === 'Enter') state.ctx.navigate(`#/results/${exam.id}/${a.number}`); },
  },
  h('td', { class: 'num' }, a.number),
  h('td', null, fmtDate(a.submitted_at)),
  h('td', { class: 'num' }, `${a.score_percent}%`, a.number === data.green_attempt ? h('span', { class: 'pill ok green-pill' }, 'green') : null),
  h('td', { class: `num${a.overtime ? ' over' : ''}` }, fmtClock(a.elapsed_seconds)),
  h('td', null, a.paused ? 'Paused' : 'Yes'),
  h('td', null, a.revised ? '✓' : h('span', { class: 'muted' }, '—'))));

  clear(slot, h('div', { class: 'panel detail' },
    h('div', { class: 'panel-head' },
      h('div', null,
        h('div', { class: 'card-label' }, `${groupLabel(exam.maker, exam.exam)} · ${exam.id}`, exam.parse_issue ? ' · 🔧 parse issue flagged' : ''),
        h('h2', null, exam.title),
        h('div', { class: 'muted small' }, `${exam.question_count} questions · ${exam.domain_count} domains · ${exam.duration_minutes} min${timeNote}`)),
      h('button', { class: 'btn primary', type: 'button', onclick: go }, data.attempts.length ? 'Retake' : 'Start')),
    data.attempts.length
      ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ['#', 'Date', 'Score', 'Completed in', 'Continuous', 'Revised'].map((t) => h('th', null, t)))),
        h('tbody', null, rows)))
      : h('div', { class: 'panel-body muted' }, 'No attempts yet. Start the exam to begin your tally.')));
}
