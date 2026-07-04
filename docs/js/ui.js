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

    // All possible nav items
    const allItems = [
      { page: 'pages/production.html', icon: 'bi-clipboard-data', label: 'กรอกยอด', id: 'production' },
      { page: 'pages/inbox.html', icon: 'bi-inbox', label: 'Inbox', id: 'inbox' },
      { page: 'pages/maintenance.html', icon: 'bi-wrench', label: 'แจ้งซ่อม', id: 'maintenance' },
      { page: 'pages/rawmaterial.html', icon: 'bi-box-seam', label: 'รับวัตถุดิบ', id: 'rawmaterial' },
      { page: 'pages/sorting.html', icon: 'bi-funnel', label: 'คัดแยก', id: 'sorting' },
      { page: 'pages/waste.html', icon: 'bi-trash3', label: 'ทิ้งขยะ', id: 'waste' },
      { page: 'pages/alarm.html', icon: 'bi-bell', label: 'Alarm', id: 'alarm' },
      { page: 'pages/machines.html', icon: 'bi-gear', label: 'เครื่องจักร', id: 'machines' },
      { page: 'pages/dashboard.html', icon: 'bi-graph-up', label: 'Dashboard', id: 'dashboard' },
      { page: 'pages/cost.html', icon: 'bi-cash-stack', label: 'ต้นทุน', id: 'cost' },
      { page: 'pages/labor.html', icon: 'bi-people', label: 'ค่าแรง', id: 'labor' },
      { page: 'pages/admin.html', icon: 'bi-person-gear', label: 'จัดการ', id: 'admin' }
    ];

    // Filter by user's permissions
    const items = allItems.filter(item => Auth.hasPermission(item.id));

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
      // Mobile: Bottom navigation with overflow handling
      const MAX_VISIBLE = 4;

      if (items.length <= MAX_VISIBLE) {
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
      } else {
        const visibleItems = items.slice(0, MAX_VISIBLE);
        const moreItems = items.slice(MAX_VISIBLE);
        const activeInMore = moreItems.some(item => item.id === activePage);

        let html = '<nav class="bottom-nav">';
        visibleItems.forEach(item => {
          const cls = activePage === item.id ? ' active' : '';
          const href = isInPages ? '../' + item.page : item.page;
          html += '<a href="' + href + '" class="' + cls + '">' +
            '<i class="bi ' + item.icon + '"></i>' +
            '<span>' + item.label + '</span></a>';
        });
        html += '<a href="#" onclick="UI.toggleMoreMenu(event)" class="' + (activeInMore ? 'active' : '') + '">' +
          '<i class="bi bi-grid-fill"></i>' +
          '<span>เพิ่มเติม</span></a>';
        html += '</nav>';

        html += '<div class="more-menu-overlay" id="moreMenuOverlay" onclick="UI.closeMoreMenu()" style="display:none;"></div>';
        html += '<div class="more-menu-drawer" id="moreMenuDrawer" style="display:none;">' +
          '<div class="more-menu-handle"></div>' +
          '<div class="more-menu-title">เมนูเพิ่มเติม</div>' +
          '<div class="more-menu-grid">';
        moreItems.forEach(item => {
          const cls = activePage === item.id ? ' active' : '';
          const href = isInPages ? '../' + item.page : item.page;
          html += '<a href="' + href + '" class="more-menu-item' + cls + '">' +
            '<i class="bi ' + item.icon + '"></i>' +
            '<span>' + item.label + '</span></a>';
        });
        html += '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
      }
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

  toggleMoreMenu(e) {
    e.preventDefault();
    const drawer = document.getElementById('moreMenuDrawer');
    const overlay = document.getElementById('moreMenuOverlay');
    if (!drawer || !overlay) return;
    const isOpen = drawer.style.display !== 'none';
    if (isOpen) {
      this.closeMoreMenu();
    } else {
      drawer.style.display = 'block';
      overlay.style.display = 'block';
    }
  },

  closeMoreMenu() {
    const drawer = document.getElementById('moreMenuDrawer');
    const overlay = document.getElementById('moreMenuOverlay');
    if (drawer) drawer.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
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

  getBkkHour() {
    // Bangkok is UTC+7; compute regardless of device timezone
    const bkk = new Date(Date.now() + 7 * 3600 * 1000);
    return bkk.getUTCHours();
  },

  getShiftInfo() {
    const hour = this.getBkkHour();
    const period = (hour >= 8 && hour < 20) ? 'เช้า' : 'ดึก';
    const user = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    const shift = user && user.shift ? user.shift : '';
    return { name: shift ? 'กะ ' + shift + ' (' + period + ')' : period, type: shift, period: period };
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
    // Shift UTC to Bangkok (UTC+7) manually so device timezone doesn't matter
    const bkk = new Date(Date.now() + 7 * 3600 * 1000);
    const hour = bkk.getUTCHours();
    // Factory work day: 08:00-07:59 next day — before 08:00 belongs to previous work date
    if (hour < 8) {
      bkk.setUTCDate(bkk.getUTCDate() - 1);
    }
    return bkk.getUTCFullYear() + '-' +
      String(bkk.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(bkk.getUTCDate()).padStart(2, '0');
  }
};
