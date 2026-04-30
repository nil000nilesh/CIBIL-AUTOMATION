"""
CIBIL Automation Server
========================
Flask + Selenium server that:
  1. Auto-login to CIBIL portal (with manual OTP)
  2. Extracts data from Aadhaar/PAN card images using OpenAI GPT-4o
  3. Auto-fills the CIBIL form at: https://dc.cibil.com/DE/ccir/Login.aspx

SETUP:
  pip install flask flask-cors selenium webdriver-manager openai

RUN:
  python cibil_automation.py

The server listens on http://localhost:5000
"""

import json
import os
import re
import time
import glob
import base64
import shutil
import logging
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ── OpenAI ────────────────────────────────────
try:
    from openai import OpenAI
    OPENAI_OK = True
except ImportError:
    OPENAI_OK = False

# ── Selenium ──────────────────────────────────
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait, Select
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.common.exceptions import (
        TimeoutException, NoSuchElementException, ElementNotInteractableException,
        UnexpectedAlertPresentException
    )
    from webdriver_manager.chrome import ChromeDriverManager
    SELENIUM_OK = True
except ImportError:
    SELENIUM_OK = False


# ═════════════════════════════════════════════════════════════
#  CONFIG  ── APNI DETAILS YAHAN DAALO
# ═════════════════════════════════════════════════════════════

# ── AI Provider: OpenAI GPT-4o (only supported provider) ────
AI_PROVIDER    = "openai"

# ── OpenAI API Key (config.json se auto-load hoga) ──────────
OPENAI_API_KEY = ""
CIBIL_USERNAME = ""                        # CIBIL portal username (saved)
CIBIL_PASSWORD = ""                        # CIBIL portal password (saved)

# ── Persistent config file (API keys + CIBIL credentials) ────
import json as _json
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cibil_config.json")

def _load_config():
    global OPENAI_API_KEY, CIBIL_USERNAME, CIBIL_PASSWORD
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as _f:
                _cfg = _json.load(_f)
            OPENAI_API_KEY = _cfg.get("openai_api_key", "") or ""
            CIBIL_USERNAME = _cfg.get("cibil_username", "") or ""
            CIBIL_PASSWORD = _cfg.get("cibil_password", "") or ""
            print(f"[CONFIG] Loaded — cibil_user={'set' if CIBIL_USERNAME else 'empty'}, api_key={'set' if OPENAI_API_KEY else 'empty'}")
    except Exception as _e:
        print(f"[CONFIG] Load error: {_e}")

def _save_config():
    # In cloud deployments, config file may not be writable — skip silently
    # Keys from environment variables are never written to file (secure)
    if os.environ.get("OPENAI_API_KEY") or os.environ.get("HEADLESS","").lower() == "true":
        log.info("[CONFIG] Cloud mode — config saved to memory only (env vars take priority)")
        return
    try:
        _cfg = {
            "openai_api_key": OPENAI_API_KEY,
            "provider":       "openai",
            "cibil_username": CIBIL_USERNAME,
            "cibil_password": CIBIL_PASSWORD,
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as _f:
            _json.dump(_cfg, _f, indent=2)
        print("[CONFIG] Saved to cibil_config.json")
    except Exception as _e:
        print(f"[CONFIG] Save error (non-critical in cloud): {_e}")

# CIBIL credentials: App2 HTML se milenge (hardcode mat karo)

# ── Settings (change karne ki zaroorat nahi) ─────────────────
CIBIL_URL    = "https://dc.cibil.com/DE/ccir/Login.aspx"
HEADLESS     = os.environ.get("HEADLESS", "false").lower() == "true"
WAIT_TIMEOUT = 15        # seconds to wait for page elements
SLOW_MODE    = False     # True = debug ke liye slow fill
SLOW_DELAY   = 0.3       # seconds between actions (slow mode)

# ── Report Download Directory ────────────────────────────────
_default_dl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", _default_dl)
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# ═════════════════════════════════════════════════════════════
#  FLASK APP
# ═════════════════════════════════════════════════════════════

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

_load_config()  # logging setup ke baad load karo (log available hai ab)

# ── Cloud: environment variables override config file ────────
# Set OPENAI_API_KEY env var in your cloud dashboard (Railway / Render / Fly.io)
# This way the key is stored securely on the server, not in any file.
_env_openai = os.environ.get("OPENAI_API_KEY", "").strip()
if _env_openai:
    OPENAI_API_KEY = _env_openai
    log.info("[ENV] OPENAI_API_KEY loaded from environment variable")

_env_cibil_user = os.environ.get("CIBIL_USERNAME", "").strip()
_env_cibil_pass = os.environ.get("CIBIL_PASSWORD", "").strip()
if _env_cibil_user:
    CIBIL_USERNAME = _env_cibil_user
    log.info("[ENV] CIBIL_USERNAME loaded from environment variable")
if _env_cibil_pass:
    CIBIL_PASSWORD = _env_cibil_pass
    log.info("[ENV] CIBIL_PASSWORD loaded from environment variable")

# ── Base directory (jahan HTML/CSS/JS files hain) ────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ═════════════════════════════════════════════════════════════
#  STATIC FILE SERVING  ── HTML / CSS / JS
#  Ab HTML files file:// se nahi, http://localhost:5000 se serve hongi
#  Isse CORS / Private Network Access problems khatam ho jaate hain
# ═════════════════════════════════════════════════════════════

@app.route("/")
@app.route("/app1")
@app.route("/App1_CIBIL_Entry_Form.html")
def serve_app1():
    return send_from_directory(BASE_DIR, "App1_CIBIL_Entry_Form.html")

@app.route("/app2")
@app.route("/App2_CIBIL_Auto_Filler.html")
def serve_app2():
    return send_from_directory(BASE_DIR, "App2_CIBIL_Auto_Filler.html")

@app.route("/app3")
@app.route("/App3_CIBIL_Viewer.html")
def serve_app3():
    return send_from_directory(BASE_DIR, "App3_CIBIL_Viewer.html")

@app.route("/index.html")
@app.route("/home")
def serve_home():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory(os.path.join(BASE_DIR, "css"), filename)

@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(BASE_DIR, "js"), filename)

driver = None   # shared browser instance

# Login state tracking
login_status  = "not_started"   # not_started | logging_in | waiting_otp | logged_in | error
login_message = "Login not started yet."
login_thread  = None


# ═════════════════════════════════════════════════════════════
#  AI PROMPTS
# ═════════════════════════════════════════════════════════════

AADHAAR_PROMPT = """
You are an expert OCR system. Carefully read this Aadhaar card image and extract ALL visible information.

Return ONLY a valid JSON object with these exact keys (use null if not found):
{
  "first_name": "first name in ENGLISH CAPITAL LETTERS",
  "middle_name": "middle name if any, else null",
  "last_name": "surname or last name in ENGLISH",
  "dob": "date of birth as DDMMYYYY exactly 8 digits e.g. 15081990",
  "gender": "Male or Female or Transgender",
  "aadhaar_number": "12 digit Aadhaar number — DIGITS ONLY, remove all spaces/dashes/dots",
  "pan_number": "10 character PAN number if visible anywhere on document, else null",
  "address_line1": "first line of address (house/flat/building number)",
  "address_line2": "second line of address (area/locality/street/village)",
  "address_line3": "third line if any (taluka/tehsil/mandal), else null",
  "city": "city or district name",
  "state": "full state name in English",
  "pincode": "6 digit pincode string",
  "email": null
}

IMPORTANT RULES:
- Name must be in ENGLISH only — ignore any regional script (Hindi/Tamil/Telugu/Marathi etc)
- DOB: convert any format (DD/MM/YYYY or DD-MM-YYYY) to DDMMYYYY (8 digits, add leading zeros for day/month < 10)
- aadhaar_number: The large 12-digit number printed on the card (format xxxx xxxx xxxx) — extract ALL 12 digits, strip every space, dash or dot → result must be exactly 12 digits e.g. "987654321012"
- pan_number: 10-character alphanumeric like ABCDE1234F — only fill if clearly visible, else null
- If a field is not visible or unclear, set it to null
- Return ONLY the JSON object, absolutely no other text, markdown or explanation
"""

PAN_PROMPT = """
You are an expert OCR system. Carefully read this PAN card image and extract ALL visible information.

Return ONLY a valid JSON object with these exact keys (use null if not found):
{
  "doc_type_detected": "PAN Card",
  "first_name": "applicant first name in ENGLISH CAPITAL LETTERS",
  "middle_name": "middle name if any, else null",
  "last_name": "surname/last name in ENGLISH CAPITAL LETTERS",
  "father_name": "father full name as printed on card",
  "dob": "date of birth as DDMMYYYY exactly 8 digits e.g. 15081990",
  "gender": null,
  "pan_number": "exactly 10 character PAN number e.g. ABCDE1234F — all UPPERCASE",
  "aadhaar_number": "12 digit Aadhaar number if visible anywhere on document, digits only, else null",
  "passport_number": null,
  "voter_id": null,
  "dl_number": null,
  "address_line1": null,
  "address_line2": null,
  "address_line3": null,
  "city": null,
  "state": null,
  "pincode": null,
  "email": null,
  "mobile": null
}

IMPORTANT RULES:
- PAN card typically shows: Name of card holder, Father's Name, Date of Birth, PAN Number
- pan_number: The prominent 10-character alphanumeric code printed on the card (5 letters + 4 digits + 1 letter, e.g. ABCDE1234F) — extract exactly as printed, all UPPERCASE
- Name must be in ENGLISH CAPITAL LETTERS only
- DOB: convert DD/MM/YYYY to DDMMYYYY (8 digits with leading zeros for day/month < 10)
- aadhaar_number: only fill if a 12-digit Aadhaar number is clearly visible, else null
- Return ONLY the JSON object, absolutely no other text, markdown or explanation
"""

UNIVERSAL_PROMPT = """
You are an expert OCR and document analysis system. Carefully examine this document image and extract ALL information relevant to a credit information/identity form.

The document may be: Aadhaar Card, PAN Card, Passport, Voter ID (EPIC), Driving Licence, Bank Statement, Electricity Bill, Rent Agreement, or any other identity/address proof document.

Return ONLY a valid JSON object with these exact keys (use null if field not found or not visible):
{
  "doc_type_detected": "Type of document detected — e.g. Aadhaar Card, PAN Card, Passport, Voter ID, Driving Licence, Bank Statement, Electricity Bill, etc.",
  "first_name": "Applicant first name — ENGLISH CAPITAL LETTERS only, ignore regional script",
  "middle_name": "Middle name if present — ENGLISH CAPITAL LETTERS, else null",
  "last_name": "Surname / last name — ENGLISH CAPITAL LETTERS, else null",
  "father_name": "Father's full name if printed on document, else null",
  "dob": "Date of birth as DDMMYYYY — exactly 8 digits, add leading zeros for day/month < 10, e.g. 05031990, else null",
  "gender": "Male or Female or Transgender — as printed or inferred from title, else null",
  "aadhaar_number": "12-digit Aadhaar number — extract ALL digits, strip ALL spaces/dashes, e.g. 987654321012. Must be exactly 12 digits, else null",
  "pan_number": "PAN number — exactly 10 chars: 5 uppercase letters + 4 digits + 1 uppercase letter, e.g. ABCDE1234F, else null",
  "passport_number": "Passport number if visible, else null",
  "voter_id": "Voter ID / EPIC number if visible, else null",
  "dl_number": "Driving licence number if visible, else null",
  "address_line1": "First line of address (house/flat/door number, building name), else null",
  "address_line2": "Second line of address (street/road/area/locality/village), else null",
  "address_line3": "Third line of address (tehsil/taluka/mandal/sub-district), else null",
  "city": "City or district name, else null",
  "state": "Full state name in English, else null",
  "pincode": "6-digit PIN code as a string, else null",
  "email": "Email address if visible, else null",
  "mobile": "10-digit mobile number — digits only, no +91 prefix, else null"
}

CRITICAL RULES:
- All names must be ENGLISH CAPITAL LETTERS — completely ignore Hindi/Tamil/Telugu/Marathi/Gujarati or any regional script
- DOB: convert any format (DD/MM/YYYY, DD-MM-YYYY, Month DD YYYY) to DDMMYYYY — 8 digits, zero-padded day and month
- aadhaar_number: printed as xxxx xxxx xxxx on Aadhaar — join ALL digits, strip every space/dash → must be exactly 12 digits
- pan_number: validate format [A-Z]{5}[0-9]{4}[A-Z] before returning — if not matching, set null
- Return ONLY the JSON object — absolutely no markdown backticks, no explanation text whatsoever
"""


