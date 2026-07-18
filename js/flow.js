import { db, state, LETTERS, _chapLabel } from './state.js';
import { _isTa, _ta } from './i18n.js';
import { showToast, showUpgradePrompt } from './ui.js';
import { showScreen, renderStepper, selectionLabel } from './navigation.js';
import { loadManifest, fetchQuestions, fetchAllSubjectQuestions } from './db.js';
import {
  preloadDailyData, getDailyDone, setDailyDone, getSubjectDailyTotal,
  isDailyComplete, getTimeUntilMidnight, qFingerprint, shuffle,
} from './utils.js';
import { getChapterLimitForSubject } from './admin.js';
import {
  renderPracticeQ, updateResetTimer, renderTimedDurationOptions, startFlashcards,
  updateTimerDisplay, renderTimedQ, renderQNav, timerTick,
} from './quiz.js';

// ── Chapter progression unlock state ─────────────────────────────────────────
let _chapUnlockMap       = {};   // { chapter1: { attempt_no, best_score, is_cleared }, ... }
let _chapUnlockSubj      = '';
let _pendingUnlockResult = null; // toast to show after returning from quiz

async function loadChapterUnlockStatus(subject) {
  if (!state.authUser || _chapUnlockSubj === subject) return;
  try {
    const { data } = await db.rpc('get_chapter_unlock_status', {
      p_user_id: state.authUser.id, p_subject: subject,
    });
    _chapUnlockMap  = {};
    (data || []).forEach(r => { _chapUnlockMap[r.chapter_id] = r; });
    _chapUnlockSubj = subject;
  } catch { _chapUnlockMap = {}; }
}

function invalidateUnlockCache() { _chapUnlockSubj = ''; }

function getChapterProgression(chapterId) {
  if (!state.authUser) return { locked: false };
  const num = parseInt(chapterId.replace(/\D/g, ''));
  if (num <= 1) return { locked: false };
  const prevId = `chapter${num - 1}`;
  const prev   = _chapUnlockMap[prevId];
  if (prev?.is_cleared) return { locked: false };
  const att    = prev?.attempt_no || 0;
  const needed = att === 0 ? 80 : att === 1 ? 70 : att === 2 ? 60 : 50;
  return {
    locked: true,
    hint: att === 0
      ? `Score 80% in Ch ${num - 1} to unlock`
      : `Score ${needed}% in Ch ${num - 1} · attempt ${att + 1}`,
  };
}

export async function recordChapterAttempt(chapterId, subject, scorePct, totalQs) {
  if (!state.authUser || !chapterId || !subject) return null;
  try {
    const { data } = await db.rpc('record_chapter_attempt', {
      p_user_id:    state.authUser.id,
      p_subject:    subject,
      p_chapter_id: chapterId,
      p_score_pct:  scorePct,
      p_questions:  totalQs,
    });
    if (data?.counted) {
      invalidateUnlockCache();
      _pendingUnlockResult = { ...data, chapterId, subject };
    }
    return data;
  } catch { return null; }
}
// ─────────────────────────────────────────────────────────────────────────────

