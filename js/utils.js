import { db, state } from './state.js';

export function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
export function subjClass(s) { return s === 'Physics' ? 'subj-phy' : s === 'Chemistry' ? 'subj-che' : 'subj-bio'; }
export function getTodayKey() { return new Date().toISOString().split('T')[0]; }
export function getWeekKey() { const n = new Date(), s = new Date(n); s.setDate(n.getDate() - n.getDay()); return s.toISOString().split('T')[0]; }
export function qFingerprint(q) { return (q.question || '').slice(0, 100); }

export function dailyStorageKey(chapter) {
  const ch = chapter || state.selection.chapter;
  return `examace_daily_${state.selection.language?.id}_${state.selection.standard?.id}_${state.selection.subject?.id}_${ch?.id}_${getTodayKey()}`;
}
export function getDailyDone(chapter) {
  const ch = chapter || state.selection.chapter;
  const key = `${state.selection.language?.id}_${state.selection.standard?.id}_${state.selection.subject?.id}_${ch?.id}_${getTodayKey()}`;
  if (state.dailyCache[key]) return state.dailyCache[key];
  try { const raw = localStorage.getItem(dailyStorageKey(ch)); return raw ? JSON.parse(raw) : { count: 0, seen: [] }; } catch (e) { return { count: 0, seen: [] }; }
}
export function setDailyDone(chapter, data) {
  const ch = chapter || state.selection.chapter;
  const key = `${state.selection.language?.id}_${state.selection.standard?.id}_${state.selection.subject?.id}_${ch?.id}_${getTodayKey()}`;
  state.dailyCache[key] = data;
  try { localStorage.setItem(dailyStorageKey(ch), JSON.stringify(data)); } catch (e) {}
  if (state.authUser) {
    db.from('daily_practice').upsert({
      user_id: state.authUser.id,
      language: state.selection.language?.label || '', standard: state.selection.standard?.id || '',
      subject: state.selection.subject?.label || '', chapter_id: ch?.id || '',
      practice_date: getTodayKey(), count: data.count, seen_fingerprints: data.seen
    }, { onConflict: 'user_id,language,standard,subject,chapter_id,practice_date' }).then();
  }
}

export function getFCDoneToday() {
  const uid = state.authUser?.id || 'guest';
  try { return Math.min(state.FREE_FC_DAILY, parseInt(localStorage.getItem('examace_fc_' + uid + '_' + getTodayKey()) || '0', 10)); } catch(e) { return 0; }
}
export function getTFDoneToday() {
  const uid = state.authUser?.id || 'guest';
  try { return Math.min(state.FREE_TF_DAILY, parseInt(localStorage.getItem('examace_tf_' + uid + '_' + getTodayKey()) || '0', 10)); } catch(e) { return 0; }
}
export function incFCDone(n) {
  if (state.userPlan !== 'free') return;
  const uid = state.authUser?.id || 'guest';
  try { localStorage.setItem('examace_fc_' + uid + '_' + getTodayKey(), getFCDoneToday() + (n||1)); } catch(e) {}
}
export function incTFDone(n) {
  if (state.userPlan !== 'free') return;
  const uid = state.authUser?.id || 'guest';
  try { localStorage.setItem('examace_tf_' + uid + '_' + getTodayKey(), getTFDoneToday() + (n||1)); } catch(e) {}
}

export async function preloadDailyData() {
  if (!state.authUser || !state.selection.subject) return;
  try {
    const today = getTodayKey();
    const { data } = await db.from('daily_practice')
      .select('chapter_id,count,seen_fingerprints')
      .eq('user_id', state.authUser.id)
      .eq('language', state.selection.language?.label || '')
      .eq('standard', state.selection.standard?.id || '')
      .eq('subject', state.selection.subject?.label || '')
      .eq('practice_date', today);
    if (data) {
      data.forEach(row => {
        const key = `${state.selection.language?.id}_${state.selection.standard?.id}_${state.selection.subject?.id}_${row.chapter_id}_${today}`;
        state.dailyCache[key] = { count: row.count, seen: row.seen_fingerprints || [] };
        try { localStorage.setItem(dailyStorageKey({ id: row.chapter_id }), JSON.stringify(state.dailyCache[key])); } catch (e) {}
      });
    }
  } catch (e) {}
}
export function isDailyComplete(chapter) {
  if (state.userPlan === 'premium' || state.userPlan === 'unlimited') return false;
  return getSubjectDailyTotal() >= state.FREE_DAILY_LIMIT;
}
export function getSubjectDailyTotal() {
  const chaps = state.selection.subject?.chapters || [];
  return chaps.reduce((sum, c) => sum + (getDailyDone(c).count || 0), 0);
}
export function getTimeUntilMidnight() {
  const now = new Date(), midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight - now;
  return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`;
}

export function renderMath(el) {
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(el, {
        delimiters: [
          {left: "$$", right: "$$", display: true},
          {left: "$", right: "$", display: false},
          {left: "\\(", right: "\\)", display: false},
          {left: "\\[", right: "\\]", display: true}
        ],
        throwOnError: false
      });
    } catch(e) {
      console.warn("Math rendering failed:", e);
    }
  }
}