# ═════════════════════════════════════════════════════════════
#  AI EXTRACTION FUNCTION
# ═════════════════════════════════════════════════════════════

def pdf_first_page_to_jpeg_b64(pdf_b64: str) -> str:
    """Convert first page of a PDF (raw base64, no data URI) to JPEG base64 using pymupdf."""
    try:
        import fitz  # pymupdf
    except ImportError:
        raise Exception("pymupdf nahi mili. Run: pip install pymupdf")
    pdf_bytes = base64.b64decode(pdf_b64)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(2.0, 2.0)   # 2x zoom for better OCR quality
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return base64.b64encode(pix.tobytes("jpeg")).decode()


def extract_with_ai(image_base64: str, mime_type: str, doc_type: str) -> dict:
    """
    Send document to OpenAI GPT-4o and extract structured data.
    Supports JPEG, PNG, WebP, and PDF (first page converted to JPEG via pymupdf).
    """
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]

    # PDF: convert first page to JPEG before sending to GPT-4o vision
    if mime_type.lower() == "application/pdf":
        log.info("PDF detected — converting first page to JPEG via pymupdf...")
        image_base64 = pdf_first_page_to_jpeg_b64(image_base64)
        mime_type = "image/jpeg"

    mime_map = {
        "image/jpeg": "image/jpeg", "image/jpg":  "image/jpeg",
        "image/png":  "image/png",  "image/gif":  "image/gif",
        "image/webp": "image/webp",
    }
    media_type = mime_map.get(mime_type.lower(), "image/jpeg")
    if doc_type == "aadhaar":
        prompt = AADHAAR_PROMPT
    elif doc_type == "pan":
        prompt = PAN_PROMPT
    else:  # "auto" or anything else
        prompt = UNIVERSAL_PROMPT

    # ── OpenAI GPT-4o ─────────────────────────────────────────
    if not OPENAI_OK:
        raise Exception("openai library not installed. Run: pip install openai")
    api_key = OPENAI_API_KEY.strip()
    if not api_key:
        raise Exception(
            "OpenAI API key not set. "
            "App1 → Settings mein key daalo aur Save karo. "
            "Get key at: https://platform.openai.com/api-keys"
        )
    client = OpenAI(api_key=api_key)
    log.info(f"Calling OpenAI GPT-4o for {doc_type} extraction...")

    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{media_type};base64,{image_base64}",
                        "detail": "high"
                    }
                },
                {"type": "text", "text": prompt}
            ]
        }]
    )
    raw = response.choices[0].message.content.strip()
    log.info(f"OpenAI response (first 300 chars): {raw[:300]}")

    # ── Parse JSON from response ──────────────────────────────
    # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    clean = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.IGNORECASE)
    clean = re.sub(r'\s*```$', '', clean.strip())

    json_match = re.search(r'\{[\s\S]*\}', clean)
    if not json_match:
        raise Exception(f"AI did not return valid JSON. Response: {raw[:200]}")

    extracted = json.loads(json_match.group())
    for k in list(extracted.keys()):
        v = extracted[k]
        if v in ("", "null", "NULL", "None", "N/A", "n/a", "NA"):
            extracted[k] = None
        elif isinstance(v, str):
            extracted[k] = v.strip()

    # ── Post-process ID numbers ───────────────────────────────
    # Aadhaar: strip all non-digits, must be 12 digits
    if extracted.get("aadhaar_number"):
        digits = re.sub(r'\D', '', str(extracted["aadhaar_number"]))
        extracted["aadhaar_number"] = digits if len(digits) == 12 else None

    # PAN: strip spaces, must be 10 alphanumeric uppercase chars
    if extracted.get("pan_number"):
        pan = re.sub(r'\s+', '', str(extracted["pan_number"])).upper()
        extracted["pan_number"] = pan if re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]$', pan) else None

    log.info(f"Extracted fields: {[k for k, v in extracted.items() if v]}")
    return extracted


# ═════════════════════════════════════════════════════════════
#  BROWSER HELPERS
# ═════════════════════════════════════════════════════════════

CHROME_DEBUG_PORT   = 9222
CHROME_SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".chrome_session")


def get_driver():
    """
    Return existing WebDriver or create a new Chrome driver.
    After a server restart (driver = None), tries to reconnect to the
    still-running Chrome window via the remote-debugging port before
    opening a fresh window.
    """
    global driver

    # ── 1. Reuse live driver ──────────────────────────────────────
    if driver:
        try:
            _ = driver.title   # raises if browser closed
            return driver
        except Exception:
            driver = None

    # ── 2. Try to reconnect to an existing Chrome window ─────────
    #    Chrome was started with --remote-debugging-port and detach=True,
    #    so the window stays alive even when Python restarts.
    if os.path.exists(CHROME_SESSION_FILE):
        try:
            reconnect_opts = Options()
            reconnect_opts.debugger_address = f"localhost:{CHROME_DEBUG_PORT}"
            svc = Service(ChromeDriverManager().install())
            candidate = webdriver.Chrome(service=svc, options=reconnect_opts)
            _ = candidate.title   # raises if port not listening
            driver = candidate
            log.info(f"✅ Reconnected to existing Chrome window (debug port {CHROME_DEBUG_PORT})")
            return driver
        except Exception as ex:
            log.warning(f"Chrome reconnect failed ({ex}) — opening fresh window")
            driver = None
            try:
                os.remove(CHROME_SESSION_FILE)
            except Exception:
                pass

    # ── 3. Open a new Chrome window ───────────────────────────────
    opts = Options()
    opts.add_argument(f"--remote-debugging-port={CHROME_DEBUG_PORT}")
    if HEADLESS:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1400,900")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    # Cloud/headless mode: no detach (container manages process lifecycle)
    # Local mode: detach=True keeps browser open across Python restarts
    if not HEADLESS:
        opts.add_experimental_option("detach", True)

    # Auto-download PDFs to DOWNLOAD_DIR without prompts
    opts.add_experimental_option("prefs", {
        "download.default_directory":        DOWNLOAD_DIR,
        "download.prompt_for_download":      False,
        "download.directory_upgrade":        True,
        "plugins.always_open_pdf_externally": True,
        "safebrowsing.enabled":              True,
    })

    # Support pre-installed Chromium (Docker / cloud containers)
    _chrome_bin = (os.environ.get("CHROMIUM_PATH") or os.environ.get("CHROME_BIN") or "").strip()
    if _chrome_bin and os.path.exists(_chrome_bin):
        opts.binary_location = _chrome_bin
        log.info(f"[DRIVER] Using Chromium at: {_chrome_bin}")

    # Use pre-installed chromedriver if available, else auto-download
    import shutil as _shutil
    _cd_path = (os.environ.get("CHROMEDRIVER_PATH") or
                _shutil.which("chromedriver") or
                _shutil.which("chromium-driver") or "").strip()
    if _cd_path and os.path.exists(_cd_path):
        svc = Service(_cd_path)
        log.info(f"[DRIVER] Using ChromeDriver at: {_cd_path}")
    else:
        svc = Service(ChromeDriverManager().install())
        log.info("[DRIVER] ChromeDriver auto-downloaded via webdriver-manager")

    driver = webdriver.Chrome(service=svc, options=opts)
    driver.maximize_window()

    # Save a marker so next restart knows to try reconnecting
    try:
        with open(CHROME_SESSION_FILE, "w") as fh:
            fh.write(str(CHROME_DEBUG_PORT))
    except Exception:
        pass

    log.info(f"🆕 New Chrome window opened (debug port {CHROME_DEBUG_PORT})")
    return driver


def js_set(d, css_selector, value):
    """Set field value using JavaScript – MUCH faster than send_keys."""
    try:
        d.execute_script("""
            var el = document.querySelector(arguments[0]);
            if(el){
                var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(el, arguments[1]);
                el.dispatchEvent(new Event('input',  {bubbles:true}));
                el.dispatchEvent(new Event('change', {bubbles:true}));
                el.dispatchEvent(new Event('blur',   {bubbles:true}));
            }
        """, css_selector, str(value) if value else "")
        return True
    except Exception:
        return False


def js_select(d, css_selector, value):
    """Set select dropdown value using JavaScript."""
    try:
        d.execute_script("""
            var el = document.querySelector(arguments[0]);
            if(el){
                el.value = arguments[1];
                el.dispatchEvent(new Event('change', {bubbles:true}));
            }
        """, css_selector, str(value) if value else "")
        return True
    except Exception:
        return False


def wait_click(d, by, selector, timeout=WAIT_TIMEOUT):
    el = WebDriverWait(d, timeout).until(EC.element_to_be_clickable((by, selector)))
    if SLOW_MODE: time.sleep(SLOW_DELAY)
    el.click()
    return el


def wait_find(d, by, selector, timeout=WAIT_TIMEOUT):
    return WebDriverWait(d, timeout).until(EC.presence_of_element_located((by, selector)))


def safe_type(el, text):
    el.clear()
    if text:
        el.send_keys(str(text))
    if SLOW_MODE: time.sleep(SLOW_DELAY)


def select_by_value_or_text(sel_el, value, text_fallback=""):
    """Try multiple strategies to select a dropdown option."""
    sel = Select(sel_el)
    value     = str(value).strip()     if value     else ""
    text_fall = str(text_fallback).strip() if text_fallback else ""

    # 1. Exact value match
    if value:
        try: sel.select_by_value(value); return
        except Exception: pass

    # 2. Exact visible-text match (text_fallback)
    if text_fall:
        try: sel.select_by_visible_text(text_fall); return
        except Exception: pass

    # 3. Exact visible-text match (value as text)
    if value:
        try: sel.select_by_visible_text(value); return
        except Exception: pass

    # 4. Case-insensitive / partial match across all options
    search_lower = [t.lower() for t in [text_fall, value] if t]
    for opt in sel.options:
        opt_val  = (opt.get_attribute("value") or "").strip()
        opt_text = opt.text.strip().lower()
        for s in search_lower:
            if s and (s == opt_val.lower() or s in opt_text or opt_text in s):
                try: sel.select_by_visible_text(opt.text); return
                except Exception: pass

    log.warning(f"Could not select value '{value}' / '{text_fall}' in dropdown")


def set_checkbox(el, checked):
    if el.is_selected() != checked:
        el.click()