export async function openFlow(mode) {
  if (mode === 'grand' && state.userPlan === 'free') { showUpgradePrompt('Weekly Grand Test'); return; }
  if (mode === 'practice' && state.userPlan === 'free') { showUpgradePrompt('MCQ Practice — Upgrade to Premium'); return; }
  if (mode === 'challenge' && state.userPlan === 'free') { showUpgradePrompt('Challenge Mode'); return; }
  state.appMode = mode;
  if (state.appMode === 'practice' && (state.userPlan === 'premium' || state.userPlan === 'unlimited')) state.appMode = 'weakareas';
  state.selection = { language: null, standard: null, subject: null, chapter: null };
  renderStepper(0);
  // Show loading on lang screen while manifest loads
  showScreen('practice-lang');
  document.getElementById('lang-options').innerHTML = '<div class="info-box">Loading…</div>';
  try { await loadManifest(); } catch(e) {
    document.getElementById('lang-options').innerHTML = `<div class="info-box">Could not load question catalog: ${e.message}</div>`;
    return;
  }

  // Auto-apply saved preferences: skip straight to subject if both lang + class are known
  const prefLangId = state.currentLang === 'ta' ? 'tamil' : 'english';
  const prefLang   = state.manifest.languages.find(l => l.id === prefLangId);
  if (prefLang) {
    state.selection.language = prefLang;
    const prefStd = prefLang.standards.find(s => s.id === state.currentClass);
    if (prefStd) {
      state.selection.standard = prefStd;
      if (state.appMode === 'grand') {
        const subjs = state.selection.standard?.subjects?.map(s => s.label).join(', ') || 'All Subjects';
        document.getElementById('grand-selection-label').textContent =
          `${state.selection.language.label} · ${state.selection.standard.label} · ${subjs} · 180 Q · 3h 15m`;
        renderStepper(2);
        showScreen('grand-setup');
      } else {
        renderSubjectOptions();
        renderStepper(2);
        showScreen('practice-subject');
      }
      return;
    }
    // Only language is known — skip to class screen
    renderClassOptions();
    renderStepper(1);
    showScreen('practice-class');
    return;
  }

  renderLangOptions();
}

export function renderLangOptions() {
  const langs = state.manifest?.languages || [];
  const icons = { English: '🌐', Tamil: '🇮🇳' };
  const el = document.getElementById('lang-options');
  if (!langs.length) {
    el.innerHTML = '<div class="info-box">Could not load question catalog. Check Supabase connection.</div>';
    return;
  }
  const activeLangId = state.currentLang === 'ta' ? 'tamil' : 'english';
  el.innerHTML = langs.map(l => `
    <button class="sel-btn${l.id === activeLangId ? ' active' : ''}" onclick="selectLang('${l.id}')">
      <span>${icons[l.label] || '📖'}</span>${l.label}
      <span style="margin-left:auto;font-size:.75rem;color:var(--muted)">${l.standards.length} class(es)</span>
    </button>`).join('');
}

export function selectLang(langId) {
  state.selection.language = state.manifest.languages.find(l => l.id === langId);
  state.currentLang = langId === 'tamil' ? 'ta' : 'en';
  if (state.authUser) {
    db.from('user_profiles')
      .upsert({ id: state.authUser.id, lang_id: state.currentLang === 'ta' ? 2 : 1 }, { onConflict: 'id' })
      .then();
  }
  renderClassOptions();
  renderStepper(1);
  showScreen('practice-class');
}

function renderClassOptions() {
  const standards = state.selection.language?.standards || [];
  const all = [{ id: '11th', label: 'Class 11', icon: '📗' }, { id: '12th', label: 'Class 12', icon: '📘' }];
  document.getElementById('class-options').innerHTML = all.map(c => {
    const found = standards.find(s => s.id === c.id);
    const disabled = !found;
    const isActive = !disabled && c.id === state.currentClass;
    return `<button class="sel-btn${disabled ? ' disabled' : ''}${isActive ? ' active' : ''}" ${disabled ? 'disabled' : `onclick="selectClass('${c.id}')"`}>
      <span>${c.icon}</span>${c.label}
      ${disabled ? '<span style="margin-left:auto;font-size:.72rem;color:var(--muted)">Coming soon</span>' : `<span style="margin-left:auto;font-size:.72rem;color:var(--muted)">${found.subjects.length} subject(s)</span>`}
    </button>`;
  }).join('');
}

export function selectClass(stdId) {
  state.selection.standard = state.selection.language.standards.find(s => s.id === stdId);
  state.currentClass = stdId;
  if (state.authUser) {
    db.from('user_profiles')
      .upsert({ id: state.authUser.id, standard: stdId }, { onConflict: 'id' })
      .then();
  }
  if (state.appMode === 'grand') {
    const subjs = state.selection.standard?.subjects?.map(s => s.label).join(', ') || 'All Subjects';
    document.getElementById('grand-selection-label').textContent = `${state.selection.language.label} · ${state.selection.standard.label} · ${subjs} · 180 Q · 3h 15m`;
    renderStepper(2);
    showScreen('grand-setup');
    return;
  }
  renderSubjectOptions();
  renderStepper(2);
  showScreen('practice-subject');
}

