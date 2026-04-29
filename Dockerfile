# ─────────────────────────────────────────────────────────
#  CIBIL Automation Server — Docker Image
#  Includes: Python 3.11 + Chromium + ChromeDriver
# ─────────────────────────────────────────────────────────
FROM python:3.11-slim

# Install Chromium + system dependencies for Selenium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Create reports directory in /tmp (writable in all cloud environments)
RUN mkdir -p /tmp/cibil_reports

# ── Environment defaults (override via cloud dashboard) ──
ENV PYTHONUNBUFFERED=1
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV HEADLESS=true
ENV DOWNLOAD_DIR=/tmp/cibil_reports
ENV PORT=5000

EXPOSE 5000

CMD ["python", "cibil_automation.py"]