def fill_cibil_dob(d, day: int, month: int, year: int) -> bool:
    """
    Set DOB on kaf_37 (readonly jQuery datepicker).
    send_keys fails because blur clears the readonly value.

    Primary: datepicker('setDate') via JS — bypasses readonly and avoids blur.
    Fallback: open calendar UI, navigate year/month, click the day link.

    day, month, year: integers (month is 1-indexed, Jan=1).
    Returns True on success.
    """
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains

    log.info(f"fill_cibil_dob: day={day}, month={month}, year={year}")

    try:
        dob_el = wait_find(d, By.ID, "kaf_37", 10)
        d.execute_script("arguments[0].scrollIntoView({block:'center'});", dob_el)
        time.sleep(0.3)

        # ── Strategy 1: jQuery datepicker('setDate') ──────────────────
        # month-1 because JS Date months are 0-indexed (Jan=0)
        d.execute_script("""
            var el = document.getElementById('kaf_37');
            try {
                $('#kaf_37').datepicker('setDate', new Date(arguments[0], arguments[1]-1, arguments[2]));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                el.dispatchEvent(new Event('input',  {bubbles: true}));
            } catch(e) {}
        """, year, month, day)
        time.sleep(0.5)

        # Verify the field has a non-empty value
        val = dob_el.get_attribute("value") or ""
        if val.strip():
            log.info(f"DOB set via datepicker('setDate'): '{val}'")
            return True

        log.warning("datepicker('setDate') did not populate field — trying calendar UI")

        # ── Strategy 2: Open calendar UI and navigate ──────────────────
        calendar_opened = False
        for method in ("js_click", "direct", "action"):
            try:
                if method == "js_click":
                    d.execute_script("arguments[0].click();", dob_el)
                elif method == "direct":
                    dob_el.click()
                else:
                    ActionChains(d).move_to_element(dob_el).click().perform()
                time.sleep(1.0)
                if d.find_elements(By.CSS_SELECTOR,
                                   ".ui-datepicker:not([style*='display: none'])"):
                    log.info(f"Calendar opened via {method}")
                    calendar_opened = True
                    break
            except Exception:
                continue

        if not calendar_opened:
            log.warning("Calendar UI did not open")

        # Year dropdown
        try:
            yr_sel = Select(WebDriverWait(d, 6).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, ".ui-datepicker-year"))
            ))
            try:
                yr_sel.select_by_visible_text(str(year))
            except Exception:
                for opt in yr_sel.options:
                    if opt.text.strip() == str(year):
                        yr_sel.select_by_value(opt.get_attribute("value"))
                        break
            time.sleep(0.6)
        except Exception as ex:
            log.warning(f"Calendar year: {ex}")

        # Month dropdown (0-indexed)
        try:
            mo_sel = Select(WebDriverWait(d, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, ".ui-datepicker-month"))
            ))
            mo_sel.select_by_value(str(month - 1))
            time.sleep(0.6)
        except Exception as ex:
            log.warning(f"Calendar month: {ex}")

        # Click the day link
        day_str = str(day)
        for selector in (
            ".ui-datepicker-calendar td:not(.ui-datepicker-other-month) a",
            ".ui-datepicker-calendar td a",
        ):
            for link in d.find_elements(By.CSS_SELECTOR, selector):
                if link.text.strip() == day_str:
                    d.execute_script("arguments[0].click();", link)
                    time.sleep(0.5)
                    val = dob_el.get_attribute("value") or ""
                    log.info(f"Calendar day clicked: '{val}'")
                    return bool(val.strip())

        log.warning(f"Day {day} not found in calendar grid")
        try:
            d.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
        except Exception:
            pass
        return False

    except Exception as ex:
        log.warning(f"fill_cibil_dob failed: {ex}")
        try:
            d.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
        except Exception:
            pass
        return False


def dismiss_alert(d, timeout=2):
    """
    If a JS alert/confirm/prompt is open, accept it and return its text.
    Returns None if no alert is present.
    """
    try:
        WebDriverWait(d, timeout).until(EC.alert_is_present())
        alert = d.switch_to.alert
        text  = alert.text
        alert.accept()
        log.warning(f"Alert dismissed: {text}")
        return text
    except Exception:
        return None


def fill_by_label(d, label_keywords, value, input_type="text"):
    """
    Find an input field by searching for a <label> whose text contains
    any of the given keywords (case-insensitive), then fill it.
    Tries both for-attribute and following-sibling/following input.
    Returns True on success.
    """
    if not value:
        return False
    for kw in label_keywords:
        try:
            labels = d.find_elements(By.XPATH,
                f"//label[contains(translate(normalize-space(.),"
                f"'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'{kw.lower()}')]")
            for lbl in labels:
                for_id = lbl.get_attribute("for") or ""
                if for_id:
                    try:
                        inp = d.find_element(By.ID, for_id)
                        if inp.is_displayed() and inp.get_attribute("type") not in ("hidden", "checkbox", "radio"):
                            inp.clear()
                            d.execute_script("""
                                var el = arguments[0];
                                var ns = Object.getOwnPropertyDescriptor(
                                    window.HTMLInputElement.prototype,'value').set;
                                ns.call(el, arguments[1]);
                                el.dispatchEvent(new Event('input',{bubbles:true}));
                                el.dispatchEvent(new Event('change',{bubbles:true}));
                            """, inp, str(value))
                            log.info(f"fill_by_label: filled '{kw}' field (id={for_id})")
                            return True
                    except Exception:
                        pass
                # No for-id — try next input after the label
                try:
                    inp = lbl.find_element(By.XPATH,
                        "following::input[not(@type='hidden') and not(@type='checkbox') "
                        "and not(@type='radio')][1]")
                    if inp.is_displayed():
                        inp_id = inp.get_attribute("id") or ""
                        inp.clear()
                        d.execute_script("""
                            var el = arguments[0];
                            var ns = Object.getOwnPropertyDescriptor(
                                window.HTMLInputElement.prototype,'value').set;
                            ns.call(el, arguments[1]);
                            el.dispatchEvent(new Event('input',{bubbles:true}));
                            el.dispatchEvent(new Event('change',{bubbles:true}));
                        """, inp, str(value))
                        log.info(f"fill_by_label: filled '{kw}' via following-input (id={inp_id})")
                        return True
                except Exception:
                    pass
        except Exception:
            continue
    return False


# ═════════════════════════════════════════════════════════════
#  LOGIN AUTOMATION
# ═════════════════════════════════════════════════════════════

def _do_login_bg(username: str, password: str):
    """
    Background thread:
    1. Open CIBIL login page in Chrome
    2. Auto-fill username + password
    3. Click Login button
    4. Wait for manual OTP entry (up to 5 minutes)
    5. Detect successful login → set login_status = "logged_in"
    """
    global driver, login_status, login_message

    try:
        d = get_driver()

        login_message = "Opening CIBIL login page in Chrome..."
        log.info(login_message)
        d.get(CIBIL_URL)
        time.sleep(3)

        # ── Fill Username ──────────────────────────────────
        login_message = "Filling username..."
        log.info(login_message)
        username_selectors = [
            "#txtUserName", "#username", "#UserName", "#user_name",
            "input[name='username']", "input[name='UserName']",
            "input[name='txtUserName']", "input[type='text']:first-of-type",
            "input[placeholder*='User']", "input[placeholder*='user']",
            "input[placeholder*='Login']", "input[placeholder*='ID']"
        ]
        filled_user = False
        for sel in username_selectors:
            try:
                el = d.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    el.clear()
                    el.send_keys(username)
                    filled_user = True
                    log.info(f"Username filled via selector: {sel}")
                    break
            except Exception:
                continue

        if not filled_user:
            # XPath fallback
            try:
                inputs = d.find_elements(By.XPATH,
                    "//input[@type='text' and not(@readonly)]")
                if inputs:
                    inputs[0].clear()
                    inputs[0].send_keys(username)
                    filled_user = True
                    log.info("Username filled via XPath fallback")
            except Exception:
                pass

        time.sleep(0.5)

        # ── Fill Password ──────────────────────────────────
        login_message = "Filling password..."
        log.info(login_message)
        password_selectors = [
            "#txtPassword", "#password", "#Password",
            "input[name='password']", "input[name='Password']",
            "input[name='txtPassword']", "input[type='password']"
        ]
        filled_pass = False
        for sel in password_selectors:
            try:
                el = d.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    el.clear()
                    # JS-based value set — handles special chars (#, @, $, etc.) correctly
                    try:
                        d.execute_script("""
                            var el = arguments[0];
                            var nativeSetter = Object.getOwnPropertyDescriptor(
                                window.HTMLInputElement.prototype, 'value').set;
                            nativeSetter.call(el, arguments[1]);
                            el.dispatchEvent(new Event('input',  {bubbles:true}));
                            el.dispatchEvent(new Event('change', {bubbles:true}));
                        """, el, password)
                        log.info(f"Password filled via JS setter: {sel}")
                    except Exception:
                        el.send_keys(password)   # fallback if JS fails
                        log.info(f"Password filled via send_keys (fallback): {sel}")
                    filled_pass = True
                    break
            except Exception:
                continue

        time.sleep(0.5)

        # ── Click Login Button ─────────────────────────────
        login_message = "Clicking login button..."
        log.info(login_message)
        btn_selectors = [
            "#btnLogin", "#LoginButton", "#btnSubmit", "#Submit",
            "input[type='submit']", "button[type='submit']",
            "input[value='Login']", "input[value='Submit']",
            "button[value='Login']", ".btn-login", ".login-btn",
            "button:contains('Login')"
        ]
        clicked = False
        for sel in btn_selectors:
            try:
                el = d.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    el.click()
                    clicked = True
                    log.info(f"Login button clicked via: {sel}")
                    break
            except Exception:
                continue

        if not clicked:
            # XPath fallback
            try:
                btns = d.find_elements(By.XPATH,
                    "//input[@type='submit'] | //button[@type='submit'] | "
                    "//button[contains(translate(text(),'login','LOGIN'),'LOGIN')] | "
                    "//input[contains(translate(@value,'login','LOGIN'),'LOGIN')]")
                for b in btns:
                    if b.is_displayed():
                        b.click()
                        clicked = True
                        log.info("Login button clicked via XPath")
                        break
            except Exception:
                pass

        time.sleep(2)

        # ── Wait for OTP Page ──────────────────────────────
        login_message = "✅ Credentials submitted! Please enter OTP in the Chrome window..."
        login_status  = "waiting_otp"
        log.info("Waiting for manual OTP entry (max 5 minutes)...")

        # Monitor URL / page changes for up to 5 minutes
        start_time = time.time()
        OTP_TIMEOUT = 300  # 5 minutes

        while time.time() - start_time < OTP_TIMEOUT:
            try:
                current_url  = d.current_url
                current_url_l = current_url.lower()
                page_src_l   = d.page_source.lower()

                # ── Detect successful login ────────────────
                logged_in_signals = [
                    "losapp" in current_url_l,
                    "dcwebportal.do" in current_url_l,
                    "portal" in current_url_l and "login" not in current_url_l,
                    "home" in current_url_l and "login" not in current_url_l,
                    "welcome" in current_url_l,
                    "dashboard" in current_url_l,
                    "enquiry" in current_url_l,
                    ("login" not in current_url_l and
                     any(k in page_src_l for k in
                         ["logout", "log out", "sign out", "welcome,", "member id"])),
                ]

                if any(logged_in_signals):
                    login_status  = "logged_in"
                    login_message = "✅ Successfully logged in to CIBIL! You can now use App1 & App2."
                    log.info(f"Login SUCCESS. URL: {current_url}")
                    return

                # ── Detect error ───────────────────────────
                error_keywords = [
                    "invalid username", "invalid password",
                    "incorrect password", "user not found",
                    "account locked", "authentication failed",
                    "invalid credentials", "login failed"
                ]
                if any(k in page_src_l for k in error_keywords):
                    login_status  = "error"
                    login_message = "❌ Login failed – Invalid username or password. Check credentials in cibil_automation.py"
                    log.error("Login credentials rejected by CIBIL")
                    return

            except Exception as ex:
                log.warning(f"Login monitor exception: {ex}")

            # Update waiting message with countdown
            elapsed = int(time.time() - start_time)
            remaining = OTP_TIMEOUT - elapsed
            login_message = (
                f"⏳ Waiting for OTP... ({remaining}s remaining) "
                f"Enter OTP in the Chrome browser window."
            )
            time.sleep(2)

        # Timeout
        login_status  = "error"
        login_message = "❌ OTP timeout (5 minutes). Please restart and try again."
        log.error("OTP entry timed out")

    except Exception as ex:
        login_status  = "error"
        login_message = f"❌ Login error: {str(ex)}"
        log.error(f"Login background error: {ex}")


# ═════════════════════════════════════════════════════════════
#  FORM FILL LOGIC
# ═════════════════════════════════════════════════════════════

