import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { workflowToolDefinitions } from './definitions.js';

const t = toolLookup(workflowToolDefinitions);

export const workflowRegistrations: readonly ToolRegistration[] = [
  { tool: t('web_api_capture_session'), domain: 'workflow', bind: (d) => (a) => d.workflowHandlers.handleWebApiCaptureSession(a) },
  { tool: t('register_account_flow'), domain: 'workflow', bind: (d) => (a) => d.workflowHandlers.handleRegisterAccountFlow(a) },
  { tool: t('page_script_register'), domain: 'workflow', bind: (d) => (a) => d.workflowHandlers.handlePageScriptRegister(a) },
  { tool: t('page_script_run'), domain: 'workflow', bind: (d) => (a) => d.workflowHandlers.handlePageScriptRun(a) },
  { tool: t('api_probe_batch'), domain: 'workflow', bind: (d) => (a) => d.workflowHandlers.handleApiProbeBatch(a) },
  { tool: t('js_bundle_search'), domain: 'workflow', bind: (d) => (a) => d.workflowHandlers.handleJsBundleSearch(a) },
];
