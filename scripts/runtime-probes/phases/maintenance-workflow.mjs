import { join } from 'node:path';

export async function runMaintenanceWorkflowPhase(ctx) {
  const { report, clients, helpers, paths, runtimeIds, constants } = ctx;
  const { client } = clients;
  const { callTool, isCapabilityAvailable, isRecord } = helpers;
  const { runtimeWorkflowRoot } = paths;
  const { runtimeMacroId, runtimeExtensionId } = runtimeIds;
  const { BODY_MARKER } = constants;

  report.maintenance.tokenStats = await callTool(client, 'get_token_budget_stats', {}, 15000);
  report.maintenance.cacheStats = await callTool(client, 'get_cache_stats', {}, 15000);
  report.maintenance.smartCacheCleanup = await callTool(
    client,
    'smart_cache_cleanup',
    { targetSize: 1024 * 1024 },
    30000,
  );
  report.maintenance.doctor = await callTool(
    client,
    'doctor_environment',
    { includeBridgeHealth: false },
    45000,
  );
  report.maintenance.listExtensions = await callTool(client, 'list_extensions', {}, 30000);
  report.maintenance.reloadExtensions = await callTool(client, 'reload_extensions', {}, 30000);
  report.maintenance.browseExtensionRegistry = await callTool(
    client,
    'browse_extension_registry',
    { kind: 'all' },
    30000,
  );
  report.binary.capabilities = await callTool(client, 'binary_instrument_capabilities', {}, 15000);
  report.binary.availablePlugins = await callTool(client, 'get_available_plugins', {}, 15000);
  report.binary.generateHooks = await callTool(
    client,
    'generate_hooks',
    {
      symbols: ['SSL_read', 'SSL_write'],
      options: { includeArgs: true, includeRetAddr: true },
    },
    30000,
  );
  report.binary.exportHookScript = await callTool(
    client,
    'export_hook_script',
    {
      hookTemplates: JSON.stringify([
        {
          functionName: 'SSL_read',
          hookCode: 'Interceptor.attach(ptr("0x1"), { onEnter() {} });',
          description: 'Runtime audit hook template',
          parameters: [
            {
              name: 'arg0',
              type: 'pointer',
              description: 'First pointer argument',
            },
          ],
        },
      ]),
    },
    15000,
  );
  report.mojo.capabilities = await callTool(client, 'mojo_ipc_capabilities', {}, 15000);
  report.binary.capabilitiesAvailable = isCapabilityAvailable(
    report.binary.capabilities,
    'frida_cli',
  );
  report.mojo.capabilitiesAvailable = isCapabilityAvailable(
    report.mojo.capabilities,
    'mojo_ipc_monitoring',
  );
  report.mojo.liveCaptureAvailable = isCapabilityAvailable(
    report.mojo.capabilities,
    'mojo_live_capture',
  );

  const installedWorkflowTarget = join(runtimeWorkflowRoot, `runtime-audit-workflow-${Date.now()}`);
  report.maintenance.installExtension = await callTool(
    client,
    'install_extension',
    {
      slug: 'runtime-audit-workflow',
      targetDir: installedWorkflowTarget,
    },
    60000,
  );
  report.workflow.list = await callTool(client, 'list_extension_workflows', {}, 15000);
  report.workflow.count = Array.isArray(report.workflow.list?.workflows)
    ? report.workflow.list.workflows.length
    : 0;
  const runnableWorkflow = Array.isArray(report.workflow.list?.workflows)
    ? report.workflow.list.workflows.find((workflow) => isRecord(workflow) && workflow.id)
    : null;
  report.workflow.firstWorkflowId =
    isRecord(runnableWorkflow) && typeof runnableWorkflow.id === 'string'
      ? runnableWorkflow.id
      : 'runtime-audit-installed-workflow';
  report.workflow.run = await callTool(
    client,
    'run_extension_workflow',
    { workflowId: report.workflow.firstWorkflowId, timeoutMs: 15000 },
    30000,
  );
  report.workflow.extensionListInstalled = await callTool(
    client,
    'extension_list_installed',
    {},
    15000,
  );
  report.extensionRegistry.listInstalled = report.workflow.extensionListInstalled;
  report.extensionRegistry.execute = await callTool(
    client,
    'extension_execute_in_context',
    {
      pluginId: runtimeExtensionId,
      contextName: 'default',
      args: { marker: ctx.constants.BODY_MARKER, count: 2 },
    },
    15000,
  );
  report.extensionRegistry.executeNamed = await callTool(
    client,
    'extension_execute_in_context',
    {
      pluginId: runtimeExtensionId,
      contextName: 'namedContext',
      args: { marker: ctx.constants.BODY_MARKER, count: 3 },
    },
    15000,
  );
  report.extensionRegistry.reload = await callTool(
    client,
    'extension_reload',
    { pluginId: runtimeExtensionId },
    15000,
  );
  report.extensionRegistry.uninstall = await callTool(
    client,
    'extension_uninstall',
    { pluginId: runtimeExtensionId },
    15000,
  );
  report.extensionRegistry.listAfterUninstall = await callTool(
    client,
    'extension_list_installed',
    {},
    15000,
  );

  const webhookPath = `/runtime-audit-webhook-${Date.now()}`;
  report.extensionRegistry.webhookCreate = await callTool(
    client,
    'webhook',
    {
      action: 'create',
      name: 'runtime-audit-webhook',
      path: webhookPath,
      events: ['extension.executed', 'extension.reloaded'],
    },
    15000,
  );
  report.extensionRegistry.webhookList = await callTool(
    client,
    'webhook',
    { action: 'list' },
    15000,
  );
  const webhookEndpointId =
    typeof report.extensionRegistry.webhookCreate?.endpointId === 'string'
      ? report.extensionRegistry.webhookCreate.endpointId
      : null;
  if (webhookEndpointId) {
    report.extensionRegistry.webhookCommandsEnqueue = await callTool(
      client,
      'webhook',
      {
        action: 'commands',
        endpointId: webhookEndpointId,
        command: { kind: 'runtime-audit', marker: BODY_MARKER, count: 1 },
      },
      15000,
    );
    report.extensionRegistry.webhookCommandsPoll = await callTool(
      client,
      'webhook',
      { action: 'commands', endpointId: webhookEndpointId },
      15000,
    );
    report.extensionRegistry.webhookDelete = await callTool(
      client,
      'webhook',
      { action: 'delete', endpointId: webhookEndpointId },
      15000,
    );
  }

  report.macro.list = await callTool(client, 'list_macros', {}, 15000);
  report.macro.customListed = Array.isArray(report.macro.list?.macros)
    ? report.macro.list.macros.some((entry) => isRecord(entry) && entry.id === runtimeMacroId)
    : false;
  report.macro.runCustom = await callTool(client, 'run_macro', { macroId: runtimeMacroId }, 45000);
  report.macro.customCompleted =
    typeof report.macro.runCustom === 'string' && report.macro.runCustom.includes('Macro complete');
  report.macro.runBuiltin = await callTool(
    client,
    'run_macro',
    {
      macroId: 'deobfuscate_ast_flow',
      inputOverrides: {
        deobfuscate: {
          code: 'eval(atob("Y29uc3QgYSA9IDE7"))',
        },
      },
    },
    90000,
  );
  report.macro.builtinCompleted =
    typeof report.macro.runBuiltin === 'string' &&
    report.macro.runBuiltin.includes('Macro complete');
}
