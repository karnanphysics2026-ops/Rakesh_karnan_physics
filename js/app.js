import { state, ADMIN_EMAIL } from './state.js';
import { _ta } from './i18n.js';
import { showScreen } from './navigation.js';
import { loadAdminConfig, loadSupabaseHomeStats, showAdminPanel } from './admin.js';
import { showAuthScreen } from './auth.js';
import { loadGamificationState, renderLevelWidget } from './xp.js';
import { loadDailyTarget, loadStreak } from './streaks.js';
import { loadUserAchievements } from './achievements.js';
import { loadStorageSync, syncProgressFromSupabase, loadManifest } from './db.js';
import { renderHomeFeatures, renderHomeStats, renderHomeSessions } from './home.js';
import { renderLangOptions } from './flow.js';
import { getTodayKey } from './utils.js';
import { openElectrostaticsMode } from './electrostatics.js';

export async function initApp() {
  document.getElementById('screen-auth-login').style.display = 'none';
  document.getElementById('screen-auth-register').style.display = 'none';
  document.getElementById('screen-plan').style.display = 'none';
  // hide landing, restore auth-only blocks
  document.getElementById('home-guest-content').style.display = 'none';
  document.getElementById('home-daily-goal').style.display = '';
  document.getElementById('home-stats-row').style.display = '';
  document.getElementById('home-sessions-section').style.display = '';
  document.getElementById('home-features').style.display = '';
  document.getElementById('upgrade-banner').style.display = '';
  await loadAdminConfig();
  loadGamificationState().catch(() => {});
  loadDailyTarget().catch(() => {});
  loadStreak().catch(() => {});
  loadUserAchievements().catch(() => {});
  loadStorageSync();
  syncProgressFromSupabase().catch(() => {});
  updateNavUser();
  updateUpgradeBanner();
  renderHomeFeatures();
  renderHomeStats();
  loadSupabaseHomeStats().catch(() => {});
  renderHomeSessions();
  loadManifest().then(() => renderLangOptions()).catch(() => {
    document.getElementById('lang-options').innerHTML = '<div class="info-box">Could not load question catalog. Check Supabase connection.</div>';
  });

  const urlParams = new URLSearchParams(window.location.search);
  const isAdminRoute = urlParams.get('mode') === 'admin' || 
                       window.location.hash === '#admin' || 
                       window.location.hash === '#/admin' || 
                       window.location.pathname.endsWith('/admin') ||
                       window.location.pathname.endsWith('/admin/');

  if (isAdminRoute) {
    if (state.authUser) {
      if (state.authUser.email === ADMIN_EMAIL) {
        showAdminPanel();
      } else {
        alert('Access Denied: You are not authorized as an administrator.');
        showScreen('home');
      }
    } else {
      state.adminRedirect = true;
      showAuthScreen('login');
    }
  } else if (urlParams.get('mode') === 'electrostatics' || window.location.hash === '#electrostatics') {
    openElectrostaticsMode();
  } else {
    if (state.authUser && state.adminRedirect) {
      state.adminRedirect = false;
      if (state.authUser.email === ADMIN_EMAIL) {
        showAdminPanel();
      } else {
        showScreen('home');
      }
    } else {
      showScreen('home');
    }
  }
  setTimeout(showDailyTipPopup, 800);
}

export function updateNavUser() {
  const name = state.authUser ? (state.authUser.user_metadata?.display_name || state.authUser.email?.split('@')[0] || 'User') : null;
  // bottom nav
  const bnav = document.getElementById('bottom-nav');
  if (bnav) bnav.style.display = state.authUser ? 'flex' : 'none';
  // nav user area — hide for guests, show level widget for logged-in users
  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.style.display = state.authUser ? 'flex' : 'none';
  renderLevelWidget();
  // greeting
  const greet = document.getElementById('greeting-name');
  if (greet) greet.textContent = name || 'there';
}

