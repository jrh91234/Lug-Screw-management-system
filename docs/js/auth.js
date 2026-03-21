/**
 * Authentication & Session Management
 */

const Auth = {
  getToken() {
    return localStorage.getItem('h1_token') || '';
  },

  setToken(token) {
    localStorage.setItem('h1_token', token);
  },

  getUser() {
    const str = localStorage.getItem('h1_user');
    return str ? JSON.parse(str) : null;
  },

  setUser(user) {
    localStorage.setItem('h1_user', JSON.stringify(user));
  },

  isLoggedIn() {
    return !!this.getToken() && !!this.getUser();
  },

  hasRole(minRole) {
    const user = this.getUser();
    if (!user) return false;
    const hierarchy = { operator: 1, maintenance: 2, supervisor: 3, admin: 4 };
    return (hierarchy[user.role] || 0) >= (hierarchy[minRole] || 0);
  },

  logout() {
    const token = this.getToken();
    if (token && API.getBaseUrl()) {
      API.post('logout').catch(() => {});
    }
    localStorage.removeItem('h1_token');
    localStorage.removeItem('h1_user');
    window.location.href = 'index.html';
  },

  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  },

  requireRole(role) {
    if (!this.requireAuth()) return false;
    if (!this.hasRole(role)) {
      UI.showToast('ไม่มีสิทธิ์เข้าถึงหน้านี้', 'error');
      setTimeout(() => { window.location.href = 'pages/production.html'; }, 1500);
      return false;
    }
    return true;
  }
};
