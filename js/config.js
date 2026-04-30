/* ─────────────────────────────────────────────
   config.js  —  Shared configuration
   CIBIL Generation Tool — GitHub Pages Version
───────────────────────────────────────────── */

// Production Render server URL
const RENDER_SERVER = 'https://cibil-automation.onrender.com';

// Auto-detect: GitHub Pages ya koi bhi non-localhost domain pe Render use karo
function _defaultServer() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'http://localhost:5000';
  return RENDER_SERVER;
}

// User-saved URL ko priority do, warna auto-detect
const SERVER = localStorage.getItem('cibil_server_url') || _defaultServer();

// App URLs — Render pe Flask routes, baaki jagah .html files
(function _setAppLinks() {
  const h = location.hostname;
  const onRender = h.endsWith('.onrender.com');
  const app1Url  = onRender ? '/app1' : 'App1_CIBIL_Entry_Form.html';
  const app2Url  = onRender ? '/app2' : 'App2_CIBIL_Auto_Filler.html';
  document.querySelectorAll('[data-app="1"]').forEach(el => el.href = app1Url);
  document.querySelectorAll('[data-app="2"]').forEach(el => el.href = app2Url);
})();

// localStorage key names used across both apps
const LS = {
  SERVER_URL:  'cibil_server_url',
  OPENAI_KEY:  'cibil_openai_key',
  CIBIL_USER:  'cibil_creds_username',
  CIBIL_PASS:  'cibil_creds_password',
};
