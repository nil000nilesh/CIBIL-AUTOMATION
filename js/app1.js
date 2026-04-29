/* ─────────────────────────────────────────────
   app1.js  —  App1: CIBIL Data Entry Form
   Requires: config.js  (defines SERVER)
───────────────────────────────────────────── */

// ══════════════════════════════════════════════════
//  SECTION TOGGLE
// ══════════════════════════════════════════════════
function toggle(id) {
  const el = document.getElementById(id);
  const icon = document.getElementById(id + 'icon');
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.textContent = isHidden ? '–' : '+';
}

// ══════════════════════════════════════════════════
//  DOB SYNC
// ══════════════════════════════════════════════════
function syncDOB() {
  const cal = document.getElementById('dob_cal');
  const dob = document.getElementById('dob');
  const disp = document.getElementById('dob_display');
  if (cal.value) {
    const [y, m, d] = cal.value.split('-');
    dob.value = d + m + y;
    disp.textContent = d + '/' + m + '/' + y;
    disp.style.display = 'inline';
  } else {
    dob.value = '';
    disp.style.display = 'none';
  }
  validate('dob');
}

// ══════════════════════════════════════════════════
//  VALIDATION
// ══════════════════════════════════════════════════
const RULES = {
  request_type:   { required: true,  label: 'Request Type' },
  first_name:     { required: true,  label: 'First Name',   pattern: /^[A-Za-z\s]+$/, patternMsg: 'Only letters allowed' },
  middle_name:    { required: false, label: 'Middle Name' },
  last_name:      { required: false, label: 'Last Name' },
  dob:            { required: true,  label: 'Date of Birth' },
  gender:         { required: true,  label: 'Gender' },
  email:          { required: false, label: 'Email', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMsg: 'Invalid email' },
  address_type:   { required: true,  label: 'Address Type' },
  addr1:          { required: true,  label: 'Address Line 1' },
  state:          { required: true,  label: 'State' },
  city:           { required: true,  label: 'City' },
  pincode:        { required: true,  label: 'Pincode',        pattern: /^\d{6}$/, patternMsg: '6-digit pincode required' },
  pan:            { required: false, label: 'PAN Number',     pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, patternMsg: 'PAN format galat hai (e.g. ABCDE1234F)' },
  aadhaar:        { required: false, label: 'Aadhaar Number', pattern: /^\d{12}$/, patternMsg: '12-digit Aadhaar required' },
  consumer_score: { required: true,  label: 'Consumer Score' },
  enq_category:   { required: true,  label: 'Enquiry Category' },
  enq_purpose:    { required: true,  label: 'Enquiry Purpose' },
  enq_amount:     { required: true,  label: 'Enquiry Amount' },
  mrn:            { required: true,  label: 'Member Reference Number' },
};

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function validate(id) {
  const rule = RULES[id];
  if (!rule) return true;
  const val = getVal(id);
  let err = '';
  if (rule.required && !val) err = rule.label + ' zaroori hai';
  else if (val && rule.pattern && !rule.pattern.test(val)) err = rule.patternMsg || 'Invalid format';
  const fd = document.getElementById('f_' + id);
  const ee = document.getElementById('e_' + id);
  if (fd) { fd.classList.toggle('valid', !err && !!val); fd.classList.toggle('invalid', !!err); }
  if (ee) ee.textContent = err;
  updateValBar();
  return !err;
}

function liveValidate(id) {
  const val = getVal(id);
  if (val) validate(id);
  else {
    const fd = document.getElementById('f_' + id);
    const ee = document.getElementById('e_' + id);
    if (fd) { fd.classList.remove('valid', 'invalid'); }
    if (ee) ee.textContent = '';
    updateValBar();
  }
}

function validateAll(show) {
  Object.keys(RULES).forEach(id => validate(id));
  const ids = ['pan','aadhaar','voter_id','passport','dl_number','ration_card'];
  const hasId = ids.some(id => getVal(id));
  const idNote = document.getElementById('idNote');
  if (idNote) {
    idNote.className = hasId ? 'id-note ok' : 'id-note';
    idNote.innerHTML = hasId ? '&#10003; Identifier present' : '&#9888; At least ONE identifier is mandatory';
  }
  updateValBar();
  const req = Object.keys(RULES).filter(id => RULES[id].required);
  const allFilled = req.every(id => {
    const v = getVal(id); const r = RULES[id];
    return v && (!r.pattern || r.pattern.test(v));
  });
  return allFilled && hasId;
}

function updateValBar() {
  const req = Object.keys(RULES).filter(id => RULES[id].required);
  const done = req.filter(id => {
    const v = getVal(id); const r = RULES[id];
    return v && (!r.pattern || r.pattern.test(v));
  }).length;
  const ids = ['pan','aadhaar','voter_id','passport','dl_number','ration_card'];
  const hasId = ids.some(id => getVal(id));
  const total = req.length + 1;
  const filled = done + (hasId ? 1 : 0);
  const pct = Math.round(filled / total * 100);
  const prog = document.getElementById('valProgress');
  const cnt  = document.getElementById('valCount');
  if (prog) { prog.style.width = pct + '%'; prog.className = 'val-progress' + (pct === 100 ? ' good' : pct >= 60 ? ' mid' : ''); }
  if (cnt)  { cnt.className = 'val-count ' + (filled === total ? 'ok' : 'err'); cnt.textContent = filled + ' / ' + total + ' mandatory fields filled'; }
  const toggleBtn = document.getElementById('toggleErrBtn');
  if (toggleBtn) toggleBtn.style.display = filled < total ? 'inline' : 'none';
}

function toggleErrList() {
  const list = document.getElementById('valErrList');
  const btn  = document.getElementById('toggleErrBtn');
  const show = !list.classList.contains('show');
  list.classList.toggle('show', show);
  if (btn) btn.textContent = show ? '&#9650; Hide errors' : '&#9660; Show errors';
}

// ══════════════════════════════════════════════════
//  CONTACTS
// ══════════════════════════════════════════════════
let contactCount = 1;
function addContact() {
  if (contactCount >= 4) { alert('Max 4 contacts allowed'); return; }
  const i = contactCount++;
  const container = document.getElementById('contactsContainer');
  const row = document.createElement('div');
  row.className = 'contact-row'; row.setAttribute('data-idx', i);
  row.innerHTML = `
    <div class="field" id="f_ctype_${i}"><label>Contact Type</label>
      <select class="ctype" onchange="validateContact(${i})">
        <option value="">--Select--</option>
        <option>Mobile Phone</option><option>Home Phone</option><option>Office Phone</option>
      </select><span class="field-err" id="e_ctype_${i}"></span></div>
    <div class="field" id="f_cnum_${i}"><label>Contact Number</label>
      <input type="text" class="cnum" placeholder="10-digit Number" maxlength="15"
        oninput="this.value=this.value.replace(/\\D/g,'');validateContact(${i})" onblur="validateContact(${i})">
      <span class="field-err" id="e_cnum_${i}"></span></div>
    <div style="align-self:flex-end;padding-bottom:4px">
      <button class="btn btn-red small-btn" onclick="this.closest('.contact-row').remove()">&#10005;</button></div>`;
  container.appendChild(row);
}

