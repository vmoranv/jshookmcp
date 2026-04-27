export async function runMetaPhase(ctx) {
  const { report, clients, helpers } = ctx;
  const { client, metaClient } = clients;
  const { withTimeout, callTool } = helpers;

  const listed = await withTimeout(client.listTools(), 'listTools', 15000);
  report.tools = (listed.tools ?? []).map((tool) => tool.name).toSorted();

  const metaListed = await withTimeout(metaClient.listTools(), 'meta-listTools', 15000);
  report.meta.searchProfileTools = (metaListed.tools ?? []).map((tool) => tool.name).toSorted();
  report.meta.searchTools = await callTool(
    metaClient,
    'search_tools',
    { query: 'cache stats', top_k: 5 },
    15000,
  );
  report.meta.routeTool = await callTool(
    metaClient,
    'route_tool',
    {
      task: 'inspect cache statistics',
      context: { preferredDomain: 'maintenance', autoActivate: false, maxRecommendations: 3 },
    },
    15000,
  );
  report.meta.describeTool = await callTool(
    metaClient,
    'describe_tool',
    { name: 'get_cache_stats' },
    15000,
  );
  report.meta.callInactive = await callTool(
    metaClient,
    'call_tool',
    { name: 'get_cache_stats', args: {} },
    15000,
  );
  report.meta.activateTools = await callTool(
    metaClient,
    'activate_tools',
    { names: ['get_cache_stats'] },
    15000,
  );
  report.meta.callTool = await callTool(
    metaClient,
    'call_tool',
    { name: 'get_cache_stats', args: {} },
    15000,
  );
  report.meta.deactivateTools = await callTool(
    metaClient,
    'deactivate_tools',
    { names: ['get_cache_stats'] },
    15000,
  );
  report.meta.callAfterDeactivate = await callTool(
    metaClient,
    'call_tool',
    { name: 'get_cache_stats', args: {} },
    15000,
  );
  report.meta.activateDomain = await callTool(
    metaClient,
    'activate_domain',
    { domain: 'maintenance', ttlMinutes: 5 },
    15000,
  );
  report.meta.callActivatedDomainTool = await callTool(
    metaClient,
    'call_tool',
    { name: 'get_cache_stats', args: {} },
    15000,
  );
}
