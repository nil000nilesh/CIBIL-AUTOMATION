/* ─────────────────────────────────────────────
   app2.js  —  App2: CIBIL Auto Filler
   Requires: config.js  (defines SERVER)
───────────────────────────────────────────── */

let records = [];
let running = false;
let stopFlag = false;
let loadedFiles = [];

// ─── SERVER CHECK ────────────────────────────
function checkServer() {
  const el = document.getElementById('serverStatus');
  el.className = 'server-status server-check';
  el.innerHTML = '<div class="dot"></div> Checking...';
  fetch(SERVER + '/ping', { signal: AbortSignal.timeout(3000) })
    .then(r => r.json())
    .then(d => {
      el.className = 'server-status server-ok';
      el.innerHTML = '<div class="dot"></div> Server Online';
      addLog('[SERVER] Connected – ' + (d.message || 'OK'), 'ok');
    })
    .catch(() => {
      el.className = 'server-status server-err';
      el.innerHTML = '<div class="dot"></div> Server Offline';
      addLog('[SERVER] Cannot reach Python server. Run: python cibil_automation.py', 'err');
    });
}

// ─── FILE HANDLING ───────────────────────────
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.name.match(/\.(txt|json)$/i)) {
      addLog('[SKIP] ' + file.name + ' – not a .txt/.json file', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        let parsed = JSON.parse(e.target.result);
        let items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach(item => {
          item._status = 'pending';
          item._message = '';
          item._file = file.name;
          records.push(item);
        });
        addLog('[LOAD] ' + file.name + ' → ' + items.length + ' record(s) loaded', 'ok');
        loadedFiles.push(file.name);
        renderFileChips();
        renderTable();
        updateStats();
        document.getElementById('startBtn').disabled = !(cibilLoggedIn);
      } catch (err) {
        addLog('[ERROR] ' + file.name + ' – invalid JSON: ' + err.message, 'err');
      }
    };
    reader.readAsText(file);
  });
}

function renderFileChips() {
  const c = document.getElementById('fileChips');
  c.innerHTML = loadedFiles.map((f, i) =>
    `<span class="file-chip">📄 ${f} <span onclick="removeFile(${i})">✕</span></span>`
  ).join('');
}

function removeFile(i) {
  const fname = loadedFiles[i];
  records = records.filter(r => r._file !== fname);
  loadedFiles.splice(i, 1);
  renderFileChips();
  renderTable();
  updateStats();
  addLog('[REMOVE] File removed: ' + fname, 'warn');
  if (!records.length) document.getElementById('startBtn').disabled = true;
  else document.getElementById('startBtn').disabled = !cibilLoggedIn;
}