function validateContact(i) {
  const row = document.querySelector(`.contact-row[data-idx="${i}"]`);
  if (!row) return;
  const num = row.querySelector('.cnum').value.trim();
  const nf  = document.getElementById('f_cnum_' + i);
  const ne  = document.getElementById('e_cnum_' + i);
  const bad = num && !/^\d{7,15}$/.test(num);
  if (nf) { nf.classList.toggle('invalid', bad); nf.classList.toggle('valid', !bad && !!num); }
  if (ne) ne.textContent = bad ? '7–15 digits required' : '';
}

// ══════════════════════════════════════════════════
//  ENQUIRY PURPOSE MAP
// ══════════════════════════════════════════════════
const PURPOSE_MAP = {
  // ── All values are ACTUAL kaf_7 option values from live CIBIL portal ──
  '1,1': [
    ['53', 'Business Loan – Priority Sector – Agriculture'],
    ['54', 'Business Loan – Priority Sector – Others'],
    ['52', 'Business Loan – Priority Sector – Small Business'],
    ['56', 'Business Non-Funded Credit Facility-Priority Sector- Small Business'],
    ['57', 'Business Non-Funded Credit Facility-Priority Sector-Agriculture'],
    ['58', 'Business Non-Funded Credit Facility-Priority Sector-Others'],
    ['36', 'Kisan Credit Card'],
    ['40', 'Microfinance - Business Loan'],
    ['42', 'Microfinance - Housing Loan'],
    ['43', 'Microfinance - Others'],
    ['41', 'Microfinance - Personal Loan'],
    ['39', 'Mudra Loans-Shishu / Kishor / Tarun'],
    ['38', 'Prime Minister Jaan Dhan Yojana-Overdraft'],
    ['70', 'Priority Sector-Gold Loan'],
    ['34', 'Tractor Loan'],
  ],
  '2,1': [
    ['01', 'Auto Loan (Personal)'],
    ['46', 'P2P Auto Loan'],
    ['13', 'Two-Wheeler Loan'],
    ['32', 'Used Car Loan'],
  ],
  '3,1': [
    ['60', 'Business Loan - Director Search-Soft Enquiry - Score Unaffected'],
    ['51', 'Business Loan - General'],
    ['61', 'Business Loan - Unsecured'],
    ['59', 'Business Loan Against Bank Deposits'],
    ['50', 'Business Loan- Secured'],
    ['55', 'Business Non-Funded Credit Facility – General'],
    ['17', 'Commercial Vehicle Loan'],
    ['33', 'Construction Equipment Loan'],
    ['35', 'Corporate Credit Card'],
    ['16', 'Fleet Card'],
    ['23', 'Gecl Loan Secured'],
    ['24', 'Gecl Loan Unsecured'],
    ['14', 'Non-Funded Credit Facility'],
    ['21', 'Seller Financing'],
  ],
  '4,0': [
    ['72', 'Complaint Resolution'],
  ],
  '5,0': [
    ['02', 'Housing Loan'],
    ['11', 'Leasing'],
    ['44', 'Pradhan Mantri Awas Yojana-Credit Link Subsidy Scheme-Pmay Clss'],
    ['03', 'Property Loan'],
  ],
  '6,1': [
    ['07', 'Gold Loan'],
    ['04', 'Loan Against Shares/Securities'],
  ],
  '8,0': [
    ['93', 'Individual Information Report'],
    ['00', 'Other'],
  ],
  '9,0': [
    ['06', 'Consumer Loan'],
    ['10', 'Credit Card'],
    ['08', 'Education Loan'],
    ['15', 'Loan Against Bank Deposits'],
    ['37', 'Loan On Credit Card'],
    ['09', 'Loan To Professional'],
    ['12', 'Overdraft'],
    ['47', 'P2P Education Loan'],
    ['45', 'P2P Personal Loan'],
    ['05', 'Personal Loan'],
    ['31', 'Secured Credit Card'],
    ['69', 'Short Term Personal Loan'],
    ['71', 'Temporary Overdraft'],
  ],
};

function updatePurpose() {
  const cat = document.getElementById('enq_category').value;
  const sel = document.getElementById('enq_purpose');
  sel.innerHTML = '<option value="">--Select--</option>';
  (PURPOSE_MAP[cat] || []).forEach(([v, l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o);
  });
  validate('enq_purpose');
}

// ══════════════════════════════════════════════════
//  QUEUE
// ══════════════════════════════════════════════════
let queue = [];

function collectFormData() {
  const catEl     = document.getElementById('enq_category');
  const stateEl   = document.getElementById('state');
  const addrEl    = document.getElementById('address_type');
  const gstEl     = document.getElementById('gst_state');
  const contacts  = [];
  document.querySelectorAll('.contact-row').forEach(row => {
    const t = row.querySelector('.ctype')?.value || '';
    const n = row.querySelector('.cnum')?.value  || '';
    if (t && n) contacts.push({ type: t, number: n });
  });
  return {
    request_type:        getVal('request_type'),
    first_name:          getVal('first_name').toUpperCase(),
    middle_name:         getVal('middle_name').toUpperCase() || null,
    last_name:           getVal('last_name').toUpperCase()   || null,
    dob:                 getVal('dob'),
    gender:              getVal('gender'),
    email:               getVal('email') || null,
    address_type:        getVal('address_type'),
    address_type_label:  addrEl.options[addrEl.selectedIndex]?.text || '',
    addr1:               getVal('addr1'),
    addr2:               getVal('addr2') || null,
    addr3:               getVal('addr3') || null,
    state_code:          getVal('state'),
    state_name:          stateEl.options[stateEl.selectedIndex]?.text || '',
    city:                getVal('city'),
    pincode:             getVal('pincode'),
    contacts,
    pan:                 getVal('pan')         || null,
    aadhaar:             getVal('aadhaar')     || null,
    voter_id:            getVal('voter_id')    || null,
    passport:            getVal('passport')    || null,
    dl_number:           getVal('dl_number')   || null,
    ration_card:         getVal('ration_card') || null,
    grameen_score:       document.getElementById('grameen_score').checked,
    consumer_score:      getVal('consumer_score'),
    enq_category:        catEl.value.split(',')[0] || '',
    enq_category_label:  catEl.options[catEl.selectedIndex]?.text || '',
    enq_purpose:         getVal('enq_purpose'),
    enq_amount:          getVal('enq_amount'),
    mrn:                 getVal('mrn'),
    gst_state_code:      getVal('gst_state'),
    gst_state_name:      gstEl.options[gstEl.selectedIndex]?.text || '',
    brn:                 getVal('brn') || null,
    crn:                 getVal('crn') || null,
    generated_at:        new Date().toISOString(),
  };
}

