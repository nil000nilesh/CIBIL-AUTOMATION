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

// localStorage key names used across both apps
const LS = {
  SERVER_URL:  'cibil_server_url',
  OPENAI_KEY:  'cibil_openai_key',
  CIBIL_USER:  'cibil_creds_username',
  CIBIL_PASS:  'cibil_creds_password',
};