// ─── TABLE RENDER ────────────────────────────
function renderTable() {
  const tbody = document.getElementById('recordsBody');
  document.getElementById('recCount').textContent = records.length;

  if (!records.length) {
    tbody.innerHTML = '<tr id="emptyRow"><td colspan="12" style="text-align:center;padding:30px;color:#999">No records loaded.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map((r, i) => {
    const badge = badgeClass(r._status);
    const isDone = r._status === 'done';
    const dlBtnHtml = isDone
      ? `<button class="btn small-btn" style="background:#1D9E75;color:#fff;margin-top:3px"
             onclick="downloadReport(${i})" title="Report download karo">
           &#11015; Report
         </button>`
      : '';
    const reportBadge = r._reportFile
      ? `<br><a href="${SERVER}/reports/${encodeURIComponent(r._reportFile)}" target="_blank"
              style="font-size:10px;color:#1D9E75;font-weight:700">&#128196; ${r._reportFile}</a>`
      : '';
    return `<tr>
      <td><input type="checkbox" class="rec-check" data-idx="${i}" ${r._status==='pending'?'':'disabled'} ${r._selected!==false?'checked':''}></td>
      <td>${i + 1}</td>
      <td><strong>${r.first_name || ''} ${r.last_name || ''}</strong><br><small style="color:#888">${r._file}</small>${reportBadge}</td>
      <td>${r.dob || '—'}</td>
      <td>${r.pan || '—'}</td>
      <td>${r.city || '—'}<br><small style="color:#888">${r.state_name || ''}</small></td>
      <td style="font-size:11px">${r.enq_category_label || r.enq_category || '—'}</td>
      <td>₹${r.enq_amount ? Number(r.enq_amount).toLocaleString('en-IN') : '—'}</td>
      <td>${r.mrn || '—'}</td>
      <td><span class="badge ${badge}">${r._status.toUpperCase()}</span></td>
      <td style="font-size:11px;color:${r._status==='failed'?'#c0392b':'#1a6b3a'}">${r._message || ''}</td>
      <td>
        <button class="btn btn-teal small-btn" onclick="previewRecord(${i})">&#128065; View</button>
        ${r._status==='failed'
          ? `<button class="btn btn-yellow small-btn" onclick="openEditModal(${i})">&#9998; Edit &amp; Retry</button>`
          : ''}
        ${dlBtnHtml}
      </td>
    </tr>`;
  }).join('');
}

function badgeClass(s) {
  return {pending:'b-pending',running:'b-running',done:'b-done',failed:'b-failed',skipped:'b-skipped'}[s] || 'b-pending';
}

// ─── STATS ──────────────────────────────────
function updateStats() {
  document.getElementById('stTotal').textContent = records.length;
  document.getElementById('stRunning').textContent = records.filter(r => r._status === 'running').length;
  document.getElementById('stDone').textContent = records.filter(r => r._status === 'done').length;
  document.getElementById('stFailed').textContent = records.filter(r => r._status === 'failed').length;
  const done = records.filter(r => ['done','failed','skipped'].includes(r._status)).length;
  const pct = records.length ? Math.round(done / records.length * 100) : 0;
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').textContent = done + ' / ' + records.length + ' (' + pct + '%)';
}

// ─── AUTOMATION ──────────────────────────────
async function startAutomation() {
  if (!records.length) return;

  const selected = records.filter((r, i) => {
    const cb = document.querySelector(`.rec-check[data-idx="${i}"]`);
    return r._status === 'pending' && cb && cb.checked;
  });

  if (!selected.length) { addLog('[WARN] No pending records selected', 'warn'); return; }

  // ── Pre-flight: check CIBIL login status ──
  addLog('[CHECK] CIBIL login status verify kar raha hoon...', 'info');
  try {
    const lr = await fetch(SERVER + '/login_status', { signal: AbortSignal.timeout(4000) });
    const ld = await lr.json();
    if (ld.status !== 'logged_in') {
      const msgs = {
        not_started: 'CIBIL portal mein login nahi kiya! Pehle upar Login karein.',
        logging_in:  'Login abhi chal raha hai — thoda wait karein phir Start karein.',
        waiting_otp: 'OTP awaited — Chrome window mein OTP bharein phir Start karein.',
        failed:      'Login fail hua! Dobara Login karein phir Start karein.',
      };
      const hint = msgs[ld.status] || `Login status: "${ld.status}" — pehle login karein.`;
      addLog(`[STOP] ${hint}`, 'err');
      alert('Automation ruk gayi!\n\n' + hint);
      return;
    }
    addLog('[CHECK] CIBIL login confirmed — automation shuru ho rahi hai', 'ok');
  } catch(e) {
    addLog('[WARN] Login status check fail — server offline ho sakta hai', 'warn');
    if (!confirm('Login status verify nahi hua (server offline?).\nFir bhi automation start karein?')) return;
  }

  running = true;
  stopFlag = false;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;

  const delay = parseInt(document.getElementById('delay').value) || 3;

  addLog('[START] Automation started – ' + selected.length + ' records', 'info');

  for (let i = 0; i < records.length; i++) {
    if (stopFlag) { addLog('[STOP] Automation stopped by user', 'warn'); break; }
    const r = records[i];
    const cb = document.querySelector(`.rec-check[data-idx="${i}"]`);
    if (r._status !== 'pending' || !cb || !cb.checked) continue;

    r._status = 'running';
    renderTable();
    updateStats();
    addLog(`[RUN] Record ${i+1}: ${r.first_name || ''} ${r.last_name || ''} (MRN: ${r.mrn || '-'})`, 'info');

    try {
      const resp = await fetch(SERVER + '/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
        signal: AbortSignal.timeout(120000)   // 2 min — form fill takes time
      });

      let result;
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        result = await resp.json();
      } else {
        // Server returned non-JSON (HTML error page)
        const text = await resp.text();
        result = { success: false, error: `Server HTTP ${resp.status} — ${text.replace(/<[^>]+>/g,'').trim().slice(0,120)}` };
      }

      if (result.success) {
        r._status = 'done';
        r._message = result.message || 'Success';
        addLog(`[OK] Record ${i+1}: ${result.message || 'Form filled successfully'}`, 'ok');
      } else {
        r._status = 'failed';
        const errMsg = (result.error && result.error.trim()) || `HTTP ${resp.status} error — server window dekhen`;
        r._message = errMsg;
        addLog(`[FAIL] Record ${i+1}: ${errMsg}`, 'err');
        // Scan page for field-level errors and show popup
        try {
          const er = await fetch(SERVER + '/scan_page_errors', { signal: AbortSignal.timeout(5000) });
          const ed = await er.json();
          if (ed.errors && ed.errors.length) {
            r._fieldErrors = ed.errors;
            addLog(`[ERRORS] Page errors: ${ed.errors.join(' | ')}`, 'warn');
          }
        } catch(e) {}
        // Show edit modal automatically for failed record
        setTimeout(() => openEditModal(i), 400);
      }
    } catch (err) {
      r._status = 'failed';
      r._message = err.name === 'TimeoutError' ? 'Timeout (120s) — form fill mein zyada time laga' : err.message;
      addLog(`[FAIL] Record ${i+1}: ${r._message}`, 'err');
    }

    renderTable();
    updateStats();
    if (i < records.length - 1 && !stopFlag) {
      addLog(`[WAIT] Waiting ${delay}s before next record...`, 'info');
      await sleep(delay * 1000);
    }
  }

  running = false;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  const done = records.filter(r => r._status === 'done').length;
  const failed = records.filter(r => r._status === 'failed').length;
  addLog(`[DONE] Automation complete – ${done} success, ${failed} failed`, done > 0 ? 'ok' : 'warn');
  updateDownloadPendingBanner();
}

function stopAutomation() {
  stopFlag = true;
  document.getElementById('stopBtn').disabled = true;
}

async function retrySingle(i) {
  records[i]._status = 'pending';
  records[i]._message = '';
  renderTable();
  updateStats();
  addLog(`[RETRY] Record ${i+1} reset to pending`, 'info');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SELECT ALL ──────────────────────────────
function selectAll(checked) {
  document.querySelectorAll('.rec-check').forEach(cb => {
    if (!cb.disabled) cb.checked = checked;
  });
  document.getElementById('checkAll').checked = checked;
}

// ─── PREVIEW ─────────────────────────────────
function previewRecord(i) {
  const r = records[i];
  document.getElementById('modalTitle').textContent = `Record ${i+1}: ${r.first_name} ${r.last_name}`;
  const fields = [
    ['Request Type', r.request_type], ['First Name', r.first_name],
    ['Middle Name', r.middle_name], ['Last Name', r.last_name],
    ['Date Of Birth', r.dob], ['Gender', r.gender], ['Email', r.email],
    ['Address Type', r.address_type_label], ['Address Line 1', r.addr1],
    ['Address Line 2', r.addr2], ['Address Line 3', r.addr3],
    ['State', r.state_name], ['City', r.city], ['Pincode', r.pincode],
    ['PAN', r.pan], ['Aadhaar', r.aadhaar], ['Voter ID', r.voter_id],
    ['Passport', r.passport], ['DL Number', r.dl_number], ['Ration Card', r.ration_card],
    ['Grameen Score', r.grameen_score ? 'Yes' : 'No'],
    ['Enquiry Category', r.enq_category_label], ['Enquiry Purpose', r.enq_purpose],
    ['Enquiry Amount', r.enq_amount ? '₹' + Number(r.enq_amount).toLocaleString('en-IN') : ''],
    ['Member Ref No.', r.mrn], ['GST State', r.gst_state_name],
    ['Branch Ref No.', r.brn], ['Center Ref No.', r.crn],
    ['Status', r._status.toUpperCase()], ['Message', r._message],
    ['Source File', r._file], ['Generated At', r.generated_at]
  ];
  document.getElementById('modalBody').innerHTML = fields
    .filter(([,v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<div class="detail-row"><div class="detail-key">${k}</div><div class="detail-val">${v || '—'}</div></div>`)
    .join('');

  if (r.contacts && r.contacts.length) {
    document.getElementById('modalBody').innerHTML +=
      '<div style="margin-top:10px;font-weight:600;color:#007B8A">Contacts:</div>' +
      r.contacts.map((c, j) => `<div class="detail-row"><div class="detail-key">Contact ${j+1}</div><div class="detail-val">${c.type} – ${c.number}</div></div>`).join('');
  }

  document.getElementById('previewModal').classList.add('show');
}

