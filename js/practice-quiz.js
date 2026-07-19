import { db, state, LETTERS, _chapLabel } from './state.js';
import { _ta } from './i18n.js';
import { showScreen } from './navigation.js';
import {
  subjClass, qFingerprint, getSubjectDailyTotal, getDailyDone, setDailyDone,
  isDailyComplete, getTimeUntilMidnight,
} from './utils.js';
import { saveStorage } from './db.js';
import { awardXP, recordChapterSession } from './xp.js';
import { checkAndShowAchievements } from './achievements.js';
import { checkAndUpdateElectrostaticsStreak, incrementDailyTarget } from './streaks.js';
import { _esLoad, _esDailyMax, openElectrostaticsMode } from './electrostatics.js';
import { recordChapterAttempt } from './flow.js';

// ── PRACTICE QUIZ (chapter-based MCQs) ───────────────────────────────────────
// Split out of js/quiz.js (Stage 4).

async function saveDailyQuizAttempt(quizId, questions, answers, timeTakenSecs) {
  if (!state.authUser) return;
  try {
    const { count } = await db
      .from('daily_quiz_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', state.authUser.id)
      .eq('daily_quiz_id', quizId);

    const nextAttempt = (count || 0) + 1;
    const total = questions.length;
    const correctCount = Object.entries(answers).filter(([i, a]) => a === questions[i]?.correct).length;
    const wrongCount = total - correctCount;
    const score = correctCount * 4;

    const attemptData = {
      user_id: state.authUser.id,
      daily_quiz_id: quizId,
      attempt_number: nextAttempt,
      score,
      correct_count: correctCount,
      wrong_count: wrongCount,
      time_taken: timeTakenSecs,
      completed_at: new Date().toISOString()
    };

    const { error } = await db.from('daily_quiz_attempts').insert(attemptData);
    if (error) throw error;
  } catch(e) {
    console.error('Failed to save daily quiz attempt:', e);
  }
}

export function updateResetTimer() {
  const el = document.getElementById('time-until-reset');
  if (el) el.textContent = getTimeUntilMidnight();
}

