/* ─────────────────────────────────────────────
   config.js  —  Shared configuration
   CIBIL Generation Tool — GitHub Pages Version
───────────────────────────────────────────── */

// Local Python server URL — user can change this in Settings (saved to localStorage)
const SERVER = localStorage.getItem('cibil_server_url') || 'http://localhost:5000';

// localStorage key names used across both apps
const LS = {
  SERVER_URL:  'cibil_server_url',
  OPENAI_KEY:  'cibil_openai_key',
  CIBIL_USER:  'cibil_creds_username',
  CIBIL_PASS:  'cibil_creds_password',
};
