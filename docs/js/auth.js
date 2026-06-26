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
    const hierarchy = { viewer: 0, operator: 1, maintenance: 2, supervisor: 3, admin: 4 };
    return (hierarchy[user.role] || 0) >= (hierarchy[minRole] || 0);
  },

  // Default permissions by role (must match backend)
  _roleDefaults: {
    viewer:      { production: false, inbox: true, maintenance: false, rawmaterial: false, machines: false, dashboard: true,  admin: false, cost: false, waste: false, sorting: false, alarm: false, ngExport: false },
    operator:    { production: true,  inbox: true, maintenance: true, rawmaterial: false, machines: true, dashboard: false, admin: false, cost: false, waste: true, sorting: true,  alarm: true,  ngExport: false },
    maintenance: { production: true,  inbox: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: false, admin: false, cost: false, waste: true, sorting: true,  alarm: true,  ngExport: false },
    supervisor:  { production: true,  inbox: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: true,  admin: false, cost: true,  waste: true, sorting: true,  alarm: true,  ngExport: true  },
    admin:       { production: true,  inbox: true, maintenance: true, rawmaterial: true,  machines: true, dashboard: true,  admin: true, cost: true,  waste: true, sorting: true,  alarm: true,  ngExport: true  }
  },

  getHomePage() {
    const order = ['dashboard', 'production', 'maintenance', 'rawmaterial', 'machines', 'admin'];
    const firstAllowed = order.find(page => this.hasPermission(page));
    return firstAllowed || 'production';
  },

  // Check if current user has permission for a specific page
  hasPermission(page) {
    const user = this.getUser();
    if (!user) return false;
    if (page === 'inbox') return true;
    // Check user's permissions object first
    const defaults = this._roleDefaults[user.role] || this._roleDefaults.operator;
    if (user.permissions && typeof user.permissions === 'object' && Object.keys(user.permissions).length > 0) {
      if (Object.prototype.hasOwnProperty.call(user.permissions, page)) {
        return !!user.permissions[page];
      }
      // If key is missing in old saved permissions, fallback to role default
      return !!defaults[page];
    }
    return !!defaults[page];
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
        const home = this.getHomePage();
        window.location.href = isInPages ? (home + '.html') : ('pages/' + home + '.html');
      }, 1500);
      return false;
    }
    return true;
  },

  requireRole(role) {
    if (!this.requireAuth()) return false;
    if (!this.hasRole(role)) {
      UI.showToast('ไม่มีสิทธิ์เข้าถึงหน้านี้', 'error');
      setTimeout(() => {
        const home = this.getHomePage();
        window.location.href = 'pages/' + home + '.html';
      }, 1500);
      return false;
    }
    return true;
  }
};
