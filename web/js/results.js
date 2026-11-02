// Results for one attempt: score, time, pause status, revise prompt, Revised switch, domain breakdown, every question.
import { h, clear, richText, fmtClock, fmtDate, copyButton, downloadButton, selectText, markdown } from './util.js';

export async function render(root, ctx, examId, number) {
  const [exam, data, instructions] = await Promise.all([
    ctx.api.getExam(examId), ctx.api.getAttempts(examId), ctx.api.getRevisePrompt().catch(() => null)]);
  const attempt = data.attempts.find((a) => a.number === Number(number));
  const back = h('button', { class: 'btn', type: 'button', onclick: () => ctx.navigate('#/') }, '← Library');
  const retake = h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.navigate(`#/take/${exam.id}`) }, 'Retake');
  const bar = h('header', { class: 'topbar' },
    back, h('span', { class: 'title' }, `${exam.title} · Attempt ${number}`), retake);
  if (!attempt) {
    clear(root, bar, h('div', { class: 'empty-view' }, `Attempt ${number} was not found.`));
    return;
  }
  const pass = exam.pass_mark_percent ?? ctx.settings.pass_mark_percent;
  clear(root, bar, h('div', { class: 'page results' },
    header(ctx, exam, attempt, data.green_attempt === attempt.number, pass, instructions),
    domainBreakdown(exam, attempt, pass),
    h('section', { class: 'qresults', 'aria-label': 'Questions' },
      exam.questions.map((q) => questionResult(exam, attempt, q)))));
}

function header(ctx, exam, attempt, isGreen, pass, instructions) {
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
    h('div', { class: 'result-left' },
      h('div', { class: 'score-block' },
        h('span', { class: `score-big num ${attempt.score_percent >= pass ? 'pass' : 'fail'}` }, `${attempt.score_percent}%`),
        h('span', { class: 'muted num' }, `${attempt.correct} / ${attempt.total} correct · pass mark ${pass}%`),
        exam.flavour ? h('span', { class: 'flavour' }, exam.flavour) : null,
        exam.made_by ? h('span', { class: 'muted small' }, `Made by ${exam.made_by}`) : null),
      h('div', { class: 'result-facts' },
        h('span', { class: `num${attempt.overtime ? ' over' : ''}` },
          `Completed in ${fmtClock(attempt.elapsed_seconds)}`,
          h('span', { class: 'muted' }, ` of ${attempt.duration_minutes} min`),
          attempt.overtime ? ' · overtime' : ''),
        h('span', { class: 'pill' }, attempt.paused ? 'Paused during exam' : 'Taken continuously'),
        isGreen ? h('span', { class: 'pill ok' }, 'Green attempt') : null)),
    reviseBox(exam, attempt, pass, instructions),
    revised);
}

// ---- revise prompt --------------------------------------------------------------------
// prompt-exam-revise.md (fixed instructions) followed by this attempt's data. The box lives in a
// fixed-height slot of the header, so unfolding scrolls inside it and never moves the page.

