import type { MissionWorkflow } from '../types';

export const loginFlowCaptureMission: MissionWorkflow = {
  id: 'login-flow-capture',
  name: '登录流抓取 / Login Flow Capture',
  description:
    'Record the complete authentication flow including navigation, API calls, token exchange, and export as HAR.',
  triggerPatterns: [
    /login\s*(flow|capture|record|抓取|录制)/i,
    /(auth|认证|登录)\s*(flow|流程|capture|抓)/i,
    /(抓取|录制|记录).*(登录|auth|login)/i,
  ],
  requiredDomains: ['browser', 'network'],
  priority: 88,
  steps: [
    {
      id: 'navigate',
      toolName: 'page_navigate',
      description: 'Navigate to the login page',
      prerequisites: [],
      evidenceNodeType: 'request',
    },
    {
      id: 'network',
      toolName: 'network_enable',
      description: 'Enable network capture before submitting credentials',
      prerequisites: ['navigate'],
      parallel: true,
      evidenceNodeType: 'request',
    },
    {
      id: 'capture',
      toolName: 'network_get_requests',
      description: 'Collect the authentication requests, responses, and redirect chain',
      prerequisites: ['network'],
      evidenceNodeType: 'request',
    },
    {
      id: 'extract',
      toolName: 'network_extract_auth',
      description: 'Extract tokens, cookies, or bearer credentials from the captured auth traffic',
      prerequisites: ['capture'],
      evidenceNodeType: 'captured-data',
    },
    {
      id: 'export',
      toolName: 'network_export_har',
      description: 'Export the captured network traffic as a HAR file',
      prerequisites: ['extract'],
      evidenceNodeType: 'replay-artifact',
    },
  ],
};
