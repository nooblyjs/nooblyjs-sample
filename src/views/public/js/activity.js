/**
 * @fileoverview Activity page: the team feed or the user's own activity.
 * Opening the page marks notifications as read.
 */

'use strict';

(function () {
  const { api, el, showAlert, formatDate } = window.KH;
  const listEl = document.getElementById('activityList');
  const pageAlert = document.getElementById('pageAlert');

  /** Icons by activity type. */
  const ICONS = {
    'document.uploaded': 'bi-upload',
    'document.updated': 'bi-pencil',
    'document.deleted': 'bi-trash',
    'document.retried': 'bi-arrow-repeat',
    'document.ingested': 'bi-check-circle',
    'document.failed': 'bi-exclamation-triangle',
    'system.alert': 'bi-exclamation-octagon'
  };

  /**
   * @param {!Object} entry Activity record.
   * @return {!HTMLElement} List item.
   */
  function renderEntry(entry) {
    const item = el('li', 'list-group-item d-flex gap-3 align-items-start');
    item.appendChild(el('i', 'bi ' + (ICONS[entry.type] || 'bi-dot') + ' fs-5 text-muted'));
    const body = el('div', 'kh-min-0');
    if (entry.docId && entry.type !== 'document.deleted') {
      const link = el('a', 'kh-break', entry.message);
      link.href = '/doc/' + encodeURIComponent(entry.docId);
      body.appendChild(link);
    } else {
      body.appendChild(el('div', 'kh-break', entry.message));
    }
    body.appendChild(el('div', 'kh-activity-type', formatDate(entry.createdAt)));
    item.appendChild(body);
    return item;
  }

  /** Loads the feed for the selected scope. */
  async function load() {
    const mine = document.getElementById('scopeMine').checked;
    try {
      const { items } = await api('/api/v1/activity?limit=100' + (mine ? '&mine=true' : ''));
      listEl.replaceChildren(...(items.length
        ? items.map(renderEntry)
        : [el('li', 'list-group-item text-muted', 'Nothing yet.')]));
    } catch (error) {
      showAlert(pageAlert, error.message);
    }
  }

  document.querySelectorAll('input[name="scope"]').forEach((input) => input.addEventListener('change', load));

  window.KH.initShell()
    .then(async () => {
      await load();
      await api('/api/v1/activity/read', { method: 'POST' });
      window.KH.setUnread(0);
    })
    .catch((error) => showAlert(pageAlert, error.message));
})();
