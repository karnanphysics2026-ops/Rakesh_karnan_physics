import { db, state } from './state.js';
import { _ta } from './i18n.js';
import { streakData } from './streaks.js';

// ── ACHIEVEMENT SYSTEM ────────────────────────────────────────────────────────
// Split out of js/gamification.js (Stage 4) — was "Phase 4" in that file.

let userAchievements  = [];   // { achievement_id, unlocked_at, title, icon, xp_reward, category }
let allAchievementDefs = [];  // all definitions from DB
let achievementTab    = 'all';

// ── Load all definitions + user's unlocked achievements ──────────────────────
export async function loadUserAchievements() {
  if (!state.authUser) return;
  try {
    const [{ data: defs }, { data: unlocked }] = await Promise.all([
      db.from('achievement_definitions').select('*').order('category').order('criteria_value'),
      db.from('user_achievements')
        .select('achievement_id, unlocked_at')
        .eq('user_id', state.authUser.id),
    ]);
    allAchievementDefs = defs || [];
    const unlockedMap  = {};
    (unlocked || []).forEach(u => { unlockedMap[u.achievement_id] = u.unlocked_at; });
    userAchievements = allAchievementDefs.map(d => ({
      ...d,
      unlockedAt: unlockedMap[d.id] || null,
    }));
  } catch (_) {}
  renderHomeAchievementsWidget();
}

// ── Compute progress toward a locked achievement ─────────────────────────────
function _achievementProgress(def) {
  const total   = state.progress.total   || 0;
  const correct = state.progress.correct || 0;
  const acc     = total > 0 ? Math.round(correct / total * 100) : 0;

  const subjectStat = (subj) => {
    // Check both exact match and substrings (Botany/Zoology → Biology)
    let s = state.progress.subjects?.[subj] || {};
    if (!s.total) {
      // Try alternate names
      const alt = Object.entries(state.progress.subjects || {}).find(([k]) =>
        k.toLowerCase().includes(subj.toLowerCase())
      );
      if (alt) s = alt[1];
    }
    const att  = s.total   || 0;
    const cor  = s.correct || 0;
    const sacc = att > 0 ? Math.round(cor / att * 100) : 0;
    return { current: sacc, att };
  };

  switch (def.criteria_type) {
    case 'mcqs_solved':       return { current: total,  target: def.criteria_value, unit: 'MCQs' };
    case 'accuracy':          return { current: acc,    target: def.criteria_value, unit: '%', note: `${total} MCQs attempted` };
    case 'streak':            return { current: streakData.currentStreak, target: def.criteria_value, unit: 'days' };
    case 'subject_biology':   { const { current, att } = subjectStat('Biology');   return { current, target: def.criteria_value, unit: '%', note: `${att} Bio MCQs done (need 100)` }; }
    case 'subject_physics':   { const { current, att } = subjectStat('Physics');   return { current, target: def.criteria_value, unit: '%', note: `${att} Phy MCQs done (need 100)` }; }
    case 'subject_chemistry': { const { current, att } = subjectStat('Chemistry'); return { current, target: def.criteria_value, unit: '%', note: `${att} Chem MCQs done (need 100)` }; }
    default:                  return { current: 0, target: def.criteria_value, unit: '' };
  }
}

// ── Render the full achievements screen ──────────────────────────────────────
export function renderAchievementsScreen() {
  const el = document.getElementById('ach-content');
  if (!el) return;

  const unlocked = userAchievements.filter(a => a.unlockedAt);
  const locked   = userAchievements.filter(a => !a.unlockedAt);
  const totalXPEarned = unlocked.reduce((s, a) => s + (a.xp_reward || 0), 0);

  // Summary header
  const summary = document.getElementById('ach-summary');
  if (summary) {
    summary.innerHTML = `
      <div class="ach-sum-stat"><div class="ach-sum-val">${unlocked.length}<span style="opacity:.5;font-size:.8em">/${userAchievements.length}</span></div><div class="ach-sum-lbl">${_ta('Unlocked','திறக்கப்பட்டது')}</div></div>
      <div class="ach-sum-divider"></div>
      <div class="ach-sum-stat"><div class="ach-sum-val">${totalXPEarned.toLocaleString()}</div><div class="ach-sum-lbl">${_ta('XP Earned','XP சம்பாதித்தது')}</div></div>
      <div class="ach-sum-divider"></div>
      <div class="ach-sum-stat"><div class="ach-sum-val">${locked.length}</div><div class="ach-sum-lbl">${_ta('Remaining','மீதமுள்ளது')}</div></div>`;
  }

  _renderAchievementCards();

  // Smart tips for near-unlock achievements
  const tips = locked.map(a => {
    const p = _achievementProgress(a);
    const pct = Math.min(100, Math.round(p.current / Math.max(p.target, 1) * 100));
    return { ...a, pct, prog: p };
  }).filter(a => a.pct >= 50 && a.pct < 100).sort((x, y) => y.pct - x.pct).slice(0, 2);

  const tipsEl = document.getElementById('ach-tips');
  if (tipsEl) {
    tipsEl.innerHTML = tips.length
      ? tips.map(a => `
          <div class="ach-tip-card">
            <span class="ach-tip-icon">${a.icon}</span>
            <div class="ach-tip-body">
              <div class="ach-tip-title">${_ta('Almost there!','கிட்டத்தட்ட வந்துவிட்டீர்கள்!')}</div>
              <div class="ach-tip-text">${_achievementTip(a)}</div>
            </div>
          </div>`).join('')
      : '';
  }
}

