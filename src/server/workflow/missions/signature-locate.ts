import type { MissionWorkflow } from '../types';

export const signatureLocateMission: MissionWorkflow = {
  id: 'signature-locate',
  name: '签名定位 / Signature Locate',
  description:
    'Locate API request signing functions by intercepting network calls, tracing call stacks, and extracting the signing algorithm.',
  triggerPatterns: [
    /sign(ature|ing)?\s*(locat|find|extract|定位|查找)/i,
    /(api|request)\s*(sign|签名|加签)/i,
    /(找|定位|逆向).*(签名|sign)/i,
  ],
  requiredDomains: ['network', 'debugger', 'hooks', 'core'],
  priority: 95,
  steps: [
    {
      id: 'network',
      toolName: 'network_enable',
      description: 'Enable request capture before reproducing the signed request flow',
      prerequisites: [],
      evidenceNodeType: 'request',
    },
    {
      id: 'capture',
      toolName: 'network_get_requests',
      description:
        'Inspect captured requests to identify the signed endpoint, headers, and payload shape',
      prerequisites: ['network'],
      evidenceNodeType: 'request',
    },
    {
      id: 'debugger',
      toolName: 'debugger_enable',
      description: 'Enable the debugger so the signing path can be paused and inspected live',
      prerequisites: ['capture'],
      evidenceNodeType: 'function',
    },
    {
      id: 'locate',
      toolName: 'detect_crypto',
      description: 'Locate cryptographic and signing-related code around the captured request flow',
      prerequisites: ['debugger'],
      parallel: true,
      evidenceNodeType: 'function',
    },
    {
      id: 'hook',
      toolName: 'ai_hook_generate',
      description:
        'Generate a hook for the candidate signing function to capture inputs and outputs',
      prerequisites: ['locate'],
      evidenceNodeType: 'captured-data',
    },
  ],
};