def navigate_to_form(d):
    """Go to CIBIL form page. Requires prior login."""
    current = d.current_url
    current_l = current.lower()

    # Already on enquiry/form page
    # URL from live page: dc.cibil.com/DE/CCIR/dcwebportal.do/LosApp?sid=...
    if any(k in current_l for k in ["losapp", "enquiry", "dcwebportal.do", "memberenquiry", "enquiryform"]):
        log.info(f"Already on CIBIL form page: {current}")
        return

    # Still on login page — not logged in
    if "login" in current_l and "aspx" in current_l:
        raise Exception(
            "Not logged in to CIBIL. "
            "Use CIBIL_LAUNCHER.bat or call /login endpoint first."
        )

    # On some other CIBIL page — try to find and click the enquiry/new enquiry link
    log.info(f"Current URL: {current} — trying to navigate to enquiry form...")
    try:
        # Look for New Enquiry / Consumer Enquiry links in the CIBIL portal menu
        nav_xpaths = [
            "//a[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'new enquiry')]",
            "//a[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'consumer enquiry')]",
            "//a[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'ccir enquiry')]",
            "//a[contains(translate(text(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'individual enquiry')]",
            "//a[contains(translate(@href,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'enquiry')]",
            "//a[contains(translate(@href,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'losapp')]",
        ]
        for xpath in nav_xpaths:
            try:
                link = d.find_element(By.XPATH, xpath)
                if link.is_displayed():
                    log.info(f"Clicking navigation link: {link.text or link.get_attribute('href')}")
                    link.click()
                    time.sleep(2)
                    return
            except Exception:
                continue
    except Exception as ex:
        log.warning(f"Form navigation attempt failed: {ex}")

    # Wait and hope the form loads
    time.sleep(2)
    log.info(f"Proceeding with current page: {d.current_url}")


def fill_individual_details(d, r):
    log.info("Filling Individual Details (fast JS mode)...")

    # Request Type — kaf_31
    try:
        rt = d.find_element(By.ID, "kaf_31")
        select_by_value_or_text(rt, r.get("request_type", "Individual"))
    except Exception: pass

    # First Name — kaf_34
    fn_val = r.get("first_name", "") or ""
    if fn_val:
        if not js_set(d, "#kaf_34", fn_val):
            try:
                el = wait_find(d, By.ID, "kaf_34", 5)
                safe_type(el, fn_val)
            except Exception: pass

    # Middle Name — kaf_35
    mn_val = r.get("middle_name", "") or ""
    js_set(d, "#kaf_35", mn_val)

    # Last Name — kaf_36
    ln_val = r.get("last_name", "") or ""
    js_set(d, "#kaf_36", ln_val)

    # Date of Birth — kaf_37
    # ⚠️ Field is readonly; jQuery datepicker('setDate') is the reliable approach.
    # send_keys fails because blur clears the value on this field.
    # Bug 5 fix: normalize separators so "15-08-1985" / "15/08/1985" → "15081985"
    dob_raw = (r.get("dob", "") or "").strip()
    if dob_raw:
        dob_normalized = re.sub(r'[-/.\s]', '', dob_raw)   # strip dashes, slashes, dots
        if len(dob_normalized) == 8 and dob_normalized.isdigit():
            dob_raw = dob_normalized
        else:
            log.warning(f"DOB format unrecognized after normalization: '{dob_raw}' → '{dob_normalized}'")
            dob_raw = ""

    dob_filled = False
    if dob_raw:
        try:
            dd_   = int(dob_raw[0:2])
            mm_   = int(dob_raw[2:4])
            yyyy_ = int(dob_raw[4:8])
            dob_filled = fill_cibil_dob(d, dd_, mm_, yyyy_)
        except ValueError:
            log.warning(f"DOB parse error: {dob_raw}")
        if not dob_filled:
            log.warning(f"DOB could not be set for: {dob_raw}")

    # Gender — kaf_38
    # ⚠️ Gender dropdown becomes ENABLED only AFTER DOB is selected via calendar.
    # So we must wait for it to become interactable after DOB click.
    gender_val = (r.get("gender") or "").strip()
    if gender_val:
        try:
            # Wait up to 12s for Gender to become clickable (DOB selection enables it)
            gn_el = WebDriverWait(d, 12).until(
                EC.element_to_be_clickable((By.ID, "kaf_38"))
            )
            sel = Select(gn_el)

            opts_available = [(o.get_attribute("value"), o.text.strip()) for o in sel.options]
            log.info(f"Gender options: {opts_available}")

            # Strategy 1: exact visible text ("Male", "Female", "Transgender")
            try:
                sel.select_by_visible_text(gender_val)
                log.info(f"Gender set: {gender_val}")
            except Exception:
                # Strategy 2: case-insensitive match across all options
                matched = False
                for opt in sel.options:
                    if opt.text.strip().lower() == gender_val.lower() or \
                       opt.text.strip().lower().startswith(gender_val.lower()):
                        sel.select_by_visible_text(opt.text.strip())
                        log.info(f"Gender set via partial match: {opt.text.strip()}")
                        matched = True
                        break
                if not matched:
                    # Strategy 3: JS select by index (Male usually index 1)
                    idx_map = {"male": 1, "female": 2, "transgender": 3}
                    idx = idx_map.get(gender_val.lower(), 1)
                    try:
                        sel.select_by_index(idx)
                        log.info(f"Gender set by index {idx} for '{gender_val}'")
                    except Exception:
                        log.warning(f"Gender '{gender_val}' not matched. Options: {opts_available}")

        except Exception as ex:
            log.warning(f"Gender (kaf_38) failed: {ex}")

    # Email ID — kaf_773
    em_val = r.get("email", "") or ""
    if em_val:
        js_set(d, "#kaf_773", em_val)

    # Address Type — kaf_112
    try:
        at = d.find_element(By.ID, "kaf_112")
        select_by_value_or_text(at, r.get("address_type", ""),
                                r.get("address_type_label", ""))
    except Exception: pass

    # Address Line 1 — kaf_107
    # Address Line 2 — kaf_108
    # Address Line 3 — kaf_109
    for field, aid in [("addr1", "kaf_107"), ("addr2", "kaf_108"), ("addr3", "kaf_109")]:
        val = r.get(field, "") or ""
        if val:
            js_set(d, f"#{aid}", val)

    # State — kaf_822
    try:
        state_el = d.find_element(By.ID, "kaf_822")
        select_by_value_or_text(state_el,
            r.get("state_code", ""), r.get("state_name", ""))
    except Exception: pass

    # City — kaf_113
    city_val = r.get("city", "") or ""
    if city_val:
        js_set(d, "#kaf_113", city_val)

    # Pincode — kaf_114
    pin_val = r.get("pincode", "") or ""
    if pin_val:
        js_set(d, "#kaf_114", pin_val)

    log.info("Individual Details filled.")


def fill_contacts(d, r):
    """
    Fill contact fields using actual CIBIL form IDs (from live page inspection).
    Contact slots (max 4):
      Slot 1: Type=kaf_58, Number=kaf_57
      Slot 2: Type=kaf_61, Number=kaf_60
      Slot 3: Type=kaf_64, Number=kaf_63
      Slot 4: Type=kaf_67, Number=kaf_66
    Note: Number fields are type="password" (masked) — js_set works fine.
    """
    contacts = r.get("contacts", [])
    if not contacts:
        return
    log.info(f"Filling {len(contacts)} contact(s)...")

    # Exact IDs from live page
    CONTACT_SLOTS = [
        ("kaf_58", "kaf_57"),   # slot 1: type, number
        ("kaf_61", "kaf_60"),   # slot 2
        ("kaf_64", "kaf_63"),   # slot 3
        ("kaf_67", "kaf_66"),   # slot 4
    ]

    for i, c in enumerate(contacts[:4]):
        c_type   = c.get("type",   "")
        c_number = c.get("number", "")
        type_id, num_id = CONTACT_SLOTS[i]

        # Fill contact type dropdown
        try:
            type_el = d.find_element(By.ID, type_id)
            sel = Select(type_el)
            try:
                sel.select_by_visible_text(c_type)
            except Exception:
                # Partial match fallback
                for opt in sel.options:
                    if c_type.lower() in opt.text.lower():
                        sel.select_by_visible_text(opt.text)
                        break
            log.info(f"Contact {i+1} type set: {c_type} (#{type_id})")
        except Exception as ex:
            log.warning(f"Contact {i+1} type (#{type_id}): {ex}")

        # Fill contact number (type=password — use js_set native setter)
        if c_number:
            if not js_set(d, f"#{num_id}", c_number):
                try:
                    num_el = d.find_element(By.ID, num_id)
                    safe_type(num_el, c_number)
                except Exception as ex:
                    log.warning(f"Contact {i+1} number (#{num_id}): {ex}")
            else:
                log.info(f"Contact {i+1} number filled: {c_number} (#{num_id})")


def fill_identifiers(d, r):
    """
    Fill identifier fields using actual CIBIL form IDs (from live page inspection).
    All identifier fields are type="password" (masked) — js_set native setter works.
      PAN           → kaf_40
      Aadhaar (UID) → kaf_50
      Voter ID      → kaf_44
      Passport      → kaf_42
      Driving Lic.  → kaf_46
      Ration Card   → kaf_48
    """
    log.info("Filling Identifiers...")

    # (record_field_key, actual_element_id)
    ID_MAP = [
        ("pan",         "kaf_40"),
        ("aadhaar",     "kaf_50"),
        ("voter_id",    "kaf_44"),
        ("passport",    "kaf_42"),
        ("dl_number",   "kaf_46"),
        ("ration_card", "kaf_48"),
    ]

    for field, elem_id in ID_MAP:
        val = (r.get(field) or "").strip()
        if not val:
            continue

        # Primary: JS native setter (fast, works on password type inputs)
        if js_set(d, f"#{elem_id}", val):
            log.info(f"Identifier '{field}' filled → #{elem_id} = {val}")
        else:
            # Fallback: direct element + send_keys
            try:
                el = d.find_element(By.ID, elem_id)
                if el.is_displayed():
                    safe_type(el, val)
                    log.info(f"Identifier '{field}' filled via send_keys → #{elem_id}")
                else:
                    log.warning(f"Identifier '{field}' (#{elem_id}) not visible — skipping")
            except Exception as ex:
                log.warning(f"Identifier '{field}' (#{elem_id}) fill failed: {ex}")