function closeModal() {
  document.getElementById('previewModal').classList.remove('show');
}

// ─── LOG ─────────────────────────────────────
function addLog(msg, type) {
  const box = document.getElementById('logBox');
  const ts = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-line log-' + (type || 'info');
  div.textContent = '[' + ts + '] ' + msg;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  document.getElementById('logBox').innerHTML = '<div class="log-line log-info">[SYSTEM] Log cleared.</div>';
}

// ─── CLEAR / EXPORT ──────────────────────────
function clearAll() {
  if (running) { addLog('[WARN] Stop automation first', 'warn'); return; }
  if (!records.length || confirm('Clear all loaded records?')) {
    records = []; loadedFiles = [];
    renderTable(); renderFileChips(); updateStats();
    document.getElementById('startBtn').disabled = true;
    document.getElementById('fileInput').value = '';
    addLog('[CLEAR] All records cleared', 'warn');
  }
}

function exportResults() {
  if (!records.length) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const data = records.map(r => ({
    name: r.first_name + ' ' + r.last_name,
    pan: r.pan,
    mrn: r.mrn,
    city: r.city,
    status: r._status,
    message: r._message,
    file: r._file
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'CIBIL_Results_' + ts + '.txt';
  a.click();
  addLog('[EXPORT] Results exported: CIBIL_Results_' + ts + '.txt', 'ok');
}

// ─── EDIT & RETRY MODAL ──────────────────────
let _editIdx = -1;

const EDIT_FIELDS = [
  { key:'first_name',   label:'First Name',    type:'text' },
  { key:'middle_name',  label:'Middle Name',   type:'text' },
  { key:'last_name',    label:'Last Name',     type:'text' },
  { key:'dob',          label:'DOB (DDMMYYYY)',type:'text', maxlen:8 },
  { key:'pan',          label:'PAN Number',    type:'text', maxlen:10 },
  { key:'aadhaar',      label:'Aadhaar (12d)', type:'text', maxlen:12 },
  { key:'voter_id',     label:'Voter ID',      type:'text' },
  { key:'passport',     label:'Passport No.',  type:'text' },
  { key:'dl_number',    label:'DL Number',     type:'text' },
  { key:'addr1',        label:'Address Line 1',type:'text' },
  { key:'addr2',        label:'Address Line 2',type:'text' },
  { key:'city',         label:'City',          type:'text' },
  { key:'pincode',      label:'Pincode',       type:'text', maxlen:6 },
  { key:'enq_amount',   label:'Enquiry Amount',type:'number' },
  { key:'mrn',          label:'Member Ref No.',type:'text' },
  { key:'brn',          label:'Branch Ref No.',type:'text' },
  { key:'crn',          label:'Center Ref No.',type:'text' },
  { key:'email',        label:'Email',         type:'email' },
];

function openEditModal(idx) {
  const r = records[idx];
  if (!r) return;
  _editIdx = idx;

  // Error banner
  const errors = r._fieldErrors || [];
  const banner = document.getElementById('editErrorBanner');
  if (banner) {
    banner.innerHTML = errors.length
      ? '&#9888; CIBIL Portal Error(s):<br>' + errors.map(e => '• ' + e).join('<br>')
      : '&#9888; ' + (r._message || 'Form fill fail hua — fields check karo aur retry karo');
  }

  // Render editable fields
  const container = document.getElementById('editFields');
  if (!container) return;
  container.innerHTML = EDIT_FIELDS.map(f => {
    const val = r[f.key] || '';
    const maxattr = f.maxlen ? `maxlength="${f.maxlen}"` : '';
    return `
      <div style="display:flex;flex-direction:column;gap:3px">
        <label style="font-size:11px;font-weight:700;color:#555">${f.label}</label>
        <input data-field="${f.key}" type="${f.type}" value="${val}" ${maxattr}
          style="padding:7px 10px;border:1.5px solid #b0c8d0;border-radius:5px;
                 font-size:12px;outline:none;transition:border-color .2s"
          onfocus="this.style.borderColor='#007B8A'"
          onblur="this.style.borderColor='#b0c8d0'">
      </div>`;
  }).join('');

  document.getElementById('editRetryMsg').textContent = '';
  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  _editIdx = -1;
}

async function saveAndRetry() {
  if (_editIdx < 0 || !records[_editIdx]) return;
  const r   = records[_editIdx];
  const msg = document.getElementById('editRetryMsg');

  // Read edited values
  document.querySelectorAll('#editFields [data-field]').forEach(inp => {
    const k = inp.getAttribute('data-field');
    r[k] = inp.value.trim() || null;
  });

  // Reset status
  r._status      = 'pending';
  r._message     = '';
  r._fieldErrors = [];
  closeEditModal();
  renderTable();
  updateStats();
  addLog(`[EDIT] Record ${_editIdx+1} updated — retry shuru ho raha hai...`, 'ok');

  // Retry this one record
  const i = _editIdx;
  r._status = 'running';
  renderTable(); updateStats();

  try {
    const resp = await fetch(SERVER + '/fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
      signal: AbortSignal.timeout(120000)
    });
    const result = resp.headers.get('content-type')?.includes('json')
      ? await resp.json()
      : { success: false, error: `HTTP ${resp.status}` };

    if (result.success) {
      r._status  = 'done';
      r._message = result.message || 'Retry success';
      addLog(`[OK] Record ${i+1} retry success!`, 'ok');
    } else {
      r._status  = 'failed';
      r._message = result.error || 'Retry failed';
      addLog(`[FAIL] Record ${i+1} retry: ${r._message}`, 'err');
      // Scan errors again
      try {
        const er = await fetch(SERVER + '/scan_page_errors', { signal: AbortSignal.timeout(5000) });
        const ed = await er.json();
        if (ed.errors && ed.errors.length) r._fieldErrors = ed.errors;
      } catch(e) {}
      setTimeout(() => openEditModal(i), 400);
    }
  } catch(err) {
    r._status  = 'failed';
    r._message = err.message;
    addLog(`[FAIL] Retry error: ${err.message}`, 'err');
  }
  renderTable(); updateStats();
}

// ─── LIVE BROWSER VIEWER ─────────────────────
let _screenshotTimer  = null;
let _autoRefreshOn    = true;

function showBrowserViewer() {
  const v = document.getElementById('browserViewer');
  if (v) { v.style.display = 'block'; v.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  refreshScreenshot();
  startAutoRefresh();
}

function hideBrowserViewer() {
  stopAutoRefresh();
  const v = document.getElementById('browserViewer');
  if (v) v.style.display = 'none';
}

function startAutoRefresh() {
  stopAutoRefresh();
  _autoRefreshOn = true;
  const btn = document.getElementById('autoRefreshBtn');
  if (btn) btn.textContent = '⏸ Pause';
  _screenshotTimer = setInterval(refreshScreenshot, 2500);
}

function stopAutoRefresh() {
  if (_screenshotTimer) { clearInterval(_screenshotTimer); _screenshotTimer = null; }
}

function toggleAutoRefresh() {
  const btn = document.getElementById('autoRefreshBtn');
  if (_screenshotTimer) {
    stopAutoRefresh(); _autoRefreshOn = false;
    if (btn) btn.textContent = '▶ Resume';
  } else {
    startAutoRefresh();
  }
}

async function refreshScreenshot() {
  const img    = document.getElementById('browserScreenshot');
  const status = document.getElementById('viewerStatus');
  if (!img) return;
  try {
    const r = await fetch(SERVER + '/screenshot', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.status === 'ok' && d.image) {
      img.src = 'data:image/png;base64,' + d.image;
      if (status) status.textContent = 'Updated: ' + new Date().toLocaleTimeString();
    } else {
      if (status) status.textContent = d.message || 'Screenshot error';
    }
  } catch(e) {
    if (status) status.textContent = 'Server unreachable';
  }
}

async function submitCaptcha() {
  const inp = document.getElementById('captchaInput');
  const msg = document.getElementById('viewerActionMsg');
  const val = inp ? inp.value.trim() : '';
  if (!val) { if (msg) { msg.style.color='#c0392b'; msg.textContent='CAPTCHA khali hai'; } return; }
  if (msg) { msg.style.color='#555'; msg.textContent='Filling...'; }
  try {
    const r = await fetch(SERVER + '/fill_captcha', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ captcha: val }), signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    if (msg) { msg.style.color = d.status==='ok'?'#1a6b3a':'#c0392b'; msg.textContent = d.message; }
    if (d.status === 'ok') { addLog('[CAPTCHA] Fill ho gaya: ' + val, 'ok'); refreshScreenshot(); }
    else addLog('[CAPTCHA] Error: ' + d.message, 'err');
  } catch(e) { if (msg) { msg.style.color='#c0392b'; msg.textContent='Error: '+e.message; } }
}

async function clickLoginSubmit() {
  const msg = document.getElementById('viewerActionMsg');
  if (msg) { msg.style.color='#555'; msg.textContent='Submitting...'; }
  try {
    const r = await fetch(SERVER + '/click_login_submit', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: '{}', signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    if (msg) { msg.style.color = d.status==='ok'?'#1a6b3a':'#c0392b'; msg.textContent = d.message; }
    addLog('[LOGIN] Submit click: ' + d.message, d.status==='ok'?'ok':'err');
    setTimeout(refreshScreenshot, 1500);
  } catch(e) { if (msg) { msg.style.color='#c0392b'; msg.textContent='Error: '+e.message; } }
}

async function submitOTPFromViewer() {
  const inp = document.getElementById('otpInputViewer');
  const msg = document.getElementById('viewerActionMsg');
  const otp = inp ? inp.value.trim() : '';
  if (!otp) { if (msg) { msg.style.color='#c0392b'; msg.textContent='OTP khali hai'; } return; }
  if (msg) { msg.style.color='#555'; msg.textContent='OTP submit ho raha hai...'; }
  try {
    const r = await fetch(SERVER + '/submit_otp', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ otp }), signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    if (msg) { msg.style.color = d.status==='ok'?'#1a6b3a':'#c0392b'; msg.textContent = d.message; }
    if (d.status === 'ok') { addLog('[OTP] Submit ho gaya', 'ok'); startLoginPoll(); }
    else addLog('[OTP] Error: ' + d.message, 'err');
  } catch(e) { if (msg) { msg.style.color='#c0392b'; msg.textContent='Error: '+e.message; } }
}

// ─── OTP SUBMIT ──────────────────────────────
async function submitOTP() {
  const inp = document.getElementById('otpInput');
  const msg = document.getElementById('otpMsg');
  if (!inp) return;
  const otp = inp.value.trim();
  if (!otp || !/^\d+$/.test(otp)) {
    if (msg) { msg.style.color = '#c0392b'; msg.textContent = 'Sirf digits daalo'; }
    return;
  }
  if (msg) { msg.style.color = '#555'; msg.textContent = 'Submit ho raha hai...'; }
  try {
    const r = await fetch(SERVER + '/submit_otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp }),
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    if (d.status === 'ok') {
      if (msg) { msg.style.color = '#1a6b3a'; msg.textContent = '✓ ' + d.message; }
      addLog('[OTP] OTP submit ho gaya — login verify ho raha hai...', 'ok');
      startLoginPoll();
    } else {
      if (msg) { msg.style.color = '#c0392b'; msg.textContent = '✗ ' + (d.message || 'Error'); }
      addLog('[OTP] Submit fail: ' + (d.message || 'Error'), 'err');
    }
  } catch(e) {
    if (msg) { msg.style.color = '#c0392b'; msg.textContent = 'Server error: ' + e.message; }
    addLog('[OTP] Server error: ' + e.message, 'err');
  }
}

// ─── LOAD FROM APP1 QUEUE (localStorage) ─────
function loadFromApp1Queue() {
  try {
    const raw = localStorage.getItem('cibil_app1_queue');
    if (!raw) { addLog('[APP1] App 1 mein abhi koi record nahi hai.', 'warn'); return; }
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || !items.length) {
      addLog('[APP1] App 1 queue khali hai — pehle App 1 mein records add karo.', 'warn'); return;
    }
    let added = 0;
    items.forEach(item => {
      item._status  = 'pending';
      item._message = '';
      item._file    = item._file || ('CIBIL_' + (item.first_name || '') + '_' + (item.mrn || '') + '.txt');
      // Duplicate check (mrn basis pe)
      const exists = records.some(r => r.mrn && r.mrn === item.mrn);
      if (!exists) { records.push(item); added++; }
    });
    if (added) {
      if (!loadedFiles.includes('App1_Queue')) loadedFiles.push('App1_Queue');
      renderFileChips();
      renderTable();
      updateStats();
      updateStartBtn();
      addLog('[APP1] ' + added + ' record(s) App 1 queue se load ho gaye!', 'ok');
    } else {
      addLog('[APP1] Saare records pehle se loaded hain (duplicate skip kiye).', 'warn');
    }
  } catch(e) {
    addLog('[APP1] Queue load error: ' + e.message, 'err');
  }
}

// ─── INIT ────────────────────────────────────
checkServer();
setInterval(checkServer, 30000);

// ─── CIBIL LOGIN ─────────────────────────────
let loginPollTimer = null;
let cibilLoggedIn  = false;

function updateLoginBadge(status, msg) {
  const badge      = document.getElementById('loginStatusBadge');
  const text       = document.getElementById('loginStatusText');
  const note       = document.getElementById('loginNote');
  const lock       = document.getElementById('lockNotice');
  const loginBtn   = document.getElementById('cibildLoginBtn');
  const reLoginBtn = document.getElementById('reLoginBtn');
  badge.className = 'login-status-badge';

  if (status === 'logged_in') {
    badge.classList.add('ls-done');
    text.textContent = 'Logged In ✓';
    cibilLoggedIn = true;
    loginBtn.disabled = true;
    loginBtn.textContent = '✓ Logged In';
    reLoginBtn.style.display = 'inline-flex';
    document.getElementById('dropZone').classList.remove('upload-locked');
    lock.style.display = 'none';
    hideBrowserViewer();
    // App 3 banner dikhao — user ko live viewer open karne ka option de
    const banner = document.getElementById('app3Banner');
    if (banner) banner.style.display = 'flex';
    updateStartBtn();
    stopLoginPoll();
    // Note: browserPollTimer is NOT stopped — it keeps watching for session expiry
    note.style.display = msg ? 'block' : 'none';
    note.textContent = msg || '';

  } else if (status === 'waiting_otp') {
    badge.classList.add('ls-waiting');
    text.textContent = 'Waiting for OTP...';
    showBrowserViewer(); // CAPTCHA + OTP dono browser viewer mein handle honge
    note.style.display = 'block';
    note.innerHTML = `
      <strong>&#128241; OTP aaya hoga aapke registered mobile/email pe — neeche daalo:</strong>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">
        <input id="otpInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8"
          placeholder="OTP enter karo"
          style="padding:8px 12px;border:2px solid #007B8A;border-radius:6px;font-size:16px;
                 font-weight:700;letter-spacing:4px;width:160px;text-align:center;outline:none">
        <button onclick="submitOTP()"
          style="background:linear-gradient(135deg,#1D9E75,#178060);color:#fff;border:none;
                 border-radius:6px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer">
          &#10003; Submit OTP
        </button>
        <span id="otpMsg" style="font-size:12px;color:#555"></span>
      </div>`;
    lock.style.display = 'block';
    reLoginBtn.style.display = 'none';
    setTimeout(() => { const el = document.getElementById('otpInput'); if (el) el.focus(); }, 100);

  } else if (status === 'logging_in') {
    badge.classList.add('ls-logging');
    text.textContent = 'Logging in...';
    note.style.display = 'block';
    note.textContent = msg || 'Chrome window khul raha hai...';
    lock.style.display = 'block';
    reLoginBtn.style.display = 'none';
    // Show live browser viewer after short delay (Chrome takes a moment to open)
    setTimeout(showBrowserViewer, 3000);

  } else if (status === 'error' || status === 'failed') {
    badge.classList.add('ls-error');
    text.textContent = 'Login Failed';
    note.style.display = 'block';
    note.textContent = msg || 'Login failed. Dobara try karein.';
    lock.style.display = 'block';
    stopLoginPoll();
    loginBtn.disabled = false;
    loginBtn.textContent = '↺ Retry Login';
    reLoginBtn.style.display = 'none';

  } else if (status === 'session_expired') {
    badge.classList.add('ls-error');
    text.textContent = 'Session Expired ⚠';
    note.style.display = 'block';
    note.innerHTML = '<strong>CIBIL session expire ho gayi.</strong> Neeche Login button dabao — saved credentials se dobara login hoga.';
    lock.style.display = 'block';
    loginBtn.disabled = false;
    loginBtn.textContent = '↺ Re-Login';
    reLoginBtn.style.display = 'none';
    cibilLoggedIn = false;
    updateStartBtn();

  } else {
    // not_started / idle
    badge.classList.add('ls-idle');
    text.textContent = 'Not logged in';
    lock.style.display = 'block';
    reLoginBtn.style.display = 'none';
    note.style.display = 'none';
    note.textContent = '';
  }
}

// ─── RE-LOGIN ────────────────────────────────
async function doReLogin() {
  if (!confirm(
    'CIBIL session reset hogi aur aapko dobara login karna hoga.\n\n' +
    'Note: Chrome window band NAHI hogi — sirf login state reset hoga.\n\n' +
    'Continue karein?'
  )) return;

  // Tell server to reset login state (keep browser open)
  try {
    await fetch(SERVER + '/login_reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(4000)
    });
    addLog('[RE-LOGIN] Server login state reset ho gaya.', 'warn');
  } catch(e) {
    addLog('[WARN] Server unreachable — login reset sirf UI mein hua.', 'warn');
  }

  // Stop any polling
  stopLoginPoll();
  cibilLoggedIn = false;

  // Re-enable login form
  const loginBtn = document.getElementById('cibildLoginBtn');
  loginBtn.disabled = false;
  loginBtn.textContent = '🔓 Login to CIBIL';

  // Reset badge to idle
  updateLoginBadge('not_started', '');
  updateStartBtn();

  addLog('[RE-LOGIN] Dobara credentials dal ke "Login to CIBIL" dabao.', 'info');
}

function stopLoginPoll() {
  if (loginPollTimer) { clearInterval(loginPollTimer); loginPollTimer = null; }
}

function startLoginPoll() {
  stopLoginPoll();
  loginPollTimer = setInterval(async () => {
    try {
      const r = await fetch(SERVER + '/login_status', { signal: AbortSignal.timeout(3000) });
      const d = await r.json();
      updateLoginBadge(d.status, d.message);
    } catch(e) {}
  }, 2500);
}

async function doCibilLogin() {
  const username  = document.getElementById('cibildUser').value.trim();
  const passField = document.getElementById('cibildPass');
  const isSaved   = passField.getAttribute('data-saved') === 'true';
  const password  = passField.value.trim();
  const remember  = document.getElementById('rememberCreds').checked;

  if (!username) { alert('Username khali hai!'); return; }

  // If field is empty AND not marked as saved → ask user to enter password
  if (!password && !isSaved) { alert('Password khali hai!'); return; }

  document.getElementById('cibildLoginBtn').disabled = true;
  document.getElementById('cibildLoginBtn').textContent = '...';
  updateLoginBadge('logging_in', 'Starting login...');

  // Save credentials to browser localStorage (user's PC only — never remote server)
  if (remember && username) {
    localStorage.setItem(LS.CIBIL_USER, username);
    if (password) localStorage.setItem(LS.CIBIL_PASS, password);
  }

  // If password field is empty but marked as saved, server uses saved password
  // If user typed a new password, send it (and save if remember is checked)
  const body = { username, save: remember };
  if (password) body.password = password;
  // (if no password sent, server falls back to CIBIL_PASSWORD from config)

  try {
    const r = await fetch(SERVER + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    if (d.status === 'logged_in') {
      updateLoginBadge('logged_in', d.message);
    } else if (d.status === 'logging_in' || d.status === 'waiting_otp') {
      updateLoginBadge(d.status, d.message);
      startLoginPoll();
    } else {
      updateLoginBadge('error', d.message || 'Unknown error');
      document.getElementById('cibildLoginBtn').disabled = false;
      document.getElementById('cibildLoginBtn').textContent = '↺ Retry Login';
    }
  } catch(e) {
    updateLoginBadge('error', 'Server connect fail: ' + e.message);
    document.getElementById('cibildLoginBtn').disabled = false;
    document.getElementById('cibildLoginBtn').textContent = '↺ Retry Login';
  }
}

// ─── SAVED CREDENTIALS ───────────────────────
async function loadSavedCreds() {
  // 1. Check browser localStorage first (works offline, credentials stay on user's PC)
  const lsUser = localStorage.getItem(LS.CIBIL_USER);
  const lsPass = localStorage.getItem(LS.CIBIL_PASS);
  if (lsUser) {
    document.getElementById('cibildUser').value = lsUser;
    if (lsPass) {
      document.getElementById('cibildPass').value = lsPass;
    } else {
      document.getElementById('cibildPass').placeholder = '(Saved password — ya naya dalein)';
    }
    document.getElementById('cibildPass').setAttribute('data-saved', 'true');
    document.getElementById('savedCredsBar').style.display = 'flex';
    addLog('[INFO] Browser mein saved credentials load ho gayi — Login button dabao', 'ok');
    return true;
  }

  // 2. Fallback: try local server (for users who saved creds via old version)
  try {
    const r = await fetch(SERVER + '/get_saved_creds', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (d.has_saved_creds) {
      document.getElementById('cibildUser').value = d.username || '';
      document.getElementById('cibildPass').value = '';
      document.getElementById('cibildPass').placeholder = '(Server pe saved password use hoga — ya naya dalein)';
      document.getElementById('cibildPass').setAttribute('data-saved', 'true');
      document.getElementById('savedCredsBar').style.display = 'flex';
      addLog('[INFO] Server se saved credentials load ho gayi — Login button dabao', 'ok');
      return true;
    }
  } catch(e) { /* server offline — silently ignore */ }
  return false;
}

async function clearSavedCreds() {
  if (!confirm('Saved credentials delete karna chahte hain?\n\nBrowser (localStorage) aur server dono se delete ho jaayenge.')) return;

  // Delete from browser localStorage
  localStorage.removeItem(LS.CIBIL_USER);
  localStorage.removeItem(LS.CIBIL_PASS);

  // Also delete from local server if it's running
  try {
    await fetch(SERVER + '/clear_cibil_creds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000)
    });
  } catch(e) { /* server offline — browser cleared is enough */ }

  document.getElementById('cibildUser').value = '';
  document.getElementById('cibildPass').value = '';
  document.getElementById('cibildPass').removeAttribute('data-saved');
  document.getElementById('cibildPass').placeholder = 'Your CIBIL password';
  document.getElementById('savedCredsBar').style.display = 'none';
  addLog('[INFO] Saved credentials browser aur server dono se delete ho gayi.', 'warn');
}

// ─── PASSWORD SHOW / HIDE ────────────────────
function togglePassVis() {
  const passEl = document.getElementById('cibildPass');
  const btn    = document.getElementById('togglePassBtn');
  if (passEl.type === 'password') {
    passEl.type = 'text';
    btn.innerHTML = '&#128683;&#128065;';  // crossed-out eye
    btn.title = 'Password chhupao';
  } else {
    passEl.type = 'password';
    btn.innerHTML = '&#128065;';
    btn.title = 'Password dikhao';
  }
}

// When user starts typing in password field, clear saved flag
// Also handle Enter key on dynamically created OTP input
document.addEventListener('DOMContentLoaded', () => {
  const passEl = document.getElementById('cibildPass');
  passEl.addEventListener('input', function() {
    if (this.getAttribute('data-saved') === 'true') {
      this.removeAttribute('data-saved');
      this.placeholder = 'Your CIBIL password';
    }
  });

  // OTP Enter key — delegated (otpInput is created dynamically)
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'otpInput') submitOTP();
  });
});

