// Library: drop zone, prompt block, search, tableau/list of exams, and the selected exam's history.
import {
  h, clear, groupLabel, tallySvg, fmtDate, fmtClock, dropTarget, blockStrayDrops, fileOrPaste, confirmDialog,
  examMatcher, copyButton, selectText, icon, downloadButton, markdown,
} from './util.js';

const VIEW_KEY = 'examsim.view';
// Shown faintly in the space a collapsed prompt block frees up.
const EXAM_TIPS = `1. **Read the last sentence first.** Know what's being asked before reading the scenario.
2. **Scan the options early.** Identify the concepts you need to focus on.
3. **Eliminate wrong answers.** Narrow down your choices before deciding.
4. **Spot keywords.** BEST, FIRST, NOT, and LEAST can change everything.
5. **True ≠ Correct.** Choose what answers the question, not just what's technically true.
6. **Stuck between two?** Compare their differences against the scenario's requirements.`;
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
  window.addEventListener('dragover', blockStrayDrops);
  window.addEventListener('drop', blockStrayDrops);
  clear(root, topbar(), page());
  loadPrompt();
  await reload();
}

export function cleanup() {
  window.removeEventListener('dragover', blockStrayDrops);
  window.removeEventListener('drop', blockStrayDrops);
  state = null;
}

async function reload() {
  if (!state) return;
  const [exams, repairs] = await Promise.all([state.ctx.api.listExams(), state.ctx.api.repairs()]);
  if (!state) return;
  state.exams = exams;
  const open = repairs.inbox.length + repairs.queue.length;
  state.els.settingsLabel.textContent = open ? `Settings · ${open}` : 'Settings';
  state.els.settingsBtn.title = open ? `Repairs: ${repairs.inbox.length} in the inbox, ${repairs.queue.length} in the queue` : '';
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
    ['list', 'tableau'].map((v) => h('button', {
      type: 'button', 'aria-pressed': String(state.view === v), dataset: { view: v },
      onclick: () => setView(v),
    }, v === 'tableau' ? 'Tableau' : 'List')));
  state.els.seg = seg;
  return h('header', { class: 'topbar' },
    h('span', { class: 'brand' }, 'Exam Simulator'),
    search, seg,
    state.els.settingsBtn = h('button', { class: 'btn icon-btn', type: 'button', onclick: openSettings },
      icon('gear'), state.els.settingsLabel = h('span', null, 'Settings')));
}

