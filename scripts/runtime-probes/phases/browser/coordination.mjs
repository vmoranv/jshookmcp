export async function runBrowserCoordinationPhase(ctx) {
  const { report, clients, helpers } = ctx;
  const { client } = clients;
  const { callTool } = helpers;

  report.coordination.create = await callTool(
    client,
    'create_task_handoff',
    {
      description: 'Runtime audit coordination probe',
      constraints: ['runtime-audit'],
      targetDomain: 'network',
    },
    15000,
  );
  report.coordination.appendInsight = await callTool(
    client,
    'append_session_insight',
    {
      category: 'audit',
      content: 'Captured runtime coordination fixture state',
      confidence: 1,
    },
    15000,
  );
  report.coordination.context = await callTool(
    client,
    'get_task_context',
    { taskId: report.coordination.create?.taskId },
    15000,
  );
  report.coordination.seedState = await callTool(
    client,
    'page_evaluate',
    {
      code: `(() => {
        document.cookie = 'audit_cookie=initial; path=/';
        localStorage.setItem('audit-key', 'snapshot-value');
        sessionStorage.setItem('audit-session', 'snapshot-session');
        return {
          url: location.href,
          cookie: document.cookie,
          localStorage: localStorage.getItem('audit-key'),
          sessionStorage: sessionStorage.getItem('audit-session'),
        };
      })()`,
    },
    15000,
  );
  report.coordination.saveSnapshot = await callTool(
    client,
    'save_page_snapshot',
    { label: 'runtime-audit' },
    15000,
  );
  report.coordination.snapshotList = await callTool(client, 'list_page_snapshots', {}, 15000);
  if (report.coordination.saveSnapshot?.snapshotId) {
    report.coordination.mutateState = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => {
          document.cookie = 'audit_cookie=mutated; path=/';
          localStorage.setItem('audit-key', 'mutated-value');
          sessionStorage.setItem('audit-session', 'mutated-session');
          return {
            cookie: document.cookie,
            localStorage: localStorage.getItem('audit-key'),
            sessionStorage: sessionStorage.getItem('audit-session'),
          };
        })()`,
      },
      15000,
    );
    report.coordination.restore = await callTool(
      client,
      'restore_page_snapshot',
      { snapshotId: report.coordination.saveSnapshot.snapshotId },
      30000,
    );
    report.coordination.restoreState = await callTool(
      client,
      'page_evaluate',
      {
        code: `(() => ({
          hasCookie: document.cookie.includes('audit_cookie=initial'),
          localStorage: localStorage.getItem('audit-key'),
          sessionStorage: sessionStorage.getItem('audit-session')
        }))()`,
      },
      15000,
    );
  }
  if (report.coordination.create?.taskId) {
    report.coordination.complete = await callTool(
      client,
      'complete_task_handoff',
      {
        taskId: report.coordination.create.taskId,
        summary: 'Runtime audit coordination probe complete',
        keyFindings: ['snapshot saved', 'snapshot restored'],
      },
      15000,
    );
  }
}
