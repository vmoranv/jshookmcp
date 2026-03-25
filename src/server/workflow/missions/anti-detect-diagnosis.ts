import type { MissionWorkflow } from '../types';

export const antiDetectDiagnosisMission: MissionWorkflow = {
  id: 'anti-detect-diagnosis',
  name: '反检测诊断 / Anti-Detect Diagnosis',
  description:
    'Identify anti-debug, anti-tamper, and bot detection protections, classify their type, and recommend bypass strategies.',
  triggerPatterns: [
    /anti[- ]?(detect|debug|tamper|检测|调试)\s*(diagnos|诊断|scan|扫描)/i,
    /(反检测|反调试|反篡改)\s*(诊断|扫描|分析)/i,
    /(detect|diagnose|identify).*(protection|anti[- ]?debug|bot[- ]?detect)/i,
  ],
  requiredDomains: ['antidebug', 'browser'],
  priority: 92,
  steps: [
    {
      id: 'scan',
      toolName: 'antidebug_detect_protections',
      description: 'Scan the page for anti-debugging and bot detection signatures',
      prerequisites: [],
      evidenceNodeType: 'script',
    },
    {
      id: 'verify',
      toolName: 'page_screenshot',
      description: 'Capture the protected page state for later comparison and reporting',
      prerequisites: ['scan'],
      evidenceNodeType: 'captured-data',
    },
    {
      id: 'bypass',
      toolName: 'antidebug_bypass_all',
      description: 'Apply bypass strategies for identified protections',
      prerequisites: ['scan', 'verify'],
      evidenceNodeType: 'replay-artifact',
    },
  ],
};
