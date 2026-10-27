// Exam screen: one attempt, held only in this tab until it is submitted.
import { h, clear, richText, firstSentence, firstWords, fmtClock, confirmDialog } from './util.js';

const LETTERS = ['A', 'B', 'C', 'D'];
let s = null;

export async function render(root, ctx, examId) {
  const exam = await ctx.api.getExam(examId);
  s = {
    ctx, exam, idx: 0, answers: {}, bookmarks: new Set(), notes: {},
    startedAt: new Date().toISOString(), accMs: 0, runningSince: performance.now(),
    everPaused: false, isPaused: false, done: false, els: {}, timer: null, review: null, pauseEl: null,
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('keydown', onKey);
  clear(root, topbar(), body());
  showQuestion();
  s.timer = setInterval(tick, 250);
  tick();
}

export function cleanup() {
  if (!s) return;
  clearInterval(s.timer);
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('keydown', onKey);
  s = null;
}

// Called by the router before leaving: an unsubmitted attempt is discarded only after asking.
export async function guard() {
  if (!s || s.done) return true;
  const ok = await confirmDialog({
    title: 'Leave this exam?',
    body: 'Your answers and notes for this attempt will be discarded.',
    confirmLabel: 'Leave and discard', cancelLabel: 'Stay', danger: true,
  });
  if (ok && s) s.done = true;
  return ok;
}

function onBeforeUnload(e) {
  if (s && !s.done) {
    e.preventDefault();
    e.returnValue = '';
  }
}

// ---- timer --------------------------------------------------------------------------------

function elapsedSeconds() {
  const running = s.runningSince === null ? 0 : performance.now() - s.runningSince;
  return Math.floor((s.accMs + running) / 1000);
}

function tick() {
  if (!s) return;
  const remaining = s.exam.duration_minutes * 60 - elapsedSeconds();
  const el = s.els.timer;
  el.textContent = fmtClock(remaining);
  el.classList.toggle('green', remaining >= 0);
  el.classList.toggle('red', remaining < 0);
  el.title = remaining >= 0 ? 'Time remaining' : 'Overtime';
}

function pause() {
  if (s.isPaused) return;
  s.accMs += performance.now() - s.runningSince;
  s.runningSince = null;
  s.isPaused = true;
  s.everPaused = true;
  const resume = h('button', { class: 'btn primary', type: 'button', onclick: resumeExam }, 'Resume');
  s.pauseEl = h('div', { class: 'pause-screen', role: 'dialog', 'aria-label': 'Exam paused' },
    h('div', { class: 'pause-box panel' },
      h('strong', { class: 'pause-warn' }, '⚠ Warning: real exams do not have a pause mechanism.'),
      h('p', { class: 'muted' }, 'The clock is stopped and the question is hidden. This attempt will be marked "Paused during exam".'),
      resume));
  document.getElementById('overlays').append(s.pauseEl);
  resume.focus();
}

function resumeExam() {
  s.runningSince = performance.now();
  s.isPaused = false;
  s.pauseEl.remove();
  s.pauseEl = null;
}

// ---- layout -------------------------------------------------------------------------------

function topbar() {
  s.els.timer = h('span', { class: 'timer mono num', 'aria-live': 'off' });
  return h('header', { class: 'topbar' },
    h('span', { class: 'title' }, s.exam.title),
    s.els.timer,
    h('button', { class: 'btn', type: 'button', onclick: pause }, 'Pause'),
    h('button', { class: 'btn', type: 'button', onclick: openReview }, 'Review'),
    h('button', { class: 'btn primary', type: 'button', onclick: submit }, 'Submit'));
}

function body() {
  const e = s.els;
  e.notice = h('div', { class: 'notice bad', hidden: true });
  e.qnum = h('div', { class: 'qnum muted' });
  e.qtext = h('div', { class: 'qtext' });
  e.choices = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Answer choices' });
  e.bookmark = h('button', { class: 'btn bookmark', type: 'button', onclick: toggleBookmark });
  e.note = h('textarea', {
    id: 'note', class: 'note', rows: '6', placeholder: 'Your note for this question',
    oninput: (ev) => {
      const n = currentQ().number;
      if (ev.target.value.trim()) s.notes[n] = ev.target.value;
      else delete s.notes[n];
    },
  });
  e.prev = h('button', { class: 'btn', type: 'button', onclick: () => goTo(s.idx - 1) }, '← Previous');
  e.next = h('button', { class: 'btn primary', type: 'button', onclick: () => goTo(s.idx + 1) }, 'Next →');
  e.progress = h('span', { class: 'muted small' });
  return h('div', { class: 'page exam-page' },
    e.notice,
    h('div', { class: 'panel qpanel' },
      h('div', { class: 'qgrid' },
        h('div', { class: 'qmain' }, e.qnum, e.qtext, e.choices),
        h('aside', { class: 'qside' },
          e.bookmark,
          h('label', { class: 'note-label', for: 'note' }, 'Note'),
          e.note)),
      h('div', { class: 'qnav' }, e.prev, e.progress, e.next)));
}

function currentQ() {
  return s.exam.questions[s.idx];
}

function goTo(i) {
  if (i < 0 || i >= s.exam.questions.length) return;
  s.idx = i;
  showQuestion();
}

function showQuestion() {
  const q = currentQ();
  const total = s.exam.questions.length;
  s.els.qnum.textContent = `Question ${s.idx + 1} of ${total}`;
  clear(s.els.qtext, richText(q.text));
  renderChoices();
  renderBookmark();
  s.els.note.value = s.notes[q.number] || '';
  s.els.prev.disabled = s.idx === 0;
  s.els.next.disabled = s.idx === total - 1;
  updateProgress();
  window.scrollTo(0, 0);
}

function renderChoices() {
  const q = currentQ();
  clear(s.els.choices, q.choices.map((c) => {
    const selected = s.answers[q.number] === c.label;
    return h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(selected), class: `choice${selected ? ' selected' : ''}`,
      onclick: () => choose(c.label),
    },
    h('span', { class: 'bubble' }, c.label),
    h('span', { class: 'choice-text' }, richText(c.text)));
  }));
}

