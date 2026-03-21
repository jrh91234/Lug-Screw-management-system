/**
 * API Layer - Communicates with Google Apps Script Backend
 * Supports GET fallback for POST actions (CORS workaround)
 */

const API = {
  BASE_URL: '',

  init() {
    const saved = localStorage.getItem('h1_api_url');
    if (saved) this.BASE_URL = saved;
  },

  setBaseUrl(url) {
    this.BASE_URL = url.replace(/\/$/, '');
    localStorage.setItem('h1_api_url', this.BASE_URL);
  },

  getBaseUrl() {
    return this.BASE_URL;
  },

  async get(action, params) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const query = new URLSearchParams({ action, token, ...params });
    const url = this.BASE_URL + '?' + query.toString();

    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) throw new Error('Network error');
    return resp.json();
  },

  async post(action, data) {
    if (!this.BASE_URL) throw new Error('API URL not configured');
    const token = Auth.getToken();
    const payload = { action, token, ...data };

    // Try POST first
    try {
      const resp = await fetch(this.BASE_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result !== null && result !== undefined) return result;
      }
    } catch (e) {
      // POST failed (CORS/redirect issue), fall back to GET
    }

    // Fallback: send POST data via GET with payload parameter
    const query = new URLSearchParams({ payload: JSON.stringify(payload) });
    const resp = await fetch(this.BASE_URL + '?' + query.toString(), { redirect: 'follow' });
    if (!resp.ok) throw new Error('Network error');
    return resp.json();
  }
};

API.init();