function addToQueue() {
  if (!validateAll(true)) {
    showMsg('Kuch mandatory fields khali hain. Upar errors dekhen.', 'err'); return;
  }
  const data = collectFormData();
  const filename = 'CIBIL_' + data.first_name + '_' + (data.mrn || Date.now()) + '.txt';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  queue.push({ ...data, _file: filename });
  renderQueue();
  showMsg('&#10003; Record queue mein add ho gaya: ' + filename + ' — Naya form fill karo', 'ok');

  // Auto-scroll to queue section
  const qSection = document.getElementById('queueSection');
  if (qSection) {
    setTimeout(() => qSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }

  // Auto-reset form silently for next entry
  setTimeout(() => resetFormSilent(), 600);
}

function renderQueue() {
  const tbody  = document.getElementById('queueBody');
  const qCount = document.getElementById('qCount');
  const rcEl   = document.getElementById('recordCount');
  const dlBtn  = document.getElementById('dlAllBtn');
  const dlIndivBtn = document.getElementById('dlIndivBtn');
  const clrBtn = document.getElementById('clrBtn');
  const emptyEl= document.getElementById('emptyQueue');
  const dlCount= document.getElementById('dlBannerCount');
  if (qCount)  qCount.textContent  = queue.length;
  if (rcEl)    rcEl.textContent    = '— ' + queue.length + ' record' + (queue.length !== 1 ? 's' : '');
  if (dlBtn)   dlBtn.disabled      = !queue.length;
  if (dlIndivBtn) dlIndivBtn.disabled = !queue.length;
  if (clrBtn)  clrBtn.disabled     = !queue.length;
  if (dlCount) dlCount.textContent = queue.length
    ? 'Queue mein ' + queue.length + ' record' + (queue.length !== 1 ? 's' : '') + ' hain — download karo'
    : 'Queue mein abhi koi record nahi hai';
  if (!queue.length) { tbody.innerHTML = ''; if (emptyEl) emptyEl.style.display = 'block'; return; }
  if (emptyEl) emptyEl.style.display = 'none';
  tbody.innerHTML = queue.map((r, i) => `<tr>
    <td>${i+1}</td><td>${r.first_name} ${r.last_name||''}</td><td>${r.dob}</td>
    <td>${r.pan||'—'}</td><td>${r.city}</td>
    <td style="font-size:11px">${r.enq_category_label||'—'}</td>
    <td>&#8377;${Number(r.enq_amount).toLocaleString('en-IN')}</td><td>${r.mrn}</td>
    <td>
      <button class="btn btn-teal small-btn" onclick="dlSingle(${i})">&#11015;</button>
      <button class="btn btn-red small-btn" onclick="removeQ(${i})">&#10005;</button>
    </td></tr>`).join('');
}

function dlSingle(i) {
  const r = queue[i];
  const blob = new Blob([JSON.stringify(r, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = r._file || ('CIBIL_' + r.first_name + '_' + r.mrn + '.txt'); a.click();
}

function downloadAll() {
  if (!queue.length) return;
  const clean = queue.map(r => { const c = {...r}; delete c._file; return c; });
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'CIBIL_Bulk_' + new Date().toISOString().slice(0,10) + '.txt'; a.click();
}

function downloadAllIndividual() {
  if (!queue.length) return;
  queue.forEach((r, i) => {
    setTimeout(() => {
      const c = { ...r }; delete c._file;
      const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r._file || ('CIBIL_' + r.first_name + '_' + r.mrn + '.txt');
      a.click();
    }, i * 400);
  });
  showMsg('&#11015; ' + queue.length + ' individual text files download ho rahe hain...', 'ok');
}

function clearQueue() {
  if (!confirm('Queue clear karna chahte hain?')) return;
  queue = []; renderQueue();
}

function removeQ(i) { queue.splice(i, 1); renderQueue(); }

function scrollToQueue() { document.getElementById('queueSection')?.scrollIntoView({ behavior:'smooth' }); }

function resetForm() {
  if (!confirm('Form reset karna chahte hain?')) return;
  _doReset();
  showMsg('Form reset ho gaya.', 'ok');
}

function resetFormSilent() {
  _doReset();
}

function _doReset() {
  document.querySelectorAll('input[type=text],input[type=email],input[type=number],input[type=hidden]').forEach(el => el.value = '');
  document.querySelectorAll('select').forEach(el => el.selectedIndex = 0);
  document.getElementById('dob_cal').value = '';
  document.getElementById('dob_display').style.display = 'none';
  document.getElementById('grameen_score').checked = false;
  document.querySelectorAll('.field').forEach(f => f.classList.remove('valid','invalid'));
  document.querySelectorAll('.field-err').forEach(e => e.textContent = '');
  document.querySelectorAll('.contact-row[data-idx]:not([data-idx="0"])').forEach(r => r.remove());
  document.getElementById('enq_purpose').innerHTML = '<option value="">--Select--</option>';
  clearAIFiles(); updateValBar();
  // Scroll back to top of form
  document.querySelector('.content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showMsg(msg, type) {
  const el = document.getElementById('globalMsg');
  if (!msg) { el.style.display = 'none'; return; }
  el.className = 'msg-' + type; el.style.display = 'block'; el.innerHTML = msg;
  setTimeout(() => el.style.display = 'none', 4000);
}

// ══════════════════════════════════════════════════
//  AI MULTI-DOCUMENT AUTO-FILL
// ══════════════════════════════════════════════════

// Prompt used when calling OpenAI directly from the browser (no local server)
const _DIRECT_PROMPT = `You are an expert OCR and document analysis system. Carefully examine this identity document image and extract ALL visible information.

The document may be: Aadhaar Card, PAN Card, Passport, Voter ID, Driving Licence, or any other identity/address proof.

Return ONLY a valid JSON object with these exact keys (use null if not found or not visible):
{
  "doc_type_detected": "Type of document — e.g. Aadhaar Card, PAN Card, Passport, Voter ID, Driving Licence",
  "first_name": "ENGLISH UPPERCASE only — ignore Hindi/regional scripts",
  "middle_name": "ENGLISH UPPERCASE or null",
  "last_name": "ENGLISH UPPERCASE or null",
  "father_name": "Father full name or null",
  "dob": "Date of birth as DDMMYYYY exactly 8 digits — zero-pad day and month e.g. 05031990",
  "gender": "Male or Female or Transgender or null",
  "aadhaar_number": "12 digits no spaces or dashes — exactly 12 digits or null",
  "pan_number": "ABCDE1234F — 5 uppercase letters + 4 digits + 1 uppercase letter or null",
  "passport_number": null,
  "voter_id": null,
  "dl_number": null,
  "address_line1": null,
  "address_line2": null,
  "address_line3": null,
  "city": null,
  "state": "Full English state name or null",
  "pincode": "6-digit string or null",
  "email": null,
  "mobile": "10 digits no +91 prefix or null"
}
CRITICAL: All names in ENGLISH CAPITALS only. Return ONLY the JSON — no markdown, no explanation.`;

// ── Check if local server is reachable ────────────────────────────────
async function isServerAvailable() {
  try {
    const r = await fetch(SERVER + '/ping', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

// ── Call OpenAI API directly from browser (no local server needed) ────
async function callOpenAIDirect(b64, apiKey) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: b64, detail: 'high' } },
          { type: 'text', text: _DIRECT_PROMPT }
        ]
      }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'OpenAI API error ' + resp.status);
  }
  const data = await resp.json();
  const raw   = data.choices[0].message.content.trim();
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI se valid JSON nahi aaya — dobara try karo');
  return JSON.parse(match[0]);
}

let aiFiles = [];
let aiIdCtr = 0;

function initAIDropZone() {
  const zone  = document.getElementById('aiDropZone');
  const input = document.getElementById('aiFileInput');
  if (!zone || !input) return;
  // Drag-drop handlers (label click → file dialog handled natively by for="aiFileInput")
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    handleAIFiles(Array.from(e.dataTransfer.files));
  });
  input.addEventListener('change', () => { handleAIFiles(Array.from(input.files)); input.value = ''; });
}

