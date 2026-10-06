/**
 * @fileoverview Document page: details, download, edit, delete and activity.
 */

'use strict';

(function () {
  const { api, el, showAlert, hideAlert, formatBytes, formatDate, statusBadge, tagBadge } = window.KH;

  const id = decodeURIComponent(location.pathname.split('/').pop());
  const apiUrl = '/api/v1/documents/' + encodeURIComponent(id);
  const pageAlert = document.getElementById('pageAlert');
  const PREVIEW_CHARS = 20000;
  const POLL_MS = 2000;
  let current = null;
  let pollTimer = null;
  let previewLoadedFor = null;

  /**
   * Renders the document.
   * @param {!Object} doc Document with canEdit and activity.
   */
  function render(doc) {
    current = doc;
    document.title = doc.title + ' · Knowledge Hub';
    document.getElementById('crumbTitle').textContent = doc.title;
    document.getElementById('docTitle').textContent = doc.title;

    const badges = document.getElementById('docBadges');
    badges.replaceChildren(statusBadge(doc.status), ...doc.tags.map(tagBadge));

    const details = document.getElementById('docDetails');
    const rows = [
      ['File', doc.filename],
      ['Type', doc.extension.toUpperCase()],
      ['Size', formatBytes(doc.sizeBytes)],
      ['Owner', doc.ownerName],
      ['Uploaded', formatDate(doc.createdAt)],
      ['Updated', formatDate(doc.updatedAt)]
    ];
    if (doc.stats) {
      rows.push(['Words', doc.stats.words.toLocaleString()]);
      rows.push(['Reading time', doc.stats.readingMinutes + ' min']);
      if (doc.stats.pages) rows.push(['Pages', String(doc.stats.pages)]);
      if (doc.stats.keywords.length) rows.push(['Keywords', doc.stats.keywords.join(', ')]);
    }
    details.replaceChildren(...rows.flatMap(([label, value]) => [el('dt', '', label), el('dd', 'kh-break', value)]));

    document.getElementById('downloadBtn').href = apiUrl + '/download';
    const failed = doc.status === 'failed';
    const failedAlert = document.getElementById('failedAlert');
    failedAlert.textContent = failed ? 'Processing failed: ' + (doc.error || 'unknown error') : '';
    failedAlert.classList.toggle('d-none', !failed);
    document.getElementById('retryBtn').classList.toggle('d-none', !(failed && doc.canEdit));
    document.getElementById('previewPending').textContent = failed
      ? 'No preview: this document could not be processed.'
      : 'This document is waiting to be processed. Its text preview will appear here once it is ready.';
    document.getElementById('editBtn').classList.toggle('d-none', !doc.canEdit);
    document.getElementById('deleteBtn').classList.toggle('d-none', !doc.canEdit);

    const activity = document.getElementById('docActivity');
    const items = doc.activity.map((entry) => {
      const item = el('li', 'list-group-item');
      item.appendChild(el('div', '', entry.message));
      item.appendChild(el('div', 'small text-muted', formatDate(entry.createdAt)));
      return item;
    });
    activity.replaceChildren(...(items.length ? items : [el('li', 'list-group-item text-muted', 'No activity yet.')]));

    document.getElementById('documentView').classList.remove('d-none');
  }

  /**
   * Shows the start of the extracted text once the document is ready.
   * @param {!Object} doc Document.
   */
  async function loadPreview(doc) {
    if (doc.status !== 'ready' || previewLoadedFor === doc.ingestedAt) return;
    const { text, truncated } = await api(apiUrl + '/text?maxChars=' + PREVIEW_CHARS);
    if (text === null) return;
    previewLoadedFor = doc.ingestedAt;
    const pre = document.getElementById('previewText');
    pre.textContent = text;
    pre.classList.remove('d-none');
    document.getElementById('previewPending').classList.add('d-none');
    document.getElementById('previewTruncated').classList.toggle('d-none', !truncated);
  }

  /** Loads the document; polls while it is queued or processing. */
  async function load() {
    clearTimeout(pollTimer);
    try {
      const doc = await api(apiUrl);
      render(doc);
      await loadPreview(doc);
      if (doc.status === 'queued' || doc.status === 'processing') {
        pollTimer = setTimeout(load, POLL_MS);
      }
    } catch (error) {
      showAlert(pageAlert, error.status === 404 ? 'This document does not exist or was deleted.' : error.message);
    }
  }

  // Retry
  const retryBtn = document.getElementById('retryBtn');
  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true;
    try {
      await api(apiUrl + '/retry', { method: 'POST' });
      showAlert(pageAlert, 'Queued for processing again.', 'success');
      await load();
    } catch (error) {
      showAlert(pageAlert, error.message);
    } finally {
      retryBtn.disabled = false;
    }
  });

  // Edit
  const editModalEl = document.getElementById('editModal');
  const editAlert = document.getElementById('editAlert');
  editModalEl.addEventListener('show.bs.modal', () => {
    hideAlert(editAlert);
    document.getElementById('editTitle').value = current.title;
    document.getElementById('editTags').value = current.tags.join(', ');
  });
  document.getElementById('editForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.getElementById('editSubmit');
    submit.disabled = true;
    try {
      const tags = document.getElementById('editTags').value.split(',').map((t) => t.trim()).filter(Boolean);
      await api(apiUrl, { method: 'PATCH', json: { title: document.getElementById('editTitle').value, tags } });
      bootstrap.Modal.getOrCreateInstance(editModalEl).hide();
      await load();
      showAlert(pageAlert, 'Saved.', 'success');
    } catch (error) {
      showAlert(editAlert, error.message);
    } finally {
      submit.disabled = false;
    }
  });

  // Delete
  const deleteAlert = document.getElementById('deleteAlert');
  const deleteConfirm = document.getElementById('deleteConfirm');
  deleteConfirm.addEventListener('click', async () => {
    deleteConfirm.disabled = true;
    try {
      await api(apiUrl, { method: 'DELETE' });
      window.location.href = '/library';
    } catch (error) {
      showAlert(deleteAlert, error.message);
      deleteConfirm.disabled = false;
    }
  });

  window.KH.initShell().then(load).catch((error) => showAlert(pageAlert, error.message));
})();
