/**
 * API Layer - Communicates with Google Apps Script Backend
 * Uses GET for ALL requests to avoid CORS issues with Google Apps Script
 */

const API = {
  // Default API URL (Google Apps Script Web App)
  DEFAULT_URL: 'https://script.google.com/macros/s/AKfycbwkIt4jIc2xGey4SsZqhcx5weEX533VzsDhRHFT78ah038x8KvU6v30IlKjgOvGdBFK0g/exec',
  BASE_URL: '',

  init() {
    // Always use DEFAULT_URL unless admin explicitly overrides
    const saved = localStorage.getItem('h1_api_url');
    if (saved && saved !== this.DEFAULT_URL) {
      // Clear old/invalid URLs, use default
      localStorage.removeItem('h1_api_url');
    }
    this.BASE_URL = this.DEFAULT_URL;
  },

  setBaseUrl(url) {
    this.BASE_URL = url.replace(/\/$/, '');
    localStorage.setItem('h1_api_url', this.BASE_URL);
  },

  getBaseUrl() {
    return this.BASE_URL;
  },

  _handleSessionExpiry(result) {
    if (result && result.success === false && result.message === 'กรุณาเข้าสู่ระบบใหม่') {
      Auth.logout();
    }
    return result;
  },

  // Apps Script never serves the response body from /exec itself: it answers with
  // a one-shot redirect to script.googleusercontent.com/macros/echo?user_content_key=...
  // and that second hop is flaky. It intermittently comes back 404, or the
  // connection is closed mid-flight (ERR_CONNECTION_CLOSED), even though the
  // script ran fine and the data is there. Because the failing hop carries no
  // Access-Control-Allow-Origin header, the browser reports it as a CORS error,
  // which makes it look like a deployment problem when it is just a transient one.
  //
  // The echo URL is single-use, so the only way to recover is to replay the whole
  // request. Read requests are idempotent, so they retry with exponential backoff.
  GET_RETRIES: 3,
  RETRY_BASE_MS: 500,

  // A hung request is worse than a failed one: the same redirect hop can also
  // stall instead of erroring, and fetch() has no built-in timeout, so the
  // promise never settles and the caller's spinner spins forever. Every request
  // gets an abort deadline so it always ends in either data or a real error.
  TIMEOUT_MS: 20000,

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  async _fetchWithTimeout(url, init, timeoutMs) {
    if (!timeoutMs || typeof AbortController === 'undefined') {
      return fetch(url, init);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  },

  async _fetchJson(url, init, retries, timeoutMs) {
    const attempts = (retries || 0) + 1;
    const deadline = timeoutMs === undefined ? this.TIMEOUT_MS : timeoutMs;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter so a page firing several requests does
        // not line them all up on the same retry tick.
        await this._sleep(this.RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250));
      }
      try {
        // Vary the URL per attempt: a replay must never be served from cache, and
        // it must mint a fresh redirect instead of reusing the spent echo link.
        const attemptUrl = attempt === 0 ? url : url + '&_retry=' + attempt;
        const resp = await this._fetchWithTimeout(attemptUrl, init, deadline);
        if (!resp.ok) throw new Error('Network error');
        return await resp.json();
      } catch (err) {
        lastError = (err && err.name === 'AbortError')
          ? new Error('หมดเวลาเชื่อมต่อ server')
          : err;
      }
    }
    throw lastError || new Error('Network error');
  },

  async get(action, params) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const query = new URLSearchParams({ action, token, _ts: String(Date.now()), ...params });
    const url = this.BASE_URL + '?' + query.toString();

    const result = await this._fetchJson(
      url,
      { redirect: 'follow', cache: 'no-store', credentials: 'omit' },
      this.GET_RETRIES
    );
    return this._handleSessionExpiry(result);
  },

  // options.retries — only pass a non-zero value for actions that are safe to
  // replay (login re-issues a session token, nothing else changes).
  // options.timeoutMs — override the default abort deadline.
  async post(action, data, options) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const opts = options || {};
    const token = Auth.getToken();
    const payload = JSON.stringify({ action, token, _ts: Date.now(), ...data });

    // Always use GET with payload parameter to avoid CORS issues
    const query = new URLSearchParams({ payload: payload, _ts: String(Date.now()) });
    const url = this.BASE_URL + '?' + query.toString();

    // No automatic retry by default: these are writes tunnelled over GET, and a
    // failed fetch does not tell us whether the script already ran. Callers that
    // need resilience send a clientRequestId so the server can dedupe the replay.
    const result = await this._fetchJson(
      url,
      { redirect: 'follow', cache: 'no-store', credentials: 'omit' },
      opts.retries || 0,
      opts.timeoutMs
    );
    return this._handleSessionExpiry(result);
  },

  // POST with large payload (for images) - uses actual POST with text/plain to avoid CORS preflight
  async postLarge(action, data) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const payload = JSON.stringify({ action, token, ...data });

    try {
      const resp = await this._fetchWithTimeout(this.BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit'
      }, this.TIMEOUT_MS);
      if (!resp.ok) throw new Error('Network error');
      const result = await resp.json();
      return this._handleSessionExpiry(result);
    } catch (e) {
      // Fallback: try GET method (for smaller payloads).
      // NOTE: the POST may have already reached the server even though the fetch
      // failed (Apps Script redirect/CORS), so submit actions MUST include an
      // idempotency key (e.g. clientRequestId) for the server to dedupe.
      return this.post(action, data);
    }
  },

  // Prepare an image for Drive OCR in a SINGLE encode pass:
  // resize (higher cap), grayscale + mild contrast stretch, encode once at high quality.
  // Avoids the double-JPEG compression that previously blurred text and hurt OCR accuracy.
  prepareOcrImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.92;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          let w = img.width, h = img.height;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.round(w * scale);
          h = Math.round(h * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          try {
            const imageData = ctx.getImageData(0, 0, w, h);
            const d = imageData.data;
            const contrast = 1.25;
            const intercept = 128 * (1 - contrast);
            for (let i = 0; i < d.length; i += 4) {
              let g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
              g = g * contrast + intercept;
              d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : (g > 255 ? 255 : g);
            }
            ctx.putImageData(imageData, 0, 0);
          } catch (err) {
            // getImageData can throw on tainted canvas — fall back to plain resize
          }
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('โหลดรูปไม่สำเร็จ'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  },

  // Compress image file to target size, returns base64 string
  compressImage(file, maxWidth, maxHeight, quality) {
    maxWidth = maxWidth || 800;
    maxHeight = maxHeight || 800;
    quality = quality || 0.6;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
          if (h > maxHeight) { w = w * maxHeight / h; h = maxHeight; }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};

API.init();