function handleAIFiles(files) {
  if (!files.length) return;
  const ALLOWED = ['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/bmp','image/heic','image/heif','application/pdf'];
  let anyAdded = false;
  files.forEach(file => {
    // Accept by MIME type or by extension if MIME is blank (some phones)
    const mime = file.type.toLowerCase();
    const ext  = file.name.split('.').pop().toLowerCase();
    const allowedExts = ['jpg','jpeg','png','webp','gif','bmp','heic','heif','pdf'];
    const ok = ALLOWED.includes(mime) || (!mime && allowedExts.includes(ext));
    if (!ok) {
      showMsg('"' + file.name + '" — sirf image ya PDF files supported hain', 'error');
      return;
    }
    const id    = ++aiIdCtr;
    const entry = { id, file, status: 'queued', data: null };
    aiFiles.push(entry);
    anyAdded = true;
    autoExtract(entry);
  });
  if (anyAdded) renderAIFiles();
}

function renderAIFiles() {
  const list     = document.getElementById('aiFileList');
  const clearBtn = document.getElementById('aiClearBtn');
  if (!list) return;
  if (clearBtn) clearBtn.style.display = aiFiles.length ? 'inline' : 'none';
  if (!aiFiles.length) { list.innerHTML = ''; return; }

  const STATUS = {
    queued:     `<span class="ai-status ai-queued">&#8987; Queued</span>`,
    extracting: `<span class="ai-status ai-extracting"><span class="spinner"></span> Reading...</span>`,
    preview:    `<span class="ai-status ai-preview-badge">&#128065; Review karo</span>`,
    filled:     `<span class="ai-status ai-done">&#10003; Form filled</span>`,
    error:      `<span class="ai-status ai-error">&#10007; Error</span>`,
  };

  list.innerHTML = aiFiles.map(e => {
    // ── Preview panel (shown when status === 'preview') ──
    let previewHtml = '';
    if (e.status === 'preview' && e.data) {
      const d = e.data;
      const rows = [];
      if (d.doc_type_detected) rows.push(['Document', d.doc_type_detected]);
      const fullName = [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(' ');
      if (fullName)            rows.push(['Name',    fullName]);
      if (d.father_name)       rows.push(['Father',  d.father_name]);
      if (d.dob && d.dob.length === 8)
                               rows.push(['DOB',     d.dob.slice(0,2)+'/'+d.dob.slice(2,4)+'/'+d.dob.slice(4)]);
      if (d.gender)            rows.push(['Gender',  d.gender]);
      if (d.aadhaar_number)    rows.push(['Aadhaar', d.aadhaar_number.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')]);
      if (d.pan_number)        rows.push(['PAN',     d.pan_number]);
      if (d.passport_number)   rows.push(['Passport',d.passport_number]);
      if (d.voter_id)          rows.push(['Voter ID',d.voter_id]);
      if (d.dl_number)         rows.push(['DL No.',  d.dl_number]);
      if (d.mobile)            rows.push(['Mobile',  d.mobile]);
      if (d.email)             rows.push(['Email',   d.email]);
      const addrParts = [d.address_line1, d.address_line2, d.address_line3, d.city, d.state, d.pincode].filter(Boolean);
      if (addrParts.length)    rows.push(['Address', addrParts.join(', ')]);

      previewHtml = `
        <div class="ai-preview">
          <div class="ai-preview-title">&#128203; Extracted Data — verify karein phir fill karein:</div>
          <div class="ai-preview-grid">
            ${rows.map(([lbl, val]) => `
              <div class="ai-preview-field">
                <span class="ai-preview-label">${lbl}</span>
                <span class="ai-preview-value">${val}</span>
              </div>`).join('')}
          </div>
          ${rows.length === 0 ? '<p style="color:#888;font-size:12px;margin:4px 0 8px">Koi data extract nahi hua — document unclear ho sakta hai.</p>' : ''}
          <div class="ai-preview-actions">
            <button class="ai-confirm-btn" onclick="confirmAIFill(${e.id})">&#10003; Form Mein Fill Karo</button>
            <button class="ai-retry-btn"   onclick="retryAIExtract(${e.id})">&#8635; Dobara Try</button>
            <button class="ai-discard-btn" onclick="removeAIFile(${e.id})">&#10005; Discard</button>
          </div>
        </div>`;
    }

    // ── File row HTML ──
    const docBadge = (e.data && e.data.doc_type_detected && e.status !== 'queued' && e.status !== 'extracting')
      ? `<div class="ai-doc-type-badge">&#128196; ${e.data.doc_type_detected}</div>` : '';

    return `
      <div class="ai-file-row" id="airow_${e.id}">
        <div class="ai-row-top">
          <div class="ai-file-thumb" id="aithumb_${e.id}"></div>
          <div class="ai-file-info">
            <div class="ai-file-name">${e.file.name}</div>
            ${docBadge}
          </div>
          <div class="ai-file-status" id="aistatus_${e.id}">${STATUS[e.status] || ''}</div>
          <button class="ai-remove-btn" onclick="removeAIFile(${e.id})" title="Remove">&#10005;</button>
        </div>
        ${previewHtml}
      </div>`;
  }).join('');

  // Load thumbnails
  aiFiles.forEach(e => {
    const thumb = document.getElementById('aithumb_' + e.id);
    if (thumb && !thumb.hasChildNodes()) {
      const isPdf = e.file.type === 'application/pdf' || e.file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        thumb.innerHTML = '<span style="font-size:28px;line-height:1">&#128196;</span><div style="font-size:9px;font-weight:700;color:#c0392b;margin-top:2px">PDF</div>';
      } else if (e.file.type.startsWith('image/')) {
        const img = new Image(); img.className = 'ai-thumb-img';
        img.src = URL.createObjectURL(e.file);
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = '<span style="font-size:20px">&#128196;</span>';
      }
    }
  });

  checkMergeReady();
}

function confirmAIFill(id) {
  const e = aiFiles.find(x => x.id === id);
  if (!e || !e.data) return;
  fillFormFromAI(e.data);
  e.status = 'filled';
  renderAIFiles();
  showMsg('&#10003; Form auto-fill ho gaya — ' + (e.data.doc_type_detected || 'document') + ' se data bhara gaya', 'success');
}

function retryAIExtract(id) {
  const e = aiFiles.find(x => x.id === id);
  if (!e) return;
  e.data = null; e.status = 'queued';
  renderAIFiles();
  autoExtract(e);
}

function removeAIFile(id) {
  aiFiles = aiFiles.filter(e => e.id !== id); renderAIFiles();
}

function clearAIFiles() {
  aiFiles = []; renderAIFiles();
}

async function autoExtract(entry) {
  entry.status = 'extracting'; renderAIFiles();
  try {
    const isPdf = entry.file.type === 'application/pdf' || entry.file.name.toLowerCase().endsWith('.pdf');
    let b64, mime;
    if (isPdf) {
      b64  = await readFileAsDataURL(entry.file);
      mime = 'application/pdf';
    } else {
      const r = await resizeAndEncode(entry.file);
      b64 = r.b64; mime = r.mime;
    }

    let data;
    const serverOnline = await isServerAvailable();

    if (serverOnline) {
      // ── Mode 1: Local Python server (supports PDF via pymupdf) ────────
      const resp = await fetch(SERVER + '/extract_document', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'auto', image_base64: b64, mime_type: mime }),
        signal:  AbortSignal.timeout(90000)
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Server error'); }
      data = await resp.json();
    } else {
      // ── Mode 2: Direct OpenAI API from browser (images only) ──────────
      if (isPdf) throw new Error('PDF ke liye local Python server zaroori hai — cibil_automation.py chalao');
      const apiKey = localStorage.getItem(LS.OPENAI_KEY);
      if (!apiKey) throw new Error('Server offline. App 1 → Settings mein OpenAI API key daalo (direct browser mode).');
      showMsg('&#9889; Server offline — OpenAI API direct browser se call ho rahi hai...', 'ok');
      data = await callOpenAIDirect(b64, apiKey);
    }

    entry.data = data; entry.status = 'preview';
    renderAIFiles();
  } catch(err) {
    entry.status = 'error'; renderAIFiles();
    const statusEl = document.getElementById('aistatus_' + entry.id);
    if (statusEl) statusEl.innerHTML =
      `<span class="ai-status ai-error" title="${err.message}">&#10007; ${err.message.slice(0,70)}</span>`;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload  = ev => resolve(ev.target.result);
    reader.readAsDataURL(file);
  });
}

