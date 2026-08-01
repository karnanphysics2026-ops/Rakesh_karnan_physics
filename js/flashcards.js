import { db, state, _chapLabel } from './state.js';
import { _ta } from './i18n.js';
import { showToast } from './ui.js';
import { showScreen } from './navigation.js';
import { fetchQuestions } from './db.js';
import { getFCDoneToday, getTFDoneToday, incFCDone, incTFDone, shuffle, subjClass, renderMath } from './utils.js';
import { renderChapters } from './flow.js';

// ── FLASHCARDS (spaced repetition, SM-2-style) + TRUE/FALSE QUIZ ────────────
// Split out of js/quiz.js (Stage 4) — both modes share the same screen and
// question pool (flashcardState), so they stay together rather than being
// split further.

let flashcardState = { questions: [], idx: 0, flipped: false };

export async function startFlashcards(chapter) {
  state.selection.chapter = chapter;
  document.getElementById('chapter-list').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><p>Loading flashcards…</p></div>';
  try {
    let qs = [];
    const subjectName = state.selection.subject?.dbLabel || state.selection.subject?.label;

    // Fetch manual flashcards first
    try {
      const manual = await fetchManualFlashcards(subjectName, chapter.id);
      if (manual && manual.length > 0) {
        qs = manual.map(m => ({
          id: m.id,
          question: m.front_text,
          correct: 0,
          options: [m.back_text],
          explanation: m.back_text,
          subject: m.subject,
          chapter: m.chapter_id,
          isManual: true
        }));
      }
    } catch(e) {
      console.log('No manual flashcards or failed to load:', e);
    }

    // Fallback to dynamic questions if no manual cards found
    if (qs.length === 0) {
      qs = await fetchQuestions({ language: state.selection.language.label, standard: state.selection.standard.id, subject: subjectName, chapterId: chapter.id});
    }

    if (state.userPlan === 'free') {
      const isFC = state.appMode !== 'truefalse';
      const done = isFC ? getFCDoneToday() : getTFDoneToday();
      const limit = isFC ? state.FREE_FC_DAILY : state.FREE_TF_DAILY;
      const remaining = limit - done;
      if (remaining <= 0) {
        showScreen('home');
        showToast(isFC ? `You have used all ${state.FREE_FC_DAILY} flashcards for today. Come back tomorrow!` : `You have used all ${state.FREE_TF_DAILY} True/False questions for today. Come back tomorrow!`);
        return;
      }
      qs = shuffle(qs).slice(0, remaining);
    } else {
      qs = shuffle(qs);
    }
    flashcardState = { questions: qs, idx: 0, flipped: false };
    renderFlashcard();
    showScreen('flashcard');
    if (state.appMode === 'truefalse') {
      switchFlashcardTab('truefalse');
    } else {
      switchFlashcardTab('flashcard');
    }
  } catch(e) {
    alert('Failed to load flashcards.');
    renderChapters();
  }
}

async function fetchManualFlashcards(subject, chapterId) {
  const { data, error } = await db
    .from('flashcards')
    .select('*')
    .eq('subject', subject)
    .eq('chapter_id', chapterId)
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
}

function renderFlashcard() {
  const { questions, idx } = flashcardState;
  const q = questions[idx], total = questions.length;
  document.getElementById('fc-num').textContent = idx + 1;
  document.getElementById('fc-total').textContent = total;
  document.getElementById('fc-progress').style.width = ((idx + 1) / total * 100) + '%';
  // "Subject · Chapter" breadcrumb
  const subjectName = q.subject || state.selection.subject?.label || '';
  const chapterName = _chapLabel(state.selection.chapter?.label || '');
  const breadcrumb = [subjectName, chapterName].filter(Boolean).join(' · ');
  const bc = document.getElementById('fc-breadcrumb');
  const bcBack = document.getElementById('fc-breadcrumb-back');
  if (bc) bc.textContent = breadcrumb;
  if (bcBack) bcBack.textContent = breadcrumb;
  // subject chip
  const sc = document.getElementById('fc-subj-chip');
  sc.textContent = subjectName;
  sc.className = 'subject-chip ' + subjClass(subjectName);
  // tag badge
  const tagEl = document.getElementById('fc-tag');
  if (tagEl) tagEl.textContent = q.tag || '';
  // question & answer
  const qEl = document.getElementById('fc-question');
  qEl.innerHTML = q.question;
  renderMath(qEl);

  const aEl = document.getElementById('fc-answer');
  aEl.innerHTML = q.options[q.correct];
  renderMath(aEl);

  // example box (correct option text without letter prefix)
  const exampleEl = document.getElementById('fc-example-text');
  if (exampleEl) {
    exampleEl.innerHTML = q.options[q.correct];
    renderMath(exampleEl);
  }

  // exam tip from explanation
  const expEl = document.getElementById('fc-exp');
  const tipWrap = document.getElementById('fc-tip-wrap');
  if (q.explanation) {
    expEl.innerHTML = q.explanation;
    renderMath(expEl);
    if (tipWrap) tipWrap.style.display = '';
  } else {
    if (tipWrap) tipWrap.style.display = 'none';
  }
  // reset to front face
  flashcardState.counted = flashcardState.counted || new Set();
  flashcardState.flipped = false;
  document.getElementById('fc-front').classList.remove('hidden');
  document.getElementById('fc-back').classList.add('hidden');
  document.getElementById('fc-prev').disabled = idx === 0;
  document.getElementById('fc-next').disabled = idx === total - 1;
}

