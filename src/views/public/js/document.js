/**
 * @fileoverview Document page: details, download, edit, delete and activity.
 */

'use strict';

(function () {
  const { api, el, showAlert, hideAlert, formatBytes, formatDate, statusBadge, tagBadge } = window.KH;

  const id = decodeURIComponent(location.pathname.split('/').pop());
  const apiUrl = '/api/v1/documents/' + encodeURIComponent(id);
  const pageAlert = document.getElementById('pageAlert');
  let current = null;

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
    details.replaceChildren(...rows.flatMap(([label, value]) => [el('dt', '', label), el('dd', 'kh-break', value)]));

    document.getElementById('downloadBtn').href = apiUrl + '/download';
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

  /** Loads the document. */
  async function load() {
    try {
      render(await api(apiUrl));
    } catch (error) {
      showAlert(pageAlert, error.status === 404 ? 'This document does not exist or was deleted.' : error.message);
    }
  }

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
