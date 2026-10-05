/**
 * @fileoverview Home page: renders the core service status grid from
 * GET /api/v1/info.
 */

'use strict';

(function () {
  /** Dashboard URL of each core service; appservice has none. */
  const DASHBOARDS = {
    aiservice: '/services/ai',
    appservice: null
  };

  /** One-line description of what each service does in this app. */
  const PURPOSE = {
    logging: 'Application and audit log',
    caching: 'Document, search and stats cache',
    queueing: 'Ingest and AI summary queues',
    notifying: 'Activity feed topics',
    appservice: 'Mounts src/ routes and views',
    fetching: 'Import from URL',
    settings: 'Encrypted app settings',
    dataservice: 'Document metadata',
    working: 'Worker-thread activities',
    measuring: 'Business metrics',
    scheduling: 'Recurring jobs',
    searching: 'Full-text search',
    workflow: 'Ingestion pipeline',
    filing: 'Document file storage',
    authservice: 'Login, users and roles',
    aiservice: 'Summaries and tags'
  };

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
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * Renders one service card.
   * @param {{service: string, defaultProvider: string, running: boolean, provider: ?string}} entry
   * @return {!HTMLElement}
   */
  function renderService(entry) {
    const col = el('div', 'col-12 col-sm-6 col-lg-4 col-xl-3');
    const card = el('div', 'kh-service' + (entry.running ? '' : ' is-planned'));

    const top = el('div', 'd-flex justify-content-between align-items-start gap-2 mb-1');
    top.appendChild(el('span', 'kh-service-name', entry.service));
    top.appendChild(el('span',
      entry.running ? 'badge text-bg-success' : 'badge text-bg-light',
      entry.running ? 'running' : 'planned'));
    card.appendChild(top);

    card.appendChild(el('div', 'kh-service-meta', PURPOSE[entry.service] || ''));
    card.appendChild(el('div', 'kh-service-meta', 'provider: ' + (entry.provider || entry.defaultProvider)));

    const dashboard = entry.service in DASHBOARDS ? DASHBOARDS[entry.service] : '/services/' + entry.service;
    if (entry.running && dashboard) {
      const link = el('a', 'small', 'Open dashboard');
      link.href = dashboard;
      card.appendChild(link);
    }

    col.appendChild(card);
    return col;
  }

  /** Loads /api/v1/info and renders the page. */
  async function load() {
    try {
      const response = await fetch('/api/v1/info', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const info = await response.json();

      document.querySelectorAll('[data-app-name]').forEach((node) => { node.textContent = info.name; });
      document.title = info.name;
      document.getElementById('appVersion').textContent = info.version;
      document.getElementById('servicesSummary').textContent =
        info.servicesRunning + ' / ' + info.servicesTotal + ' running';

      const grid = document.getElementById('servicesGrid');
      grid.replaceChildren(...info.services.map(renderService));
    } catch (error) {
      console.error('Failed to load app info', error);
      document.getElementById('infoError').classList.add('show');
    }
  }

  load();
})();