function choose(label) {
  s.answers[currentQ().number] = label;
  renderChoices();
  updateProgress();
}

function renderBookmark() {
  const on = s.bookmarks.has(currentQ().number);
  s.els.bookmark.textContent = on ? '★ Bookmarked' : '☆ Bookmark';
  s.els.bookmark.setAttribute('aria-pressed', String(on));
  s.els.bookmark.classList.toggle('on', on);
}

function toggleBookmark() {
  const n = currentQ().number;
  if (s.bookmarks.has(n)) s.bookmarks.delete(n);
  else s.bookmarks.add(n);
  renderBookmark();
}

function updateProgress() {
  const answered = Object.keys(s.answers).length;
  s.els.progress.textContent = `${answered} of ${s.exam.questions.length} answered`;
}

// ---- keyboard -----------------------------------------------------------------------------

function onKey(e) {
  if (!s || s.isPaused) return;
  if (s.review) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (s.review.openChip) closePop();
      else closeReview();
    }
    return;
  }
  const typing = e.target instanceof Element && e.target.closest('textarea, input');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('#overlays .dialog')) return;
  const key = e.key.toUpperCase();
  if (e.key === 'ArrowLeft') goTo(s.idx - 1);
  else if (e.key === 'ArrowRight') goTo(s.idx + 1);
  else if (LETTERS.includes(key)) choose(key);
  else if (['1', '2', '3', '4'].includes(e.key)) choose(LETTERS[Number(e.key) - 1]);
  else return;
  e.preventDefault();
}

// ---- review panel -------------------------------------------------------------------------

const FILTERS = [
  ['all', 'All', () => true],
  ['bookmarked', '★ Bookmarked', (q) => s.bookmarks.has(q.number)],
  ['unanswered', 'Unanswered', (q) => !s.answers[q.number]],
  ['notes', 'With notes', (q) => !!s.notes[q.number]],
];

function openReview() {
  if (s.review) return;
  const tbody = h('tbody');
  const chips = h('div', { class: 'chips' });
  const pop = h('div', { class: 'note-pop', role: 'tooltip', hidden: true });
  const scroller = h('div', { class: 'review-body', onscroll: () => closePop() },
    h('table', null,
      h('thead', null, h('tr', null, ['#', 'Question', '★', 'Note', 'Status'].map((t) => h('th', null, t)))),
      tbody));
  const dialog = h('div', { class: 'dialog review-panel', role: 'dialog', 'aria-label': 'Review list' },
    h('div', { class: 'panel-head' },
      h('strong', null, `Review · ${s.exam.questions.length} questions`),
      chips),
    scroller,
    pop);
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'scrim', onclick: closeReview }), dialog);
  // Layered dismissal: while a note is open, the first click elsewhere only closes the note.
  overlay.addEventListener('click', (e) => {
    if (s.review && s.review.openChip && !e.target.closest('.note-pop') && !e.target.closest('.note-chip')) {
      closePop();
      e.stopPropagation();
    }
  }, true);
  s.review = { overlay, dialog, tbody, chips, pop, filter: 'all', openChip: null };
  renderReview();
  document.getElementById('overlays').append(overlay);
}