const ALL_NEET_SUBJECTS = [
  { id:'physics',   dbId:'physics',   label:'Physics',   icon:'⚛️', grad:'linear-gradient(135deg,#dbeafe,#bfdbfe)', border:'#3b82f6', color:'#1e3a8a' },
  { id:'chemistry', dbId:'chemistry', label:'Chemistry', icon:'🧪', grad:'linear-gradient(135deg,#d1fae5,#a7f3d0)', border:'#10b981', color:'#064e3b' },
  { id:'biology',   dbId:'biology',   label:'Biology',   icon:'🧬', grad:'linear-gradient(135deg,#ede9fe,#ddd6fe)', border:'#7c3aed', color:'#3b0764' },
];
const SUBJ_LABELS_TA = { 'Physics':'இயற்பியல்', 'Chemistry':'வேதியியல்', 'Biology':'உயிரியல்' };
function _subjLabel(label) { return _isTa() ? (SUBJ_LABELS_TA[label] || label) : label; }

export function renderSubjectOptions() {
  const subs = state.selection.standard?.subjects || [];
  const modeLabel = (state.appMode === 'truefalse') ? _ta('True / False','சரி / தவறு') : (state.appMode === 'flashcard') ? _ta('Flashcards','நினைவட்டைகள்') : _ta('Practice','பயிற்சி');
  const titleEl = document.getElementById('subject-screen-title');
  if (titleEl) titleEl.textContent = `${modeLabel} — ${_ta('Choose a Subject','பாடம் தேர்ந்தெடுக்கவும்')}`;
  document.getElementById('subject-options').innerHTML = ALL_NEET_SUBJECTS.map(s => {
    const found = subs.find(x => x.id === s.dbId);
    const locked = s.comingSoon || !found;
    const chapCount = found ? found.chapters.length : 0;
    const meta = locked ? _ta('Coming Soon','விரைவில்') : `${chapCount} ${_ta('chapters','அத்தியாயங்கள்')}`;
    return `<div class="subj-card-v2${locked ? ' locked' : ''}"
        style="background:${s.grad};border-color:${s.border};color:${s.color}"
        ${locked ? '' : `onclick="selectSubject('${s.id}')"`}>
      <span class="s2-icon">${s.icon}</span>
      <div class="s2-name">${_subjLabel(s.label)}</div>
      <div class="s2-meta">${locked ? `<span class="s2-soon">${_ta('Coming Soon','விரைவில்')}</span>` : meta}</div>
      ${locked ? '<span class="s2-lock">🔒</span>' : ''}
    </div>`;
  }).join('');
}

export function selectSubject(subjId) {
  const def = ALL_NEET_SUBJECTS.find(s => s.id === subjId);
  const dbId = def?.dbId || subjId;
  const found = state.selection.standard.subjects.find(s => s.id === dbId);
  state.selection.subject = found ? { ...found, label: def ? def.label : found.label, dbLabel: found.label, uiId: subjId } : null;
  if (!state.selection.subject) return;
  if (state.appMode === 'timed') {
    document.getElementById('timed-selection-label').textContent = selectionLabel() + ` · ${state.selection.subject.totalQuestions || 0} questions available`;
    renderTimedDurationOptions();
    renderStepper(3);
    showScreen('timed-setup');
    return;
  }
  renderChapters();
  renderStepper(3);
  showScreen('practice-chapter');
}

