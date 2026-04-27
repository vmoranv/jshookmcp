export async function runStateBoardPhase(ctx) {
  const { report, clients, helpers } = ctx;
  const { client } = clients;
  const { callTool } = helpers;
  const stateBoardNamespace = `runtime-audit-${Date.now()}`;

  report.coordination.stateBoardSet = await callTool(
    client,
    'state_board',
    {
      action: 'set',
      namespace: stateBoardNamespace,
      key: 'primary',
      value: { marker: ctx.constants.BODY_MARKER, count: 1 },
    },
    15000,
  );
  report.coordination.stateBoardGet = await callTool(
    client,
    'state_board',
    { action: 'get', namespace: stateBoardNamespace, key: 'primary' },
    15000,
  );
  report.coordination.stateBoardHistory = await callTool(
    client,
    'state_board',
    { action: 'history', namespace: stateBoardNamespace, key: 'primary', limit: 10 },
    15000,
  );
  report.coordination.stateBoardWatchStart = await callTool(
    client,
    'state_board_watch',
    {
      action: 'start',
      namespace: stateBoardNamespace,
      key: 'watch-*',
      pollIntervalMs: 100,
    },
    15000,
  );
  report.coordination.stateBoardWatchSeed = await callTool(
    client,
    'state_board',
    {
      action: 'set',
      namespace: stateBoardNamespace,
      key: 'watch-key',
      value: { marker: ctx.constants.BODY_MARKER, updated: true },
    },
    15000,
  );
  report.coordination.stateBoardList = await callTool(
    client,
    'state_board',
    { action: 'list', namespace: stateBoardNamespace, includeValues: true },
    15000,
  );
  report.coordination.stateBoardExport = await callTool(
    client,
    'state_board_io',
    { action: 'export', namespace: stateBoardNamespace },
    15000,
  );
  const stateBoardWatchId =
    typeof report.coordination.stateBoardWatchStart?.watchId === 'string'
      ? report.coordination.stateBoardWatchStart.watchId
      : null;
  if (stateBoardWatchId) {
    report.coordination.stateBoardWatchPoll = await callTool(
      client,
      'state_board_watch',
      { action: 'poll', watchId: stateBoardWatchId },
      15000,
    );
    report.coordination.stateBoardWatchStop = await callTool(
      client,
      'state_board_watch',
      { action: 'stop', watchId: stateBoardWatchId },
      15000,
    );
  }
  report.coordination.stateBoardClear = await callTool(
    client,
    'state_board',
    { action: 'clear', namespace: stateBoardNamespace },
    15000,
  );
  report.coordination.stateBoardImport = await callTool(
    client,
    'state_board_io',
    {
      action: 'import',
      namespace: stateBoardNamespace,
      overwrite: true,
      data: {
        imported: {
          marker: ctx.constants.BODY_MARKER,
          source: 'runtime-audit',
        },
      },
    },
    15000,
  );
  report.coordination.stateBoardImportedGet = await callTool(
    client,
    'state_board',
    { action: 'get', namespace: stateBoardNamespace, key: 'imported' },
    15000,
  );
}
