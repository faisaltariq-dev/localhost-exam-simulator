// Settings panel: theme × style, pass mark, and Manage exams (time, delete).
import { h, clear } from './util.js';

export function open(ctx, { onChange = () => {} } = {}) {
  const root = document.getElementById('overlays');
  const notice = h('div', { class: 'notice bad', hidden: true });
  const tbody = h('tbody');
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
    passInput.value = ctx.settings.pass_mark_percent;
  }
  const passInput = h('input', {
    type: 'number', id: 'pass-mark', min: '1', max: '100', class: 'num-input',
    onchange: (e) => {
      const v = Number(e.target.value);
      if (Number.isInteger(v) && v >= 1 && v <= 100) save({ pass_mark_percent: v });
      else e.target.value = ctx.settings.pass_mark_percent;
    },
  });

  // -- manage exams

  async function renderExams() {
    let exams;
    try {
      exams = await ctx.api.listExams();
    } catch (err) {
      showError(err);
      return;
    }
    if (!exams.length) {
      clear(tbody, h('tr', null, h('td', { colspan: '4', class: 'muted' }, 'No exams yet.')));
      return;
    }
    clear(tbody, exams.flatMap((e) => {
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
        h('td', { class: 'num' }, e.attempt_count),
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
    }));
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

  async function remove(exam) {
    try {
      await ctx.api.deleteExam(exam.id);
      pendingDelete = null;
      ctx.settings.duration_overrides = { ...ctx.settings.duration_overrides };
      delete ctx.settings.duration_overrides[exam.id];
      await onChange();
      renderExams();
    } catch (err) {
      showError(err);
    }
  }

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
          h('h3', null, 'Appearance'),
          h('div', { class: 'set-row' },
            h('span', { class: 'set-label' }, 'Theme'), seg('theme', [['light', 'Light'], ['dark', 'Dark']]),
            h('span', { class: 'set-label' }, 'Style'), seg('style', [['classic', 'Classic'], ['modern', 'Modern']])),
          h('p', { class: 'muted small' }, 'Classic looks like a test-centre client. Modern keeps the same layout with a lighter touch.')),
        h('section', { class: 'set-section' },
          h('h3', null, 'Scoring'),
          h('div', { class: 'set-row' },
            h('label', { class: 'set-label', for: 'pass-mark' }, 'Pass mark'), passInput, h('span', null, '%')),
          h('p', { class: 'muted small' }, 'Used for the green tally mark and the domain bars.')),
        h('section', { class: 'set-section' },
          h('h3', null, 'Manage exams'),
          h('p', { class: 'muted small' }, 'A time change only affects new attempts.'),
          h('div', { class: 'tablewrap' }, h('table', { class: 'manage' },
            h('thead', null, h('tr', null, ['Exam', 'Time (min)', 'Attempts', ''].map((t) => h('th', null, t)))),
            tbody))))));
  document.addEventListener('keydown', onKey);
  root.append(overlay);
  paintSegments();
  renderExams();
}