export async function renderChapters() {
  const chaps = state.selection.subject?.chapters || [];
  const subj = state.selection.subject.label;
  const dbSubj = state.selection.subject?.dbLabel || subj;
  const isPremium = state.userPlan === 'premium' || state.userPlan === 'unlimited';
  const isWeakAreas = state.appMode === 'weakareas';
  const useProgression = state.appMode === 'practice' && state.authUser;
  const subjDisplay = _subjLabel(subj);
  document.getElementById('chapter-title').textContent = isWeakAreas
    ? `${subjDisplay} — ${_ta('Weak Areas','பலவீன பகுதிகள்')}`
    : state.appMode === 'challenge' ? `${subjDisplay} — ${_ta('Challenge','சவால்')}`
    : `${subjDisplay} — ${_ta('Select Chapter','அத்தியாயம் தேர்ந்தெடுக்கவும்')}`;
  document.getElementById('chapter-list').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><p>Loading chapters…</p></div>';
  await Promise.all([
    preloadDailyData(),
    useProgression ? loadChapterUnlockStatus(dbSubj) : Promise.resolve(),
  ]);
  const totalDoneQs = chaps.reduce((sum, c) => sum + getDailyDone(c).count, 0);
  const bannerEl = document.getElementById('daily-progress-banner');
  if (isWeakAreas && bannerEl) {
    bannerEl.innerHTML = `<div style="background:linear-gradient(90deg,#fff0f0,#ffe4e4);border-left:4px solid #dc2626;border-radius:8px;padding:.6rem .9rem;margin-bottom:.75rem;font-size:.82rem;font-weight:700;color:#9b1c1c">🎯 ${_ta('Weak Areas Mode — Chapters sorted by lowest accuracy first','பலவீன பகுதி முறை — குறைந்த துல்லியம் முதலில் காட்டப்படும்')}</div>`;
  } else if (state.appMode === 'challenge' && bannerEl) {
    bannerEl.innerHTML = `<div style="background:linear-gradient(90deg,#1e1b4b,#312e81);border-radius:8px;padding:.6rem .9rem;margin-bottom:.75rem;font-size:.82rem;font-weight:700;color:#c7d2fe">🏆 ${_ta('Challenge Mode — Answers revealed only at the end. No hints!','சவால் முறை — விடைகள் இறுதியில் மட்டுமே காட்டப்படும். குறிப்புகள் இல்லை!')}</div>`;
  } else if (isPremium) {
    const DAILY_GOAL = 20;
    const pct = Math.min(100, Math.round(totalDoneQs / DAILY_GOAL * 100));
    if (bannerEl) bannerEl.innerHTML = `<div class="daily-banner">
      <div style="font-size:1.4rem">🌟</div>
      <div class="db-text"><b>${_ta('Unlimited Practice','வரம்பற்ற பயிற்சி')}</b><br/>
      ${totalDoneQs} ${_ta('questions answered today · Keep pushing!','கேள்விகள் இன்று பதிலளித்தது · தொடர்ந்து முயற்சி செய்யுங்கள்!')}
      <div class="daily-limit-bar"><div class="daily-limit-fill" style="width:${pct}%"></div></div></div></div>`;
  } else {
    const subjectTotal = getSubjectDailyTotal();
    const subjectLimit = state.FREE_DAILY_LIMIT;
    const pct = Math.min(100, Math.round(subjectTotal / subjectLimit * 100));
    if (bannerEl) bannerEl.innerHTML = `<div class="daily-banner">
      <div style="font-size:1.4rem">📅</div>
      <div class="db-text"><b>${_ta(`Daily Practice — ${subjectLimit} Questions Per Subject`,`தினசரி பயிற்சி — ${subjectLimit} கேள்விகள் / பாடம்`)}</b><br/>
      ${_ta(`${subjectTotal} of ${subjectLimit} questions done today`,`இன்று ${subjectTotal} / ${subjectLimit} கேள்விகள் முடிந்தது`)}
      <div class="daily-limit-bar"><div class="daily-limit-fill" style="width:${pct}%"></div></div></div></div>`;
  }
  const CHAP_COLORS = [
    {bg:'#dbeafe',border:'#3b82f6',badge:'#2563eb'},
    {bg:'#d1fae5',border:'#10b981',badge:'#059669'},
    {bg:'#ede9fe',border:'#8b5cf6',badge:'#7c3aed'},
    {bg:'#fef3c7',border:'#f59e0b',badge:'#d97706'},
    {bg:'#fee2e2',border:'#ef4444',badge:'#dc2626'},
    {bg:'#cffafe',border:'#06b6d4',badge:'#0891b2'},
    {bg:'#ffedd5',border:'#f97316',badge:'#ea580c'},
    {bg:'#e0e7ff',border:'#6366f1',badge:'#4f46e5'},
  ];
  // in weak areas mode sort by accuracy ascending
  let sortedChaps = [...chaps];
  const chapAccMap = {};
  if (isWeakAreas) {
    chaps.forEach(c => {
      const stat = state.progress.chapters?.[c.label] || state.progress.chapters?.[c.id];
      chapAccMap[c.id] = stat?.total > 0 ? Math.round(stat.correct / stat.total * 100) : null;
    });
    sortedChaps.sort((a, b) => {
      const accA = chapAccMap[a.id] ?? 999; // unattempted goes to end
      const accB = chapAccMap[b.id] ?? 999;
      return accA - accB;
    });
  }
  // Show pending unlock result banner (set after quiz completion)
  const bannerArea = document.getElementById('daily-progress-banner');
  if (_pendingUnlockResult && bannerArea && state.appMode === 'practice') {
    const r = _pendingUnlockResult;
    _pendingUnlockResult = null;
    const isPass = r.passed;
    const bg = isPass
      ? 'linear-gradient(90deg,#d1fae5,#a7f3d0)' : 'linear-gradient(90deg,#fef3c7,#fde68a)';
    const bdr = isPass ? '#059669' : '#d97706';
    const msg = isPass
      ? (r.already_cleared
          ? `✅ Chapter already cleared · Best score: ${r.best_score}%`
          : `🎉 Chapter cleared! You scored ${r.score}% · Next chapter unlocked!`)
      : `💪 You scored ${r.score}% · Need ${r.next_threshold}% on attempt ${r.attempt_no + 1} to unlock next chapter`;
    const unlockHtml = `<div style="background:${bg};border-left:4px solid ${bdr};border-radius:8px;padding:.65rem .9rem;font-size:.82rem;font-weight:700;color:#1f2937">${msg}</div>`;
    const origInner = bannerArea.innerHTML;
    bannerArea.innerHTML = unlockHtml + origInner;
  }

  document.getElementById('chapter-list').innerHTML = sortedChaps.map((c, i) => {
    const originalIdx = chaps.findIndex(ch => ch.id === c.id);
    const col = CHAP_COLORS[originalIdx % CHAP_COLORS.length];
    const dayData = getDailyDone(c);
    const chapNum = parseInt((c.id.match(/\d+$/) || [i+1])[0]);
    const visLimit = getChapterLimitForSubject(state.selection.subject?.uiId || state.selection.subject?.id);
    const adminLocked = chapNum > visLimit;

    // Progression lock (practice mode only, overrides nothing when admin-locked)
    const prog = (useProgression && !adminLocked) ? getChapterProgression(c.id) : { locked: false };
    if (prog.locked) {
      return `<button class="ch-card ch-locked" style="background:#f3f4f6;border:2px solid #d1d5db;position:relative;opacity:.7" disabled>
        <div class="ch-card-body">
          <div class="ch-card-name" style="color:#374151">${_chapLabel(c.label)}</div>
          <span class="ch-card-status" style="color:#6b7280;font-size:.72rem">🔒 ${prog.hint}</span>
        </div>
        <div class="ch-card-num" style="background:#9ca3af">
          <span>CH</span><span style="font-size:.95rem;font-weight:900">${chapNum}</span>
        </div>
      </button>`;
    }

    // Cleared badge
    const unlockData = useProgression ? _chapUnlockMap[c.id] : null;
    const isCleared  = unlockData?.is_cleared;

    let status;
    if (isCleared) {
      status = `<span class="ch-card-status" style="color:#059669">✅ ${_ta('Cleared','முடிந்தது')} · ${unlockData.best_score}%</span>`;
    } else if (state.userPlan === 'unlimited') {
      const chapStats = state.progress.chapters?.[c.label] || state.progress.chapters?.[c.id] || null;
      const passed = chapStats?.correct || 0;
      const failed = chapStats ? (chapStats.total - chapStats.correct) : 0;
      status = chapStats
        ? `<span class="ch-card-status"><span style="color:#059669">✓ ${passed} ${_ta('passed','சரி')}</span> · <span style="color:#e84545">✗ ${failed} ${_ta('failed','தவறு')}</span></span>`
        : `<span class="ch-card-status" style="color:#6b7280">▶ ${_ta('Practice Now','இப்போது பயிற்சி செய்')}</span>`;
    } else if (isPremium) {
      status = dayData.count > 0
        ? `<span class="ch-card-status" style="color:#059669">✅ ${dayData.count} ${_ta('answered today','இன்று பதிலளித்தது')}</span>`
        : `<span class="ch-card-status" style="color:#6b7280">▶ ${_ta('Practice Now','இப்போது பயிற்சி செய்')}</span>`;
    } else {
      const subjectDone = getSubjectDailyTotal() >= state.FREE_DAILY_LIMIT;
      const subjectRemaining = Math.max(0, state.FREE_DAILY_LIMIT - getSubjectDailyTotal());
      status = subjectDone
        ? `<span class="ch-card-status" style="color:#059669">✅ ${_ta('Daily limit reached','இன்றைய வரம்பு முடிந்தது')}</span>`
        : `<span class="ch-card-status" style="color:#6b7280">📝 ${subjectRemaining} ${_ta('left today','இன்று மீதம்')}</span>`;
    }

    // Motivational threshold hint for open-but-not-cleared chapters
    let thresholdHint = '';
    if (useProgression && !isCleared) {
      const att = unlockData?.attempt_no || 0;
      const needed = att === 0 ? 80 : att === 1 ? 70 : att === 2 ? 60 : 50;
      thresholdHint = `<span style="font-size:.65rem;color:#7c3aed;font-weight:700;margin-top:.18rem;display:block">🎯 ${_ta(`Score ${needed}% to clear${att > 0 ? ` (attempt ${att + 1})` : ''}`, `${needed}% மதிப்பெண் பெற்று முடிக்கவும்${att > 0 ? ` (முயற்சி ${att + 1})` : ''}`)}</span>`;
    }

    let accBadge = '';
    if (isWeakAreas) {
      const acc = chapAccMap[c.id];
      if (acc !== null && acc !== undefined) {
        const accColor = acc < 50 ? '#dc2626' : acc < 70 ? '#d97706' : '#059669';
        accBadge = `<span style="font-size:.65rem;font-weight:700;color:${accColor};margin-top:.2rem;display:block">${acc}% ${_ta('accuracy','துல்லியம்')}</span>`;
      } else {
        accBadge = `<span style="font-size:.65rem;color:var(--muted);margin-top:.2rem;display:block">${_ta('Not attempted','முயற்சிக்கப்படவில்லை')}</span>`;
      }
    }
    const chapDone = state.userPlan === 'free' && getSubjectDailyTotal() >= state.FREE_DAILY_LIMIT;
    return `<button class="ch-card${adminLocked ? ' ch-locked' : ''}" style="background:${col.bg};border:2px solid ${col.border};position:relative"
      ${(chapDone || adminLocked) ? 'disabled' : `onclick="selectChapter('${c.id}')"`}>
      <div class="ch-card-body">
        <div class="ch-card-name">${_chapLabel(c.label)}</div>
        ${adminLocked ? `<span class="ch-card-status" style="color:#9ca3af">🔒 ${_ta('Not available yet','இன்னும் கிடைக்கவில்லை')}</span>` : status}
        ${thresholdHint}${accBadge}
      </div>
      <div class="ch-card-num" style="background:${adminLocked ? '#9ca3af' : col.badge}">
        <span>CH</span><span style="font-size:.95rem;font-weight:900">${chapNum}</span>
      </div>
    </button>`;
  }).join('') || `<div class="info-box">${_ta('No chapters available.','அத்தியாயங்கள் எதுவும் இல்லை.')}</div>`;
  document.getElementById('reset-note').textContent = isPremium ? '' : `⏰ Resets at midnight · Next reset in ${getTimeUntilMidnight()}`;
}