def fill_enquiry_details(d, r):
    log.info("Filling Enquiry Details...")

    # Include MFI/Grameen Score checkbox — kaf_2842
    try:
        grameen_el = d.find_element(By.ID, "kaf_2842")
        set_checkbox(grameen_el, bool(r.get("grameen_score", False)))
        log.info(f"Grameen/MFI checkbox (kaf_2842) set to: {r.get('grameen_score', False)}")
    except Exception as ex:
        log.warning(f"Grameen checkbox (kaf_2842): {ex}")

    # Consumer Score — search by label text first, then broad XPath fallback
    try:
        score_val = str(r.get("consumer_score", "30")).strip()
        cs_el = None

        # Strategy 1: Find via label text "consumer score"
        labels = d.find_elements(By.XPATH,
            "//label[contains(translate(normalize-space(.),"
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'consumer score')]")
        for lbl in labels:
            for_id = lbl.get_attribute("for") or ""
            if for_id:
                try:
                    cs_el = d.find_element(By.ID, for_id)
                    break
                except Exception:
                    pass
            if not cs_el:
                try:
                    cs_el = lbl.find_element(By.XPATH, "following::select[1]")
                    break
                except Exception:
                    pass

        # Strategy 2: Broad XPath fallback
        if cs_el is None:
            sels = d.find_elements(By.XPATH,
                "//select[contains(@id,'consumer') or contains(@id,'score') or contains(@id,'Score')]")
            if sels:
                cs_el = sels[0]

        if cs_el:
            sel = Select(cs_el)
            matched_score = False

            # Match by value
            for opt in sel.options:
                if (opt.get_attribute("value") or "").strip() == score_val:
                    sel.select_by_value(score_val)
                    log.info(f"Consumer Score set by value: {score_val}")
                    matched_score = True
                    break

            # Match by key phrase in option text
            if not matched_score:
                key_phrases = {
                    "28": ["enhanced creditvision score with this report", "creditvision score"],
                    "29": ["personal loan score"],
                    "30": ["new to credit"],
                    "31": ["personal loan", "new to credit"],
                    "00": ["do not include"],
                }
                phrases = key_phrases.get(score_val, [])
                for phrase in phrases:
                    for opt in sel.options:
                        if phrase.lower() in opt.text.strip().lower():
                            sel.select_by_visible_text(opt.text)
                            log.info(f"Consumer Score set by text phrase '{phrase}': {opt.text}")
                            matched_score = True
                            break
                    if matched_score:
                        break

            if not matched_score:
                log.warning(f"Consumer Score '{score_val}' not matched — leaving default")
        else:
            log.warning("Consumer Score dropdown not found on page")
    except Exception as ex:
        log.warning(f"Consumer Score: {ex}")

    # Enquiry Purpose Category — kaf_2910
    # Note: record stores enq_category as "3" but portal option value is "3,1"
    # So we match by: exact value → prefix match (cat starts option) → label text
    cat_val   = str(r.get("enq_category",       "") or "").strip()
    cat_label = str(r.get("enq_category_label", "") or "").strip()
    try:
        cat_el = d.find_element(By.ID, "kaf_2910")
        sel = Select(cat_el)
        matched = False

        # Strategy 1: exact value match (e.g. "3,1" == "3,1")
        for opt in sel.options:
            opt_v = (opt.get_attribute("value") or "").strip()
            if cat_val and opt_v.lower() == cat_val.lower():
                sel.select_by_value(opt_v)
                matched = True
                log.info(f"Enquiry Category set by exact value: {opt_v} = {opt.text}")
                break

        # Strategy 2: prefix match — file has "3", portal has "3,1"
        if not matched and cat_val:
            for opt in sel.options:
                opt_v = (opt.get_attribute("value") or "").strip()
                if opt_v.startswith(cat_val + ",") or opt_v.startswith(cat_val + "|"):
                    sel.select_by_value(opt_v)
                    matched = True
                    log.info(f"Enquiry Category set by prefix match: '{cat_val}' → '{opt_v}' = {opt.text}")
                    break

        # Strategy 3: label text match
        if not matched and cat_label:
            for opt in sel.options:
                if cat_label.lower() in opt.text.strip().lower():
                    sel.select_by_visible_text(opt.text)
                    matched = True
                    log.info(f"Enquiry Category set by label: {opt.text}")
                    break

        if matched:
            time.sleep(3.0)   # wait longer for kaf_7 AJAX to load
        else:
            log.warning(f"Enquiry Category '{cat_val}' / '{cat_label}' not matched in kaf_2910")
    except Exception as ex:
        log.warning(f"Enquiry Category (kaf_2910): {ex}")

    # Enquiry Purpose — kaf_7 (AJAX-loaded after category; retry 3x with 2s gap)
    purpose_val = str(r.get("enq_purpose", "") or "").strip()
    if purpose_val:
        matched_purpose = False
        for attempt in range(3):
            time.sleep(2.0)
            try:
                purpose_el = d.find_element(By.ID, "kaf_7")
                sel = Select(purpose_el)
                # Skip if only default "--Select--" option present (not loaded yet)
                real_opts = [o for o in sel.options if (o.get_attribute("value") or "").strip()]
                if not real_opts:
                    log.info(f"Enquiry Purpose options not loaded yet (attempt {attempt+1}/3)...")
                    continue

                real_vals = [(o.get_attribute("value") or "").strip() for o in real_opts]
                log.info(f"Purpose options loaded (attempt {attempt+1}): {real_vals}")

                # Strategy 1: exact value match
                for opt in real_opts:
                    opt_v = (opt.get_attribute("value") or "").strip()
                    if opt_v == purpose_val:
                        sel.select_by_value(opt_v)
                        log.info(f"Enquiry Purpose set by value '{opt_v}' = {opt.text}")
                        matched_purpose = True
                        break

                # Strategy 2: partial text match
                if not matched_purpose:
                    for opt in real_opts:
                        opt_t = opt.text.strip()
                        if purpose_val.lower() in opt_t.lower() or opt_t.lower() in purpose_val.lower():
                            sel.select_by_visible_text(opt_t)
                            log.info(f"Enquiry Purpose set by text match: {opt_t}")
                            matched_purpose = True
                            break

                if matched_purpose:
                    break
                else:
                    log.warning(
                        f"Purpose value '{purpose_val}' NOT in loaded options: {real_vals} "
                        f"— regenerate .txt file from App1 with correct purpose selected"
                    )
                    break   # options are loaded but value doesn't exist — no point retrying

            except Exception as ex:
                log.warning(f"Enquiry Purpose attempt {attempt+1}: {ex}")

        if not matched_purpose:
            log.warning(f"Enquiry Purpose '{purpose_val}' could not be matched. Check App1 — regenerate the .txt file.")

    # Enquiry Amount — kaf_9
    amt_val = str(r.get("enq_amount", "") or "")
    if amt_val:
        if not js_set(d, "#kaf_9", amt_val):
            try:
                amt_el = d.find_element(By.ID, "kaf_9")
                safe_type(amt_el, amt_val)
                log.info(f"Amount filled via send_keys: {amt_val}")
            except Exception as ex:
                log.warning(f"Amount (kaf_9) fill failed: {ex}")

    # Member Reference Number (MRN) — kaf_136
    mrn_val = str(r.get("mrn", "") or "")
    if mrn_val:
        if js_set(d, "#kaf_136", mrn_val):
            log.info(f"MRN filled (kaf_136): {mrn_val}")
        else:
            try:
                mrn_el = d.find_element(By.ID, "kaf_136")
                safe_type(mrn_el, mrn_val)
                log.info(f"MRN filled via send_keys (kaf_136): {mrn_val}")
            except Exception as ex:
                log.warning(f"MRN (kaf_136) fill failed: {ex}")

    # BRN + CRN — try known patterns (fill only if present on page)
    brn_val = str(r.get("brn", "") or "")
    if brn_val:
        js_set(d, "input[id*='BRN'], input[id*='branchRef'], input[id*='brn'], input[name*='BRN']", brn_val)

    crn_val = str(r.get("crn", "") or "")
    if crn_val:
        js_set(d, "input[id*='CRN'], input[id*='centerRef'], input[id*='crn'], input[name*='CRN']", crn_val)

    # GST State — kaf_847
    try:
        gst_el = d.find_element(By.ID, "kaf_847")
        select_by_value_or_text(gst_el,
            r.get("gst_state_code", ""),
            r.get("gst_state_name", ""))
        log.info("GST State filled (kaf_847)")
    except Exception as ex:
        log.warning(f"GST State (kaf_847): {ex}")

    log.info("Enquiry Details filled.")


def submit_form(d):
    """
    Click the form submit button using multiple strategies.
    Returns (success: bool, alert_text: str|None).
    alert_text is set if CIBIL showed a validation alert.
    """
    log.info("Submitting form...")

    strategies = [
        (By.XPATH, "//*[self::button or self::input][@type='submit']"),
        (By.XPATH, "//button[contains(translate(normalize-space(text()),"
                   "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'submit')]"),
        (By.XPATH, "//input[@value='Submit' or @value='SUBMIT' or @value='submit']"),
        (By.XPATH, "//button[contains(@id,'submit') or contains(@id,'Submit') or contains(@id,'SUBMIT')]"),
        (By.XPATH, "//button[contains(@onclick,'submit') or contains(@onclick,'Submit')]"),
        (By.XPATH, "//a[contains(translate(text(),'SUBMIT','submit'),'submit')]"),
    ]

    for by, selector in strategies:
        try:
            btn = WebDriverWait(d, 5).until(EC.element_to_be_clickable((by, selector)))
            d.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
            time.sleep(0.4)
            btn.click()
            time.sleep(1)
            # Check if an alert appeared immediately after click
            alert_text = dismiss_alert(d, timeout=2)
            if alert_text:
                log.warning(f"Submit alert: {alert_text}")
                return False, alert_text
            time.sleep(2)
            log.info(f"Form submitted via: {selector[:60]}")
            return True, None
        except UnexpectedAlertPresentException as uae:
            alert_text = getattr(uae, 'alert_text', None) or str(uae)
            try: d.switch_to.alert.accept()
            except Exception: pass
            log.warning(f"UnexpectedAlert during submit: {alert_text}")
            return False, alert_text
        except Exception:
            continue

    # Last resort: JS form submit
    try:
        log.warning("Button not found — trying JS form.submit()...")
        d.execute_script(
            "var f = document.querySelector('form'); "
            "if(f) { f.submit(); } "
            "else { document.forms[0].submit(); }"
        )
        time.sleep(1)
        alert_text = dismiss_alert(d, timeout=2)
        if alert_text:
            return False, alert_text
        time.sleep(2)
        log.info("Form submitted via JS fallback.")
        return True, None
    except UnexpectedAlertPresentException as uae:
        alert_text = getattr(uae, 'alert_text', None) or str(uae)
        try: d.switch_to.alert.accept()
        except Exception: pass
        return False, alert_text
    except Exception as ex:
        log.error(f"Submit failed (all strategies): {ex}")
        return False, None


def fill_cibil_form(record: dict):
    """
    Main function: navigate to CIBIL form and fill all sections.
    Returns (success: bool, message: str)
    """
    global login_status
    if login_status != "logged_in":
        return False, "Not logged in to CIBIL. Login first via /login endpoint or CIBIL_LAUNCHER.bat"
    try:
        d = get_driver()

        # Dismiss any stale alert before starting
        dismiss_alert(d, timeout=1)

        navigate_to_form(d)
        WebDriverWait(d, WAIT_TIMEOUT).until(
            EC.presence_of_element_located((By.TAG_NAME, "form"))
        )
        time.sleep(0.8)

        fill_individual_details(d, record)
        fill_contacts(d, record)
        fill_identifiers(d, record)
        fill_enquiry_details(d, record)

        # Check for any alert that appeared during field filling
        pre_alert = dismiss_alert(d, timeout=1)
        if pre_alert:
            log.warning(f"Alert before submit: {pre_alert}")

        submitted, alert_text = submit_form(d)

        # If submit triggered a validation alert, return it as the error
        if alert_text:
            return False, f"Validation error: {alert_text}"

        if not submitted:
            return False, "Form submit failed — no submit button found. Check browser."

        # Dismiss any alert that appeared after submit
        post_alert = dismiss_alert(d, timeout=2)
        if post_alert:
            return False, f"Validation error: {post_alert}"

        time.sleep(2)

        # Check page for success/error keywords
        try:
            page_src = d.page_source.lower()
        except UnexpectedAlertPresentException:
            pa = dismiss_alert(d, timeout=1)
            return False, f"Validation error: {pa or 'unknown alert'}"

        success_kw = ["success", "submitted", "thank you", "application number",
                      "report generated", "enquiry id"]
        error_kw   = ["error", "invalid", "mandatory", "required", "failed"]

        if any(k in page_src for k in success_kw):
            return True, "Form submitted successfully"
        elif any(k in page_src for k in error_kw):
            try:
                err_el = d.find_element(By.XPATH,
                    "//*[contains(@class,'error') or contains(@class,'alert') "
                    "or contains(@class,'validation')]")
                return False, err_el.text.strip()[:200]
            except Exception:
                return False, "Form may have validation errors – check browser"
        else:
            return True, "Form submitted (verify result in browser)"

    except UnexpectedAlertPresentException as uae:
        alert_text = getattr(uae, 'alert_text', None) or str(uae)
        try: d.switch_to.alert.accept()
        except Exception: pass
        log.error(f"UnexpectedAlert in fill_cibil_form: {alert_text}")
        return False, f"Validation error: {alert_text}"

    except Exception as ex:
        log.error(f"Form fill error: {ex}", exc_info=True)
        msg = str(ex).strip()
        if not msg:
            msg = type(ex).__name__ + " — check Flask server window for details"
        return False, msg


# ═════════════════════════════════════════════════════════════
#  REPORT DOWNLOAD
# ═════════════════════════════════════════════════════════════