function closeReview() {
  if (!s.review) return;
  s.review.overlay.remove();
  s.review = null;
}

function renderReview() {
  const r = s.review;
  clear(r.chips, FILTERS.map(([key, label]) => h('button', {
    type: 'button', class: `chip${r.filter === key ? ' on' : ''}`, 'aria-pressed': String(r.filter === key),
    onclick: () => { r.filter = key; closePop(); renderReview(); },
  }, label)));
  const test = FILTERS.find((f) => f[0] === r.filter)[2];
  const rows = s.exam.questions.map((q, i) => ({ q, i })).filter(({ q }) => test(q));
  if (!rows.length) {
    clear(r.tbody, h('tr', null, h('td', { colspan: '5', class: 'muted' }, 'No questions match this filter.')));
    return;
  }
  clear(r.tbody, rows.map(({ q, i }) => {
    const note = s.notes[q.number];
    const answered = !!s.answers[q.number];
    return h('tr', {
      class: `clickable${i === s.idx ? ' current' : ''}`,
      onclick: () => { goTo(i); closeReview(); },
    },
    h('td', { class: 'num' }, q.number),
    h('td', { class: 'first', title: firstSentence(q.text, 400) }, firstSentence(q.text)),
    h('td', { class: 'star' }, s.bookmarks.has(q.number) ? '★' : ''),
    h('td', null, note
      ? h('button', {
        type: 'button', class: 'note-chip', 'aria-expanded': 'false', dataset: { q: q.number },
        onclick: (e) => { e.stopPropagation(); toggleNote(e.currentTarget, q.number); },
      }, firstWords(note, 3))
      : h('span', { class: 'muted' }, '—')),
    h('td', null, answered ? h('span', { class: 'pill' }, 'answered') : h('span', { class: 'pill bad' }, 'unanswered')));
  }));
}

function toggleNote(chip, number) {
  const r = s.review;
  if (r.openChip === chip) { closePop(); return; }
  closePop();
  r.openChip = chip;
  chip.setAttribute('aria-expanded', 'true');
  clear(r.pop, h('span', { class: 'pop-label' }, `Note · Q${number}`), h('div', { class: 'pop-text' }, s.notes[number]));
  r.pop.hidden = false;
  const dr = r.dialog.getBoundingClientRect();
  const cr = chip.getBoundingClientRect();
  const left = Math.max(8, Math.min(cr.left - dr.left, dr.width - r.pop.offsetWidth - 8));
  let top = cr.bottom - dr.top + 6;
  if (top + r.pop.offsetHeight > dr.height - 8) top = cr.top - dr.top - r.pop.offsetHeight - 6;
  r.pop.style.left = `${left}px`;
  r.pop.style.top = `${Math.max(8, top)}px`;
}

function closePop() {
  const r = s && s.review;
  if (!r || !r.openChip) return;
  r.openChip.setAttribute('aria-expanded', 'false');
  r.openChip = null;
  r.pop.hidden = true;
}

// ---- submit -------------------------------------------------------------------------------

async function submit() {
  const total = s.exam.questions.length;
  const unanswered = total - Object.keys(s.answers).length;
  const ok = await confirmDialog({
    title: 'Submit this exam?',
    body: h('p', null, `${unanswered} unanswered · ${s.bookmarks.size} bookmarked. Unanswered questions count as wrong.`),
    confirmLabel: 'Submit exam', cancelLabel: 'Keep working',
  });
  if (!ok || !s) return;
  const payload = {
    started_at: s.startedAt,
    submitted_at: new Date().toISOString(),
    duration_minutes: s.exam.duration_minutes,
    elapsed_seconds: elapsedSeconds(),
    paused: s.everPaused,
    answers: s.answers,
    bookmarks: [...s.bookmarks],
    notes: s.notes,
  };
  try {
    const attempt = await s.ctx.api.postAttempt(s.exam.id, payload);
    s.done = true;
    s.ctx.leave(`#/results/${s.exam.id}/${attempt.number}`);
  } catch (err) {
    s.els.notice.textContent = `Could not save this attempt: ${err.message}. Your answers are still here; try Submit again.`;
    s.els.notice.hidden = false;
  }
}
