/**
 * Authentication & Session Management
 * Supports per-user permissions
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

  // Check if current user has permission for a specific page
  hasPermission(page) {
    const user = this.getUser();
    if (!user) return false;
    // Admin always has all permissions
    if (user.role === 'admin') return true;
    // Check user's permissions object
    if (user.permissions && typeof user.permissions === 'object') {
      return !!user.permissions[page];
    }
    // Fallback to role-based defaults
    return this.hasRole(page === 'dashboard' ? 'supervisor' : 'operator');
  },

  // Get all permissions for current user
  getPermissions() {
    const user = this.getUser();
    if (!user) return {};
    return user.permissions || {};
  },

  logout() {
    const token = this.getToken();
    if (token && API.getBaseUrl()) {
      API.post('logout').catch(() => {});
    }
    localStorage.removeItem('h1_token');
    localStorage.removeItem('h1_user');
    const isInPages = window.location.pathname.includes('/pages/');
    window.location.href = isInPages ? '../index.html' : 'index.html';
  },

  requireAuth() {
    if (!this.isLoggedIn()) {
      const isInPages = window.location.pathname.includes('/pages/');
      window.location.href = isInPages ? '../index.html' : 'index.html';
      return false;
    }
    return true;
  },

  // Check permission for a specific page, redirect if not allowed
  requirePermission(page) {
    if (!this.requireAuth()) return false;
    if (!this.hasPermission(page)) {
      UI.showToast('คุณไม่มีสิทธิ์เข้าถึงหน้านี้', 'error');
      setTimeout(() => {
        const isInPages = window.location.pathname.includes('/pages/');
        window.location.href = isInPages ? 'production.html' : 'pages/production.html';
      }, 1500);
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
