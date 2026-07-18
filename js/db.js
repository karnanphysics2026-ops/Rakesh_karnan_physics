import { db, state, SUPABASE_URL } from './state.js';
import { shuffle } from './utils.js';

// ── STORAGE ──
export function loadStorageSync() {
  try { const s = localStorage.getItem('examace_lb'); if (s) state.localLeaderboard = JSON.parse(s); } catch (e) {}
  try { const s = localStorage.getItem('examace_mistakes'); if (s) state.mistakes = JSON.parse(s); } catch (e) {}
  try { const s = localStorage.getItem('examace_progress'); if (s) state.progress = JSON.parse(s); } catch (e) {}
}

export async function syncProgressFromSupabase() {
  if (!state.authUser) return;
  try {
    const { data } = await db.from('user_progress').select('total,correct,wrong,time_spent,subjects,chapters,history').eq('user_id', state.authUser.id).single();
    if (data) {
      state.progress = { total: data.total, correct: data.correct, wrong: data.wrong, time: data.time_spent, subjects: data.subjects || {}, chapters: data.chapters || {}, history: data.history || [] };
      try { localStorage.setItem('examace_progress', JSON.stringify(state.progress)); } catch (e) {}
    }
    const mistakeLimit = (state.userPlan === 'premium' || state.userPlan === 'unlimited') ? 200 : 20;
    const { data: md } = await db.from('mistakes').select('question,options,correct,explanation,subject,chapter,your_answer,answered_at').eq('user_id', state.authUser.id).order('answered_at', { ascending: false }).limit(mistakeLimit);
    if (md) {
      state.mistakes = md.map(m => ({ question: m.question, options: m.options, correct: m.correct, explanation: m.explanation, subject: m.subject, chapter: m.chapter, date: new Date(m.answered_at).toLocaleDateString('en-GB'), yourAnswer: m.your_answer }));
      try { localStorage.setItem('examace_mistakes', JSON.stringify(state.mistakes)); } catch (e) {}
    }
  } catch (e) {}
}