function page() {
  state.els.notice = h('div', { class: 'lib-notice', hidden: true });
  state.els.board = h('section', { class: 'board', 'aria-label': 'Exams' });
  state.els.detail = h('section', { class: 'detail-slot', 'aria-label': 'Selected exam' });
  return h('div', { class: 'page' },
    h('div', { class: 'intake' }, fileOrPaste(fileBox(), pasteBox(), 'Load an exam by'), promptBlock()),
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

// One file at a time: dropping or choosing only stages it; nothing loads until Load is pressed.
function fileBox() {
  let staged = null;
  const input = h('input', {
    type: 'file', accept: '.md,.txt,text/markdown,text/plain', hidden: true,
    onchange: (e) => { stage(e.target.files[0]); e.target.value = ''; },
  });
  const label = h('div', { class: 'dropzone-label' });
  const zone = h('div', {
    class: 'dropzone panel', role: 'button', tabindex: '0', 'aria-label': 'Choose an exam file',
    onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
  }, label, input);
  const loadBtn = h('button', {
    class: 'btn primary', type: 'button',
    onclick: async () => {
      if (!staged) return;
      if (await loadExam(staged.name, await staged.text())) stage(null);
    },
  }, 'Load');
  function stage(file) {
    staged = file || null;
    if (staged) {
      clear(label, h('strong', { class: 'staged-name' }, staged.name),
        h('button', {
          class: 'unstage', type: 'button', 'aria-label': `Remove ${staged.name}`,
          onclick: (e) => { e.stopPropagation(); stage(null); },
        }, '✕'));
    } else {
      clear(label, h('strong', null, 'Drop an exam file here'),
        h('span', { class: 'muted small' }, 'or click to choose · then press Load'));
    }
    loadBtn.disabled = !staged;
  }
  dropTarget(zone, (files) => stage(files[0]));
  stage(null);
  return h('div', { class: 'file-box' }, zone, h('div', { class: 'paste-actions' }, loadBtn));
}

function pasteBox() {
  const text = h('textarea', {
    id: 'paste-exam', class: 'paste-area', rows: '5', spellcheck: 'false',
    placeholder: 'Paste the whole exam here: the --- header, # Domains, # Questions and # Answers',
  });
  const go = async () => {
    if (!text.value.trim()) {
      showNotice('bad', 'Paste an exam first.');
      return;
    }
    if (await loadExam('Pasted text', text.value)) text.value = '';
  };
  return h('div', { class: 'paste-box' }, text,
    h('div', { class: 'paste-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Load')));
}

// Loads one exam and reports the result. Resolves true when it loaded.
async function loadExam(name, text) {
  let loaded;
  try {
    loaded = await state.ctx.api.load(text, name === 'Pasted text' ? '' : name);
  } catch (err) {
    if (err.data.duplicate === 'identical') {
      showNotice('ok', err.message);
      return true;
    }
    showNotice('bad', h('div', null, h('strong', null, `${name} was not loaded:`),
      h('ul', null, (err.errors || [err.message]).map((e) => h('li', null, e)))));
    return offerRepairs(text);
  }
  showNotice('ok', `Loaded ${loaded.title} (${loaded.question_count} questions, ${loaded.domain_count} domains, ${loaded.duration_minutes} min).`);
  state.selected = loaded.id;
  await reload();
  return true;
}

// After a failed load: ask whether to send the exam to Repairs, with an optional reason.
async function offerRepairs(text) {
  const reason = h('textarea', { id: 'repair-reason', class: 'paste-area', rows: '2', placeholder: 'Why? (optional)' });
  const yes = await confirmDialog({
    title: 'Send this to Repairs?',
    body: h('div', { class: 'repair-ask' },
      h('p', null, 'An agent can look at it and queue a fix for your approval.'),
      h('label', { class: 'muted small', for: 'repair-reason' }, 'Why? (optional)'), reason),
    confirmLabel: 'Send to Repairs', cancelLabel: 'No',
  });
  if (!yes || !state) return false;
  try {
    const sent = await state.ctx.api.sendToRepairs(text, reason.value);
    showNotice('ok', h('div', { class: 'inbox-hint' },
      `Saved as #${String(sent.id).padStart(3, '0')}. See Settings → Repairs.`,
      h('button', { class: 'btn', type: 'button', onclick: openSettings }, 'Open Settings')));
    await reload();
    return true;
  } catch (err) {
    showNotice('bad', `Could not send it to Repairs: ${err.message}`);
    return false;
  }
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
  const rendered = h('div', { class: 'prompt-rendered', hidden: true });
  // Raw by default; Render shows the same file as formatted markdown. Copy and download are always raw.
  let renderOn = false;
  const renderSwitch = h('button', {
    type: 'button', class: 'switch prompt-render', role: 'switch', 'aria-checked': 'false', title: 'Render the markdown',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderOn = !renderOn;
      renderSwitch.setAttribute('aria-checked', String(renderOn));
      if (renderOn) clear(rendered, markdown(state.promptText));
      rendered.hidden = !renderOn;
      pre.hidden = renderOn;
    },
  }, h('span', { class: 'knob' }), h('span', null, 'Render'));
  const copy = copyButton(() => state.promptText, () => {
    details.open = true;
    if (renderOn) renderSwitch.click();
    selectText(pre);
  });
  // Open by default; folding it hides the text, unfolding drops the same height as the other boxes.
  const details = h('details', { class: 'prompt panel', open: true },
    h('summary', { class: 'prompt-head' },
      h('span', { class: 'caret', 'aria-hidden': 'true' }, '▶'),
      h('span', { class: 'mono prompt-name' }, 'prompt-exam-parsable-output.md'),
      h('span', { class: 'muted small prompt-desc' }, 'Format spec to give any AI with your exam request'),
      renderSwitch,
      downloadButton(() => state.promptText, 'prompt-exam-parsable-output.md'),
      copy),
    pre, rendered);
  state.els.promptPre = pre;
  const tips = h('div', { class: 'exam-tips', 'aria-label': 'Exam tips' }, markdown(EXAM_TIPS));
  const syncTips = () => { tips.hidden = details.open; };
  details.addEventListener('toggle', syncTips);
  syncTips();
  return h('div', { class: 'prompt-col' }, details, tips);
}

async function loadPrompt() {
  try {
    state.promptText = await state.ctx.api.getPrompt();
    if (state) state.els.promptPre.textContent = state.promptText;
  } catch (e) {
    if (state) state.els.promptPre.textContent = 'Could not load prompt-exam-parsable-output.md';
  }
}

// ---- board ----------------------------------------------------------------------------

function renderBoard() {
  const board = state.els.board;
  if (!state.exams.length) {
    clear(board, h('div', { class: 'empty-view panel' },
      'No exams yet. Drop a file above. The sample in samples/questions-and-answers-sample-demo-1.md is a good first try.'));
    return;
  }
  const hits = state.exams.filter(examMatcher(state.query));
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
    h('span', { class: 'tally' }, e.attempt_count ? tallySvg(e.attempt_count, greenIndex) : null)),
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
        h('div', { class: 'card-label' }, `${groupLabel(exam.maker, exam.exam)} · ${exam.id}`),
        h('h2', null, exam.title),
        h('div', { class: 'muted small' }, `${exam.question_count} questions · ${exam.domain_count} domains · ${exam.duration_minutes} min${timeNote} · pass ${exam.pass_mark_percent}%`)),
      h('button', { class: 'btn primary', type: 'button', onclick: go }, data.attempts.length ? 'Retake' : 'Start')),
    data.attempts.length
      ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ['#', 'Date', 'Score', 'Completed in', 'Continuous', 'Revised'].map((t) => h('th', null, t)))),
        h('tbody', null, rows)))
      : h('div', { class: 'panel-body muted' }, 'No attempts yet. Start the exam to begin your tally.')));
}
