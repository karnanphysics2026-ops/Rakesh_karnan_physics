// Small, self-contained UI helpers used across many modules. Previously
// defined in js/app.js (loaded last), which created a circular import with
// gamification.js/electrostatics.js/flow.js/quiz.js once everything became
// real ES modules — moved here (same code) to keep the dependency graph a DAG.
export function showToast(msg) {
  let t = document.getElementById('app-toast');
  if (!t) { t = document.createElement('div'); t.id = 'app-toast'; t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1035;color:#fff;padding:10px 20px;border-radius:24px;font-size:.85rem;font-family:Sora,sans-serif;z-index:9999;opacity:0;transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

export function showUpgradePrompt(feature) {
  document.getElementById('upgrade-feature').textContent = feature;
  document.getElementById('upgrade-modal').classList.add('open');
}
export function hideUpgradePrompt() {
  document.getElementById('upgrade-modal').classList.remove('open');
}

// Referenced from inline onclick="..." HTML attributes — must stay reachable
// as plain globals; rewriting the markup to addEventListener is out of scope
// for this behavior-preserving module conversion.
window.showUpgradePrompt = showUpgradePrompt;
window.hideUpgradePrompt = hideUpgradePrompt;