/**
 * Resize image to max 1600px on longest side, compress to JPEG 85%.
 * Runs on canvas — does NOT block main thread in modern browsers.
 * Returns { b64: "data:image/jpeg;base64,...", mime: "image/jpeg" }
 */
function resizeAndEncode(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 1600;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else        { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ b64: canvas.toDataURL('image/jpeg', 0.85), mime: 'image/jpeg' });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function fillFormFromAI(data) {
  const setF = (id, val) => {
    if (!val) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.classList.add('ai-fill');
    setTimeout(() => el.classList.remove('ai-fill'), 1800);
    validate(id);
  };

  // ── Personal details ──
  if (data.first_name)  setF('first_name',  data.first_name.toUpperCase());
  if (data.middle_name) setF('middle_name', data.middle_name.toUpperCase());
  if (data.last_name)   setF('last_name',   data.last_name.toUpperCase());

  if (data.dob && data.dob.length === 8) {
    const dd = data.dob.slice(0,2), mm = data.dob.slice(2,4), yyyy = data.dob.slice(4);
    const calEl = document.getElementById('dob_cal');
    if (calEl) { calEl.value = yyyy + '-' + mm + '-' + dd; syncDOB(); }
  }
  if (data.gender) {
    const gEl = document.getElementById('gender');
    if (gEl) {
      Array.from(gEl.options).forEach(o => {
        if (o.text.toLowerCase() === data.gender.toLowerCase()) gEl.value = o.value;
      });
      validate('gender');
    }
  }
  if (data.email)  setF('email',  data.email);
  if (data.mobile) setF('mobile', data.mobile);

  // ── Address ──
  if (data.address_line1) setF('addr1', data.address_line1);
  if (data.address_line2) setF('addr2', data.address_line2);
  if (data.address_line3) setF('addr3', data.address_line3);
  if (data.city)    setF('city',    data.city);
  if (data.pincode) setF('pincode', data.pincode);
  if (data.state) {
    const stEl = document.getElementById('state');
    if (stEl) {
      const sl = data.state.toLowerCase();
      Array.from(stEl.options).forEach(o => {
        if (o.text.toLowerCase().includes(sl) || sl.includes(o.text.toLowerCase())) stEl.value = o.value;
      });
      validate('state');
    }
  }

  // ── ID numbers ──
  if (data.aadhaar_number) setF('aadhaar', data.aadhaar_number);
  if (data.pan_number)     setF('pan',     data.pan_number.toUpperCase());

  updateValBar();
}

// ══════════════════════════════════════════════════
//  LOGIN GATE
// ══════════════════════════════════════════════════
function skipLoginGate() {
  const gate = document.getElementById('loginGate');
  if (gate) gate.style.display = 'none';
}

// ══════════════════════════════════════════════════
//  SETTINGS — Tab switching + API Key management
// ══════════════════════════════════════════════════
function showTab(tab) {
  const formContent = document.querySelector('.content');
  const settPanel   = document.getElementById('settingsPanel');
  const navForm     = document.getElementById('navForm');
  const navSett     = document.getElementById('navSettings');
  if (tab === 'settings') {
    formContent.style.display = 'none';
    settPanel.style.display   = 'block';
    navForm.classList.remove('active');
    navSett.classList.add('active');
    loadSavedKeys();
    checkServerSettings();
    loadApiStatus();   // show server-saved key status
  } else {
    formContent.style.display = 'block';
    settPanel.style.display   = 'none';
    navForm.classList.add('active');
    navSett.classList.remove('active');
  }
}

function toggleKeyVis(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.innerHTML = '&#128065; Hide';
  } else {
    inp.type = 'password';
    btn.innerHTML = '&#128065; Show';
  }
}

function loadSavedKeys() {
  const oKey = localStorage.getItem(LS.OPENAI_KEY) || '';
  if (document.getElementById('openaiKeyInput')) document.getElementById('openaiKeyInput').value = oKey;

  // Pre-fill server URL field in settings
  const urlField = document.getElementById('serverUrlSetting');
  if (urlField) urlField.value = localStorage.getItem(LS.SERVER_URL) || 'http://localhost:5000';
}

