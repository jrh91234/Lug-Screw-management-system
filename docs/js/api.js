/**
 * API Layer - Communicates with Google Apps Script Backend
 * Uses GET for ALL requests to avoid CORS issues with Google Apps Script
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
    const payload = JSON.stringify({ action, token, ...data });

    // Always use GET with payload parameter to avoid CORS issues
    const query = new URLSearchParams({ payload: payload });
    const url = this.BASE_URL + '?' + query.toString();

    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) throw new Error('Network error');
    return resp.json();
  }
};

API.init();