function _achievementTip(ach) {
  const p    = ach.prog;
  const left = p.target - Math.min(p.current, p.target);
  switch (ach.criteria_type) {
    case 'mcqs_solved':       return _ta(`Solve ${left.toLocaleString()} more MCQs to unlock <b>${ach.title}</b>.`,`<b>${ach.title}</b> திறக்க ${left.toLocaleString()} MCQ கேள்விகளுக்கு மேலும் பதிலளியுங்கள்.`);
    case 'accuracy':          return _ta(`Raise your accuracy to ${p.target}% to unlock <b>${ach.title}</b>.`,`<b>${ach.title}</b> திறக்க உங்கள் துல்லியத்தை ${p.target}% ஆக உயர்த்துங்கள்.`);
    case 'streak':            return _ta(`Practice for ${left} more day${left !== 1 ? 's' : ''} in a row to unlock <b>${ach.title}</b>.`,`<b>${ach.title}</b> திறக்க தொடர்ந்து ${left} நாள் மேலும் பயிற்சி செய்யுங்கள்.`);
    case 'subject_biology':   return _ta(`Score ${p.target}%+ in Biology (${p.note}) to unlock <b>${ach.title}</b>.`,`<b>${ach.title}</b> திறக்க உயிரியலில் ${p.target}%+ மதிப்பெண் (${p.note}) பெறுங்கள்.`);
    case 'subject_physics':   return _ta(`Score ${p.target}%+ in Physics (${p.note}) to unlock <b>${ach.title}</b>.`,`<b>${ach.title}</b> திறக்க இயற்பியலில் ${p.target}%+ மதிப்பெண் (${p.note}) பெறுங்கள்.`);
    case 'subject_chemistry': return _ta(`Score ${p.target}%+ in Chemistry (${p.note}) to unlock <b>${ach.title}</b>.`,`<b>${ach.title}</b> திறக்க வேதியியலில் ${p.target}%+ மதிப்பெண் (${p.note}) பெறுங்கள்.`);
    default:                  return _ta(`Keep going to unlock <b>${ach.title}</b>!`,`<b>${ach.title}</b> திறக்க தொடர்ந்து முயற்சி செய்யுங்கள்!`);
  }
}