function saveServerUrlSetting() {
  const val = document.getElementById('serverUrlSetting').value.trim();
  if (!val) return;
  localStorage.setItem(LS.SERVER_URL, val);
  showApiStatus('ok', '&#10003; Server URL save ho gayi — page reload karo changes apply karne ke liye.');
}

function resetServerUrl() {
  localStorage.removeItem(LS.SERVER_URL);
  document.getElementById('serverUrlSetting').value = 'http://localhost:5000';
  showApiStatus('warn', 'Server URL default pe reset ho gayi (http://localhost:5000) — page reload karo.');
}

// ── Load API key status — check localStorage first, then server ──
async function loadApiStatus() {
  const bar = document.getElementById('savedKeyBar');
  if (!bar) return;

  const localKey = localStorage.getItem(LS.OPENAI_KEY);

  try {
    const r = await fetch(SERVER + '/get_api_status', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();

    if (d.openai_key_set) {
      bar.style.display = 'flex';
      const txt = document.getElementById('savedKeyText');
      if (txt) txt.textContent = '💾 Server + Browser mein API key save hai — OpenAI (' + d.openai_key_hint + ')';
      const inp = document.getElementById('openaiKeyInput');
      if (inp && !inp.value) {
        inp.placeholder = 'Server pe save hai: ' + d.openai_key_hint + ' — dobara dalne ki zaroorat nahi';
        if (localKey) inp.value = localKey;
      }
    } else if (localKey) {
      // Key only in localStorage (server offline or key not pushed yet)
      bar.style.display = 'flex';
      const txt = document.getElementById('savedKeyText');
      if (txt) txt.textContent = '💾 Browser mein API key save hai (' + localKey.slice(0,10) + '...) — Direct AI mode enabled';
      const inp = document.getElementById('openaiKeyInput');
      if (inp && !inp.value) inp.value = localKey;
    } else {
      bar.style.display = 'none';
    }
  } catch(e) {
    // Server offline — show localStorage key if available
    if (localKey) {
      bar.style.display = 'flex';
      const txt = document.getElementById('savedKeyText');
      if (txt) txt.textContent = '💾 Browser mein API key save hai — Server offline, Direct AI mode active';
      const inp = document.getElementById('openaiKeyInput');
      if (inp && !inp.value) inp.value = localKey;
    } else {
      bar.style.display = 'none';
    }
  }
}

async function saveApiKey() {
  const key = document.getElementById('openaiKeyInput').value.trim();
  if (!key) { alert('API key khali hai!'); return; }

  // Always save to localStorage — works offline + for direct browser mode
  localStorage.setItem(LS.OPENAI_KEY, key);

  // Also push to local server if it's running
  try {
    const r = await fetch(SERVER + '/set_api_key', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ api_key: key }),
      signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    showApiStatus(d.status === 'ok' ? 'ok' : 'err', d.message || 'Server + browser dono mein save ho gayi');
  } catch(e) {
    showApiStatus('warn', '&#10003; Key browser (localStorage) mein save ho gayi — Direct AI mode enabled. Server offline hai — baad mein automatically server pe bhi save ho jaayegi.');
  }

  const sm = document.getElementById('saveMsg');
  sm.style.display = 'inline';
  setTimeout(() => sm.style.display = 'none', 2500);
}

async function testApiKey() {
  const key = document.getElementById('openaiKeyInput').value.trim();
  if (!key) { alert('Pehle API key dalen!'); return; }

  showApiStatus('idle', 'Testing...');
  try {
    const r = await fetch(SERVER + '/test_api_key', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ api_key: key }),
      signal: AbortSignal.timeout(20000)
    });
    const d = await r.json();
    if (d.status === 'ok') showApiStatus('ok', '✓ ' + (d.message || 'API key valid hai!'));
    else showApiStatus('err', '✗ ' + (d.message || 'API key invalid ya error.'));
  } catch(e) {
    showApiStatus('warn', 'Server offline hai. Pehle CIBIL_LAUNCHER.bat chalayein, phir test karein.');
  }
}

function showApiStatus(type, msg) {
  const row = document.getElementById('apiStatusRow');
  row.style.display = 'flex';
  let cls = 'api-idle';
  if (type === 'ok')   cls = 'api-ok';
  if (type === 'err')  cls = 'api-err';
  if (type === 'warn') cls = 'api-warn';
  row.className = 'api-status-row ' + cls;
  document.getElementById('apiStatusText').textContent = msg;
}

async function checkServerSettings() {
  const el = document.getElementById('settSrvStatus');
  el.textContent = 'Checking...';
  el.className   = 'api-status-row api-idle';
  await _pollServer();
}

async function restoreKeysToServer() {
  // Agar server pe already key saved hai (cibil_config.json se), toh overwrite mat karo
  try {
    const sr = await fetch(SERVER + '/get_api_status', { signal: AbortSignal.timeout(3000) });
    const sd = await sr.json();
    if (sd.openai_key_set) return; // server ke paas key hai — restore skip karo
  } catch(e) {}

  // Server ke paas key nahi — localStorage se push karo
  const key = localStorage.getItem('cibil_openai_key');
  if (!key) return;
  try {
    await fetch(SERVER + '/set_api_key', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ api_key: key }),
      signal: AbortSignal.timeout(4000)
    });
  } catch(e) {}
}

// Migrate old localStorage key name → new LS.OPENAI_KEY
(function() {
  const OLD_KEY = 'cibil_openai_key';
  if (OLD_KEY !== LS.OPENAI_KEY) {
    const v = localStorage.getItem(OLD_KEY);
    if (v) { localStorage.setItem(LS.OPENAI_KEY, v); localStorage.removeItem(OLD_KEY); }
  }
})();

// Periodic server poll — updates navbar badge + auto-restores key when server comes online
let _serverWasOnline = false;

