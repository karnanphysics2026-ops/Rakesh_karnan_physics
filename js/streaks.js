import { db, state } from './state.js';
import { _ta } from './i18n.js';
import { showToast } from './ui.js';
import { awardXP } from './xp.js';
import { checkAndShowAchievements } from './achievements.js';

// ── DAILY TARGETS + STREAK SYSTEM ────────────────────────────────────────────
// Split out of js/gamification.js (Stage 4) — was "Phase 3" in that file.

let dailyTarget = {
  targetMCQs: 75, completedMCQs: 0,
  physicsTarget: 25, physicsCompleted: 0,
  chemistryTarget: 25, chemistryCompleted: 0,
  biologyTarget: 25, biologyCompleted: 0,
  isCompleted: false, xpAwarded: false,
  loaded: false,
};

// Exported (read-only in practice) so js/achievements.js can read the current
// streak for the "streak" achievement-progress calculation.
export let streakData = { currentStreak: 0, longestStreak: 0, streakUpdatedToday: false };

let _dailySyncTimer = null;

// ── Load today's target from Supabase ────────────────────────────────────────
export async function loadDailyTarget() {
  if (!state.authUser) return;
  try {
    const { data, error } = await db.rpc('get_or_create_daily_target', { p_user_id: state.authUser.id });
    if (!error && data) {
      dailyTarget = {
        targetMCQs:         data.target_mcqs,
        completedMCQs:      data.completed_mcqs,
        physicsTarget:      data.physics_target,
        physicsCompleted:   data.physics_completed,
        chemistryTarget:    data.chemistry_target,
        chemistryCompleted: data.chemistry_completed,
        biologyTarget:      data.biology_target,
        biologyCompleted:   data.biology_completed,
        isCompleted:        data.is_completed,
        xpAwarded:          data.xp_awarded,
        loaded: true,
      };
    }
  } catch (_) {}
  renderDailyMissionCard();
}

// ── Load streak from Supabase ────────────────────────────────────────────────
export async function loadStreak() {
  if (!state.authUser) return;
  try {
    const { data } = await db.from('user_streaks')
      .select('current_streak,longest_streak,last_practice_date')
      .eq('user_id', state.authUser.id).single();
    if (data) {
      const today = new Date().toISOString().split('T')[0];
      streakData.currentStreak      = data.current_streak;
      streakData.longestStreak      = data.longest_streak;
      streakData.streakUpdatedToday = data.last_practice_date === today;
    }
  } catch (_) {}
  renderStreakWidget();
  renderDailyMissionCard();
}

// ── Called after every MCQ answer ────────────────────────────────────────────
export async function incrementDailyTarget(subject) {
  if (!state.authUser || !dailyTarget.loaded) return;

  dailyTarget.completedMCQs++;
  const s = (subject || '').toLowerCase();
  if (s.includes('physics'))                                        dailyTarget.physicsCompleted++;
  else if (s.includes('chem'))                                      dailyTarget.chemistryCompleted++;
  else if (s.includes('bio') || s.includes('botan') || s.includes('zoo')) dailyTarget.biologyCompleted++;

  renderDailyMissionCard();

  // Trigger streak after 20 MCQs for the day
  if (dailyTarget.completedMCQs === 20 && !streakData.streakUpdatedToday) {
    checkAndUpdateStreak().catch(() => {});
  }

  // Daily goal completed → award 200 XP
  if (!dailyTarget.isCompleted && dailyTarget.completedMCQs >= dailyTarget.targetMCQs) {
    dailyTarget.isCompleted = true;
    if (!dailyTarget.xpAwarded) {
      dailyTarget.xpAwarded = true;
      awardXP('daily_goal').catch(() => {});
    }
    renderDailyMissionCard();
    showToast('🎯 Daily Mission Complete! +200 XP');
  }

  // Debounced sync to Supabase (batch writes)
  clearTimeout(_dailySyncTimer);
  _dailySyncTimer = setTimeout(_syncDailyTarget, 4000);
}

