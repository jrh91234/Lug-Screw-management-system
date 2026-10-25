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

  // All possible nav items (shared by the menu and the browser-style tab bar)
  NAV_ITEMS: [
    { page: 'pages/production.html', icon: 'bi-clipboard-data', label: 'กรอกยอด', id: 'production' },
    { page: 'pages/dailycheck.html', icon: 'bi-clipboard-check', label: 'Daily Check', id: 'dailycheck' },
    { page: 'pages/fives.html', icon: 'bi-stars', label: '5ส.', id: 'fives' },
    { page: 'pages/inbox.html', icon: 'bi-inbox', label: 'Inbox', id: 'inbox' },
    { page: 'pages/maintenance.html', icon: 'bi-wrench', label: 'แจ้งซ่อม', id: 'maintenance' },
    { page: 'pages/joborders.html', icon: 'bi-calendar2-week', label: 'วางแผนการผลิต', id: 'joborders' },
    { page: 'pages/rawmaterial.html', icon: 'bi-box-seam', label: 'รับวัตถุดิบ', id: 'rawmaterial' },
    { page: 'pages/sorting.html', icon: 'bi-funnel', label: 'คัดแยก', id: 'sorting' },
    { page: 'pages/waste.html', icon: 'bi-trash3', label: 'ทิ้งขยะ', id: 'waste' },
    { page: 'pages/alarm.html', icon: 'bi-bell', label: 'Alarm', id: 'alarm' },
    { page: 'pages/machines.html', icon: 'bi-gear', label: 'เครื่องจักร', id: 'machines' },
    { page: 'pages/dashboard.html', icon: 'bi-graph-up', label: 'Dashboard', id: 'dashboard' },
    { page: 'pages/cost.html', icon: 'bi-cash-stack', label: 'ต้นทุน', id: 'cost' },
    { page: 'pages/labor.html', icon: 'bi-people', label: 'ค่าแรง', id: 'labor' },
    { page: 'pages/admin.html', icon: 'bi-person-gear', label: 'จัดการ', id: 'admin' }
  ],

  renderNav(activePage) {
    this.applyDeviceClass();
    const user = Auth.getUser();

    // Filter by user's permissions
    const items = this.NAV_ITEMS.filter(item => Auth.hasPermission(item.id));

    const isInPages = window.location.pathname.includes('/pages/');

    if (this.isDesktop()) {
      // Desktop: Sidebar navigation
      let html = '<nav class="sidebar-nav">';
      html += '<div class="sidebar-logo"><i class="bi bi-gear-wide-connected"></i> H1 Lug&Screw</div>';
      items.forEach(item => {
        const cls = activePage === item.id ? ' active' : '';
        const href = isInPages ? '../' + item.page : item.page;
        html += '<a href="' + href + '" data-nav-id="' + item.id + '" class="sidebar-item' + cls + '">' +
          '<i class="bi ' + item.icon + '"></i>' +
          '<span>' + item.label + '</span></a>';
      });
      html += '<div class="sidebar-spacer"></div>';
      html += '<a href="#" class="sidebar-item sidebar-logout" onclick="Auth.logout();return false;">' +
        '<i class="bi bi-box-arrow-right"></i><span>ออกจากระบบ</span></a>';
      html += '</nav>';
      document.body.insertAdjacentHTML('afterbegin', html);
      // A long menu scrolls; bring the current page's item into view.
      const activeItem = document.querySelector('.sidebar-nav .sidebar-item.active');
      if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });

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
          html += '<a href="' + href + '" data-nav-id="' + item.id + '" class="' + cls + '">' +
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
          html += '<a href="' + href + '" data-nav-id="' + item.id + '" class="' + cls + '">' +
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
          html += '<a href="' + href + '" data-nav-id="' + item.id + '" class="more-menu-item' + cls + '">' +
            '<i class="bi ' + item.icon + '"></i>' +
            '<span>' + item.label + '</span></a>';
        });
        html += '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
      }
    }

    this.renderBrowserTabs(activePage, items);

    // Listen for resize
    window.addEventListener('resize', () => {
      const wasDesktop = document.body.classList.contains('is-desktop');
      const nowDesktop = window.innerWidth >= 768;
      if (wasDesktop !== nowDesktop) {
        window.location.reload();
      }
    });
  },

  // ── แถบแท็บแบบ browser ────────────────────────────────────────────────
  // ระบบเป็นหลายหน้า (แต่ละเมนูคือไฟล์ HTML) แท็บจึงเป็น "รายการหน้าที่เปิดค้างไว้"
  // เก็บใน localStorage แล้ววาดใหม่ทุกหน้า — กดแท็บ = ไปหน้านั้น, เมนูปกติ = เปลี่ยนหน้าในแท็บที่เปิดอยู่
  // Ctrl/⌘+คลิก หรือคลิกกลางที่เมนู = เปิดหน้านั้นเป็นแท็บใหม่ (ยังอยู่หน้าเดิม)
  TABS_KEY: 'h1ls_browser_tabs',
  TABS_MAX: 12,
  // แท็บใหม่ (ปุ่ม +) = หน้าเปล่า pages/newtab.html ให้เลือกเมนูเอง
  NEW_TAB_ID: 'newtab',
  NEW_TAB_ITEM: { page: 'pages/newtab.html', icon: 'bi-plus-square', label: 'แท็บใหม่', id: 'newtab' },

  loadTabs() {
    try {
      const st = JSON.parse(localStorage.getItem(this.TABS_KEY) || 'null');
      if (st && Array.isArray(st.tabs)) return st;
    } catch (e) { /* storage ปิด/เสีย → เริ่มใหม่ */ }
    return { tabs: [], active: '' };
  },

  saveTabs(st) {
    try { localStorage.setItem(this.TABS_KEY, JSON.stringify(st)); } catch (e) { /* ไม่มี storage ก็ใช้ได้แค่หน้านี้ */ }
  },

  // ปรับสถานะแท็บตามหน้าที่เพิ่งเปิด (แยกออกมาให้เทสต์ได้โดยไม่ต้องมี DOM)
  syncTabs(st, activePage, allowedIds) {
    const allowed = {};
    allowedIds.forEach(id => { allowed[id] = true; });
    const tabs = st.tabs.filter(t => t && t.uid && allowed[t.id]);
    let cur = tabs.filter(t => t.uid === st.active)[0];
    if (!cur) {
      cur = { uid: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id: activePage };
      tabs.push(cur);
    }
    cur.id = activePage; // เปลี่ยนหน้าจากเมนู = เปลี่ยนหน้าในแท็บที่เปิดอยู่ เหมือน browser
    return { tabs: tabs.slice(-this.TABS_MAX), active: cur.uid };
  },

  tabHref(id) {
    const item = this.NAV_ITEMS.concat([this.NEW_TAB_ITEM]).filter(i => i.id === id)[0];
    if (!item) return '#';
    return window.location.pathname.includes('/pages/') ? '../' + item.page : item.page;
  },

  newTabUid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  renderBrowserTabs(activePage, items) {
    items = items.concat([this.NEW_TAB_ITEM]);
    if (!activePage || !items.some(i => i.id === activePage)) return;
    const allowedIds = items.map(i => i.id);
    const st = this.syncTabs(this.loadTabs(), activePage, allowedIds);
    this.saveTabs(st);
    const byId = {};
    items.forEach(i => { byId[i.id] = i; });

    const old = document.getElementById('browserTabs');
    if (old) old.remove();
    const bar = document.createElement('div');
    bar.id = 'browserTabs';
    bar.className = 'browser-tabs';
    let html = '<div class="browser-tabs-list" role="tablist">';
    st.tabs.forEach(t => {
      const it = byId[t.id];
      const on = t.uid === st.active;
      html += '<a href="' + this.tabHref(t.id) + '" class="browser-tab' + (on ? ' active' : '') + '" role="tab" aria-selected="' + on + '" data-tab-uid="' + t.uid + '" title="' + it.label + '">' +
        '<i class="bi ' + it.icon + '"></i><span>' + it.label + '</span>' +
        (st.tabs.length > 1 ? '<button type="button" class="browser-tab-close" data-tab-close="' + t.uid + '" aria-label="ปิดแท็บ">&times;</button>' : '') +
        '</a>';
    });
    html += '</div>';
    html += '<button type="button" class="browser-tab-add" id="browserTabAdd" title="เปิดแท็บใหม่" aria-label="เปิดแท็บใหม่"><i class="bi bi-plus-lg"></i></button>';
    bar.innerHTML = html;
    document.body.insertAdjacentElement('afterbegin', bar);
    document.body.classList.add('has-browser-tabs');
    const activeEl = bar.querySelector('.browser-tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    const self = this;
    const go = (uid) => {
      const s2 = self.loadTabs();
      const t = s2.tabs.filter(x => x.uid === uid)[0];
      if (!t) return;
      s2.active = uid;
      self.saveTabs(s2);
      window.location.href = self.tabHref(t.id);
    };
    const closeTab = (uid) => {
      const s2 = self.loadTabs();
      const idx = s2.tabs.findIndex(x => x.uid === uid);
      if (idx < 0 || s2.tabs.length <= 1) return;
      const wasActive = s2.active === uid;
      s2.tabs.splice(idx, 1);
      if (wasActive) {
        const next = s2.tabs[Math.min(idx, s2.tabs.length - 1)];
        s2.active = next.uid;
        self.saveTabs(s2);
        window.location.href = self.tabHref(next.id);
        return;
      }
      self.saveTabs(s2);
      self.renderBrowserTabs(activePage, items);
    };
    const openNew = (id, activate) => {
      const s2 = self.loadTabs();
      const t = { uid: self.newTabUid(), id: id };
      s2.tabs.push(t);
      s2.tabs = s2.tabs.slice(-self.TABS_MAX);
      if (activate) s2.active = t.uid;
      self.saveTabs(s2);
      if (activate) window.location.href = self.tabHref(id);
      else self.renderBrowserTabs(activePage, items);
    };

    bar.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-tab-close]');
      if (closeBtn) { e.preventDefault(); e.stopPropagation(); closeTab(closeBtn.getAttribute('data-tab-close')); return; }
      // + = แท็บใหม่เป็นหน้าเปล่า ให้เลือกเมนูไหนก็ได้ (จากแถบซ้าย หรือปุ่มในหน้า)
      if (e.target.closest('#browserTabAdd')) { e.preventDefault(); openNew(self.NEW_TAB_ID, true); return; }
      const tab = e.target.closest('[data-tab-uid]');
      if (tab && !e.ctrlKey && !e.metaKey) { e.preventDefault(); go(tab.getAttribute('data-tab-uid')); }
    });
    // คลิกกลางที่แท็บ = ปิด เหมือน browser
    bar.addEventListener('auxclick', (e) => {
      const tab = e.target.closest('[data-tab-uid]');
      if (tab && e.button === 1) { e.preventDefault(); closeTab(tab.getAttribute('data-tab-uid')); }
    });

    if (!this._tabNavHooked) {
      this._tabNavHooked = true;
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-nav-id]');
        if (link && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openNew(link.getAttribute('data-nav-id'), false); UI.showToast('เปิดเป็นแท็บใหม่แล้ว', 'info'); }
      });
      document.addEventListener('auxclick', (e) => {
        const link = e.target.closest('a[data-nav-id]');
        if (link && e.button === 1) { e.preventDefault(); openNew(link.getAttribute('data-nav-id'), false); UI.showToast('เปิดเป็นแท็บใหม่แล้ว', 'info'); }
      });
    }
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