export function renderPracticeQ() {
  const { questions, idx, answers } = state.practiceState;
  const q = questions[idx], total = questions.length;
  document.getElementById('pq-num').textContent = idx + 1;
  document.getElementById('pq-total').textContent = total;
  document.getElementById('pq-progress').style.width = ((idx + 1) / total * 100) + '%';
  const chapEl = document.getElementById('pq-chapter-name');
  if (chapEl) chapEl.textContent = _chapLabel(state.selection.chapter?.label || q.chapter || '');
  const sc = document.getElementById('pq-subj-chip');
  sc.textContent = q.subject || state.selection.subject?.label || '';
  sc.className = 'subject-chip ' + subjClass(q.subject || state.selection.subject?.label);
  document.getElementById('pq-question').textContent = q.question;
  const pqTag = document.getElementById('pq-tag');
  if (pqTag) pqTag.textContent = q.tag || '';
  const answered = answers[idx];
  document.getElementById('pq-options').innerHTML = q.options.map((o, i) => {
    let cls = 'opt';
    if (answered !== undefined) {
      cls += ' locked';
      if (i === q.correct) cls += ' correct';
      else if (i === answered) cls += ' wrong';
    }
    return `<div class="${cls}" onclick="answerPractice(${i})"><div class="opt-key">${LETTERS[i]}</div>${o}</div>`;
  }).join('');
  const expEl = document.getElementById('pq-explanation');
  document.getElementById('pq-exp-text').textContent = q.explanation || '';
  if (answered !== undefined && state.appMode !== 'challenge') { expEl.classList.add('show'); expEl.classList.toggle('wrong-bg', answered !== q.correct); }
  else expEl.classList.remove('show');
  document.getElementById('pq-prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
  const nextBtn = document.getElementById('pq-next');
  if (state.appMode === 'challenge' && idx === total - 1) {
    nextBtn.textContent = 'See Results →';
  } else {
    nextBtn.textContent = idx === total - 1 ? 'Finish ✓' : 'Next →';
  }
  const banner = document.querySelector('#screen-practice-quiz .practice-mode-banner');
  if (banner && state.appMode === 'challenge') {
    banner.style.cssText = 'background:linear-gradient(90deg,#1e1b4b,#312e81);border-left-color:#6366f1;color:#c7d2fe';
    banner.querySelector('span').textContent = '🏆 Challenge Mode';
  } else if (banner && state.appMode === 'electrostatics') {
    banner.style.cssText = 'background:linear-gradient(90deg,#fef9c3,#fef08a);border-left-color:#f59e0b;color:#78350f';
    banner.querySelector('span').textContent = _ta('⚡ Electrostatics Practice', '⚡ மின்னியல் பயிற்சி');
  } else if (banner) {
    banner.style.cssText = '';
    banner.querySelector('span').textContent = '📚 Practice Mode';
  }
  const correct = Object.entries(answers).filter(([i, a]) => a === questions[i]?.correct).length;
  const wrong = Object.keys(answers).length - correct;
  const ch = state.practiceState.chapter || state.selection.chapter;
  let statusText = `✅ ${correct}  ❌ ${wrong}`;
  if (state.appMode === 'electrostatics') {
    const esState = _esLoad();
    const served  = esState.servedToday || 0;
    const limit   = Math.min(_esDailyMax(), served); // best-effort display
    statusText += `  ⚡ ${idx + 1}/${total} ${_ta('today', 'இன்று')}`;
  } else if (!state.practiceState.skipDaily && state.userPlan === 'free') {
    const dailyLeft = Math.max(0, state.FREE_DAILY_LIMIT - getSubjectDailyTotal());
    statusText += `  📅 ${dailyLeft} left today`;
  }
  document.getElementById('pq-status').textContent = statusText;
}

export function answerPractice(i) {
  if (state.practiceState.answers[state.practiceState.idx] !== undefined) return;
  const q = state.practiceState.questions[state.practiceState.idx];
  state.practiceState.answers[state.practiceState.idx] = i;
  const subj = q.subject || state.selection.subject?.label || 'General';
  const chap = q.chapter || state.selection.chapter?.label || q.topic || 'General';
  const chapId = state.selection.chapter?.id || '';
  const isCorrect = i === q.correct;
  const isSkip = i === -1;
  const neetScore = isSkip ? 0 : isCorrect ? 4 : -1;
  if (!state.progress.subjects[subj]) state.progress.subjects[subj] = { total: 0, correct: 0 };
  if (!state.progress.chapters[chap]) state.progress.chapters[chap] = { total: 0, correct: 0 };
  state.progress.total++;
  state.progress.subjects[subj].total++;
  state.progress.chapters[chap].total++;
  if (isCorrect) {
    state.progress.correct++;
    state.progress.subjects[subj].correct++;
    state.progress.chapters[chap].correct++;
    awardXP('correct_mcq', q.id || null).catch(() => {});
  } else if (!isSkip) {    state.progress.wrong++;
    state.mistakes.push({ question: q.question, options: q.options, correct: q.correct, explanation: q.explanation || '', subject: subj, chapter: chap, date: new Date().toLocaleDateString('en-GB'), yourAnswer: i });
    if (state.mistakes.length > 200) state.mistakes.splice(0, state.mistakes.length - 200);
    if (state.authUser) {
      if (q.id) db.rpc('increment_wrong_count', { p_user_id: state.authUser.id, p_question_id: q.id }).then();
      db.from('mistakes').insert({ user_id: state.authUser.id, question: q.question, options: q.options, correct: q.correct, explanation: q.explanation || '', subject: subj, chapter: chap, your_answer: i }).then();
    }
  }
  // Write to topic_performance (new schema)
  if (state.authUser && chapId) {
    db.from('topic_performance').upsert({
      user_id: state.authUser.id, subject: subj,
      chapter_id: chapId, standard: state.selection.standard?.id || '12th',
      total: (state.progress.chapters[chap]?.total || 1),
      correct: (state.progress.chapters[chap]?.correct || 0),
      neet_score: (state.progress.chapters[chap]?.neet_score || 0) + neetScore,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,subject,chapter_id,standard' }).then();
  }
  // Daily target + streak tracking (every answered MCQ counts)
  if (!isSkip) incrementDailyTarget(subj).catch(() => {});
  if (!state.practiceState.skipDaily && state.selection.chapter) {
    const dayData = getDailyDone(state.selection.chapter);
    dayData.count = (dayData.count || 0) + 1;
    dayData.seen = dayData.seen || [];
    dayData.seen.push(qFingerprint(q));
    setDailyDone(state.selection.chapter, dayData);
  }
  saveStorage();
  // Save resume progress
  if (state.appMode === 'electrostatics') {
    const nextIdx = state.practiceState.idx + 1;
    const esSession = {
      questions: state.practiceState.questions,
      idx: nextIdx,
      answers: state.practiceState.answers,
      start: state.practiceState.start,
      quizId: state.practiceState.quizId
    };
    try { localStorage.setItem('karnan_electrostatics_active_session', JSON.stringify(esSession)); } catch(e) {}
  } else if (state.practiceState.progressKey) {
    const nextIdx = state.practiceState.idx + 1;
    if (nextIdx < state.practiceState.questions.length) {
      try { localStorage.setItem(state.practiceState.progressKey, String(nextIdx)); } catch(e) {}
    }
  }
  renderPracticeQ();
}

export function practiceNav(dir) {
  const total = state.practiceState.questions.length;
  if (dir === 1 && state.practiceState.idx === total - 1) {
    practiceNavFinish();
    return;
  }
  state.practiceState.idx = Math.max(0, Math.min(total - 1, state.practiceState.idx + dir));
  if (state.appMode === 'electrostatics') {
    const esSession = {
      questions: state.practiceState.questions,
      idx: state.practiceState.idx,
      answers: state.practiceState.answers,
      start: state.practiceState.start,
      quizId: state.practiceState.quizId
    };
    try { localStorage.setItem('karnan_electrostatics_active_session', JSON.stringify(esSession)); } catch(e) {}
  }
  renderPracticeQ();
}

async function practiceNavFinish() {
  const total = state.practiceState.questions.length;
  // Chapter complete — clear resume progress
  if (state.practiceState.progressKey) { try { localStorage.removeItem(state.practiceState.progressKey); } catch(e) {} }
  const timeTakenSecs = Math.round((Date.now() - (state.practiceState.start || Date.now())) / 1000);
  if (state.appMode === 'electrostatics') {
    try { localStorage.removeItem('karnan_electrostatics_active_session'); } catch(e) {}
    if (state.authUser && state.practiceState.quizId) {
      saveDailyQuizAttempt(state.practiceState.quizId, state.practiceState.questions, state.practiceState.answers, timeTakenSecs).catch(() => {});
    }
    checkAndUpdateElectrostaticsStreak().catch(() => {});
  }
  saveSessionToSupabase({ questions: state.practiceState.questions, answers: state.practiceState.answers, timeTakenSecs, mode: state.appMode || 'practice', chapterId: state.selection.chapter?.id });
  // XP + mastery on chapter completion
  if (state.authUser && total >= 5) {
    const chapCorrect = Object.entries(state.practiceState.answers).filter(([i, a]) => a === state.practiceState.questions[i]?.correct).length;
    awardXP('chapter_test', state.selection.chapter?.id || null).catch(() => {});
    recordChapterSession(state.selection.chapter?.id, state.selection.subject?.dbLabel || state.selection.subject?.label, chapCorrect, total).catch(() => {});
    checkAndShowAchievements().catch(() => {});
    // Progression unlock — requires ≥20 questions to count as an attempt
    if (total >= 20 && state.selection.chapter?.id && state.appMode === 'practice') {
      const scorePct = Math.round(chapCorrect / total * 100);
      const subj = state.selection.subject?.dbLabel || state.selection.subject?.label;
      recordChapterAttempt(state.selection.chapter.id, subj, scorePct, total).catch(() => {});
    }
  }
  if (state.appMode === 'electrostatics') {
    openElectrostaticsMode();
  } else if (!state.practiceState.skipDaily && state.userPlan !== 'premium' && state.userPlan !== 'unlimited' && state.selection.chapter && isDailyComplete(state.selection.chapter)) {
    document.getElementById('done-chapter').textContent = _chapLabel(state.selection.chapter.label);
    const limitEl = document.getElementById('done-limit');
    if (limitEl) limitEl.textContent = `${state.FREE_DAILY_LIMIT} questions`;
    const subLimitEl = document.getElementById('done-subject-limit');
    if (subLimitEl) subLimitEl.textContent = `${state.FREE_DAILY_LIMIT} questions`;
    updateResetTimer();
    showScreen('daily-done');
  } else showScreen('practice-chapter');
}

// ── Save session results to Supabase ─────────────────────────────────────────
// Shared with js/timed-test.js (both practice and timed sessions log here).
export async function saveSessionToSupabase({ questions, answers, timeTakenSecs, mode, chapterId }) {
  if (!state.authUser) return;
  const lang_id = state.selection.language?.label === 'Tamil' ? 2 : 1;
  let correct = 0, wrong = 0, skipped = 0;
  questions.forEach((q, i) => {
    if (answers[i] === undefined) skipped++;
    else if (answers[i] === q.correct) correct++;
    else wrong++;
  });
  const neet_score = correct * 4 - wrong;

  try {
    // 1. Insert exam_session
    const { data: sess, error: sessErr } = await db.from('exam_sessions').insert({
      user_id:      state.authUser.id,
      mode:         mode || state.appMode || 'practice',
      language:     state.selection.language?.label || 'English',
      standard:     state.selection.standard?.id    || '12th',
      subject:      state.selection.subject?.label  || null,
      chapter_id:   chapterId || state.selection.chapter?.id || null,
      total_q:      questions.length,
      correct_q:    correct,
      wrong_q:      wrong,
      skipped_q:    skipped,
      neet_score,
      time_taken:   timeTakenSecs,
      completed_at: new Date().toISOString()
    }).select('id').single();
    if (sessErr || !sess) return;

    const sessionId = sess.id;

    // 2. Insert question_responses
    const responses = questions.map((q, i) => {
      const answered    = answers[i] !== undefined;
      const isCorrect   = answered && answers[i] === q.correct;
      // map display index back to A/B/C/D using shuffleMap
      const selOpt      = answered ? (q.shuffleMap?.[answers[i]] || null) : null;
      return {
        session_id:      sessionId,
        question_id:     q.id || null,
        selected_option: selOpt,
        is_correct:      answered ? isCorrect : null,
        neet_score:      answered ? (isCorrect ? 4 : -1) : 0,
        time_taken:      0
      };
    }).filter(r => r.question_id); // only rows where we have a UUID
    if (responses.length) await db.from('question_responses').insert(responses);

    // 3. Increment wrong_answer_tracker (single bulk RPC instead of N parallel calls)
    const wrongIds = questions
      .filter((q, i) => q.id && answers[i] !== undefined && answers[i] !== q.correct)
      .map(q => q.id);
    if (wrongIds.length) {
      await db.rpc('bulk_increment_wrong_count', {
        p_user_id: state.authUser.id,
        p_question_ids: wrongIds
      });
    }
  } catch(e) { /* silent — results screen still shows */ }
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.answerPractice = answerPractice;
window.practiceNav = practiceNav;