async function _syncDailyTarget() {
  if (!state.authUser) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    await db.from('daily_targets').upsert({
      user_id:             state.authUser.id,
      target_date:         today,
      target_mcqs:         dailyTarget.targetMCQs,
      completed_mcqs:      dailyTarget.completedMCQs,
      physics_target:      dailyTarget.physicsTarget,
      physics_completed:   dailyTarget.physicsCompleted,
      chemistry_target:    dailyTarget.chemistryTarget,
      chemistry_completed: dailyTarget.chemistryCompleted,
      biology_target:      dailyTarget.biologyTarget,
      biology_completed:   dailyTarget.biologyCompleted,
      is_completed:        dailyTarget.isCompleted,
      xp_awarded:          dailyTarget.xpAwarded,
      updated_at:          new Date().toISOString(),
    }, { onConflict: 'user_id,target_date' });
  } catch (_) {}
}

// ── Update streak (once ≥20 MCQs answered today) ─────────────────────────────
async function checkAndUpdateStreak() {
  if (!state.authUser || streakData.streakUpdatedToday) return;
  try {
    const { data: newStreak } = await db.rpc('update_streak', { p_user_id: state.authUser.id });
    if (newStreak != null) {
      streakData.currentStreak      = newStreak;
      streakData.longestStreak      = Math.max(streakData.longestStreak, newStreak);
      streakData.streakUpdatedToday = true;

      renderStreakWidget();
      renderDailyMissionCard();

      // 7-day milestone bonus (7, 14, 21, …)
      if (newStreak > 0 && newStreak % 7 === 0) {
        await awardXP('streak_7');
        showToast(`🔥 ${newStreak}-Day Streak! +500 XP Bonus!`);
      }

      checkAndShowAchievements().catch(() => {});

      // Update stat-streak on home screen
      const ss = document.getElementById('stat-streak');
      if (ss) ss.textContent = newStreak;
    }
  } catch (_) {}
}