async function _pollServer() {
  try {
    const r = await fetch(SERVER + '/ping', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();

    const badge = document.getElementById('srvBadge');
    if (badge) {
      badge.className = 'srv-badge srv-ok';
      badge.innerHTML = '<div class="dot"></div> Server Online';
    }

    if (!_serverWasOnline) {
      _serverWasOnline = true;
      await restoreKeysToServer();
    }

    const settEl = document.getElementById('settSrvStatus');
    if (settEl && document.getElementById('settingsPanel').style.display !== 'none') {
      settEl.className   = 'api-status-row api-ok';
      settEl.textContent = '✓ Server online | AI: ' + (d.ai_provider||'') + ' | Selenium: ' + (d.selenium ? 'OK' : 'Not installed');
    }
  } catch(e) {
    _serverWasOnline = false;

    const badge = document.getElementById('srvBadge');
    if (badge) {
      badge.className = 'srv-badge srv-err';
      badge.innerHTML = '<div class="dot"></div> Server Offline';
    }

    const settEl = document.getElementById('settSrvStatus');
    if (settEl && document.getElementById('settingsPanel').style.display !== 'none') {
      settEl.className   = 'api-status-row api-err';
      settEl.textContent = '✗ Server offline — CIBIL_LAUNCHER.bat chalayein';
    }
  }
}

// ══════════════════════════════════════════════════
//  SMART MERGE — MULTI-DOCUMENT BEST-DATA SELECTOR
// ══════════════════════════════════════════════════

/**
 * Field definitions for the merge panel.
 * extract(data)  → display string built from one doc's AI result
 * applyTo        → keys copied from that doc's data into the merged payload
 *                  (these keys must match what fillFormFromAI() reads)
 * priority       → doc_type_detected substrings, ordered most-trusted first
 * validate(v)    → true if the value looks correct (used to prefer valid values)
 */
const MERGE_FIELDS = [
  {
    id: 'name', label: 'Full Name', icon: '&#128100;',
    extract:  d => [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(' ').toUpperCase(),
    applyTo:  ['first_name', 'middle_name', 'last_name'],
    priority: ['PAN Card', 'Aadhaar Card', 'Driving Licence', 'Passport'],
    validate: v => v.replace(/\s/g,'').length > 1,
  },
  {
    id: 'dob', label: 'Date of Birth', icon: '&#128197;',
    extract:  d => (d.dob && d.dob.length === 8)
                  ? d.dob.slice(0,2)+'/'+d.dob.slice(2,4)+'/'+d.dob.slice(4) : '',
    applyTo:  ['dob'],
    priority: ['PAN Card', 'Aadhaar Card', 'Driving Licence'],
    validate: v => /^\d{2}\/\d{2}\/\d{4}$/.test(v),
  },
  {
    id: 'gender', label: 'Gender', icon: '&#9895;',
    extract:  d => d.gender || '',
    applyTo:  ['gender'],
    priority: ['Aadhaar Card', 'Driving Licence'],
    validate: v => ['male','female','transgender'].includes(v.toLowerCase()),
  },
  {
    id: 'aadhaar', label: 'Aadhaar No.', icon: '&#128284;',
    extract:  d => d.aadhaar_number
                  ? d.aadhaar_number.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3') : '',
    applyTo:  ['aadhaar_number'],
    priority: ['Aadhaar Card'],
    validate: v => /^\d{4}\s?\d{4}\s?\d{4}$/.test(v),
  },
  {
    id: 'pan', label: 'PAN No.', icon: '&#128203;',
    extract:  d => d.pan_number || '',
    applyTo:  ['pan_number'],
    priority: ['PAN Card'],
    validate: v => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
  },
  {
    id: 'address', label: 'Address', icon: '&#127968;',
    extract:  d => [d.address_line1, d.address_line2, d.address_line3].filter(Boolean).join(', '),
    applyTo:  ['address_line1', 'address_line2', 'address_line3'],
    priority: ['Aadhaar Card', 'Voter ID Card', 'Driving Licence'],
    validate: v => v.length > 4,
  },
  {
    id: 'city', label: 'City', icon: '&#127968;',
    extract:  d => d.city || '',
    applyTo:  ['city'],
    priority: ['Aadhaar Card', 'Voter ID Card', 'Driving Licence'],
    validate: v => v.length > 1,
  },
  {
    id: 'state', label: 'State', icon: '&#128506;',
    extract:  d => d.state || '',
    applyTo:  ['state'],
    priority: ['Aadhaar Card', 'Voter ID Card'],
    validate: v => v.length > 1,
  },
  {
    id: 'pincode', label: 'Pincode', icon: '&#128236;',
    extract:  d => d.pincode || '',
    applyTo:  ['pincode'],
    priority: ['Aadhaar Card'],
    validate: v => /^\d{6}$/.test(v),
  },
  {
    id: 'mobile', label: 'Mobile', icon: '&#128241;',
    extract:  d => d.mobile || '',
    applyTo:  ['mobile'],
    priority: [],
    validate: v => /^\d{10}$/.test(v),
  },
  {
    id: 'email', label: 'Email', icon: '&#9993;',
    extract:  d => d.email || '',
    applyTo:  ['email'],
    priority: [],
    validate: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  },
  {
    id: 'voter_id', label: 'Voter ID', icon: '&#128441;',
    extract:  d => d.voter_id || '',
    applyTo:  ['voter_id'],
    priority: ['Voter ID Card'],
    validate: v => v.length > 4,
  },
  {
    id: 'passport', label: 'Passport No.', icon: '&#128722;',
    extract:  d => d.passport_number || '',
    applyTo:  ['passport_number'],
    priority: ['Passport'],
    validate: v => v.length > 4,
  },
  {
    id: 'dl', label: 'Driving Licence', icon: '&#128663;',
    extract:  d => d.dl_number || '',
    applyTo:  ['dl_number'],
    priority: ['Driving Licence'],
    validate: v => v.length > 4,
  },
];

// ── Show / hide merge trigger button ─────────────────
function checkMergeReady() {
  const ready = aiFiles.filter(e => (e.status === 'preview' || e.status === 'filled') && e.data);
  const btn   = document.getElementById('aiMergeBtn');
  const badge = document.getElementById('aiMergeBadge');
  if (!btn) return;
  if (ready.length >= 2) {
    btn.style.display = 'inline-flex';
    if (badge) badge.textContent = ready.length + ' docs';
  } else {
    btn.style.display = 'none';
    // If merge panel is open with fewer than 2 docs now, close it
    const panel = document.getElementById('aiMergePanel');
    if (panel) panel.style.display = 'none';
  }
}

// ── Pick the best option index for a field ────────────
function pickBestIdx(fieldDef, options) {
  // options = [{ value, docType, entryId }, ...]
  if (!options.length) return -1;
  if (options.length === 1) return 0;

  const validate = fieldDef.validate || (() => true);

  // 1. Prefer valid values
  const validOpts = options.filter(o => validate(o.value));
  const pool = validOpts.length ? validOpts : options;

  // 2. Priority by document type (most trusted first)
  for (const pref of (fieldDef.priority || [])) {
    const found = pool.find(o =>
      o.docType && o.docType.toLowerCase().includes(pref.toLowerCase())
    );
    if (found) return options.indexOf(found);
  }

  // 3. Most frequent value (documents agree)
  const freq = {};
  pool.forEach(o => {
    const k = o.value.toLowerCase().trim();
    freq[k] = (freq[k] || []).concat([o]);
  });
  const groups = Object.values(freq).sort((a, b) => b.length - a.length);
  if (groups[0].length > 1) return options.indexOf(groups[0][0]);

  // 4. Longest / most complete
  const longest = pool.reduce((best, o) =>
    o.value.length > best.value.length ? o : best, pool[0]);
  return options.indexOf(longest);
}

// ── Reason text shown under AI-recommended option ─────
function mergeReason(fieldDef, options, bestIdx) {
  if (options.length === 1) return 'Sirf ek document mein mila';
  const best = options[bestIdx];
  const validate = fieldDef.validate || (() => true);

  // Check if it's valid
  const isValid = validate(best.value);

  // Check priority match
  for (const pref of (fieldDef.priority || [])) {
    if (best.docType && best.docType.toLowerCase().includes(pref.toLowerCase())) {
      return isValid
        ? pref + ' is field ke liye sabse reliable source hai'
        : pref + ' se mila (format verify karein)';
    }
  }

  // Check frequency
  const freq = {};
  options.forEach(o => { const k = o.value.toLowerCase().trim(); freq[k] = (freq[k]||0)+1; });
  if ((freq[best.value.toLowerCase().trim()]||1) > 1) return 'Multiple documents mein same value hai';

  return isValid ? 'Sabse complete value' : 'Best available (verify karein)';
}

// ── Render one field row ──────────────────────────────
function renderMergeRow(fieldDef, options, bestIdx) {
  const allSame = new Set(options.map(o => o.value.toLowerCase().trim())).size === 1;
  const rowCls  = (options.length > 1 && !allSame) ? 'merge-row-conflict' : 'merge-row-agree';
  const tagHtml = (options.length > 1 && !allSame)
    ? `<span class="merge-status-tag tag-conflict">&#9888; Conflict</span>`
    : `<span class="merge-status-tag tag-agree">&#10003; Same</span>`;

  const optionsHtml = options.map((opt, i) => {
    const isBest = i === bestIdx;
    const reason = isBest ? mergeReason(fieldDef, options, bestIdx) : '';
    const solo   = options.length === 1;
    return `
      <label class="merge-option${isBest ? ' is-best' : ''}${solo ? ' solo' : ''}"
             title="${opt.docType}">
        <input type="radio" name="mf_${fieldDef.id}" value="${opt.entryId}"
               ${isBest ? 'checked' : ''} ${solo ? 'disabled' : ''}>
        <div class="merge-opt-body">
          <div class="merge-opt-doctag">${opt.docType}</div>
          <div class="merge-opt-value">${opt.value}</div>
          ${isBest ? `<div class="merge-ai-badge">&#129302; AI Pick &mdash; ${reason}</div>` : ''}
        </div>
      </label>`;
  }).join('');

  return `
    <div class="merge-row ${rowCls}">
      <div class="merge-field-label">
        <span class="merge-field-icon">${fieldDef.icon}</span>
        <span class="merge-field-name">${fieldDef.label}</span>
        ${tagHtml}
      </div>
      <div class="merge-options">${optionsHtml}</div>
    </div>`;
}

// ── Open / render the merge panel ────────────────────
function openMergePanel() {
  const ready = aiFiles.filter(e => (e.status === 'preview' || e.status === 'filled') && e.data);
  const panel = document.getElementById('aiMergePanel');
  if (!panel || ready.length < 2) return;

  // Build per-field options from all ready docs
  const fieldRows = [];
  for (const fieldDef of MERGE_FIELDS) {
    const options = [];
    for (const e of ready) {
      const val = (fieldDef.extract(e.data) || '').trim();
      if (val) {
        options.push({
          value:   val,
          docType: e.data.doc_type_detected || e.file.name,
          entryId: e.id,
        });
      }
    }
    if (!options.length) continue;           // field absent from all docs — skip
    const bestIdx = pickBestIdx(fieldDef, options);
    fieldRows.push({ fieldDef, options, bestIdx });
  }

  if (!fieldRows.length) {
    panel.innerHTML = '<p style="padding:14px;color:#888;font-size:12px">Koi shared field nahi mila — documents check karein.</p>';
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  // Count conflicts
  const conflicts = fieldRows.filter(({ options }) =>
    options.length > 1 && new Set(options.map(o => o.value.toLowerCase().trim())).size > 1
  ).length;

  panel.innerHTML = `
    <div class="merge-header">
      <div class="merge-header-title">
        &#128256; Smart Merge &mdash; Best Data Select Karo
        <span class="merge-doc-count">${ready.length} documents</span>
        ${conflicts ? `<span class="merge-doc-count" style="background:rgba(255,220,0,.3)">${conflicts} conflict${conflicts>1?'s':''}</span>` : ''}
      </div>
      <button class="merge-close-btn" onclick="closeMergePanel()" title="Close">&#10005;</button>
    </div>
    <div class="merge-hint-bar">
      &#129302; AI ne har field ke liye best document recommend kiya hai (green border).
      Koi bhi option click karke badal sakte hain — phir <strong>Apply</strong> dabao.
    </div>
    <div class="merge-table">
      ${fieldRows.map(({ fieldDef, options, bestIdx }) =>
          renderMergeRow(fieldDef, options, bestIdx)).join('')}
    </div>
    <div class="merge-actions">
      <button class="merge-apply-btn" onclick="applyMerge()">
        &#10003; Selected Data Form Mein Fill Karo
      </button>
      <button class="merge-cancel-btn" onclick="closeMergePanel()">&#10005; Cancel</button>
      <span class="merge-actions-hint">
        &#128204; Sirf selected fields fill honge — baaki form data safe rahega
      </span>
    </div>`;

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Close without applying ────────────────────────────
function closeMergePanel() {
  const panel = document.getElementById('aiMergePanel');
  if (panel) panel.style.display = 'none';
}

// ── Apply selected values to the form ────────────────
function applyMerge() {
  const merged = {};

  for (const fieldDef of MERGE_FIELDS) {
    // For solo (single-option, disabled) fields, read the only option's entryId
    const soloInput = document.querySelector(
      `input[name="mf_${fieldDef.id}"][disabled]`
    );
    const checkedInput = soloInput
      || document.querySelector(`input[name="mf_${fieldDef.id}"]:checked`);

    if (!checkedInput) continue;
    const entryId = parseInt(checkedInput.value);
    const e = aiFiles.find(x => x.id === entryId);
    if (!e || !e.data) continue;

    for (const key of (fieldDef.applyTo || [])) {
      if (e.data[key] != null && e.data[key] !== '') {
        merged[key] = e.data[key];
      }
    }
  }

  if (!Object.keys(merged).length) {
    showMsg('Koi data select nahi hua.', 'err');
    return;
  }

  fillFormFromAI(merged);
  closeMergePanel();

  // Mark contributing docs as 'filled'
  aiFiles.forEach(e => { if (e.status === 'preview') e.status = 'filled'; });
  renderAIFiles();

  const fieldCount = new Set(
    MERGE_FIELDS.filter(f => f.applyTo.some(k => merged[k] != null)).map(f => f.label)
  ).size;
  showMsg(`&#10003; Smart Merge complete — ${fieldCount} fields fill ho gaye selected documents se`, 'ok');
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
window.addEventListener('load', () => {
  ['s1','s2','s3','s4'].forEach(id => {
    const el = document.getElementById(id);
    const ic = document.getElementById(id + 'icon');
    if (el) el.style.display = 'block';
    if (ic) ic.textContent = '–';
  });
  initAIDropZone();
  renderQueue();
  updateValBar();
  setTimeout(_pollServer, 800);
  setInterval(_pollServer, 8000);
});
