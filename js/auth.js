import { db, state, PREMIUM_DAILY_LIMIT, ADMIN_EMAIL } from './state.js';
import { _ta } from './i18n.js';
import { initApp } from './app.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ni = document.getElementById('timed-name');
  if (ni) ni.addEventListener('focus', () => ni.style.borderColor = 'var(--gold)');

  // Wire Enter key on login/register forms
  document.querySelectorAll('#screen-auth-login input, #screen-auth-register input').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const s = inp.closest('[id^=screen-auth-]')?.id; if (s === 'screen-auth-login') handleLogin(); else if (s === 'screen-auth-register') handleRegister(); } });
  });

  // Check for an existing session
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    state.authUser = session.user;
    await loadUserPlan();
    await initApp();
  } else {
    showGuestLanding();
  }

  // React to auth state changes across tabs / email confirmation
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      state.authUser = null; state.userPlan = 'free'; state.DAILY_LIMIT = state.FREE_DAILY_LIMIT;
      showGuestLanding();
    } else if (event === 'SIGNED_IN' && session?.user && !state.authUser) {
      state.authUser = session.user;
      await loadUserPlan();
      await initApp();
    }
  });
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
export function showGuestLanding() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-home').classList.add('active');
  document.getElementById('screen-auth-login').style.display = 'none';
  document.getElementById('screen-auth-register').style.display = 'none';
  document.getElementById('screen-plan').style.display = 'none';
  document.getElementById('home-guest-content').style.display = 'block';
  const hxp = document.getElementById('home-xp-card'); if (hxp) hxp.style.display = 'none';
  const hsc = document.getElementById('home-streak-card'); if (hsc) hsc.style.display = 'none';
  const haw = document.getElementById('home-achievements-widget'); if (haw) haw.style.display = 'none';
  document.getElementById('home-daily-goal').style.display = 'none';
  document.getElementById('home-stats-row').style.display = 'none';
  document.getElementById('home-sessions-section').style.display = 'none';
  document.getElementById('home-features').style.display = 'none';
  document.getElementById('upgrade-banner').style.display = 'none';
  document.getElementById('greeting-name').textContent = 'there';
  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.style.display = 'none';
  const bnav = document.getElementById('bottom-nav');
  if (bnav) bnav.style.display = 'none';
}

export function showAuthScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-auth-login').style.display = screen === 'login' ? 'flex' : 'none';
  document.getElementById('screen-auth-register').style.display = screen === 'register' ? 'flex' : 'none';
  document.getElementById('screen-plan').style.display = 'none';
}

export function showPlanScreen() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-auth-login').style.display = 'none';
  document.getElementById('screen-auth-register').style.display = 'none';
  document.getElementById('screen-plan').style.display = 'flex';
  selectPlan('free');
}

export function selectPlan(plan) {
  state.selectedPlan = plan;
  document.getElementById('plan-free-card').classList.toggle('selected', plan === 'free');
  document.getElementById('plan-premium-card').classList.toggle('selected', plan === 'premium');
  const unlimitedCard = document.getElementById('plan-unlimited-card');
  if (unlimitedCard) unlimitedCard.classList.toggle('selected', plan === 'unlimited');
  document.getElementById('plan-btn').textContent = plan === 'premium' ? 'Get Premium →' : (plan === 'unlimited' ? 'Get Unlimited Pro →' : 'Continue with Free');
}

export async function confirmPlan() {
  const btn = document.getElementById('plan-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  await db.from('user_profiles').upsert({ id: state.authUser.id, plan: state.selectedPlan }, { onConflict: 'id' });
  state.userPlan = state.selectedPlan;
  state.DAILY_LIMIT = (state.userPlan === 'premium' || state.userPlan === 'unlimited') ? PREMIUM_DAILY_LIMIT : state.FREE_DAILY_LIMIT;
  btn.disabled = false;
  await initApp();
}

export async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-err');
  const btn = document.getElementById('login-btn');
  errEl.style.display = 'none';
  if (!email || !password) { errEl.textContent = 'Please fill in all fields.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  // Check if this user has been disabled by admin
  const { data: profile } = await db.from('user_profiles').select('disabled').eq('id', data.user.id).single();
  if (profile?.disabled) {
    await db.auth.signOut();
    errEl.textContent = _ta('Your account has been disabled. Please contact support.','உங்கள் கணக்கு முடக்கப்பட்டுள்ளது. ஆதரவை தொடர்பு கொள்ளவும்.');
    errEl.style.display = 'block';
    return;
  }
  state.authUser = data.user;
  await loadUserPlan();
  await initApp();
}

export async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-err');
  const btn = document.getElementById('reg-btn');
  errEl.style.display = 'none';
  if (!name || !email || !password) { errEl.textContent = 'Please fill in all fields.'; errEl.style.display = 'block'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Creating account…';
  const { data, error } = await db.auth.signUp({ email, password, options: { data: { display_name: name } } });
  btn.disabled = false; btn.textContent = 'Create Account';
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  state.authUser = data.user;
  // user_profiles row is created server-side by the on_auth_user_created_profile
  // trigger (036_user_profiles_signup_trigger.sql) — no client-side insert needed.
  showPlanScreen();
}

export async function showForgotPassword() {
  const email = document.getElementById('login-email').value.trim();
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none'; errEl.style.color = ''; errEl.style.background = '';
  if (!email) { errEl.textContent = 'Enter your email above, then click Forgot password.'; errEl.style.display = 'block'; return; }
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://karnan.guru/'
  });
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  errEl.style.color = '#059669'; errEl.style.background = '#f0fdf4';
  errEl.textContent = 'Password reset link sent to ' + email + '. Check your inbox.';
  errEl.style.display = 'block';
  setTimeout(() => { errEl.style.display = 'none'; errEl.style.color = ''; errEl.style.background = ''; errEl.textContent = ''; }, 6000);
}

export async function handleLogout() {
  if (!confirm('Sign out?')) return;
  await db.auth.signOut();
  state.mistakes = []; state.progress = { total: 0, correct: 0, wrong: 0, time: 0, subjects: {}, chapters: {}, history: [] };
  state.localLeaderboard = []; state.manifest = null; state.dailyCache = {};
  try { localStorage.clear(); } catch (e) {}
  state.authUser = null; state.userPlan = 'free'; state.DAILY_LIMIT = state.FREE_DAILY_LIMIT;
  showGuestLanding();
}

export async function loadUserPlan() {
  try {
    let plan = 'free';
    const { data: up } = await db.from('user_profiles').select('plan,display_name,lang_id,standard').eq('id', state.authUser.id).single();
    if (up) {
      plan = up.plan || 'free';
      state.currentLang  = up.lang_id === 2 ? 'ta' : 'en';
      state.currentClass = up.standard || '12th';
    }
    state.userPlan = plan;
    state.DAILY_LIMIT = (state.userPlan === 'premium' || state.userPlan === 'unlimited') ? PREMIUM_DAILY_LIMIT : state.FREE_DAILY_LIMIT;
  } catch (e) { state.userPlan = 'free'; state.DAILY_LIMIT = state.FREE_DAILY_LIMIT; }
}

export async function signInWithGoogle() {
  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) throw error;
  } catch (e) {
    alert('Google Sign-In failed: ' + e.message);
  }
}

// Referenced from inline onclick="..." HTML attributes — see js/ui.js for why.
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
window.confirmPlan = confirmPlan;
window.selectPlan = selectPlan;
window.showForgotPassword = showForgotPassword;
window.showAuthScreen = showAuthScreen;
window.showGuestLanding = showGuestLanding;
window.signInWithGoogle = signInWithGoogle;