let fcSaving = false;

export function flipCard() {
  flashcardState.flipped = !flashcardState.flipped;
  document.getElementById('fc-front').classList.toggle('hidden', flashcardState.flipped);
  document.getElementById('fc-back').classList.toggle('hidden', !flashcardState.flipped);
  if (flashcardState.flipped && !flashcardState.counted?.has(flashcardState.idx)) {
    flashcardState.counted = flashcardState.counted || new Set();
    flashcardState.counted.add(flashcardState.idx);
    incFCDone(1);

    // Sync flashcard progress with debouncing
    if (state.authUser && !fcSaving) {
      const q = flashcardState.questions[flashcardState.idx];
      if (q) {
        fcSaving = true;
        saveFlashcardProgress(q, 4).finally(() => {
          fcSaving = false;
        });
      }
    }
  }
}

async function saveFlashcardProgress(q, rating = 4) {
  if (!state.authUser || !q || !q.id) return;
  try {
    let flashcardId = null;
    if (q.isManual) {
      flashcardId = q.id;
    } else {
      const { data: existingCard } = await db
        .from('flashcards')
        .select('id')
        .eq('question_id', q.id)
        .maybeSingle();
      if (existingCard) {
        flashcardId = existingCard.id;
      } else {
        const { data: newCard, error } = await db
          .from('flashcards')
          .insert({
            question_id: q.id,
            subject: q.subject || 'Physics',
            chapter_id: q.chapter || 'chapter1',
            front_text: q.question,
            back_text: q.options[q.correct],
            status: 'active'
          })
          .select('id')
          .single();
        if (error) throw error;
        if (newCard) flashcardId = newCard.id;
      }
    }

    if (!flashcardId) return;

    // Fetch current progress
    const { data: current } = await db
      .from('user_flashcard_progress')
      .select('id, box_number, easiness_factor, repetitions, interval_days')
      .eq('user_id', state.authUser.id)
      .eq('flashcard_id', flashcardId)
      .maybeSingle();

    let repetitions = current ? current.repetitions : 0;
    let easinessFactor = current ? parseFloat(current.easiness_factor) : 2.5;
    let intervalDays = current ? current.interval_days : 0;
    let boxNumber = current ? current.box_number : 1;

    if (rating >= 3) {
      if (repetitions === 0) {
        intervalDays = 1;
      } else if (repetitions === 1) {
        intervalDays = 6;
      } else {
        intervalDays = Math.round(intervalDays * easinessFactor);
      }
      repetitions += 1;
      boxNumber = Math.min(5, boxNumber + 1);
    } else {
      repetitions = 0;
      intervalDays = 1;
      boxNumber = Math.max(1, boxNumber - 1);
    }

    easinessFactor = easinessFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
    if (easinessFactor < 1.3) easinessFactor = 1.3;

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + intervalDays);

    await db.from('user_flashcard_progress').upsert({
      user_id: state.authUser.id,
      flashcard_id: flashcardId,
      box_number: boxNumber,
      easiness_factor: parseFloat(easinessFactor.toFixed(2)),
      repetitions,
      interval_days: intervalDays,
      next_review_at: nextReview.toISOString(),
      last_reviewed_at: new Date().toISOString()
    }, { onConflict: 'user_id,flashcard_id' });
  } catch(e) {
    console.error('Failed to save flashcard progress:', e);
  }
}