export function saveStorage() {
  try { localStorage.setItem('examace_lb', JSON.stringify(state.localLeaderboard)); } catch (e) {}
  try { localStorage.setItem('examace_mistakes', JSON.stringify(state.mistakes)); } catch (e) {}
  try { localStorage.setItem('examace_progress', JSON.stringify(state.progress)); } catch (e) {}
  if (!state.authUser) return;
  db.from('user_progress').upsert({
    user_id: state.authUser.id, total: state.progress.total, correct: state.progress.correct, wrong: state.progress.wrong,
    time_spent: state.progress.time, subjects: state.progress.subjects, chapters: state.progress.chapters,
    history: state.progress.history, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' }).then();
}

export async function loadManifest() {
  if (state.manifest) return state.manifest;
  const { data, error } = await db.from('chapters')
    .select('language,standard,subject,chapter_id,chapter_label,question_count')
    .order('language').order('standard').order('subject').order('chapter_id');
  if (error || !data?.length) throw new Error(error ? error.message : 'chapters table empty');
  const manifest = { languages: [] };
  const li = {}, si = {}, oi = {};
  for (const r of data) {
    if (!li[r.language]) { li[r.language] = { id: r.language.toLowerCase(), label: r.language, standards: [] }; manifest.languages.push(li[r.language]); }
    const sk = `${r.language}/${r.standard}`;
    if (!si[sk]) { si[sk] = { id: r.standard, label: `${r.standard} Standard`, subjects: [] }; li[r.language].standards.push(si[sk]); }
    const ok = `${sk}/${r.subject}`;
    if (!oi[ok]) { oi[ok] = { id: r.subject.toLowerCase(), label: r.subject, chapters: [], totalQuestions: 0 }; si[sk].subjects.push(oi[ok]); }
    oi[ok].chapters.push({ id: r.chapter_id, label: r.chapter_label, count: r.question_count || 0 });
    oi[ok].totalQuestions += r.question_count || 0;
  }
  state.manifest = manifest;
  return manifest;
}

// Build a question object with shuffled options (A/B/C/D → display 1/2/3/4)
// correct_option stays as A/B/C/D internally; correct (int) = shuffled display index
export function buildQuestion({ id, question_text, optMap, correct_option, explanation, topic, chapter, tag, subject }) {
  const keys = shuffle(['A','B','C','D']);          // e.g. ['C','A','D','B']
  const options = keys.map(k => optMap[k] || '');  // display 1/2/3/4 texts
  const correct = keys.indexOf(correct_option);     // which display position is correct
  return { id, question: question_text, options, correct, correct_option, shuffleMap: keys, explanation: explanation || '', topic, chapter, tag, subject };
}

// Returns true if text contains Tamil Unicode characters (U+0B80–U+0BFF)
export function _hasTamilText(text) { return /[஀-௿]/.test(text || ''); }

export async function fetchQuestions({ language, standard, subject, chapterId }) {
  const isT = language.toLowerCase() === 'tamil';
  const lang_id = isT ? 2 : 1;  // case-insensitive Tamil detection

  // ── Layer 1: Storage JSON (CDN-cached, free of DB quota) ─────────────────
  if (chapterId) {
    try {
      const url = `${SUPABASE_URL}/storage/v1/object/public/questions/${language.toLowerCase()}/${standard.toLowerCase().replace(/\s+/g,'')}/${subject.toLowerCase()}/${chapterId}.json`;
      const res = await fetch(url);
      if (res.ok) {
        const raw = await res.json();
        // Support both flat array [] and nested {meta, questions:[]} formats
        const data = Array.isArray(raw) ? raw : (Array.isArray(raw.questions) ? raw.questions : []);
        if (!data.length) throw new Error('empty');
        const mapped = data
          .filter(r => !r.status || r.status === 'active')
          .map(r => {
            const optMap = { A: r.options?.[0], B: r.options?.[1], C: r.options?.[2], D: r.options?.[3] };
            const correct_option = r.correct_option || 'ABCD'[r.correct] || 'A';
            return buildQuestion({ id: r.id || null, question_text: r.question, optMap, correct_option,
              explanation: r.explanation, topic: r.topic || subject,
              chapter: r.chapter_label || chapterId, tag: r.question_tag || r.tag || '', subject });
          });
        // For Tamil: verify the file actually contains Tamil text, not English
        if (!isT || _hasTamilText(mapped[0]?.question)) return mapped;
        // Tamil path returned English content — fall through to DB layers
      }
    } catch(e) { /* fall through */ }
  }

  // ── Layer 2: DB fallback (flat schema — questions.options JSONB) ──────────
  // Previously tried question_translations/options first (normalized schema
  // from migration 007), but those tables were never populated (0 rows in
  // production) — that query always returned nothing and silently fell
  // through here anyway. Removed to stop pretending it does something.
  let qb = db.from('questions')
    .select('id,topic,question,options,correct,correct_option,explanation,chapter_label,question_tag')
    .eq('language', language).eq('standard', standard).eq('subject', subject);
  if (chapterId) qb = qb.eq('chapter_id', chapterId);
  const { data, error } = await qb;
  if (error) throw new Error('Could not load questions');
  const mapped3 = (data || []).map(r => {
    const correct_option = r.correct_option || 'ABCD'[r.correct] || 'A';
    const optMap = { A: r.options?.[0], B: r.options?.[1], C: r.options?.[2], D: r.options?.[3] };
    return buildQuestion({ id: r.id, question_text: r.question, optMap, correct_option,
      explanation: r.explanation, topic: r.topic || r.chapter_label,
      chapter: r.chapter_label || r.topic || chapterId || subject,
      tag: r.question_tag || '', subject });
  });
  // For Tamil: if Layer 2 also returns English text, signal no Tamil content available
  if (isT && mapped3.length > 0 && !_hasTamilText(mapped3[0]?.question)) {
    throw new Error('tamil_unavailable');
  }
  return mapped3;
}

// Fetch all questions for a subject — used by timed/grand tests.
// Tries a bulk DB fetch first; if it returns English for a Tamil request,
// falls back to chapter-by-chapter CDN fetches (Layer 1).
export async function fetchAllSubjectQuestions(language, standard, subjectObj) {
  const isStr = typeof subjectObj === 'string';
  const subjectLabel = isStr ? subjectObj : (subjectObj.dbLabel || subjectObj.label);
  const chapters = isStr ? [] : (subjectObj.chapters || []);
  const isT = language.toLowerCase() === 'tamil';

  // Bulk DB attempt first (fast path)
  try {
    const qs = await fetchQuestions({ language, standard, subject: subjectLabel });
    if (qs.length > 0 && (!isT || _hasTamilText(qs[0]?.question))) return qs;
  } catch(e) { if (e?.message !== 'tamil_unavailable') throw e; }

  // For Tamil (or bulk returned nothing/English): chapter-by-chapter via CDN
  if (chapters.length > 0) {
    const results = await Promise.allSettled(
      chapters.map(c => fetchQuestions({ language, standard, subject: subjectLabel, chapterId: c.id }))
    );
    const combined = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (combined.length > 0) return combined;
  }

  return [];
}
