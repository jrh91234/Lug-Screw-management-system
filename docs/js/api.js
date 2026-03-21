/**
 * API Layer - Communicates with Google Apps Script Backend
 */

const API = {
  // Set this to your Google Apps Script Web App URL after deployment
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
    const body = JSON.stringify({ action, token, ...data });

    const resp = await fetch(this.BASE_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: body
    });
    if (!resp.ok) throw new Error('Network error');
    return resp.json();
  }
};

API.init();