def _configure_chrome_downloads(d):
    """Tell Chrome to save downloads to DOWNLOAD_DIR (CDP command)."""
    try:
        d.execute_cdp_cmd("Page.setDownloadBehavior", {
            "behavior":     "allow",
            "downloadPath": DOWNLOAD_DIR,
        })
    except Exception as ex:
        log.warning(f"CDP setDownloadBehavior: {ex}")


def download_cibil_report(d, name_hint: str = "", mrn_hint: str = "") -> tuple:
    """
    After CIBIL form submit, find and download the credit report.

    Strategy 1 — Click visible download / view report button on result page.
    Strategy 2 — Find any <a href="...pdf"> link.
    Strategy 3 — CDP Page.printToPDF (always works as fallback).

    Returns: (success: bool, filename_or_error: str)
    """
    _configure_chrome_downloads(d)

    ts = time.strftime("%Y%m%d_%H%M%S")
    safe_tag = re.sub(r"[^a-zA-Z0-9_-]", "_",
                      f"{name_hint}_{mrn_hint}".strip("_") or ts)

    # ── Snapshot of files before we click anything ────────────────
    existing_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*")))

    def _wait_for_new_download(timeout=45):
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(1)
            current = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*")))
            new = current - existing_files
            completed = [f for f in new if not f.endswith(".crdownload")]
            if completed:
                fname = os.path.basename(
                    sorted(completed, key=os.path.getmtime)[-1]
                )
                log.info(f"Download detected: {fname}")
                return fname
        return None

    # ── Strategy 1: Click download / view-report / print buttons ──
    lower = "translate(normalize-space(text())," \
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
    btn_xpaths = [
        f"//a[contains({lower},'download report')]",
        f"//button[contains({lower},'download report')]",
        f"//a[contains({lower},'download')]",
        f"//button[contains({lower},'download')]",
        f"//input[contains(translate(@value,'ABCDEFGHIJKLMNOPQRSTUVWXYZ',"
        f"'abcdefghijklmnopqrstuvwxyz'),'download')]",
        f"//a[contains({lower},'view report')]",
        f"//a[contains({lower},'print report')]",
        f"//button[contains({lower},'print')]",
        "//a[contains(@href,'.pdf')]",
        "//a[contains(@href,'report')]",
        "//a[contains(@href,'ccir')]",
        "//a[contains(@href,'download')]",
    ]

    for xpath in btn_xpaths:
        try:
            els = d.find_elements(By.XPATH, xpath)
            for el in els:
                if not el.is_displayed():
                    continue
                txt  = el.text.strip()
                href = el.get_attribute("href") or ""
                log.info(f"Trying download element: text='{txt}' href='{href[:80]}'")
                d.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
                time.sleep(0.3)
                d.execute_script("arguments[0].click();", el)
                time.sleep(2)
                fname = _wait_for_new_download(timeout=40)
                if fname:
                    return True, fname
                # New tab / window may have opened — switch & retry
                if len(d.window_handles) > 1:
                    d.switch_to.window(d.window_handles[-1])
                    time.sleep(1)
                    fname = _wait_for_new_download(timeout=20)
                    if fname:
                        return True, fname
                break  # tried one element from this xpath — move on
        except Exception:
            continue

    # ── Strategy 2: Find PDF URL and fetch via requests ───────────
    try:
        pdf_links = d.find_elements(By.XPATH, "//a[contains(@href,'.pdf')]")
        for link in pdf_links:
            href = link.get_attribute("href") or ""
            if href and ".pdf" in href.lower():
                try:
                    import urllib.request as _urlreq
                    fname = f"CIBIL_Report_{safe_tag}.pdf"
                    dest  = os.path.join(DOWNLOAD_DIR, fname)
                    _urlreq.urlretrieve(href, dest)
                    log.info(f"PDF fetched directly: {fname}")
                    return True, fname
                except Exception as fetch_ex:
                    log.warning(f"Direct PDF fetch failed: {fetch_ex}")
    except Exception:
        pass

    # ── Strategy 3: CDP Print-to-PDF (always works) ───────────────
    log.info("No download button found — using CDP Print-to-PDF fallback...")
    try:
        result = d.execute_cdp_cmd("Page.printToPDF", {
            "printBackground":   True,
            "preferCSSPageSize": True,
            "landscape":         False,
            "paperWidth":        8.27,   # A4
            "paperHeight":       11.69,
            "marginTop":         0.4,
            "marginBottom":      0.4,
            "marginLeft":        0.4,
            "marginRight":       0.4,
        })
        pdf_data = base64.b64decode(result["data"])
        fname    = f"CIBIL_Report_{safe_tag}.pdf"
        dest     = os.path.join(DOWNLOAD_DIR, fname)
        with open(dest, "wb") as fh:
            fh.write(pdf_data)
        log.info(f"Report saved via Print-to-PDF: {fname} ({len(pdf_data)} bytes)")
        return True, fname
    except Exception as ex:
        log.error(f"Print-to-PDF failed: {ex}")
        return False, f"Report download failed: {str(ex)[:120]}"


# ═════════════════════════════════════════════════════════════
#  FLASK ROUTES
# ═════════════════════════════════════════════════════════════

@app.route("/ping", methods=["GET"])
def ping():
    return jsonify({
        "status":        "ok",
        "message":       "CIBIL Automation Server running",
        "selenium":      SELENIUM_OK,
        "ai_provider":   "openai",
        "ai_ready":      OPENAI_OK,
        "api_key_set":   bool(OPENAI_API_KEY.strip()),
        "creds_set":     bool(CIBIL_USERNAME and CIBIL_PASSWORD),   # Bug 3 fix
        "login_status":  login_status
    })



@app.route("/set_api_key", methods=["POST"])
def set_api_key():
    """App1 Settings se OpenAI API key set karo (runtime mein)."""
    global OPENAI_API_KEY, OPENAI_OK
    data    = request.get_json(silent=True) or {}
    api_key = (data.get("api_key") or "").strip()

    if not api_key:
        return jsonify({"status": "error", "message": "API key khali hai"}), 400

    OPENAI_API_KEY = api_key
    try:
        import openai as _oai
        _oai.api_key = api_key
        OPENAI_OK    = True
    except Exception:
        OPENAI_OK    = False
    _save_config()
    log.info("OpenAI API key set via App1 Settings")
    return jsonify({"status": "ok", "message": "OpenAI API key set ho gaya! (disk mein bhi save)"})


@app.route("/get_api_status", methods=["GET"])
def get_api_status():
    """Browser ko batao OpenAI key saved hai ya nahi (key expose nahi hoti)."""
    okey = OPENAI_API_KEY.strip()
    return jsonify({
        "provider":          "openai",
        "openai_key_set":    bool(okey),
        "openai_key_hint":   ("sk-..." + okey[-6:]) if okey else "",
    })


@app.route("/test_api_key", methods=["POST"])
def test_api_key():
    """OpenAI API key test karo — model list endpoint pe cheapest request bheji jaati hai."""
    data    = request.get_json(silent=True) or {}
    api_key = (data.get("api_key") or "").strip()

    if not api_key:
        return jsonify({"status": "error", "message": "API key khali hai"}), 400

    try:
        import openai as _oai
        client = _oai.OpenAI(api_key=api_key)
        client.models.list()   # No tokens consumed — just auth check
        return jsonify({"status": "ok", "message": "OpenAI API key valid hai! Connection successful."})
    except _oai.AuthenticationError:
        return jsonify({"status": "error", "message": "Invalid API key — Authentication failed."}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": "Test fail: " + str(e)[:120]}), 500

@app.route("/login", methods=["POST"])
def do_login():
    """
    Start CIBIL login automation.
    Credentials come from JSON body; if omitted, saved credentials are used.
    Optionally saves credentials if save=true in body.

    Request body:
    { "username": "...", "password": "...", "save": true }
    """
    global login_status, login_message, login_thread, CIBIL_USERNAME, CIBIL_PASSWORD

    if not SELENIUM_OK:
        return jsonify({"status": "error",
                        "message": "selenium not installed"}), 500

    # Already logged in
    if login_status == "logged_in":
        return jsonify({"status": "logged_in",
                        "message": "Already logged in to CIBIL!"})

    # Already in progress
    if login_status in ("logging_in", "waiting_otp"):
        return jsonify({"status": login_status, "message": login_message})

    # session_expired → allow fresh login (same flow as not_started / error)

    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    save     = bool(data.get("save", False))

    # Fallback to saved credentials if not provided
    if not username and CIBIL_USERNAME:
        username = CIBIL_USERNAME
        log.info("Using saved CIBIL username from config")
    if not password and CIBIL_PASSWORD:
        password = CIBIL_PASSWORD
        log.info("Using saved CIBIL password from config")

    if not username:
        return jsonify({
            "status": "error",
            "message": "CIBIL username nahi diya aur save nahi tha. App2 mein username fill karein."
        }), 400

    if not password:
        return jsonify({
            "status": "error",
            "message": "CIBIL password nahi diya aur save nahi tha. App2 mein password fill karein."
        }), 400

    # Save credentials if requested
    if save:
        CIBIL_USERNAME = username
        CIBIL_PASSWORD = password
        _save_config()
        log.info("CIBIL credentials saved to config")

    login_status  = "logging_in"
    login_message = "Starting login process..."
    login_thread  = threading.Thread(
        target=_do_login_bg, args=(username, password), daemon=True
    )
    login_thread.start()

    saved_msg = " (credentials saved)" if save else ""
    return jsonify({"status": "logging_in", "message": f"Login started{saved_msg}. Chrome window will open."})


@app.route("/login_status", methods=["GET"])
def get_login_status():
    """Check current login status. Polled by App1 every 3 seconds."""
    return jsonify({
        "status":  login_status,
        "message": login_message
    })


@app.route("/save_cibil_creds", methods=["POST"])
def save_cibil_creds():
    """
    CIBIL username + password config mein save karo.
    Request body: { "username": "...", "password": "..." }
    """
    global CIBIL_USERNAME, CIBIL_PASSWORD
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not username:
        return jsonify({"status": "error", "message": "Username khali hai"}), 400
    if not password:
        return jsonify({"status": "error", "message": "Password khali hai"}), 400

    CIBIL_USERNAME = username
    CIBIL_PASSWORD = password
    _save_config()
    log.info(f"CIBIL credentials saved for user: {username}")
    return jsonify({"status": "ok", "message": f"Credentials save ho gaye! ({username})"})


@app.route("/get_saved_creds", methods=["GET"])
def get_saved_creds():
    """
    Saved CIBIL credentials return karo (password masked).
    """
    has_creds = bool(CIBIL_USERNAME and CIBIL_PASSWORD)
    return jsonify({
        "has_saved_creds": has_creds,
        "username":        CIBIL_USERNAME if CIBIL_USERNAME else "",
        "password_saved":  bool(CIBIL_PASSWORD),
        "password_hint":   ("*" * min(len(CIBIL_PASSWORD), 8)) if CIBIL_PASSWORD else "",
    })


@app.route("/clear_cibil_creds", methods=["POST"])
def clear_cibil_creds():
    """Saved CIBIL credentials delete karo."""
    global CIBIL_USERNAME, CIBIL_PASSWORD
    CIBIL_USERNAME = ""
    CIBIL_PASSWORD = ""
    _save_config()
    log.info("CIBIL credentials cleared")
    return jsonify({"status": "ok", "message": "Saved credentials delete ho gaye."})


@app.route("/login_reset", methods=["POST"])
def login_reset():
    """Reset login status (for retry)."""
    global login_status, login_message
    login_status  = "not_started"
    login_message = "Login reset. Call /login to start again."
    return jsonify({"status": "not_started"})


@app.route("/screenshot", methods=["GET"])
def get_screenshot():
    """Return current Chrome window screenshot as base64 PNG."""
    d = driver
    if not d:
        return jsonify({"status": "error", "message": "Browser open nahi hai"})
    try:
        img_b64 = d.get_screenshot_as_base64()
        return jsonify({"status": "ok", "image": img_b64})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})