// ─── BROWSER STATUS POLL (manual login detect + session watch) ───────────
// Runs always — detects both manual logins AND session expiry
let browserPollTimer = null;

function startBrowserPoll() {
  if (browserPollTimer) return;
  browserPollTimer = setInterval(async () => {
    try {
      const r = await fetch(SERVER + '/check_browser_login', { signal: AbortSignal.timeout(4000) });
      const d = await r.json();

      if (!cibilLoggedIn && d.status === 'logged_in') {
        // ── Manual login detected ─────────────────────────────────
        addLog('[AUTO] CIBIL browser mein manual login detect hua — automation ab start kar sakte hain!', 'ok');
        updateLoginBadge('logged_in', 'Manual login detected');

      } else if (cibilLoggedIn && d.status === 'logging_in') {
        // ── Session expired → server ne auto re-login start kar diya ─
        addLog('[SESSION] ⚠ CIBIL session expire ho gayi — auto re-login shuru ho gaya...', 'warn');
        updateLoginBadge('logging_in', d.message || 'Session expire — auto re-login chal raha hai...');
        startLoginPoll();   // track re-login progress (logging_in → waiting_otp → logged_in)

      } else if (cibilLoggedIn && d.status === 'session_expired') {
        // ── Session expired → no saved creds → user must login manually ─
        addLog('[SESSION] ⚠ CIBIL session expire ho gayi — saved credentials nahi hain, dobara login karein!', 'err');
        updateLoginBadge('session_expired', d.message || 'Session expire ho gayi — dobara login karein');
      }
    } catch(e) {}
  }, 15000);  // check every 15 seconds
}

