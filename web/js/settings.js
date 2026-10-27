// Settings panel: Repairs, theme × style, pass mark, and Manage exams (time, delete).
import { h, clear, groupLabel, examMatcher } from './util.js';

const AGENT_LINE = 'Read .FIXPARSE.MD in this folder and work through the Repairs inbox.';

export function open(ctx, { onChange = () => {} } = {}) {
  const root = document.getElementById('overlays');
  const notice = h('div', { class: 'notice bad', hidden: true });
  const manageCount = h('span');
  const manageShown = h('span', { class: 'muted small' });
  const manageGroups = h('div', { class: 'manage-groups' });
  const manage = { filter: '', open: new Set() };
  let pendingDelete = null;

  const showError = (err) => {
    notice.textContent = err.message;
    notice.hidden = false;
  };

  async function save(patch) {
    notice.hidden = true;
    try {
      ctx.applySettings(await ctx.api.putSettings(patch));
      paintSegments();
      await onChange();
    } catch (err) {
      showError(err);
    }
  }

  // -- appearance

  const segments = {};
  const seg = (key, options) => {
    const el = h('div', { class: 'seg', role: 'group', 'aria-label': key },
      options.map(([value, label]) => h('button', {
        type: 'button', dataset: { value }, onclick: () => save({ [key]: value }),
      }, label)));
    segments[key] = el;
    return el;
  };
  function paintSegments() {
    for (const [key, el] of Object.entries(segments)) {
      el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(ctx.settings[key] === b.dataset.value)));
    }
  }

  // -- manage exams

  async function renderExams() {
    let exams;
    try {
      exams = await ctx.api.listExams();
    } catch (err) {
      showError(err);
      return;
    }
    manageCount.textContent = `Manage exams (${exams.length})`;
    const hits = exams.filter(examMatcher(manage.filter));
    manageShown.textContent = manage.filter.trim() ? `${hits.length} shown` : '';
    if (!hits.length) {
      clear(manageGroups, h('p', { class: 'muted small' }, exams.length ? 'No exams match.' : 'No exams yet.'));
      return;
    }
    const groups = new Map();
    hits.forEach((e) => {
      const key = `${e.maker}-${e.exam}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    const filtering = Boolean(manage.filter.trim());
    clear(manageGroups, [...groups.keys()].sort().map((key) => {
      const list = groups.get(key).sort((x, y) => x.number - y.number);
      return h('details', {
        class: 'manage-group', open: filtering || manage.open.has(key),
        ontoggle: (ev) => { if (!filtering) (ev.target.open ? manage.open.add(key) : manage.open.delete(key)); },
      },
      h('summary', null, `${groupLabel(list[0].maker, list[0].exam)} (${list.length})`),
      h('div', { class: 'tablewrap' }, h('table', { class: 'manage' },
        h('thead', null, h('tr', null, ['Exam', 'Time (min)', 'Pass %', ''].map((t) => h('th', null, t)))),
        h('tbody', null, list.flatMap(examRows)))));
    }));
  }

  function examRows(e) {
    const changed = e.duration_minutes !== e.default_duration_minutes;
    const row = h('tr', null,
      h('td', null, h('div', { class: 'mono' }, e.id), h('div', { class: 'muted small' }, e.title)),
      h('td', null,
        h('input', {
          type: 'number', min: '1', max: '600', class: 'num-input', id: `time-${e.id}`, value: e.duration_minutes,
          'aria-label': `Time in minutes for ${e.id}`,
          onchange: (ev) => setTime(e, ev.target),
        }),
        h('div', { class: 'muted small' }, changed ? `changed · default ${e.default_duration_minutes}` : 'default')),
      h('td', null,
        h('input', {
          type: 'number', min: '1', max: '100', class: 'num-input', id: `pass-${e.id}`, value: e.pass_mark_percent,
          'aria-label': `Pass mark in percent for ${e.id}`,
          onchange: (ev) => setPass(e, ev.target),
        }),
        h('div', { class: 'muted small' },
          e.pass_mark_percent !== e.default_pass_mark_percent ? `changed · default ${e.default_pass_mark_percent}` : 'default')),
      h('td', null, h('button', {
        type: 'button', class: 'btn', onclick: () => { pendingDelete = e.id; renderExams(); },
      }, 'Delete…')));
    if (pendingDelete !== e.id) return [row];
    const confirmRow = h('tr', { class: 'confirm-row' }, h('td', { colspan: '4' },
      h('div', { class: 'confirm-box' },
        h('span', null, `Delete ${e.id}, its original .md and ${e.attempt_count} attempt${e.attempt_count === 1 ? '' : 's'}? This can't be undone.`),
        h('span', { class: 'actions' },
          h('button', { type: 'button', class: 'btn danger', onclick: () => remove(e) }, 'Delete for good'),
          h('button', { type: 'button', class: 'btn', onclick: () => { pendingDelete = null; renderExams(); } }, 'Cancel')))));
    return [row, confirmRow];
  }

  async function setTime(exam, input) {
    const v = Number(input.value);
    if (!Number.isInteger(v) || v < 1 || v > 600) {
      input.value = exam.duration_minutes;
      return;
    }
    const overrides = { ...ctx.settings.duration_overrides };
    if (v === exam.default_duration_minutes) delete overrides[exam.id];
    else overrides[exam.id] = v;
    await save({ duration_overrides: overrides });
    renderExams();
  }

  async function setPass(exam, input) {
    const v = Number(input.value);
    if (!Number.isInteger(v) || v < 1 || v > 100) {
      input.value = exam.pass_mark_percent;
      return;
    }
    const overrides = { ...(ctx.settings.pass_mark_overrides || {}) };
    if (v === ctx.settings.pass_mark_percent) delete overrides[exam.id];
    else overrides[exam.id] = v;
    await save({ pass_mark_overrides: overrides });
    renderExams();
  }

  async function remove(exam) {
    try {
      await ctx.api.deleteExam(exam.id);
      pendingDelete = null;
      ctx.settings.duration_overrides = { ...ctx.settings.duration_overrides };
      delete ctx.settings.duration_overrides[exam.id];
      ctx.settings.pass_mark_overrides = { ...(ctx.settings.pass_mark_overrides || {}) };
      delete ctx.settings.pass_mark_overrides[exam.id];
      await onChange();
      renderExams();
    } catch (err) {
      showError(err);
    }
  }

  // -- repairs: exams that failed to load. State lives in repairs/log.md; the app only reads it
  //    and appends owner actions (approve, reject, note).

  const repairsBody = h('div', { class: 'repairs' });
  const repairsNotice = h('div', { class: 'notice', hidden: true });
  const view = { logOpen: true, lastOnly: true, rejecting: null };
  const tag = (n) => `#${String(n).padStart(3, '0')}`;

  function say(kind, text) {
    repairsNotice.className = `notice ${kind}`;
    repairsNotice.textContent = text;
    repairsNotice.hidden = false;
  }

  async function act(fn, okText) {
    repairsNotice.hidden = true;
    try {
      const result = await fn();
      if (okText) say('ok', typeof okText === 'function' ? okText(result) : okText);
    } catch (err) {
      say('bad', err.message);
    }
    view.rejecting = null;
    await refreshRepairs();
    await onChange();
  }

  function logLine(e) {
    return h('li', { class: `log-line${e.id === null ? ' odd' : ''}` },
      e.id === null ? e.message : [
        h('span', { class: 'mono muted' }, e.time), ' ',
        h('strong', { class: 'mono' }, tag(e.id)), ' ',
        h('span', { class: `pill log-${e.event}` }, `${e.who} · ${e.event}`), ' ',
        e.message]);
  }

  function queueItem(item) {
    const isDelete = item.kind === 'delete';
    const queued = [...item.history].reverse().find((e) => e.event === (isDelete ? 'queued-delete' : 'queued'));
    const msg = queued ? queued.message : item.latest.message;
    const failed = item.latest.event === 'failed' ? h('p', { class: 'bad-text small' }, `Last approve failed: ${item.latest.message}`) : null;
    let actions;
    if (view.rejecting === item.id) {
      const why = h('textarea', { id: `reject-${item.id}`, class: 'paste-area', rows: '2', placeholder: 'Why? (optional)' });
      actions = h('div', { class: 'reject-box' }, why,
        h('div', { class: 'paste-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => { view.rejecting = null; refreshRepairs(); } }, 'Cancel'),
          h('button', {
            class: 'btn danger', type: 'button',
            onclick: () => act(() => ctx.api.rejectRepair(item.id, why.value), `${tag(item.id)} went back to the inbox.`),
          }, 'Reject')));
    } else {
      actions = h('div', { class: 'paste-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => { view.rejecting = item.id; refreshRepairs(); } }, 'Reject'),
        isDelete
          ? h('button', {
            class: 'btn danger', type: 'button',
            onclick: () => act(() => ctx.api.approveRepair(item.id), (r) => `${tag(item.id)} moved to ${r.moved_to}/.`),
          }, 'Delete')
          : h('button', {
            class: 'btn go', type: 'button', disabled: !item.fix_ready,
            onclick: () => act(() => ctx.api.approveRepair(item.id), (r) => `${tag(item.id)} loaded as ${r.id}.`),
          }, 'Load'));
    }
    return h('li', { class: `queue-item${isDelete ? ' delete' : ''}` },
      isDelete ? h('div', { class: 'proposal small' }, 'Proposed: delete this request') : null,
      h('div', null, h('strong', { class: 'mono' }, tag(item.id)), ' ', msg),
      failed, actions);
  }

  async function refreshRepairs() {
    let s;
    try {
      s = await ctx.api.repairs();
    } catch (err) {
      say('bad', err.message);
      return;
    }
    const open = s.items.map((i) => tag(i.id)).join(' ');
    const status = s.items.length
      ? h('p', { class: 'repairs-status' }, `${s.items.length} open: ${open}`)
      : h('p', { class: 'repairs-status muted' }, 'All good. Nothing needs your decision.');

    const queue = s.items.filter((i) => i.where === 'queue');
    const queueBlock = queue.length ? h('ul', { class: 'queue-list' }, queue.map(queueItem)) : null;

    const inboxIds = s.inbox;
    const pick = h('select', { id: 'note-id', 'aria-label': 'Inbox item', disabled: !inboxIds.length },
      inboxIds.length ? inboxIds.map((n) => h('option', { value: n }, tag(n))) : h('option', null, 'none'));
    const noteText = h('input', { type: 'text', id: 'note-text', class: 'note-input', placeholder: 'Add to the log…', disabled: !inboxIds.length });
    const addNote = h('button', {
      class: 'btn', type: 'button', disabled: !inboxIds.length,
      onclick: () => noteText.value.trim() && act(() => ctx.api.noteRepair(Number(pick.value), noteText.value), 'Added to the log.'),
    }, 'Add');

    let lines = s.log;
    if (view.lastOnly) {
      const last = new Map();
      lines.forEach((e) => { if (e.id !== null) last.set(e.id, e); });
      lines = [...last.values()];
    }
    const lastOnly = h('input', {
      type: 'checkbox', id: 'log-last-only', checked: view.lastOnly,
      onchange: (e) => { view.lastOnly = e.target.checked; refreshRepairs(); },
    });
    const log = h('details', {
      class: 'repairs-log', open: view.logOpen,
      ontoggle: (e) => { view.logOpen = e.target.open; },
    },
    h('summary', null, `Log (${s.log.length} lines)`),
    h('label', { class: 'small', for: 'log-last-only' }, lastOnly, ' Last entry per item only'),
    lines.length ? h('ol', { class: 'log-lines' }, [...lines].reverse().map(logLine)) : h('p', { class: 'muted small' }, 'Empty.'));

    clear(repairsBody,
      h('p', { class: 'repairs-counts' }, `Inbox ${s.inbox.length} · Queue ${s.queue.length}`),
      status, queueBlock,
      h('div', { class: 'note-row' }, pick, noteText, addNote),
      log);
  }

  const agentCode = h('code', { class: 'agent-text' }, AGENT_LINE);
  const agentCopy = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(AGENT_LINE);
        agentCopy.textContent = 'Copied';
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents(agentCode);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        agentCopy.textContent = 'Selected · press ⌘C';
      }
      setTimeout(() => { agentCopy.textContent = 'Copy'; }, 1800);
    },
  }, 'Copy');

  // -- panel

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'scrim', onclick: close }),
    h('div', { class: 'dialog settings-panel', role: 'dialog', 'aria-label': 'Settings' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'section-title' }, 'Settings'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')),
      h('div', { class: 'settings-body' },
        notice,
        h('section', { class: 'set-section' },
          h('h3', null, 'General'),
          h('div', { class: 'set-row' },
            h('span', { class: 'set-label' }, 'Theme'), seg('theme', [['light', 'Light'], ['dark', 'Dark']]),
            h('span', { class: 'set-label' }, 'Style'), seg('style', [['classic', 'Classic'], ['modern', 'Modern']])),
          h('p', { class: 'muted small' },
            'Classic looks like a test-centre client; Modern keeps the same layout with a lighter touch.')),
        h('section', { class: 'set-section' },
          h('h3', null, 'Manage exams'),
          h('details', { class: 'manage-box' },
            h('summary', null, manageCount),
            h('div', { class: 'manage-filter' },
              h('input', {
                type: 'search', id: 'manage-filter', class: 'lib-search', autocomplete: 'off',
                placeholder: 'Filter: adp, practice 2, /gcp-.*-1/', 'aria-label': 'Filter exams',
                oninput: (ev) => { manage.filter = ev.target.value; renderExams(); },
              }),
              manageShown),
            h('p', { class: 'muted small' }, 'A time change only affects new attempts.'),
            manageGroups)),
        h('section', { class: 'set-section' },
          h('h3', null, 'Repairs'),
          h('p', { class: 'muted small' }, 'Exams that failed to load and were sent here. An agent queues fixes; you approve or reject them.'),
          repairsNotice,
          repairsBody,
          h('p', { class: 'small' }, 'To work through the inbox, start an agent in this folder and give it this line:'),
          h('div', { class: 'agent-line' }, agentCode, agentCopy)))));
  document.addEventListener('keydown', onKey);
  root.append(overlay);
  paintSegments();
  renderExams();
  refreshRepairs();
}