@app.route("/fill_captcha", methods=["POST"])
def fill_captcha():
    """Fill CAPTCHA field in current browser page."""
    d = driver
    if not d:
        return jsonify({"status": "error", "message": "Browser open nahi hai"})
    data    = request.get_json(silent=True) or {}
    captcha = str(data.get("captcha", "")).strip()
    if not captcha:
        return jsonify({"status": "error", "message": "CAPTCHA value khali hai"})
    try:
        # Common CAPTCHA field selectors on CIBIL portal
        selectors = [
            (By.NAME, "captcha"), (By.ID, "captcha"),
            (By.NAME, "txtCaptcha"), (By.ID, "txtCaptcha"),
            (By.NAME, "CaptchaCode"), (By.ID, "CaptchaCode"),
            (By.CSS_SELECTOR, "input[placeholder*='captcha' i]"),
            (By.CSS_SELECTOR, "input[placeholder*='code' i]"),
            (By.CSS_SELECTOR, "input[name*='captcha' i]"),
            (By.CSS_SELECTOR, "input[id*='captcha' i]"),
        ]
        field = None
        for by, sel in selectors:
            try:
                el = d.find_element(by, sel)
                if el.is_displayed() and el.is_enabled():
                    field = el; break
            except Exception:
                continue
        if not field:
            return jsonify({"status": "error", "message": "CAPTCHA field nahi mila — screenshot check karo"})
        field.clear()
        field.send_keys(captcha)
        log.info(f"[CAPTCHA] Filled: {captcha}")
        return jsonify({"status": "ok", "message": "CAPTCHA fill ho gaya"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)[:120]})


@app.route("/reload_captcha", methods=["POST"])
def reload_captcha():
    """Click the CAPTCHA refresh/reload image on the page."""
    d = driver
    if not d:
        return jsonify({"status": "error", "message": "Browser open nahi hai"})
    try:
        reload_selectors = [
            (By.CSS_SELECTOR, "img[onclick*='captcha' i]"),
            (By.CSS_SELECTOR, "img[src*='captcha' i]"),
            (By.CSS_SELECTOR, "a[onclick*='captcha' i]"),
            (By.CSS_SELECTOR, "span[onclick*='captcha' i]"),
            (By.CSS_SELECTOR, "[id*='refresh' i]"),
            (By.CSS_SELECTOR, "[id*='reload' i]"),
            (By.CSS_SELECTOR, "[onclick*='refresh' i]"),
        ]
        for by, sel in reload_selectors:
            try:
                el = d.find_element(by, sel)
                if el.is_displayed():
                    el.click()
                    log.info(f"[CAPTCHA] Reload clicked: {sel}")
                    return jsonify({"status": "ok", "message": "CAPTCHA refresh ho gaya — screenshot dekho"})
            except Exception:
                continue
        return jsonify({"status": "error", "message": "CAPTCHA refresh button nahi mila"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)[:120]})


@app.route("/click_login_submit", methods=["POST"])
def click_login_submit():
    """Click the login/submit button on current page."""
    d = driver
    if not d:
        return jsonify({"status": "error", "message": "Browser open nahi hai"})
    try:
        selectors = [
            (By.CSS_SELECTOR, "input[type='submit']"),
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.NAME, "btnLogin"), (By.ID, "btnLogin"),
            (By.NAME, "btnSubmit"), (By.ID, "btnSubmit"),
            (By.CSS_SELECTOR, "button"),
        ]
        for by, sel in selectors:
            try:
                btns = d.find_elements(by, sel)
                for btn in btns:
                    txt = (btn.text or btn.get_attribute("value") or "").lower()
                    if btn.is_displayed() and any(k in txt for k in ["login","submit","verify","proceed","sign in","continue"]):
                        btn.click()
                        log.info(f"[SUBMIT] Clicked: '{btn.text}'")
                        return jsonify({"status": "ok", "message": "Button click ho gaya"})
            except Exception:
                continue
        return jsonify({"status": "error", "message": "Submit button nahi mila"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)[:120]})


@app.route("/submit_otp", methods=["POST"])
def submit_otp():
    """
    Accept OTP from browser UI and enter it into the CIBIL portal's OTP field.
    Called when login_status == 'waiting_otp' and user types OTP in App2.
    """
    global login_status, login_message
    if login_status != "waiting_otp":
        return jsonify({"status": "error", "message": f"OTP abhi expected nahi — current status: {login_status}"})

    data = request.get_json(silent=True) or {}
    otp  = str(data.get("otp", "")).strip()
    if not otp or not otp.isdigit():
        return jsonify({"status": "error", "message": "Valid numeric OTP daalo"})

    d = driver
    if not d:
        return jsonify({"status": "error", "message": "Browser open nahi hai — pehle Login karo"})

    try:
        # Try common OTP field selectors used by CIBIL portal
        otp_selectors = [
            (By.NAME,  "txtOTP"),
            (By.ID,    "txtOTP"),
            (By.NAME,  "otp"),
            (By.ID,    "otp"),
            (By.CSS_SELECTOR, "input[placeholder*='OTP' i]"),
            (By.CSS_SELECTOR, "input[placeholder*='otp' i]"),
            (By.CSS_SELECTOR, "input[type='text'][maxlength]"),
            (By.CSS_SELECTOR, "input[type='number']"),
            (By.CSS_SELECTOR, "input[type='tel']"),
        ]
        otp_field = None
        for by, sel in otp_selectors:
            try:
                el = d.find_element(by, sel)
                if el.is_displayed():
                    otp_field = el
                    log.info(f"[OTP] Field found: {by}={sel}")
                    break
            except Exception:
                continue

        if not otp_field:
            # Last resort: find any visible single-line text input on page
            inputs = d.find_elements(By.CSS_SELECTOR, "input:not([type='hidden']):not([type='password'])")
            for inp in inputs:
                try:
                    if inp.is_displayed() and inp.is_enabled():
                        otp_field = inp
                        log.info("[OTP] Field found via generic input fallback")
                        break
                except Exception:
                    continue

        if not otp_field:
            return jsonify({"status": "error", "message": "OTP field page pe nahi mila — manually check karo"})

        # Clear and enter OTP
        otp_field.clear()
        otp_field.send_keys(otp)
        log.info(f"[OTP] Entered OTP: {'*' * len(otp)}")

        # Try to submit — look for submit/verify button
        submit_selectors = [
            (By.CSS_SELECTOR, "input[type='submit']"),
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.CSS_SELECTOR, "button"),
            (By.NAME,  "btnSubmit"),
            (By.ID,    "btnSubmit"),
            (By.NAME,  "btnVerify"),
            (By.ID,    "btnVerify"),
        ]
        submitted = False
        for by, sel in submit_selectors:
            try:
                btns = d.find_elements(by, sel)
                for btn in btns:
                    txt = (btn.text or btn.get_attribute("value") or "").lower()
                    if btn.is_displayed() and any(k in txt for k in ["submit","verify","login","proceed","confirm","ok"]):
                        btn.click()
                        submitted = True
                        log.info(f"[OTP] Submit button clicked: '{btn.text}'")
                        break
                if submitted:
                    break
            except Exception:
                continue

        if not submitted:
            # Try pressing Enter as fallback
            from selenium.webdriver.common.keys import Keys as _Keys
            otp_field.send_keys(_Keys.RETURN)
            submitted = True
            log.info("[OTP] Submitted via Enter key")

        login_message = "OTP submit ho gaya — login verify ho raha hai..."
        return jsonify({"status": "ok", "message": "OTP submit ho gaya — thoda wait karo"})

    except Exception as e:
        log.error(f"[OTP] Submit error: {e}")
        return jsonify({"status": "error", "message": f"OTP submit error: {str(e)[:120]}"})


@app.route("/check_browser_login", methods=["GET"])
def check_browser_login():
    """
    Check if the Selenium Chrome window is currently on a logged-in CIBIL page.
    Called by App2 periodically so manual logins AND session expiries are auto-detected.

    - If browser shows login page and we were logged_in  → session expired → auto re-login
    - If browser shows logged-in page and we were not    → manual login detected
    """
    global login_status, login_message, login_thread
    try:
        d = get_driver()
        current_url    = d.current_url.lower()
        page_src_lower = d.page_source.lower()[:4000]  # only check first 4KB

        LOGIN_PAGE_SIGNALS = ["login.aspx", "txtusername", "sign in", "user id"]
        LOGGEDIN_SIGNALS   = [
            "losapp", "dcwebportal", "new application", "dashboard",
            "logout", "logoff", "enquiry", "welcome", "ccir"
        ]

        on_login_page = any(s in current_url or s in page_src_lower for s in LOGIN_PAGE_SIGNALS)
        on_loggedin   = any(s in current_url or s in page_src_lower for s in LOGGEDIN_SIGNALS)

        # ── Case 1: Session expired — was logged_in, now on login page ──────────
        if login_status == "logged_in" and on_login_page and not on_loggedin:
            log.warning(f"CIBIL session expired detected — URL: {d.current_url}")
            if CIBIL_USERNAME and CIBIL_PASSWORD:
                # Saved credentials available → auto re-login silently
                login_status  = "logging_in"
                login_message = "Session expire ho gayi — auto re-login shuru ho raha hai..."
                login_thread  = threading.Thread(
                    target=_do_login_bg, args=(CIBIL_USERNAME, CIBIL_PASSWORD), daemon=True
                )
                login_thread.start()
                log.info("Auto re-login thread started after session expiry")
            else:
                # No saved credentials — notify user to login manually
                login_status  = "session_expired"
                login_message = "CIBIL session expire ho gayi — App2 mein dobara login karein"
                log.warning("Session expired and no saved credentials — manual login required")

        # ── Case 2: Manual login detected — not logged in, browser shows logged-in page ──
        elif on_loggedin and not on_login_page and login_status not in ("logged_in", "logging_in", "waiting_otp"):
            login_status  = "logged_in"
            login_message = "CIBIL login detected (manual login confirmed)"
            log.info(f"Manual login detected at URL: {d.current_url}")

        return jsonify({
            "status":        login_status,
            "message":       login_message,
            "browser_url":   d.current_url,
            "on_login_page": on_login_page,
        })
    except Exception as ex:
        # Driver not available or crashed
        return jsonify({
            "status":      login_status,
            "message":     login_message,
            "browser_url": "",
            "error":       str(ex),
        })


@app.route("/scan_page_errors", methods=["GET"])
def scan_page_errors():
    """
    Scan current CIBIL page for validation/field errors.
    Returns list of error messages found on the page.
    """
    d = driver
    if not d:
        return jsonify({"errors": [], "message": "Browser not open"})
    try:
        errors = []
        # Common error element selectors on CIBIL portal
        error_selectors = [
            "[class*='error']:not(script)",
            "[class*='alert']:not(script)",
            "[class*='validation']:not(script)",
            "[class*='invalid']:not(script)",
            "[id*='error']:not(script)",
            "span[style*='color:red']",
            "span[style*='color: red']",
            "font[color='red']",
            ".field-validation-error",
            ".validation-summary-errors li",
        ]
        seen = set()
        for sel in error_selectors:
            try:
                els = d.find_elements(By.CSS_SELECTOR, sel)
                for el in els:
                    txt = el.text.strip()
                    if txt and len(txt) > 2 and txt.lower() not in seen:
                        seen.add(txt.lower())
                        errors.append(txt)
            except Exception:
                continue

        # Also check alert text
        try:
            alert = d.switch_to.alert
            txt = alert.text.strip()
            if txt and txt.lower() not in seen:
                errors.append(txt)
            alert.accept()
        except Exception:
            pass

        return jsonify({"errors": errors[:10], "page_url": d.current_url})
    except Exception as e:
        return jsonify({"errors": [], "message": str(e)[:120]})


@app.route("/preload_form", methods=["GET"])
def preload_form():
    """
    After login, navigate to the CIBIL enquiry form so it's ready.
    Call this once to pre-load the form page.
    """
    global login_status
    if login_status != "logged_in":
        return jsonify({"success": False, "message": "Not logged in"}), 400
    try:
        d = get_driver()
        current = d.current_url
        log.info(f"Preload form: current URL = {current}")
        return jsonify({"success": True, "url": current})
    except Exception as ex:
        return jsonify({"success": False, "message": str(ex)}), 500