function _renderAchievementCards() {
  const el = document.getElementById('ach-content');
  if (!el) return;

  const list = achievementTab === 'all'
    ? userAchievements
    : userAchievements.filter(a => a.category === achievementTab);

  // Unlocked first, then locked sorted by progress desc
  const sorted = [
    ...list.filter(a => a.unlockedAt).sort((x, y) => new Date(y.unlockedAt) - new Date(x.unlockedAt)),
    ...list.filter(a => !a.unlockedAt).map(a => {
      const p = _achievementProgress(a);
      return { ...a, _pct: Math.min(100, Math.round(p.current / Math.max(p.target, 1) * 100)), _prog: p };
    }).sort((x, y) => y._pct - x._pct),
  ];

  if (!sorted.length) {
    el.innerHTML = `<div class="ach-empty">${_ta('No achievements in this category yet.','இந்த பிரிவில் இன்னும் சாதனைகள் இல்லை.')}</div>`;
    return;
  }

  el.innerHTML = sorted.map(a => {
    if (a.unlockedAt) {
      const date = new Date(a.unlockedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return `
        <div class="ach-card unlocked">
          <div class="ach-card-icon">${a.icon}</div>
          <div class="ach-card-body">
            <div class="ach-card-title">${a.title}</div>
            <div class="ach-card-desc">${a.description || ''}</div>
            <div class="ach-card-meta">✅ ${date}${a.xp_reward ? ` &middot; +${a.xp_reward} XP` : ''}</div>
          </div>
        </div>`;
    } else {
      const p   = a._prog   || _achievementProgress(a);
      const pct = a._pct    ?? Math.min(100, Math.round(p.current / Math.max(p.target, 1) * 100));
      const progLabel = p.unit === '%'
        ? `${p.current}% / ${p.target}%${p.note ? ` · ${p.note}` : ''}`
        : `${Math.min(p.current, p.target).toLocaleString()} / ${p.target.toLocaleString()} ${p.unit}`;
      return `
        <div class="ach-card locked">
          <div class="ach-card-icon">🔒</div>
          <div class="ach-card-body">
            <div class="ach-card-title">${a.title}</div>
            <div class="ach-card-desc">${a.description || ''}</div>
            <div class="ach-prog-wrap">
              <div class="ach-prog-bar"><div class="ach-prog-fill" style="width:${pct}%"></div></div>
              <div class="ach-prog-txt">${progLabel}</div>
            </div>
          </div>
          ${a.xp_reward ? `<div class="ach-reward-badge">+${a.xp_reward}</div>` : ''}
        </div>`;
    }
  }).join('');
}

export function filterAchievementTab(tab) {
  achievementTab = tab;
  document.querySelectorAll('.ach-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  _renderAchievementCards();
}

// ── Home achievements widget ──────────────────────────────────────────────────
export function renderHomeAchievementsWidget() {
  const el = document.getElementById('home-achievements-widget');
  if (!el || !state.authUser) return;

  const unlocked = userAchievements.filter(a => a.unlockedAt);
  const total    = userAchievements.length;
  el.style.display = 'block';

  if (!unlocked.length) {
    el.innerHTML = `
      <div class="haw-header">
        <span class="haw-title">🏅 ${_ta('Achievements','சாதனைகள்')}</span>
        <button class="haw-see-all" onclick="showScreen('achievements')">${_ta('See All →','அனைத்தும் காண →')}</button>
      </div>
      <div class="haw-empty">${_ta('Answer MCQs to unlock your first achievement!','உங்கள் முதல் சாதனையை திறக்க MCQகளுக்கு பதிலளியுங்கள்!')}</div>`;
    return;
  }

  const recent = unlocked.slice(0, 4);
  el.innerHTML = `
    <div class="haw-header">
      <span class="haw-title">🏅 ${_ta('Achievements','சாதனைகள்')}</span>
      <span class="haw-count">${unlocked.length}/${total}</span>
      <button class="haw-see-all" onclick="showScreen('achievements')">${_ta('See All →','அனைத்தும் காண →')}</button>
    </div>
    <div class="haw-badges">
      ${recent.map(a => `
        <div class="haw-badge" title="${a.title}">
          <div class="haw-badge-icon">${a.icon}</div>
          <div class="haw-badge-name">${a.title.split(' ').slice(0, 2).join(' ')}</div>
        </div>`).join('')}
      ${unlocked.length > 4 ? `<div class="haw-badge haw-more" onclick="showScreen('achievements')">+${unlocked.length - 4}<div class="haw-badge-name">more</div></div>` : ''}
    </div>`;
}

// ── Achievement check (fire after significant events) ────────────────────────
export async function checkAndShowAchievements() {
  if (!state.authUser) return;
  try {
    const { data } = await db.rpc('check_achievements', { p_user_id: state.authUser.id });
    if (data?.length) {
      data.forEach((ach, i) => {
        setTimeout(() => showAchievementToast(ach), i * 2200);
      });
      // Refresh cached list so home widget and screen stay current
      loadUserAchievements().catch(() => {});
    }
  } catch (_) {}
}

function showAchievementToast(ach) {
  const t = document.createElement('div');
  t.className = 'ach-toast';
  t.innerHTML = `
    <div class="acht-icon">${ach.icon}</div>
    <div class="acht-body">
      <div class="acht-title">Achievement Unlocked!</div>
      <div class="acht-name">${ach.title}</div>
      ${ach.xp_reward ? `<div class="acht-xp">+${ach.xp_reward} XP</div>` : ''}
    </div>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.filterAchievementTab = filterAchievementTab;
