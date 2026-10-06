/**
 * @fileoverview Admin workflows page: embeds the core WorkflowManagerUI
 * (loaded from /services/workflow/scripts), which calls the workflow
 * service's REST API with the admin's session.
 */

'use strict';

(function () {
  const pageAlert = document.getElementById('pageAlert');

  window.KH.initShell()
    .then(() => new window.WorkflowManagerUI({
      containerId: 'workflowManager',
      fetchOptions: { credentials: 'same-origin' },
      screens: ['workflows', 'executions'],
      onError: (error) => window.KH.showAlert(pageAlert, error.message)
    }).initialize())
    .catch((error) => window.KH.showAlert(pageAlert, error.message));
})();