function stopBrowserPoll() {
  if (browserPollTimer) { clearInterval(browserPollTimer); browserPollTimer = null; }
}

// On load: check if already logged in + load saved credentials
(async function initLoginCheck() {
  document.getElementById('dropZone').classList.add('upload-locked');
  document.getElementById('lockNotice').style.display = 'block';

  const hasSaved = await loadSavedCreds();

  try {
    const r = await fetch(SERVER + '/login_status', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (d.status === 'logged_in') {
      updateLoginBadge('logged_in', 'Already logged in');
    } else if (d.status === 'logging_in' || d.status === 'waiting_otp') {
      updateLoginBadge(d.status, d.message);
      startLoginPoll();
    } else if (hasSaved && d.status === 'not_started') {
      // Auto-start login when saved credentials exist and not logged in yet
      addLog('[AUTO] Saved credentials mili — 3 second mein auto-login shuru hoga...', 'ok');
      setTimeout(() => {
        if (!cibilLoggedIn) {
          addLog('[AUTO] Auto-login shuru ho raha hai (saved credentials se)...', 'info');
          doCibilLogin();
        }
      }, 3000);
    }
  } catch(e) {
    // Server not ready yet — start browser poll for manual login detection
  }

  // Always start browser poll so manual logins in Chrome are auto-detected
  startBrowserPoll();
})();

function updateStartBtn() {
  const hasRecords = records && records.length > 0;
  document.getElementById('startBtn').disabled = !(cibilLoggedIn && hasRecords);
}

// ─── REPORT DOWNLOAD ─────────────────────────
async function downloadReport(idx) {
  const r = records[idx];
  if (!r) return;

  const btn = document.querySelector(
    `tr:nth-child(${idx + 1}) button[onclick="downloadReport(${idx})"]`
  );
  if (btn) { btn.textContent = '⏳ Downloading...'; btn.disabled = true; }

  const name = ((r.first_name || '') + '_' + (r.last_name || '')).trim();
  addLog(`[REPORT] Downloading report for: ${name} (MRN: ${r.mrn || '-'})`, 'info');

  try {
    const resp = await fetch(SERVER + '/download_report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, mrn: r.mrn || '' }),
      signal:  AbortSignal.timeout(90000),
    });
    const data = await resp.json();
    if (data.success) {
      r._reportFile = data.filename;
      addLog(`[REPORT] ✓ Downloaded: ${data.filename}`, 'ok');
      renderTable();
      renderReportsPanel();
      updateDownloadPendingBanner();
      // Auto-open the PDF in new tab
      window.open(SERVER + '/reports/' + encodeURIComponent(data.filename), '_blank');
    } else {
      addLog(`[REPORT] ✗ ${data.error || 'Download failed'}`, 'err');
      if (btn) { btn.textContent = '⬇ Report'; btn.disabled = false; }
    }
  } catch (err) {
    addLog(`[REPORT] Error: ${err.message}`, 'err');
    if (btn) { btn.textContent = '⬇ Report'; btn.disabled = false; }
  }
}