export function renderProfileScreen() {
  const name = state.authUser ? (state.authUser.user_metadata?.display_name || state.authUser.email?.split('@')[0] || 'User') : 'User';
  const email = state.authUser?.email || '';
  const el = document.getElementById('profile-uname'); if (el) el.textContent = name;
  const em = document.getElementById('profile-email-txt'); if (em) em.textContent = email;
  const chip = document.getElementById('profile-plan-chip');
  if (chip) { chip.textContent = state.userPlan === 'premium' ? '⭐ Premium' : (state.userPlan === 'unlimited' ? '🚀 Unlimited' : 'Free Plan'); chip.className = (state.userPlan === 'premium' || state.userPlan === 'unlimited') ? 'profile-plan-chip premium' : 'profile-plan-chip'; }
  const adminItem = document.getElementById('admin-menu-item');
  if (adminItem) adminItem.style.display = state.authUser?.email === ADMIN_EMAIL ? 'flex' : 'none';
}

export function updateUpgradeBanner() {
  const el = document.getElementById('upgrade-banner');
  if (!el) return;
  if (state.userPlan !== 'premium' && state.userPlan !== 'unlimited') {
    el.innerHTML = `<div class="upgrade-banner"><p><b>⭐ Go Premium</b> — unlock flashcards, unlimited practice &amp; study community</p><button class="ub-btn" onclick="showUpgradePrompt('Premium Plan')">Upgrade</button></div>`;
  } else {
    el.innerHTML = '';
  }
}

const DAILY_TIPS = [
  { type:'do',    label:'✅ DO THIS',     title:'Start with Biology', text:'Attempt Biology first — it\'s worth 360 marks and has no complex calculations. Build confidence and save time for Physics.' },
  { type:'dont',  label:'❌ AVOID THIS',  title:'Don\'t Overthink Options', text:'Don\'t spend more than 2 minutes on any single question. Time loss compounds quickly — skip and return.' },
  { type:'studytip', label:'💡 STUDY TIP', title:'Trust NCERT Completely', text:'85% of NEET questions come directly from NCERT text and diagrams. Read line by line, not just highlighted parts.' },
  { type:'do',    label:'✅ DO THIS',     title:'Read All 4 Options First', text:'Read the complete question AND all 4 options before answering. NEET uses "most appropriate" wording that changes the answer.' },
  { type:'dont',  label:'❌ AVOID THIS',  title:'Never Skip Biology Questions', text:'Biology has no negative marking risk when you make an educated guess. Never leave a Biology question blank.' },
  { type:'studytip', label:'💡 STUDY TIP', title:'Spaced Repetition Works', text:'Review chapters after 1 day, 1 week, then 1 month. This proven technique locks information into long-term memory.' },
  { type:'do',    label:'✅ DO THIS',     title:'Mark Uncertain Questions', text:'Use the review/mark feature for uncertain questions. Return to them after completing easier questions first.' },
  { type:'dont',  label:'❌ AVOID THIS',  title:'Don\'t Change First Instinct', text:'Avoid changing an answer you were initially confident about. Research shows first instinct is correct more often.' },
  { type:'studytip', label:'💡 STUDY TIP', title:'Focus on Weak Chapters', text:'20% of your weak chapters contribute to 80% of lost marks. Identify them using your accuracy stats and drill those first.' },
  { type:'do',    label:'✅ DO THIS',     title:'Write Down SUVAT Variables', text:'For Physics numericals, write down known and unknown variables before solving. This systematic approach prevents errors.' },
];

export function showDailyTipPopup() {
  const today = getTodayKey();
  const shownKey = 'examace_tip_' + (state.authUser?.id || 'guest') + '_' + today;
  if (localStorage.getItem(shownKey)) return;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  const tip = DAILY_TIPS[dayOfYear % DAILY_TIPS.length];
  const badge = document.getElementById('tip-badge');
  badge.className = 'tip-badge ' + tip.type.replace('studytip','studytip');
  badge.textContent = tip.label;
  document.getElementById('tip-modal-title').textContent = tip.title;
  document.getElementById('tip-modal-text').textContent = tip.text;
  document.getElementById('tip-day-label').textContent = today;
  document.getElementById('tip-modal').style.display = 'flex';
}

export function closeTipModal() {
  document.getElementById('tip-modal').style.display = 'none';
  try { localStorage.setItem('examace_tip_' + (state.authUser?.id||'guest') + '_' + getTodayKey(), '1'); } catch(e) {}
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.closeTipModal = closeTipModal;