export async function selectChapter(chapterId) {
  const chapter = state.selection.subject.chapters.find(c => c.id === chapterId);
  if (!chapter) return;
  state.selection.chapter = chapter;
  // save recommended chapter for session cards
  const _lid = state.selection.language?.id, _sid = state.selection.standard?.id;
  if (_lid && _sid) {
    try { localStorage.setItem('examace_rec_'+_lid+'_'+_sid, JSON.stringify({subjId:state.selection.subject?.id, subjLabel:state.selection.subject?.label, chapId:chapter.id, chapLabel:chapter.label})); } catch(e) {}
  }
  if (state.appMode === 'flashcard' || state.appMode === 'truefalse') { startFlashcards(chapter); return; }
  if (isDailyComplete(chapter)) {
    document.getElementById('done-chapter').textContent = _chapLabel(chapter.label);
    const limitEl = document.getElementById('done-limit');
    if (limitEl) limitEl.textContent = `${state.FREE_DAILY_LIMIT} questions`;
    const subLimitEl = document.getElementById('done-subject-limit');
    if (subLimitEl) subLimitEl.textContent = `${state.FREE_DAILY_LIMIT} questions`;
    updateResetTimer();
    showScreen('daily-done');
    return;
  }
  document.getElementById('chapter-list').innerHTML = '<div class="spinner-wrap"><div class="spinner"></div><p>Loading questions…</p></div>';
  try {
    const allQs = await fetchQuestions({ language: state.selection.language.label, standard: state.selection.standard.id, subject: state.selection.subject.dbLabel || state.selection.subject.label, chapterId: chapter.id});
    const dayData = getDailyDone(chapter);
    const seen = new Set(dayData.seen || []);
    const fresh = allQs.filter(q => !seen.has(qFingerprint(q)));
    const isPremiumOrUnlimited = state.userPlan === 'premium' || state.userPlan === 'unlimited';
    const remaining = isPremiumOrUnlimited ? allQs.length : Math.max(0, state.FREE_DAILY_LIMIT - getSubjectDailyTotal());
    const pool = isPremiumOrUnlimited ? allQs : (fresh.length >= remaining ? fresh : allQs);
    const qs = shuffle(pool).slice(0, remaining);
    if (!qs.length) { renderChapters(); showScreen('chapters'); return; }
    // Check for saved practice progress for this chapter
    const progressKey = 'practice_progress_' + chapter.id;
    let savedIdx = 0;
    try { savedIdx = parseInt(localStorage.getItem(progressKey) || '0') || 0; } catch(e) {}
    if (savedIdx > 0 && savedIdx < qs.length) {
      // Show resume prompt
      _showResumePrompt(qs, chapter, progressKey, savedIdx);
    } else {
      localStorage.removeItem(progressKey);
      state.practiceState = { questions: qs, idx: 0, answers: {}, skipDaily: false, chapter, start: Date.now(), progressKey };
      renderPracticeQ();
      showScreen('practice-quiz');
    }
  } catch (e) {
    const msg = e?.message === 'tamil_unavailable'
      ? _ta('Tamil questions not available for this chapter yet. Please try another chapter.', 'இந்த அத்தியாயத்திற்கு தமிழ் கேள்விகள் இன்னும் கிடைக்கவில்லை. வேறு அத்தியாயத்தை முயற்சிக்கவும்.')
      : _ta('Failed to load questions. Please try again.', 'கேள்விகளை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.');
    showToast(msg);
    renderChapters(); showScreen('practice-chapter');
  }
}