export function flashcardNav(dir) {
  flashcardState.idx = Math.max(0, Math.min(flashcardState.questions.length - 1, flashcardState.idx + dir));
  renderFlashcard();
}

// ── TRUE/FALSE QUIZ ──
let tfState = { statements: [], idx: 0, score: 0, answered: false };

function generateTFStatements(questions) {
  return questions
    .filter(q => !q.isManual)
    .map(q => {
      const isTrue = Math.random() > 0.5;
      const wrongIdxs = [0,1,2,3].filter(i => i !== q.correct);
      const wrongIdx = wrongIdxs[Math.floor(Math.random() * wrongIdxs.length)];
      const statementText = isTrue ? q.options[q.correct] : q.options[wrongIdx];
      return { question: q.question, statement: statementText, isTrue, explanation: q.explanation || '', correctText: q.options[q.correct], subject: q.subject };
    });
}

export function switchFlashcardTab(tab) {
  document.getElementById('fc-tab-flashcard').classList.toggle('active', tab === 'flashcard');
  document.getElementById('fc-tab-truefalse').classList.toggle('active', tab === 'truefalse');
  const fcSection = document.getElementById('fc-flashcard-section');
  const tfSection = document.getElementById('fc-truefalse-section');
  if (fcSection) fcSection.style.display = tab === 'flashcard' ? '' : 'none';
  if (tfSection) tfSection.style.display = tab === 'truefalse' ? '' : 'none';
  if (tab === 'truefalse') initTrueFalse();
}

function initTrueFalse() {
  const tfQs = generateTFStatements(flashcardState.questions);
  if (tfQs.length === 0) {
    alert(_ta('True/False mode is not available for manually uploaded flashcards.', 'கைமுறையாகப் பதிவேற்றப்பட்ட அட்டைப்படங்களுக்கு True/False முறை கிடைக்கவில்லை.'));
    switchFlashcardTab('flashcard');
    return;
  }
  tfState = { statements: tfQs, idx: 0, score: 0, answered: false };
  renderTF();
}

function renderTF() {
  const { statements, idx, score } = tfState;
  const total = statements.length;
  const s = statements[idx];
  document.getElementById('tf-score').textContent = score;
  document.getElementById('tf-qnum').textContent = `QUESTION ${idx + 1} OF ${total}`;
  document.getElementById('tf-topic').textContent = s.subject || '';
  document.getElementById('tf-stmt-q').textContent = 'Is this the correct answer?\n' + s.question;
  document.getElementById('tf-stmt-opt').textContent = s.statement;
  // reset feedback
  const fb = document.getElementById('tf-feedback');
  fb.style.display = 'none';
  fb.className = 'tf-feedback';
  document.getElementById('tf-next-btn').style.display = 'none';
  // re-enable buttons
  const btnT = document.getElementById('tf-btn-true');
  const btnF = document.getElementById('tf-btn-false');
  if (btnT) btnT.disabled = false;
  if (btnF) btnF.disabled = false;
  tfState.answered = false;
}

export function answerTF(userSaysTrue) {
  if (tfState.answered) return;
  tfState.answered = true;
  incTFDone(1);
  const s = tfState.statements[tfState.idx];
  const correct = (userSaysTrue === s.isTrue);
  if (correct) tfState.score++;
  document.getElementById('tf-score').textContent = tfState.score;
  // disable buttons
  document.getElementById('tf-btn-true').disabled = true;
  document.getElementById('tf-btn-false').disabled = true;
  // show feedback
  const fb = document.getElementById('tf-feedback');
  fb.style.display = 'block';
  fb.className = 'tf-feedback ' + (correct ? 'ok' : 'bad');
  document.getElementById('tf-feedback-lbl').textContent = correct ? '✅ Correct!' : '❌ Incorrect.';
  document.getElementById('tf-feedback-body').innerHTML = `<b>Correct answer:</b> ${s.correctText}${s.explanation ? `<br/><b>Explanation:</b> ${s.explanation}` : ''}`;
  // show next button unless last question
  if (tfState.idx < tfState.statements.length - 1) {
    document.getElementById('tf-next-btn').style.display = 'block';
  }
}

export function nextTF() {
  tfState.idx++;
  renderTF();
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.flipCard = flipCard;
window.flashcardNav = flashcardNav;
window.switchFlashcardTab = switchFlashcardTab;
window.answerTF = answerTF;
window.nextTF = nextTF;
