import { db, state, LETTERS } from './state.js';
import { showScreen, selectionLabel, confirmSubmit } from './navigation.js';
import { subjClass, shuffle, getWeekKey } from './utils.js';
import { fetchAllSubjectQuestions, saveStorage } from './db.js';
import { awardXP } from './xp.js';
import { checkAndShowAchievements } from './achievements.js';
import { saveToLeaderboard } from './leaderboard.js';
import { saveSessionToSupabase } from './practice-quiz.js';

// ── TIMED / GRAND TEST ────────────────────────────────────────────────────────
// Split out of js/quiz.js (Stage 4).

export function renderTimedDurationOptions() {
  const maxFree = state.adminConfig.free_max_test_duration;
  const options = [
    { mins: 15, label: '15 Minutes', sub: '15 Questions' },
    { mins: 30, label: '30 Minutes', sub: '30 Questions' },
    { mins: 45, label: '45 Minutes', sub: '45 Questions' },
    { mins: 60, label: '1 Hour', sub: '60 Questions' },
    { mins: 90, label: '1.5 Hours', sub: '90 Questions' },
    { mins: 120, label: '2 Hours', sub: '120 Questions' },
    { mins: 150, label: '2.5 Hours', sub: '150 Questions' },
    { mins: 180, label: '3 Hours', sub: '180 Questions' },
  ];
  const isFree = state.userPlan === 'free';
  // default select first allowed option
  const firstAllowed = options.find(o => !isFree || o.mins <= maxFree);
  if (firstAllowed) { state.timedQCount = firstAllowed.mins; state.timedDuration = firstAllowed.mins * 60; }
  document.getElementById('timed-duration-options').innerHTML = options.map(o => {
    const locked = isFree && o.mins > maxFree;
    const isSelected = o.mins === state.timedQCount;
    return `<button class="sel-btn${isSelected ? ' active' : ''}${locked ? ' disabled' : ''}"
      style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem"
      ${locked ? `onclick="showUpgradePrompt('Timed Tests > ${o.label}')"` : `onclick="pickTimedDuration(${o.mins},this)"`}>
      <span>⏱ ${o.label}</span>
      <span style="font-size:.8rem;opacity:.7">${locked ? '🔒 Premium' : o.sub}</span>
    </button>`;
  }).join('');
}
export function pickTimedDuration(mins, btn) {
  state.timedQCount = mins;
  state.timedDuration = mins * 60;
  document.querySelectorAll('#timed-duration-options .sel-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

export async function startTimedTest() {
  const name = document.getElementById('timed-name').value.trim();
  if (!name) { document.getElementById('timed-err').style.display = 'block'; return; }
  document.getElementById('timed-err').style.display = 'none';
  const btn = document.querySelector('#screen-timed-setup .btn-gold');
  btn.textContent = 'Loading questions…'; btn.disabled = true;
  try {
    const subjects = state.selection.standard?.subjects || [];
    let allQs = [];
    if (subjects.length > 1) {
      const results = await Promise.all(subjects.map(s =>
        fetchAllSubjectQuestions(state.selection.language.label, state.selection.standard.id, s)
      ));
      const perSubj = Math.floor(state.timedQCount / subjects.length);
      results.forEach((subQs, i) => {
        allQs = allQs.concat(shuffle(subQs.map(q => ({ ...q, subject: subjects[i]?.label || q.subject }))).slice(0, perSubj));
      });
    } else {
      allQs = await fetchAllSubjectQuestions(state.selection.language.label, state.selection.standard.id, state.selection.subject);
    }
    const qs = shuffle(allQs).slice(0, state.timedQCount);
    state.timedState = { questions: qs, idx: 0, answers: {}, marked: {}, secs: state.timedDuration, totalSecs: state.timedDuration, timer: null, start: Date.now(), name };
    document.getElementById('tq-total').textContent = qs.length;
    updateTimerDisplay();
    renderTimedQ();
    renderQNav();
    showScreen('timed-quiz');
    state.timedState.timer = setInterval(timerTick, 1000);
  } catch (e) {
    alert('Failed to load questions for timed test.');
  }
  btn.textContent = '🚀 Start Timed Test'; btn.disabled = false;
}

export function updateTimerDisplay() {
  const h = Math.floor(state.timedState.secs / 3600), m = Math.floor((state.timedState.secs % 3600) / 60), s = state.timedState.secs % 60;
  const el = document.getElementById('tq-timer');
  el.textContent = `⏱ ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('urgent', state.timedState.secs <= 300);
}

export function renderTimedQ() {
  const { questions, idx, answers, marked } = state.timedState;
  const q = questions[idx];
  document.getElementById('tq-num').textContent = idx + 1;
  document.getElementById('tq-progress').style.width = ((idx + 1) / questions.length * 100) + '%';
  const sc = document.getElementById('tq-subj-chip');
  sc.textContent = q.subject || state.selection.subject?.label || '';
  sc.className = 'subject-chip ' + subjClass(q.subject || state.selection.subject?.label);
  document.getElementById('tq-question').textContent = q.question;
  document.getElementById('tq-options').innerHTML = q.options.map((o, i) =>
    `<div class="opt${answers[idx] === i ? ' selected' : ''}" onclick="answerTimed(${i})"><div class="opt-key">${LETTERS[i]}</div>${o}</div>`
  ).join('');
  document.getElementById('tq-prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
  document.getElementById('tq-next').textContent = idx === questions.length - 1 ? 'Finish →' : 'Next →';
  const markBtn = document.getElementById('tq-mark');
  markBtn.classList.toggle('marked', !!marked[idx]);
  markBtn.textContent = marked[idx] ? '🟡 Marked' : '🟡 Mark for Review';
}

export function answerTimed(i) { state.timedState.answers[state.timedState.idx] = i; renderTimedQ(); renderQNav(); }
export function toggleMark() { state.timedState.marked[state.timedState.idx] = !state.timedState.marked[state.timedState.idx]; renderTimedQ(); renderQNav(); }
export function timedNav(dir) {
  if (dir === 1 && state.timedState.idx === state.timedState.questions.length - 1) { confirmSubmit(); return; }
  state.timedState.idx = Math.max(0, Math.min(state.timedState.questions.length - 1, state.timedState.idx + dir));
  renderTimedQ(); renderQNav();
}
export function jumpToQ(i) { state.timedState.idx = i; renderTimedQ(); renderQNav(); }

export function renderQNav() {
  const { questions, idx, answers, marked } = state.timedState;
  const groups = {};
  questions.forEach((q, i) => {
    const s = q.chapter || q.topic || 'Questions';
    if (!groups[s]) groups[s] = [];
    groups[s].push(i);
  });
  let html = '';
  for (const [label, indices] of Object.entries(groups)) {
    html += `<div class="qnav-section">${label}</div><div class="qnav-grid">`;
    html += indices.map(i => {
      let cls = 'qnav-btn';
      if (i === idx) cls += ' current';
      else if (marked[i]) cls += ' marked';
      else if (answers[i] !== undefined) cls += ' answered';
      else cls += ' notanswered';
      return `<button class="${cls}" onclick="jumpToQ(${i})">${i + 1}</button>`;
    }).join('');
    html += '</div>';
  }
  document.getElementById('qnav-grid').innerHTML = html;
}

export function timerTick() {
  state.timedState.secs--;
  updateTimerDisplay();
  if (state.timedState.secs <= 0) { clearInterval(state.timedState.timer); finishTimedTest(); }
}

export async function finishTimedTest() {
  clearInterval(state.timedState.timer);
  const { questions, answers, name, start } = state.timedState;
  const total = questions.length;
  let correct = 0, wrong = 0, skipped = 0;
  questions.forEach((q, i) => {
    if (answers[i] === undefined) skipped++;
    else if (answers[i] === q.correct) correct++;
    else wrong++;
  });
  const pct = Math.round(correct / total * 100);
  const timeTaken = Math.round((Date.now() - start) / 1000);
  const accuracy = total - skipped > 0 ? Math.round(correct / (total - skipped) * 100) : 0;

  document.getElementById('tr-pct').textContent = pct + '%';
  document.getElementById('tr-correct').textContent = correct;
  document.getElementById('tr-wrong').textContent = wrong;
  document.getElementById('tr-skipped').textContent = skipped;
  document.getElementById('tr-accuracy').textContent = accuracy + '%';
  document.getElementById('tr-time').textContent = `${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s`;
  document.getElementById('tr-avg').textContent = Math.round(timeTaken / total) + 's';
  document.getElementById('tr-grade').textContent = [[90, '🥇 Excellent!'], [75, '🥈 Great Job!'], [60, '🥉 Good Effort'], [0, '📚 Keep Practicing']].find(([m]) => pct >= m)[1];
  document.getElementById('tr-name').textContent = `Student: ${name} · ${selectionLabel()}`;

  const chapData = {};
  questions.forEach((q, i) => {
    const c = q.chapter || q.topic || 'General';
    if (!chapData[c]) chapData[c] = { total: 0, correct: 0 };
    chapData[c].total++;
    if (answers[i] === q.correct) chapData[c].correct++;
  });
  const chapArr = Object.entries(chapData).map(([c, d]) => ({ c, p: Math.round(d.correct / d.total * 100) })).sort((a, b) => b.p - a.p);
  const subj = state.selection.subject?.label || 'Physics';
  document.getElementById('tr-subject-analysis').innerHTML = `<div class="subj-row">
    <div class="subj-label">${subj}</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div style="font-weight:700;color:var(--purple)">${pct}%</div></div>`;
  document.getElementById('tr-chapter-analysis').innerHTML = chapArr.map(({ c, p }) => `
    <div class="topic-row"><div class="topic-header"><div class="topic-name">${c}</div><div style="font-weight:700;color:${p >= 75 ? 'var(--success)' : p >= 50 ? 'var(--warning)' : 'var(--danger)'}">${p}%</div></div>
    <div class="progress-bar"><div class="progress-fill ${p >= 75 ? 'success' : p >= 50 ? 'gold' : 'danger'}" style="width:${p}%"></div></div></div>`).join('');

  const strong = chapArr.filter(c => c.p >= 75).map(c => c.c);
  const weak = chapArr.filter(c => c.p < 50).map(c => c.c);
  const tip = pct >= 90 ? 'Outstanding! You are NEET-ready.' : pct >= 75 ? 'Great performance! Focus on weak chapters.' : pct >= 60 ? 'Good effort. Daily focused study will help.' : 'Keep practising — consistency brings improvement.';
  document.getElementById('tr-insights').innerHTML = [
    `<div class="insight-card strength"><h4>💪 Strengths</h4><p>${strong.length ? `Strong in <b>${strong.slice(0, 3).join(', ')}</b>.` : 'Keep practising to build strengths.'}</p></div>`,
    `<div class="insight-card improve"><h4>🎯 Needs Improvement</h4><p>${weak.length ? `<b>${weak.slice(0, 3).join(', ')}</b> need more revision.` : 'No major weak areas detected.'}</p></div>`,
    weak.length ? `<div class="insight-card action"><h4>📚 Recommended Action</h4><p>Practice more <b>${weak[0]}</b> questions this week.</p></div>` : '',
    `<div class="insight-card tip"><h4>💡 Overall Tip</h4><p>${tip}</p></div>`
  ].join('');

  const newMistakes = [];
  questions.forEach((q, i) => {
    if (answers[i] !== undefined && answers[i] !== q.correct) {
      const entry = { question: q.question, options: q.options, correct: q.correct, explanation: q.explanation || '', subject: q.subject, chapter: q.chapter || q.topic, date: new Date().toLocaleDateString('en-GB'), yourAnswer: answers[i] };
      state.mistakes.push(entry);
      newMistakes.push({ user_id: state.authUser?.id, question: q.question, options: q.options, correct: q.correct, explanation: q.explanation || '', subject: q.subject, chapter: q.chapter || q.topic, your_answer: answers[i] });
    }
  });
  if (state.mistakes.length > 200) state.mistakes.splice(0, state.mistakes.length - 200);
  if (state.authUser && newMistakes.length) {
    db.from('mistakes').insert(newMistakes.filter(m => m.user_id)).then();
  }
  state.progress.total += total; state.progress.correct += correct; state.progress.wrong += wrong; state.progress.time += timeTaken;
  state.progress.history = state.progress.history || [];
  state.progress.history.push({ week: getWeekKey(), score: pct, correct, total, timeTaken, date: new Date().toLocaleDateString('en-GB') });
  if (state.progress.history.length > 100) state.progress.history = state.progress.history.slice(-100);
  if (state.progress.history.length > 20) state.progress.history.shift();

  const entry = { name, score: pct, correct, total, time: timeTaken, date: new Date().toLocaleDateString('en-GB'), week: getWeekKey(), selection: selectionLabel() };
  state.localLeaderboard.push(entry);
  state.localLeaderboard.sort((a, b) => b.score - a.score || a.time - b.time);
  const rank = state.localLeaderboard.findIndex(e => e === entry) + 1;
  document.getElementById('tr-name').textContent += `  |  Rank #${rank}`;
  saveStorage();

  const savingEl = document.getElementById('tr-saving');
  savingEl.innerHTML = '<span class="saving-badge">🌍 Saving to global leaderboard…</span>';
  const saved = await saveToLeaderboard(entry);
  savingEl.innerHTML = saved
    ? '<span class="saving-badge" style="color:var(--success)">✅ Saved to global leaderboard!</span>'
    : '<span class="saving-badge">📱 Saved locally</span>';
  saveSessionToSupabase({ questions, answers, timeTakenSecs: timeTaken, mode: state.appMode || 'timed' });
  if (state.authUser) {
    awardXP('mock_test').catch(() => {});
    checkAndShowAchievements().catch(() => {});
    refresh_leaderboard_score_remote().catch(() => {});
  }
  showScreen('timed-result');
}

async function refresh_leaderboard_score_remote() {
  if (!state.authUser) return;
  await db.rpc('refresh_leaderboard_score', { p_user_id: state.authUser.id });
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.pickTimedDuration = pickTimedDuration;
window.startTimedTest = startTimedTest;
window.answerTimed = answerTimed;
window.toggleMark = toggleMark;
window.timedNav = timedNav;
window.jumpToQ = jumpToQ;
