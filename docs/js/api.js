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