function reviseBox(exam, attempt, pass, instructions) {
  const filename = `${exam.id}-revise-${attempt.number}.md`;
  const data = reviseData(exam, attempt, pass);
  const text = instructions === null ? data : `${instructions.trimEnd()}\n\n---\n\n${data}`;
  const pre = h('pre', { class: 'revise-text' },
    instructions === null ? `Could not load prompt-exam-revise.md; Copy and Download give the attempt data only.\n\n${text}` : text);
  const rendered = h('div', { class: 'revise-rendered prompt-rendered', hidden: true });
  let renderOn = false;
  const renderSwitch = h('button', {
    type: 'button', class: 'switch prompt-render', role: 'switch', 'aria-checked': 'false', title: 'Render the markdown',
    onclick: () => {
      renderOn = !renderOn;
      renderSwitch.setAttribute('aria-checked', String(renderOn));
      if (renderOn && !rendered.firstChild) rendered.append(markdown(text));
      rendered.hidden = !renderOn;
      pre.hidden = renderOn;
    },
  }, h('span', { class: 'knob' }), h('span', null, 'Render'));
  const box = h('div', { class: 'revise-box' });
  const toggle = h('button', {
    type: 'button', class: 'revise-toggle', 'aria-expanded': 'false', title: 'Show the prompt',
    onclick: () => setOpen(!box.classList.contains('open')),
  }, h('span', { class: 'caret', 'aria-hidden': 'true' }, '▶'), h('span', { class: 'mono prompt-name' }, filename));
  const body = h('div', { class: 'revise-body' }, pre, rendered);
  function setOpen(open) {
    box.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  const copy = copyButton(() => text, () => {
    setOpen(true);
    if (renderOn) renderSwitch.click();
    selectText(pre);
  });
  box.append(
    h('div', { class: 'revise-head' }, toggle,
      h('span', { class: 'revise-actions' }, renderSwitch, downloadButton(() => text, filename), copy)),
    body);
  return h('div', { class: 'revise-slot' }, box);
}

function reviseData(exam, attempt, pass) {
  const domains = exam.domains || [];
  const domainName = (id) => {
    const d = domains.find((x) => x.id === id);
    return d ? `${d.id} ${d.name}` : id;
  };
  const yours = (q) => attempt.answers[String(q.number)] || null;
  const noteOf = (q) => (attempt.notes[String(q.number)] || '').trim();
  const bookmarked = new Set(attempt.bookmarks || []);
  const verdict = (q) => (!yours(q) ? 'Unanswered' : yours(q) === q.answer ? 'Correct' : 'Incorrect');
  const oneLine = (s) => String(s || '').trim().replace(/\n+/g, ' ');

  const block = (q) => {
    const lines = [`### Q${q.number} · ${domainName(q.domain)} · ${verdict(q)}${bookmarked.has(q.number) ? ' · ★' : ''}`, '',
      String(q.text || '').trim(), ''];
    q.choices.forEach((c) => {
      const tags = [];
      if (c.label === yours(q)) tags.push("user's answer");
      if (c.label === q.answer) tags.push('correct answer');
      lines.push(`- ${c.label}) ${oneLine(c.text)}${tags.length ? ` ← ${tags.join(', ')}` : ''}`);
    });
    lines.push('', `**Explanation:** ${String(q.explanation || '').trim()}`);
    const note = noteOf(q);
    if (note) {
      lines.push('');
      lines.push(`**User's note:** "${note}"`);
    }
    return lines.join('\n');
  };

  // Each question is written out once, in the first section it belongs to; later sections point back.
  const shownIn = new Map();
  const section = (title, list) => {
    const full = [];
    const pointers = [];
    list.forEach((q) => {
      if (shownIn.has(q.number)) pointers.push(`- Q${q.number}: see "${shownIn.get(q.number)}"`);
      else {
        shownIn.set(q.number, title);
        full.push(block(q));
      }
    });
    const parts = [...full];
    if (pointers.length) parts.push(pointers.join('\n'));
    return `## ${title}\n\n${parts.length ? parts.join('\n\n') : 'None.'}`;
  };

  const qs = exam.questions;
  const summary = [`Score ${attempt.score_percent}% (${attempt.correct}/${attempt.total})`, `pass mark ${pass}%`,
    `completed in ${fmtClock(attempt.elapsed_seconds)} of ${attempt.duration_minutes} min`,
    attempt.paused ? 'paused during exam' : 'taken continuously'];
  if (attempt.overtime) summary.push('overtime');
  const domainLines = domains.map((d) => {
    const ds = (attempt.domain_scores || {})[d.id] || { correct: 0, total: 0 };
    if (!ds.total) return `- ${d.id} ${d.name}: no questions`;
    const pct = Math.round((1000 * ds.correct) / ds.total) / 10;
    return `- ${d.id} ${d.name}: ${ds.correct}/${ds.total} (${pct}%)${pct < pass ? ', below pass mark' : ''}`;
  });
  const meta = [`- Title: ${exam.title}`, `- ID: ${exam.id}`, `- Exam maker: ${exam.exam_maker}`,
    `- Exam name: ${exam.exam_name}`, `- Exam number: ${exam.exam_number}`,
    exam.made_by ? `- Made by: ${exam.made_by}` : null, exam.flavour ? `- Flavour: ${exam.flavour}` : null,
    `- ${qs.length} questions · ${domains.length} domains · ${attempt.duration_minutes} min · pass mark ${pass}%`,
  ].filter(Boolean);
  return [
    `# ${exam.title}, attempt ${attempt.number}`,
    `## Exam\n\n${meta.join('\n')}`,
    `## Attempt summary\n\nAttempt ${attempt.number}, ${fmtDate(attempt.submitted_at)} · ${summary.join(' · ')}`,
    `## Score by domain\n\n${domainLines.length ? domainLines.join('\n') : 'None.'}`,
    section('Questions the user got wrong', qs.filter((q) => verdict(q) !== 'Correct')),
    section("Questions with the user's notes", qs.filter((q) => noteOf(q))),
    section('Questions the user bookmarked', qs.filter((q) => bookmarked.has(q.number))),
  ].join('\n\n') + '\n';
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