// ── Update the Download Pending banner ───────
function updateDownloadPendingBanner() {
  const pending = records.filter(r => r._status === 'done' && !r._reportFile);
  const banner  = document.getElementById('dlPendingBanner');
  const info    = document.getElementById('dlPendingInfo');
  const btn     = document.getElementById('dlPendingBtn');
  if (!banner) return;
  if (pending.length > 0) {
    banner.style.display = 'flex';
    info.textContent = pending.length + ' record' + (pending.length > 1 ? 's' : '') +
                       ' ki reports abhi download nahi hui hain';
    btn.textContent  = '⬇ Download Pending Reports (' + pending.length + ')';
    btn.disabled     = false;
    btn.style.opacity = '1';
  } else {
    banner.style.display = 'none';
  }
}

// ── Download only pending (done + no report) records, one by one ────
async function downloadPendingReports() {
  const pending = records.map((r, i) => ({ r, i })).filter(x => x.r._status === 'done' && !x.r._reportFile);
  if (!pending.length) {
    addLog('[REPORT] Koi pending report nahi hai.', 'warn');
    return;
  }

  const btn  = document.getElementById('dlPendingBtn');
  const info = document.getElementById('dlPendingInfo');
  btn.disabled     = true;
  btn.style.opacity = '0.7';

  addLog(`[REPORT] ${pending.length} pending reports download shuru ho rahi hain...`, 'info');

  for (let j = 0; j < pending.length; j++) {
    const { r, i } = pending[j];
    const name = ((r.first_name || '') + ' ' + (r.last_name || '')).trim();
    info.textContent = `Downloading ${j + 1} / ${pending.length}: ${name}...`;
    btn.textContent  = `⏳ ${j + 1} / ${pending.length} Downloading...`;
    await downloadReport(i);
    if (j < pending.length - 1) await sleep(2000);
  }

  addLog('[REPORT] Saari pending reports download ho gayi!', 'ok');
  updateDownloadPendingBanner();
  renderReportsPanel();
}

