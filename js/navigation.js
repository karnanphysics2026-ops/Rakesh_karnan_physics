import { state } from './state.js';
import { loadLeaderboard } from './leaderboard.js';
import { renderDashboard, renderMistakes } from './dashboard.js';
import { renderHomeStats, renderHomeFeatures } from './home.js';
import { updateUpgradeBanner, renderProfileScreen } from './app.js';
import { finishTimedTest } from './timed-test.js';
import { renderHomeXPCard } from './xp.js';
import { renderDailyMissionCard, renderStreakWidget } from './streaks.js';
import { renderHomeAchievementsWidget, loadUserAchievements, renderAchievementsScreen } from './achievements.js';

function _hideAuthForms() {
  ['screen-auth-login','screen-auth-register','screen-plan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}
export function showScreen(name) {
  _hideAuthForms();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'dashboard') renderDashboard();
  if (name === 'mistakes') renderMistakes();
  if (name === 'home') { renderHomeStats(); renderHomeFeatures(); updateUpgradeBanner(); renderDailyMissionCard(); renderStreakWidget(); renderHomeXPCard(); renderHomeAchievementsWidget(); }
  if (name === 'achievements') { loadUserAchievements().then(() => renderAchievementsScreen()); }
  if (name === 'profile') renderProfileScreen();
  // bottom nav active state
  ['home','practice','community','profile'].forEach(n => {
    const btn = document.getElementById('bnav-' + n);
    if (btn) btn.classList.toggle('active', n === name);
  });
}
export function goHome() { showScreen('home'); }
// Show a screen without requiring auth (for contact, community)
export function showScreenPublic(name) {
  _hideAuthForms();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) { el.classList.add('active'); window.scrollTo(0,0); }
}
export function confirmExit() { if (confirm('Exit quiz? Your progress will be lost.')) goHome(); }
export function confirmSubmit() { if (confirm('Submit the test now?')) finishTimedTest(); }
export function showCommunity() { showScreenPublic('community'); }

export function renderStepper(step) {
  let steps;
  if (state.appMode === 'grand') steps = ['Language', 'Class', 'Test'];
  else if (state.appMode === 'timed') steps = ['Language', 'Class', 'Subject', 'Test'];
  else steps = ['Language', 'Class', 'Subject', 'Chapter'];
  const html = steps.map((s, i) => `
    <div class="step">
      <div class="step-dot ${i < step ? 'done' : i === step ? 'active' : ''}">${i < step ? '✓' : i + 1}</div>
      <div class="step-line ${i < step ? 'done' : ''}"></div>
    </div>`).join('');
  ['stepper-practice', 'stepper-class', 'stepper-subject', 'stepper-chapter', 'stepper-grand'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

export function selectionLabel() {
  return [state.selection.language?.label, state.selection.standard?.label, state.selection.subject?.label, state.selection.chapter?.label].filter(Boolean).join(' · ');
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.showScreen = showScreen;
window.goHome = goHome;
window.showScreenPublic = showScreenPublic;
window.confirmExit = confirmExit;
window.confirmSubmit = confirmSubmit;
window.showCommunity = showCommunity;
