/**
 * @fileoverview Library page: filterable document list and upload form.
 */

'use strict';

(function () {
  const { api, el, showAlert, hideAlert, formatBytes, formatDate, statusBadge, tagBadge } = window.KH;
  const PAGE_SIZE = 25;

  const listEl = document.getElementById('documentList');
  const emptyEl = document.getElementById('emptyState');
  const summaryEl = document.getElementById('librarySummary');
  const loadMoreEl = document.getElementById('loadMore');
  const pageAlert = document.getElementById('pageAlert');
  const filtersEl = document.getElementById('filters');
  const filterQ = document.getElementById('filterQ');
  const filterTag = document.getElementById('filterTag');
  const filterOwner = document.getElementById('filterOwner');
  const filterStatus = document.getElementById('filterStatus');

  const POLL_MS = 4000;
  let me = null;
  let offset = 0;
  let loadedTags = false;
  let pollTimer = null;

  /** @return {!URLSearchParams} Query for the current filters and page. */
  function buildQuery() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filterQ.value.trim()) params.set('q', filterQ.value.trim());
    if (filterTag.value) params.set('tag', filterTag.value);
    if (filterOwner.value === 'me') params.set('owner', me.user.email);
    if (filterStatus.value) params.set('status', filterStatus.value);
    return params;
  }

  /**
   * Renders one document row.
   * @param {!Object} doc Document record.
   * @return {!HTMLElement}
   */
  function renderDocument(doc) {
    const item = el('li', 'list-group-item kh-doc');
    const top = el('div', 'd-flex justify-content-between align-items-start gap-2');
    const link = el('a', 'kh-doc-title', doc.title);
    link.href = '/doc/' + encodeURIComponent(doc.id);
    top.appendChild(link);
    top.appendChild(statusBadge(doc.status));
    item.appendChild(top);

    const meta = el('div', 'kh-doc-meta',
      doc.filename + ' · ' + formatBytes(doc.sizeBytes) + ' · ' + doc.ownerName + ' · ' + formatDate(doc.createdAt));
    item.appendChild(meta);

    if (doc.tags.length) {
      const tags = el('div', 'kh-doc-tags');
      doc.tags.forEach((tag) => tags.appendChild(tagBadge(tag)));
      item.appendChild(tags);
    }
    return item;
  }

  /** Fills the tag filter once from the list response. */
  function fillTags(tags) {
    if (loadedTags) return;
    loadedTags = true;
    tags.forEach((tag) => {
      const option = el('option', '', tag);
      option.value = tag;
      filterTag.appendChild(option);
    });
  }

  /**
   * Loads a page of documents.
   * @param {boolean} append Append to the list instead of replacing it.
   */
  async function load(append) {
    clearTimeout(pollTimer);
    if (!append) offset = 0;
    try {
      const result = await api('/api/v1/documents?' + buildQuery());
      fillTags(result.tags);
      document.getElementById('uploadHint').textContent =
        'Allowed: ' + result.limits.allowedTypes.join(', ') + '. Max ' + formatBytes(result.limits.maxBytes) + '.';
      document.getElementById('uploadFile').accept = result.limits.allowedTypes.map((t) => '.' + t).join(',');

      const rows = result.items.map(renderDocument);
      if (append) listEl.append(...rows); else listEl.replaceChildren(...rows);
      offset += result.items.length;

      summaryEl.textContent = result.total + (result.total === 1 ? ' document' : ' documents');
      emptyEl.classList.toggle('d-none', result.total > 0);
      loadMoreEl.classList.toggle('d-none', offset >= result.total);
      hideAlert(pageAlert);

      // Refresh while documents on the first page are still being processed.
      if (offset <= PAGE_SIZE && result.items.some((d) => d.status === 'queued' || d.status === 'processing')) {
        pollTimer = setTimeout(() => load(false), POLL_MS);
      }
    } catch (error) {
      showAlert(pageAlert, error.message);
    }
  }

  /** Debounces filter typing. */
  let typingTimer = null;
  filterQ.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => load(false), 250);
  });
  [filterTag, filterOwner, filterStatus].forEach((select) => select.addEventListener('change', () => load(false)));
  filtersEl.addEventListener('submit', (event) => { event.preventDefault(); load(false); });
  filtersEl.addEventListener('reset', () => setTimeout(() => load(false), 0));
  loadMoreEl.addEventListener('click', () => load(true));

  // Upload
  const uploadForm = document.getElementById('uploadForm');
  const uploadAlert = document.getElementById('uploadAlert');
  const uploadSubmit = document.getElementById('uploadSubmit');
  const uploadModalEl = document.getElementById('uploadModal');

  uploadModalEl.addEventListener('hidden.bs.modal', () => {
    uploadForm.reset();
    hideAlert(uploadAlert);
  });

  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = document.getElementById('uploadFile').files[0];
    if (!file) {
      showAlert(uploadAlert, 'Choose a file to upload.');
      return;
    }
    const form = new FormData();
    form.append('title', document.getElementById('uploadTitle').value);
    form.append('tags', document.getElementById('uploadTags').value);
    form.append('file', file);

    uploadSubmit.disabled = true;
    try {
      const doc = await api('/api/v1/documents', { method: 'POST', form });
      bootstrap.Modal.getOrCreateInstance(uploadModalEl).hide();
      // Reload the tag filter and list; load() clears the alert, so show it after.
      loadedTags = false;
      filterTag.replaceChildren(filterTag.options[0]);
      await load(false);
      showAlert(pageAlert, 'Uploaded "' + doc.title + '".', 'success');
    } catch (error) {
      showAlert(uploadAlert, error.message);
    } finally {
      uploadSubmit.disabled = false;
    }
  });

  window.KH.initShell().then((result) => {
    me = result;
    return load(false);
  }).catch((error) => showAlert(pageAlert, error.message));
})();