function _showResumePrompt(qs, chapter, progressKey, savedIdx) {
  const overlay = document.getElementById('resume-prompt-overlay');
  if (!overlay) {
    // Fallback: just start fresh if overlay HTML not present
    state.practiceState = { questions: qs, idx: 0, answers: {}, skipDaily: false, chapter, start: Date.now(), progressKey };
    renderPracticeQ(); showScreen('practice-quiz'); return;
  }
  document.getElementById('resume-q-num').textContent = savedIdx + 1;
  const rptEl = document.getElementById('resume-prompt-title');
  if (rptEl) rptEl.textContent = _ta('Resume Practice?', 'பயிற்சியை தொடரவா?');
  const rpdEl = overlay.querySelector('div > div:nth-child(3)');
  if (rpdEl) rpdEl.innerHTML = _ta(
    `You left off at <strong>Question ${savedIdx + 1}</strong>. Continue from here?`,
    `கேள்வி <strong>${savedIdx + 1}</strong> வரை வந்தீர்கள். இங்கிருந்து தொடரவா?`
  );
  const rstBtn = document.getElementById('resume-restart-btn');
  if (rstBtn) rstBtn.textContent = _ta('Restart', 'மீண்டும் தொடங்கு');
  const cntBtn = document.getElementById('resume-continue-btn');
  if (cntBtn) cntBtn.textContent = _ta('Continue →', 'தொடர் →');
  overlay.style.display = 'flex';
  overlay._continueHandler = () => {
    overlay.style.display = 'none';
    state.practiceState = { questions: qs, idx: savedIdx, answers: {}, skipDaily: false, chapter, start: Date.now(), progressKey };
    renderPracticeQ(); showScreen('practice-quiz');
  };
  overlay._restartHandler = () => {
    overlay.style.display = 'none';
    localStorage.removeItem(progressKey);
    state.practiceState = { questions: qs, idx: 0, answers: {}, skipDaily: false, chapter, start: Date.now(), progressKey };
    renderPracticeQ(); showScreen('practice-quiz');
  };
  document.getElementById('resume-continue-btn').onclick = overlay._continueHandler;
  document.getElementById('resume-restart-btn').onclick = overlay._restartHandler;
}

