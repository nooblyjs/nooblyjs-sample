/**
 * @fileoverview Shared browser helpers for signed-in pages: API calls, the
 * header (user, admin link, sign out) and small formatting utilities.
 * Exposed as window.KH.
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

  /**
   * Fills the header from /api/v1/me and wires sign-out.
   * @return {Promise<!Object>} The /me response.
   */
  async function initShell() {
    const me = await api('/api/v1/me');
    const user = me.user;
    document.querySelectorAll('[data-app-name]').forEach((node) => { node.textContent = me.appName; });
    document.querySelectorAll('[data-user-name]').forEach((node) => { node.textContent = user.fullName; });
    document.querySelectorAll('[data-user-initials]').forEach((node) => {
      const words = user.fullName.match(/[\p{L}\p{N}]+/gu) || ['?'];
      node.textContent = words.map((word) => word[0]).join('').slice(0, 2).toUpperCase();
    });
    document.querySelectorAll('[data-admin-only]').forEach((node) => {
      node.classList.toggle('d-none', !user.isAdmin);
    });
    document.querySelectorAll('[data-logout]').forEach((button) => {
      button.classList.toggle('d-none', Boolean(me.noAuth));
      button.addEventListener('click', async () => {
        await fetch('/services/authservice/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        window.location.href = LOGIN_PAGE;
      });
    });
    return me;
  }

  window.KH = { api, el, showAlert, hideAlert, formatBytes, formatDate, statusBadge, tagBadge, initShell };
})();
