/**
 * @fileoverview Shared browser helpers for signed-in pages: API calls, the
 * header (navigation, notification bell, user, sign out) and small
 * formatting utilities. Exposed as window.KH.
 */

'use strict';

(function () {
  const LOGIN_PAGE = '/services/authservice/views/login.html';

  /**
   * Calls the app API. Sends cookies, parses JSON, and throws an Error with
   * the server's message (and .status) on failure. 401 redirects to login.
   *
   * @param {string} url API path.
   * @param {{method: (string|undefined), json: (*|undefined), form: (FormData|undefined)}=} options
   * @return {Promise<*>} Parsed JSON, or null for 204.
   */
  async function api(url, options = {}) {
    const init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (options.json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.json);
    } else if (options.form) {
      init.body = options.form;
    }

    const response = await fetch(url, init);
    if (response.status === 401) {
      window.location.href = LOGIN_PAGE + '?returnUrl=' + encodeURIComponent(location.pathname);
      throw Object.assign(new Error('Please sign in'), { status: 401 });
    }
    if (response.status === 204) return null;

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (body && body.error) || 'Request failed (HTTP ' + response.status + ')';
      throw Object.assign(new Error(message), { status: response.status });
    }
    return body;
  }

  /**
   * Creates an element with optional class and text.
   * @param {string} tag Tag name.
   * @param {string=} className Class list.
   * @param {string=} text Text content.
   * @return {!HTMLElement}
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /**
   * Shows a Bootstrap alert (`alert … fade`) with a message.
   * @param {!HTMLElement} alert Alert element.
   * @param {string} message Text.
   * @param {string=} kind Bootstrap contextual class suffix.
   */
  function showAlert(alert, message, kind = 'danger') {
    alert.className = 'alert alert-' + kind + ' fade show';
    alert.textContent = message;
  }

  /** @param {!HTMLElement} alert Alert to hide. */
  function hideAlert(alert) {
    alert.classList.remove('show');
    alert.textContent = '';
  }

  /** @param {number} bytes Size. @return {string} Human-readable size. */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /** @param {string} iso ISO date. @return {string} Local date and time. */
  function formatDate(iso) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Status badge classes. */
  const STATUS_CLASSES = {
    queued: 'text-bg-secondary',
    processing: 'text-bg-info',
    ready: 'text-bg-success',
    failed: 'text-bg-danger'
  };

  /** @param {string} status Document status. @return {!HTMLElement} Badge. */
  function statusBadge(status) {
    return el('span', 'badge ' + (STATUS_CLASSES[status] || 'text-bg-light'), status);
  }

  /** @param {string} tag Tag. @return {!HTMLElement} Tag badge. */
  function tagBadge(tag) {
    return el('span', 'badge kh-tag', tag);
  }

  /** Navigation links; adminOnly links are hidden from members. */
  const NAV = [
    { href: '/library', icon: 'bi-journal-text', label: 'Library' },
    { href: '/activity', icon: 'bi-clock-history', label: 'Activity' },
    { href: '/admin/workflows', icon: 'bi-diagram-3', label: 'Workflows', adminOnly: true }
  ];

  const UNREAD_POLL_MS = 15000;

  /**
   * Renders the header into <header data-kh-header data-section="…">.
   * @param {!HTMLElement} header Header element.
   * @param {!Object} me The /api/v1/me response.
   */
  function renderHeader(header, me) {
    const user = me.user;
    header.className = 'navbar core-topbar';

    const brand = el('a', 'core-brand');
    brand.href = '/library';
    const logo = el('span', 'kh-logo');
    logo.setAttribute('aria-hidden', 'true');
    logo.appendChild(el('i', 'bi bi-journal-text'));
    const name = el('span', 'name', me.appName);
    name.appendChild(el('small', '', header.dataset.section || ''));
    brand.append(logo, name);

    const nav = el('nav', 'kh-nav');
    nav.setAttribute('aria-label', 'Main');
    NAV.filter((item) => !item.adminOnly || user.isAdmin).forEach((item) => {
      const link = el('a', 'kh-nav-link');
      link.href = item.href;
      link.title = item.label;
      if (location.pathname === item.href) link.setAttribute('aria-current', 'page');
      link.append(el('i', 'bi ' + item.icon), el('span', 'kh-nav-label', item.label));
      nav.appendChild(link);
    });

    const actions = el('div', 'core-topbar-actions');
    const bell = el('a', 'core-icon-btn kh-bell');
    bell.href = '/activity';
    bell.title = 'Notifications';
    bell.appendChild(el('i', 'bi bi-bell'));
    const count = el('span', 'kh-bell-count d-none');
    count.setAttribute('data-unread', '');
    bell.appendChild(count);
    actions.appendChild(bell);

    if (user.isAdmin) {
      const dashboards = el('a', 'core-icon-btn');
      dashboards.href = '/services/';
      dashboards.title = 'Service dashboards';
      dashboards.appendChild(el('i', 'bi bi-grid-3x3-gap'));
      actions.appendChild(dashboards);
    }

    const userBox = el('div', 'core-user');
    const words = user.fullName.match(/[\p{L}\p{N}]+/gu) || ['?'];
    userBox.append(
      el('span', 'kh-user-name', user.fullName),
      el('div', 'av', words.map((word) => word[0]).join('').slice(0, 2).toUpperCase())
    );
    actions.appendChild(userBox);

    if (!me.noAuth) {
      const logout = el('button', 'core-icon-btn');
      logout.type = 'button';
      logout.title = 'Sign out';
      logout.appendChild(el('i', 'bi bi-box-arrow-right'));
      logout.addEventListener('click', async () => {
        await fetch('/services/authservice/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        window.location.href = LOGIN_PAGE;
      });
      actions.appendChild(logout);
    }

    header.replaceChildren(brand, nav, actions);
  }

  /**
   * Updates the bell with the unread count.
   * @param {number} unread Unread notifications.
   */
  function setUnread(unread) {
    document.querySelectorAll('[data-unread]').forEach((badge) => {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('d-none', unread === 0);
      badge.parentElement.setAttribute('aria-label', unread + ' unread notifications');
    });
  }

  /** Fetches the unread count; failures are ignored (the next poll retries). */
  async function refreshUnread() {
    try {
      setUnread((await api('/api/v1/activity/unread')).unread);
    } catch (error) {
      console.warn('Unread count unavailable', error);
    }
  }

  /**
   * Loads the signed-in user, renders the header and starts the unread poll.
   * @return {Promise<!Object>} The /me response.
   */
  async function initShell() {
    const me = await api('/api/v1/me');
    const header = document.querySelector('[data-kh-header]');
    if (header) renderHeader(header, me);
    document.title = document.title.replace('Knowledge Hub', me.appName);
    refreshUnread();
    setInterval(refreshUnread, UNREAD_POLL_MS);
    return me;
  }

  window.KH = { api, el, showAlert, hideAlert, formatBytes, formatDate, statusBadge, tagBadge, initShell, setUnread };
})();
