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

  async get(action, params) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const query = new URLSearchParams({ action, token, _ts: String(Date.now()), ...params });
    const url = this.BASE_URL + '?' + query.toString();

    const resp = await fetch(url, { redirect: 'follow', cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) throw new Error('Network error');
    const result = await resp.json();
    return this._handleSessionExpiry(result);
  },

  async post(action, data) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const payload = JSON.stringify({ action, token, _ts: Date.now(), ...data });

    // Always use GET with payload parameter to avoid CORS issues
    const query = new URLSearchParams({ payload: payload, _ts: String(Date.now()) });
    const url = this.BASE_URL + '?' + query.toString();

    const resp = await fetch(url, { redirect: 'follow', cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) throw new Error('Network error');
    const result = await resp.json();
    return this._handleSessionExpiry(result);
  },

  // POST with large payload (for images) - uses actual POST with text/plain to avoid CORS preflight
  async postLarge(action, data) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const payload = JSON.stringify({ action, token, ...data });

    try {
      const resp = await fetch(this.BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit'
      });
      return resp.json();
    } catch (e) {
      // Fallback: try GET method (for smaller payloads)
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