// ── Daily Mission Card UI ─────────────────────────────────────────────────────
export function renderDailyMissionCard() {
  const el = document.getElementById('home-daily-goal');
  if (!el || !state.authUser) return;

  if (!dailyTarget.loaded) {
    el.innerHTML = `<div class="dm-loading"><div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div><span>${_ta('Loading mission…','பணி ஏற்றுகிறது…')}</span></div>`;
    el.style.display = 'block';
    return;
  }

  const { targetMCQs, completedMCQs, physicsTarget, physicsCompleted,
          chemistryTarget, chemistryCompleted, biologyTarget, biologyCompleted,
          isCompleted } = dailyTarget;
  const remaining  = Math.max(0, targetMCQs - completedMCQs);
  const totalPct   = Math.min(100, Math.round(completedMCQs / Math.max(targetMCQs, 1) * 100));
  const tier       = targetMCQs >= 150 ? _ta('🔥 Advanced','🔥 மேம்பட்ட') : targetMCQs >= 100 ? _ta('⚡ Intermediate','⚡ இடைநிலை') : _ta('📚 Beginner','📚 தொடக்கநிலை');

  const subjBar = (label, done, target, color) => {
    const pct = Math.min(100, target > 0 ? Math.round(Math.min(done, target) / target * 100) : 0);
    return `
      <div class="dm-subj">
        <div class="dm-subj-row">
          <span class="dm-subj-name">${label}</span>
          <span class="dm-subj-val" style="color:${pct >= 100 ? 'var(--success)' : 'inherit'}">${Math.min(done, target)}/${target}${pct >= 100 ? ' ✓' : ''}</span>
        </div>
        <div class="dm-bar"><div class="dm-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
  };

  el.style.display = 'block';
  el.innerHTML = `
    <div class="dm-header">
      <div class="dm-header-left">
        <div class="dm-title">${isCompleted ? _ta('✅ Mission Complete!','✅ பணி முடிந்தது!') : _ta("🎯 Today's Mission","🎯 இன்றைய பணி")}</div>
        <div class="dm-sub">${tier} · ${targetMCQs} MCQs${streakData.currentStreak > 0 ? ` · 🔥 ${streakData.currentStreak}${_ta('d streak','நாள் தொடர்')}` : ''}</div>
      </div>
      ${!isCompleted ? `<div class="dm-reward-badge">+200 XP</div>` : ''}
    </div>
    <div class="dm-subjects">
      ${subjBar(_ta('⚛️ Physics','⚛️ இயற்பியல்'),   physicsCompleted,   physicsTarget,   '#3b82f6')}
      ${subjBar(_ta('🧪 Chemistry','🧪 வேதியியல்'), chemistryCompleted, chemistryTarget, '#10b981')}
      ${subjBar(_ta('🧬 Biology','🧬 உயிரியல்'),   biologyCompleted,   biologyTarget,   '#ec4899')}
    </div>
    <div class="dm-total-bar"><div class="dm-total-fill" style="width:${totalPct}%"></div></div>
    <div class="dm-footer">
      <span class="dm-done-txt">${completedMCQs} / ${targetMCQs} ${_ta('done','முடிந்தது')}</span>
      <span class="dm-remain-txt">${isCompleted ? _ta('🏆 Goal achieved!','🏆 இலக்கு அடைந்தது!') : `${remaining} ${_ta('more to go','மேலும் தேவை')}`}</span>
    </div>`;
}

// ── Streak Widget UI ──────────────────────────────────────────────────────────
export function renderStreakWidget() {
  const el = document.getElementById('home-streak-card');
  if (!el || !state.authUser) return;

  const { currentStreak, longestStreak } = streakData;
  const nextMilestone = currentStreak < 7 ? 7 : Math.ceil((currentStreak + 1) / 7) * 7;
  const toMilestone   = nextMilestone - currentStreak;

  el.style.display = 'flex';
  el.innerHTML = currentStreak === 0
    ? `<div class="sc-empty">${_ta('🔥 Answer 20 MCQs today to start your streak!','🔥 இன்று 20 MCQகள் பதிலளித்து தொடர்ச்சியை தொடங்குங்கள்!')}</div>`
    : `
      <div class="sc-item">
        <div class="sc-icon">🔥</div>
        <div class="sc-val">${currentStreak}</div>
        <div class="sc-lbl">${_ta('Day Streak','நாள் தொடர்')}</div>
      </div>
      <div class="sc-divider"></div>
      <div class="sc-item">
        <div class="sc-icon">🏆</div>
        <div class="sc-val">${longestStreak}</div>
        <div class="sc-lbl">${_ta('Best Ever','சிறந்த சாதனை')}</div>
      </div>
      <div class="sc-divider"></div>
      <div class="sc-item">
        <div class="sc-icon">⚡</div>
        <div class="sc-val">${toMilestone}</div>
        <div class="sc-lbl">${_ta('Days to +500 XP','+500 XP-க்கு நாட்கள்')}</div>
      </div>`;
}

export async function checkAndUpdateElectrostaticsStreak() {
  let esState = {};
  try { esState = JSON.parse(localStorage.getItem('electrostatics_practice') || '{}') || {}; } catch(e) {}

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  if (esState.lastStreakDate === today) {
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

  let currentStreak = esState.electrostaticsStreak || 0;
  if (esState.lastStreakDate === yestStr) {
    currentStreak += 1;
  } else {
    currentStreak = 1;
  }

  esState.electrostaticsStreak = currentStreak;
  esState.lastStreakDate = today;
  try { localStorage.setItem('electrostatics_practice', JSON.stringify(esState)); } catch(e) {}

  await awardXP('electrostatics_streak');
  showToast(`⚡ Electrostatics Day ${currentStreak} Completed! +150 XP`);
}