@app.route("/extract_document", methods=["POST"])
def extract_document():
    """
    AI extraction endpoint.
    Accepts base64 Aadhaar/PAN image, returns structured JSON.

    Request body:
    {
      "type":          "aadhaar" | "pan" | "auto",
      "image_base64":  "data:image/jpeg;base64,/9j/...",
      "mime_type":     "image/jpeg"
    }
    """
    # ── Readiness check ──────────────────────────────────────────
    if not OPENAI_OK:
        return jsonify({"error": "openai library nahi mili. Run: pip install openai"}), 500
    if not OPENAI_API_KEY.strip():
        return jsonify({"error": "OpenAI API key set nahi hai. App1 → Settings mein key daalo aur Save karo."}), 500

    # Bug 4 fix: force=True prevents Flask returning HTML 415 on missing Content-Type
    data = request.get_json(silent=True, force=True)
    if not data:
        return jsonify({"error": "No JSON body received"}), 400

    doc_type  = data.get("type", "aadhaar").lower()
    img_b64   = data.get("image_base64", "")
    mime_type = data.get("mime_type", "image/jpeg")

    if not img_b64:
        return jsonify({"error": "image_base64 is required"}), 400
    if doc_type not in ("aadhaar", "pan", "auto"):
        return jsonify({"error": "type must be 'aadhaar', 'pan', or 'auto'"}), 400

    try:
        extracted = extract_with_ai(img_b64, mime_type, doc_type)
        log.info(f"Extraction done — fields found: {[k for k,v in extracted.items() if v]}")
        return jsonify(extracted), 200
    except Exception as ex:
        log.error(f"extract_document error: {ex}")
        return jsonify({"error": str(ex)}), 500


@app.route("/fill", methods=["POST"])
def fill():
    """Auto-fill CIBIL form with one record."""
    try:
        if not SELENIUM_OK:
            return jsonify({"success": False,
                            "error": "Selenium install nahi hai. Run: pip install selenium webdriver-manager"}), 500

        record = request.get_json()
        if not record:
            return jsonify({"success": False, "error": "Server ko koi data nahi mila (empty request)"}), 400

        # Pre-check: login status
        if login_status != "logged_in":
            friendly = {
                "not_started": "CIBIL portal mein login nahi kiya. App2 mein pehle Login karein.",
                "logging_in":  "Login abhi chal raha hai — thoda ruk kar retry karein.",
                "waiting_otp": "OTP awaited — Chrome window mein OTP bharein phir retry karein.",
                "failed":      f"Login fail hua: {login_message} — App2 mein dobara Login karein.",
            }
            err_msg = friendly.get(login_status,
                      f"Login status: {login_status} — App2 mein CIBIL login karein.")
            return jsonify({"success": False, "error": err_msg, "login_status": login_status}), 403

        name = f"{record.get('first_name','')} {record.get('last_name','')}".strip()
        log.info(f"Fill request: {name} | MRN: {record.get('mrn')}")

        success, message = fill_cibil_form(record)
        err_msg = (message.strip() or "Form fill fail hua — Flask server window mein error dekhen") if not success else None
        return jsonify({
            "success": success,
            "message": message if success else None,
            "error":   err_msg,
            "name":    name,
            "mrn":     record.get("mrn")
        }), 200 if success else 500

    except Exception as ex:
        log.error(f"/fill unhandled error: {ex}", exc_info=True)
        return jsonify({"success": False,
                        "error": f"Server exception: {type(ex).__name__}: {str(ex)[:200]}"}), 500


@app.route("/fill_bulk", methods=["POST"])
def fill_bulk():
    """Auto-fill CIBIL form for multiple records."""
    if not SELENIUM_OK:
        return jsonify({"success": False, "error": "selenium not installed"}), 500

    # Bug 1 fix: guard login — same check as /fill, return 403 not silent 200
    if login_status != "logged_in":
        friendly = {
            "not_started": "CIBIL portal mein login nahi kiya. App2 mein pehle Login karein.",
            "logging_in":  "Login abhi chal raha hai — thoda ruk kar retry karein.",
            "waiting_otp": "OTP awaited — Chrome window mein OTP bharein phir retry karein.",
            "failed":      f"Login fail hua: {login_message} — App2 mein dobara Login karein.",
        }
        err_msg = friendly.get(login_status,
                  f"Login status: {login_status} — App2 mein CIBIL login karein.")
        return jsonify({"success": False, "error": err_msg, "login_status": login_status}), 403

    records = request.get_json(silent=True, force=True)
    if not isinstance(records, list):
        return jsonify({"success": False, "error": "Expected a JSON array"}), 400

    results = []
    for i, rec in enumerate(records):
        name = f"{rec.get('first_name','')} {rec.get('last_name','')}".strip()
        log.info(f"Bulk record {i+1}/{len(records)}: {name}")
        success, message = fill_cibil_form(rec)
        results.append({
            "index":   i + 1,
            "name":    name,
            "mrn":     rec.get("mrn"),
            "success": success,
            "message": message
        })
        if i < len(records) - 1:
            time.sleep(1.5)

    ok = sum(1 for r in results if r["success"])
    return jsonify({
        "total":         len(results),
        "success_count": ok,
        "failed_count":  len(results) - ok,
        "results":       results
    })


@app.route("/download_report", methods=["POST"])
def download_report_endpoint():
    """
    Download CIBIL report from the current browser page.
    Call this AFTER a successful /fill — browser should be on the result page.

    Request body (optional): { "name": "RAVI KUMAR", "mrn": "MRN001" }
    Response: { "success": true, "filename": "CIBIL_Report_...pdf", "url": "/reports/..." }
    """
    global login_status
    if login_status != "logged_in":
        return jsonify({"success": False, "error": "Not logged in to CIBIL"}), 403

    try:
        d = get_driver()
    except Exception as ex:
        return jsonify({"success": False, "error": f"Browser not available: {ex}"}), 500

    data      = request.get_json(silent=True) or {}
    name_hint = re.sub(r"\s+", "_", (data.get("name") or "").strip())[:30]
    mrn_hint  = re.sub(r"[^a-zA-Z0-9_-]", "_", (data.get("mrn") or "").strip())[:20]

    log.info(f"/download_report called — name='{name_hint}', mrn='{mrn_hint}'")
    success, result = download_cibil_report(d, name_hint, mrn_hint)

    if success:
        return jsonify({
            "success":  True,
            "filename": result,
            "url":      f"/reports/{result}",
            "message":  f"Report download ho gaya: {result}",
        })
    else:
        return jsonify({"success": False, "error": result}), 500


@app.route("/reports/<path:filename>", methods=["GET"])
def serve_report(filename):
    """Serve a downloaded CIBIL report PDF."""
    try:
        return send_from_directory(DOWNLOAD_DIR, filename, as_attachment=True)
    except Exception as ex:
        return jsonify({"error": str(ex)}), 404


@app.route("/list_reports", methods=["GET"])
def list_reports():
    """List all downloaded CIBIL reports in the reports/ folder."""
    try:
        files = []
        for fpath in sorted(glob.glob(os.path.join(DOWNLOAD_DIR, "*")),
                            key=os.path.getmtime, reverse=True):
            fname = os.path.basename(fpath)
            if fname.endswith(".crdownload"):
                continue
            stat = os.stat(fpath)
            files.append({
                "filename":  fname,
                "url":       f"/reports/{fname}",
                "size_kb":   round(stat.st_size / 1024, 1),
                "modified":  time.strftime("%d %b %Y %H:%M",
                                           time.localtime(stat.st_mtime)),
            })
        return jsonify({"reports": files, "count": len(files),
                        "dir": DOWNLOAD_DIR})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 500


@app.route("/delete_report", methods=["POST"])
def delete_report():
    """Delete a single report file."""
    data     = request.get_json(silent=True) or {}
    filename = (data.get("filename") or "").strip()
    if not filename or "/" in filename or "\\" in filename:
        return jsonify({"error": "Invalid filename"}), 400
    fpath = os.path.join(DOWNLOAD_DIR, filename)
    if os.path.exists(fpath):
        os.remove(fpath)
        log.info(f"Report deleted: {filename}")
        return jsonify({"success": True})
    return jsonify({"error": "File not found"}), 404


@app.route("/close_browser", methods=["POST"])
def close_browser():
    """Close browser window."""
    global driver, login_status, login_message
    if driver:
        try: driver.quit()
        except Exception: pass
        driver = None
    login_status  = "not_started"
    login_message = "Browser closed. Login again to continue."
    return jsonify({"message": "Browser closed"})


@app.route("/status", methods=["GET"])
def status():
    """Server and browser status."""
    global driver
    browser_open = False
    current_url  = ""
    if driver:
        try:
            current_url  = driver.current_url
            browser_open = True
        except Exception:
            driver = None
    return jsonify({
        "server":       "running",
        "selenium":     SELENIUM_OK,
        "browser_open": browser_open,
        "current_url":  current_url,
        "login_status": login_status,
        "login_message": login_message
    })


# ═════════════════════════════════════════════════════════════
#  MAIN
# ═════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys
    # Windows console UTF-8 fix
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    if AI_PROVIDER == "openai":
        ai_lib_ok  = OPENAI_OK
        api_key_ok = bool(OPENAI_API_KEY.strip())
        ai_label   = "OpenAI GPT-4o"
        key_url    = "https://platform.openai.com/api-keys"
    else:
        ai_lib_ok  = ANTHROPIC_OK
        api_key_ok = bool(ANTHROPIC_API_KEY.strip())
        ai_label   = "Anthropic Claude"
        key_url    = "https://console.anthropic.com/"

    print("=" * 65)
    print("  CIBIL Automation Server  -  http://localhost:5000")
    print("=" * 65)
    print(f"  AI Provider        : {ai_label}")
    print(f"  AI Library         : {'OK' if ai_lib_ok else 'NOT INSTALLED'}")
    print(f"  API Key set        : {'YES' if api_key_ok else 'NO  <-- App1 Settings mein daalen'}")
    print(f"  Selenium           : {'OK' if SELENIUM_OK else 'NOT INSTALLED'}")
    print(f"  CIBIL Username     : {CIBIL_USERNAME if CIBIL_USERNAME else '(not saved yet)'}")
    print(f"  CIBIL Password     : {'(saved)' if CIBIL_PASSWORD else '(not saved yet)'}")
    print(f"  Headless mode      : {HEADLESS}")
    print()
    print("  Routes:")
    print("    GET  /ping                - Health check")
    print("    POST /login               - CIBIL login (credentials saved if save=true)")
    print("    GET  /login_status        - Login status check")
    print("    POST /login_reset         - Reset login state")
    print("    GET  /get_saved_creds     - Return saved CIBIL credentials")
    print("    POST /save_cibil_creds    - Save CIBIL username+password")
    print("    POST /clear_cibil_creds   - Delete saved credentials")
    print("    POST /extract_document    - AI extract Aadhaar/PAN image")
    print("    POST /fill                - Auto-fill CIBIL form (1 record)")
    print("    POST /fill_bulk           - Auto-fill CIBIL form (many records)")
    print("    GET  /preload_form        - Pre-navigate to form")
    print("    POST /download_report     - Download CIBIL report from browser")
    print("    GET  /reports/<file>      - Serve a downloaded report PDF")
    print("    GET  /list_reports        - List all downloaded reports")
    print("    POST /delete_report       - Delete a report file")
    print(f"    Reports saved to: reports/")
    print("    POST /close_browser       - Close browser")
    print("    GET  /status              - Full status")
    print()
    if not api_key_ok:
        print(f"  [!] API key nahi hai — App1 > Settings mein set karein")
        print(f"      Key milegi: {key_url}")
        print()
    if not CIBIL_USERNAME:
        print("  [!] CIBIL credentials save nahi hain — App2 mein login karte waqt")
        print("      'Credentials yaad rakho' checkbox tick karein.")
        print()
    print("  Press Ctrl+C to stop")
    print("=" * 65)
    _port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=_port, debug=False)