export async function startGrandTestNow() {
  const name = document.getElementById('grand-name').value.trim();
  if (!name) { document.getElementById('grand-err').style.display = 'block'; return; }
  document.getElementById('grand-err').style.display = 'none';
  const btn = document.querySelector('#screen-grand-setup .btn-danger');
  btn.textContent = 'Loading…'; btn.disabled = true;
  try {
    const subjects = state.selection.standard?.subjects || [];
    const results = await Promise.all(subjects.map(s =>
      fetchAllSubjectQuestions(state.selection.language.label, state.selection.standard.id, s)
    ));
    const perSubj = Math.floor(180 / Math.max(subjects.length, 1));
    let qs = [];
    results.forEach((subQs, i) => {
      qs = qs.concat(shuffle(subQs.map(q => ({ ...q, subject: subjects[i]?.label || q.subject }))).slice(0, perSubj));
    });
    qs = shuffle(qs).slice(0, 180);
    state.timedState = { questions: qs, idx: 0, answers: {}, marked: {}, secs: 11700, totalSecs: 11700, timer: null, start: Date.now(), name };
    document.getElementById('tq-total').textContent = qs.length;
    updateTimerDisplay();
    renderTimedQ();
    renderQNav();
    showScreen('timed-quiz');
    state.timedState.timer = setInterval(timerTick, 1000);
  } catch(e) {
    alert('Failed to load questions: ' + e.message);
  } finally {
    btn.textContent = '🏆 Start Grand Test'; btn.disabled = false;
  }
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.openFlow = openFlow;
window.selectLang = selectLang;
window.selectClass = selectClass;
window.selectSubject = selectSubject;
window.selectChapter = selectChapter;
window.startGrandTestNow = startGrandTestNow;
