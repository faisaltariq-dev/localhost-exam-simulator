// Results for one attempt: score, time, pause status, Revised switch, domain breakdown, every question.
import { h, clear, richText, fmtClock } from './util.js';

export async function render(root, ctx, examId, number) {
  const [exam, data] = await Promise.all([ctx.api.getExam(examId), ctx.api.getAttempts(examId)]);
  const attempt = data.attempts.find((a) => a.number === Number(number));
  const back = h('button', { class: 'btn', type: 'button', onclick: () => ctx.navigate('#/') }, '← Library');
  const retake = h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.navigate(`#/take/${exam.id}`) }, 'Retake');
  const bar = h('header', { class: 'topbar' },
    back, h('span', { class: 'title' }, `${exam.title} · Attempt ${number}`), retake);
  if (!attempt) {
    clear(root, bar, h('div', { class: 'empty-view' }, `Attempt ${number} was not found.`));
    return;
  }
  const pass = ctx.settings.pass_mark_percent;
  clear(root, bar, h('div', { class: 'page results' },
    header(ctx, exam, attempt, data.green_attempt === attempt.number, pass),
    domainBreakdown(exam, attempt, pass),
    h('section', { class: 'qresults', 'aria-label': 'Questions' },
      exam.questions.map((q) => questionResult(exam, attempt, q)))));
}

function header(ctx, exam, attempt, isGreen, pass) {
  const revised = h('button', {
    type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(attempt.revised), id: 'revised',
    onclick: async () => {
      const next = revised.getAttribute('aria-checked') !== 'true';
      revised.setAttribute('aria-checked', String(next));
      try {
        await ctx.api.setRevised(exam.id, attempt.number, next);
      } catch (err) {
        revised.setAttribute('aria-checked', String(!next));
      }
    },
  }, h('span', { class: 'knob' }), h('span', null, 'Revised'));
  return h('section', { class: 'panel result-head' },
    h('div', { class: 'score-block' },
      h('span', { class: `score-big num ${attempt.score_percent >= pass ? 'pass' : 'fail'}` }, `${attempt.score_percent}%`),
      h('span', { class: 'muted num' }, `${attempt.correct} / ${attempt.total} correct · pass mark ${pass}%`)),
    h('div', { class: 'result-facts' },
      h('span', { class: `num${attempt.overtime ? ' over' : ''}` },
        `Completed in ${fmtClock(attempt.elapsed_seconds)}`,
        h('span', { class: 'muted' }, ` of ${attempt.duration_minutes} min`),
        attempt.overtime ? ' · overtime' : ''),
      h('span', { class: 'pill' }, attempt.paused ? 'Paused during exam' : 'Taken continuously'),
      isGreen ? h('span', { class: 'pill ok' }, 'Green attempt') : null),
    revised);
}

function domainBreakdown(exam, attempt, pass) {
  const rows = (exam.domains || []).map((d) => {
    const ds = (attempt.domain_scores || {})[d.id] || { correct: 0, total: 0 };
    const pct = ds.total ? Math.round((1000 * ds.correct) / ds.total) / 10 : null;
    const ok = pct !== null && pct >= pass;
    return h('tr', null,
      h('td', null, h('span', { class: 'mono domain-id' }, d.id), ` ${d.name}`),
      h('td', { class: 'num' }, ds.total ? `${ds.correct} / ${ds.total}` : '—'),
      h('td', { class: 'barcell' }, pct === null
        ? h('span', { class: 'muted small' }, 'no questions')
        : h('div', { class: 'barwrap' },
          h('div', { class: 'bar' }, h('div', { class: `fill ${ok ? 'pass' : 'fail'}`, style: `width:${pct}%` })),
          h('span', { class: `num pct ${ok ? 'pass' : 'fail'}` }, `${pct}%`))));
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { class: 'section-title' }, 'By domain'),
      h('span', { class: 'muted small' }, `Red is below the ${pass}% pass mark`)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'domains' },
      h('thead', null, h('tr', null, h('th', null, 'Domain'), h('th', null, 'Correct'), h('th', null, 'Score'))),
      h('tbody', null, rows))));
}

function questionResult(exam, attempt, q) {
  const yours = attempt.answers[String(q.number)] || null;
  const verdict = !yours ? ['Unanswered', 'bad'] : yours === q.answer ? ['Correct', 'ok'] : ['Incorrect', 'bad'];
  const domain = (exam.domains || []).find((d) => d.id === q.domain);
  const note = attempt.notes[String(q.number)];
  return h('article', { class: 'panel qresult' },
    h('div', { class: 'qresult-head' },
      h('strong', null, `Q${q.number}`),
      domain ? h('span', { class: 'domain-tag' }, `${domain.id} · ${domain.name}`) : null,
      attempt.bookmarks.includes(q.number) ? h('span', { class: 'star', title: 'Bookmarked' }, '★') : null,
      h('span', { class: 'spacer' }),
      h('span', { class: `pill ${verdict[1]}` }, verdict[0])),
    h('div', { class: 'qtext' }, richText(q.text)),
    h('div', { class: 'choices' }, q.choices.map((c) => {
      const isRight = c.label === q.answer;
      const isYours = c.label === yours;
      const cls = isRight ? 'right' : isYours ? 'wrong' : '';
      const tag = isRight && isYours ? 'Your answer · correct' : isRight ? 'Correct answer' : isYours ? 'Your answer' : '';
      return h('div', { class: `choice static ${cls}` },
        h('span', { class: 'bubble' }, c.label),
        h('span', { class: 'choice-text' }, richText(c.text)),
        tag ? h('span', { class: 'choice-tag' }, tag) : null);
    })),
    h('div', { class: 'explain' }, h('span', { class: 'block-label' }, 'Explanation'), richText(q.explanation)),
    note ? h('div', { class: 'your-note' }, h('span', { class: 'block-label' }, 'Your note'), h('div', { class: 'note-text' }, note)) : null);
}
