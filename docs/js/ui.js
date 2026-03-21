/**
 * UI Utilities - Toast, Loading, Navigation, Device Detection
 */

const UI = {
  isDesktop() {
    return window.innerWidth >= 768;
  },

  isMobile() {
    return window.innerWidth < 768;
  },

  applyDeviceClass() {
    document.body.classList.toggle('is-desktop', this.isDesktop());
    document.body.classList.toggle('is-mobile', this.isMobile());
  },

  showToast(message, type = 'success') {
    const icons = {
      success: 'bi-check-circle-fill',
      error: 'bi-x-circle-fill',
      warning: 'bi-exclamation-triangle-fill',
      info: 'bi-info-circle-fill'
    };

    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML =
      '<i class="bi ' + (icons[type] || icons.info) + '"></i>' +
      '<span>' + message + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },

  showLoading(text) {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = '<div class="spinner"></div><div class="loading-text">' + (text || 'กำลังโหลด...') + '</div>';
      document.body.appendChild(overlay);
    }
    overlay.classList.add('show');
  },

  hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('show');
  },

  renderNav(activePage) {
    this.applyDeviceClass();
    const user = Auth.getUser();
    const role = user ? user.role : 'operator';

    const items = [
      { page: 'pages/production.html', icon: 'bi-clipboard-data', label: 'กรอกยอด', id: 'production' },
      { page: 'pages/maintenance.html', icon: 'bi-wrench', label: 'แจ้งซ่อม', id: 'maintenance' },
      { page: 'pages/machines.html', icon: 'bi-gear', label: 'เครื่องจักร', id: 'machines' }
    ];

    if (role === 'supervisor' || role === 'admin') {
      items.push({ page: 'pages/dashboard.html', icon: 'bi-graph-up', label: 'Dashboard', id: 'dashboard' });
    }
    if (role === 'admin') {
      items.push({ page: 'pages/admin.html', icon: 'bi-person-gear', label: 'จัดการ', id: 'admin' });
    }

    const isInPages = window.location.pathname.includes('/pages/');

    if (this.isDesktop()) {
      // Desktop: Sidebar navigation
      let html = '<nav class="sidebar-nav">';
      html += '<div class="sidebar-logo"><i class="bi bi-gear-wide-connected"></i> H1 Lug&Screw</div>';
      items.forEach(item => {
        const cls = activePage === item.id ? ' active' : '';
        const href = isInPages ? '../' + item.page : item.page;
        html += '<a href="' + href + '" class="sidebar-item' + cls + '">' +
          '<i class="bi ' + item.icon + '"></i>' +
          '<span>' + item.label + '</span></a>';
      });
      html += '<div class="sidebar-spacer"></div>';
      html += '<a href="#" class="sidebar-item sidebar-logout" onclick="Auth.logout();return false;">' +
        '<i class="bi bi-box-arrow-right"></i><span>ออกจากระบบ</span></a>';
      html += '</nav>';
      document.body.insertAdjacentHTML('afterbegin', html);

      // Wrap content in desktop layout
      const container = document.querySelector('.container');
      if (container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'desktop-main';
        container.parentNode.insertBefore(wrapper, container);
        wrapper.appendChild(container);
        container.style.maxWidth = '1100px';
      }
    } else {
      // Mobile: Bottom navigation
      let html = '<nav class="bottom-nav">';
      items.forEach(item => {
        const cls = activePage === item.id ? ' active' : '';
        const href = isInPages ? '../' + item.page : item.page;
        html += '<a href="' + href + '" class="' + cls + '">' +
          '<i class="bi ' + item.icon + '"></i>' +
          '<span>' + item.label + '</span></a>';
      });
      html += '</nav>';
      document.body.insertAdjacentHTML('beforeend', html);
    }

    // Listen for resize
    window.addEventListener('resize', () => {
      const wasDesktop = document.body.classList.contains('is-desktop');
      const nowDesktop = window.innerWidth >= 768;
      if (wasDesktop !== nowDesktop) {
        window.location.reload();
      }
    });
  },

  renderTopNav(title, icon) {
    this.applyDeviceClass();
    const user = Auth.getUser();

    if (this.isDesktop()) {
      // Desktop: Top bar without logout (sidebar has it)
      const html = '<div class="top-nav desktop-topnav">' +
        '<div class="nav-title"><i class="bi ' + icon + '"></i> ' + title + '</div>' +
        '<div class="nav-right">' +
        '<span class="user-name"><i class="bi bi-person-circle"></i> ' + (user ? user.name : '') +
        ' <span class="badge badge-info" style="font-size:11px;">' + (user ? user.role : '') + '</span></span>' +
        '</div></div>';
      document.body.insertAdjacentHTML('afterbegin', html);
    } else {
      // Mobile: Original top nav
      const html = '<div class="top-nav">' +
        '<div class="nav-title"><i class="bi ' + icon + '"></i> ' + title + '</div>' +
        '<div class="nav-right">' +
        '<span class="user-name">' + (user ? user.name : '') + '</span>' +
        '<button class="btn-icon" onclick="Auth.logout()" title="ออกจากระบบ"><i class="bi bi-box-arrow-right"></i></button>' +
        '</div></div>';
      document.body.insertAdjacentHTML('afterbegin', html);
    }
  },

  getShiftInfo() {
    const hour = new Date().getHours();
    if (hour >= 8 && hour < 20) {
      return { name: 'Day Shift (กะกลางวัน)', type: 'day' };
    }
    return { name: 'Night Shift (กะกลางคืน)', type: 'night' };
  },

  formatNumber(n) {
    return Number(n || 0).toLocaleString();
  },

  formatDate(date) {
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  },

  getToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
};