// ── Render Reports Panel ─────────────────────
async function renderReportsPanel() {
  const panel = document.getElementById('reportsPanel');
  const body  = document.getElementById('reportsList');
  if (!panel || !body) return;

  try {
    const resp = await fetch(SERVER + '/list_reports', { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    const reports = data.reports || [];

    const badge = document.getElementById('reportsBadge');
    if (badge) badge.textContent = reports.length;

    if (!reports.length) {
      body.innerHTML = '<p style="text-align:center;color:#888;padding:20px">Abhi koi report download nahi hui. Record fill karke "Report Download" button dabao.</p>';
      return;
    }

    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:linear-gradient(90deg,#005a7a,#007B8A);color:#fff">
            <th style="padding:8px 10px;text-align:left">#</th>
            <th style="padding:8px 10px;text-align:left">File Name</th>
            <th style="padding:8px 10px;text-align:left">Size</th>
            <th style="padding:8px 10px;text-align:left">Date</th>
            <th style="padding:8px 10px;text-align:left">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map((rpt, i) => `
            <tr style="border-bottom:1px solid #eef3f6">
              <td style="padding:7px 10px">${i + 1}</td>
              <td style="padding:7px 10px;font-weight:600;color:#005a7a">
                &#128196; ${rpt.filename}
              </td>
              <td style="padding:7px 10px;color:#666">${rpt.size_kb} KB</td>
              <td style="padding:7px 10px;color:#666">${rpt.modified}</td>
              <td style="padding:7px 10px">
                <a href="${SERVER}/reports/${encodeURIComponent(rpt.filename)}"
                   target="_blank"
                   style="background:linear-gradient(135deg,#1D9E75,#178060);color:#fff;border:none;border-radius:4px;padding:5px 12px;font-size:11px;font-weight:700;text-decoration:none;cursor:pointer;margin-right:5px">
                  &#128065; Open
                </a>
                <a href="${SERVER}/reports/${encodeURIComponent(rpt.filename)}"
                   download="${rpt.filename}"
                   style="background:linear-gradient(135deg,#007B8A,#005a7a);color:#fff;border:none;border-radius:4px;padding:5px 12px;font-size:11px;font-weight:700;text-decoration:none;cursor:pointer;margin-right:5px">
                  &#11015; Download
                </a>
                <button onclick="deleteReport('${rpt.filename}')"
                  style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;border:none;border-radius:4px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">
                  &#128465; Delete
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    body.innerHTML = '<p style="color:#e74c3c;padding:14px">Reports load nahi ho sakin — server check karo.</p>';
  }
}

async function deleteReport(filename) {
  if (!confirm(`"${filename}" delete karna chahte hain?`)) return;
  try {
    const resp = await fetch(SERVER + '/delete_report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename }),
      signal:  AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    if (data.success) {
      addLog(`[REPORT] Deleted: ${filename}`, 'warn');
      renderReportsPanel();
    }
  } catch (e) {
    addLog('[REPORT] Delete failed: ' + e.message, 'err');
  }
}

// ─── APP 2 SETTINGS ──────────────────────────
function toggleApp2Settings() {
  const panel = document.getElementById('app2SettingsPanel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) {
    const inp = document.getElementById('app2ServerUrl');
    if (inp) inp.value = localStorage.getItem(LS.SERVER_URL) || 'http://localhost:5000';
  }
}

function saveApp2ServerUrl() {
  const val = document.getElementById('app2ServerUrl').value.trim();
  if (!val) return;
  localStorage.setItem(LS.SERVER_URL, val);
  addLog('[SETTINGS] Server URL save ho gayi: ' + val + ' — page reload ho raha hai...', 'ok');
  setTimeout(() => location.reload(), 800);
}

function resetApp2ServerUrl() {
  localStorage.removeItem(LS.SERVER_URL);
  document.getElementById('app2ServerUrl').value = 'http://localhost:5000';
  addLog('[SETTINGS] Server URL default pe reset ho gayi — page reload ho raha hai...', 'warn');
  setTimeout(() => location.reload(), 800);
}

function toggleReportsPanel() {
  const panel = document.getElementById('reportsPanel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderReportsPanel();
}
