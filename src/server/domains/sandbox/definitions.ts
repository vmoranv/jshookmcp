import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sandboxTools: Tool[] = [
  tool('execute_sandbox_script', (t) =>
    t
      .desc('Execute JavaScript in an isolated sandbox.')
      .string('code', 'JavaScript source code to execute inside the sandbox')
      .string('sessionId', 'Session ID for scratchpad persistence across executions')
      .number('timeoutMs', 'Execution timeout in ms', { default: 1000 })
      .boolean('autoCorrect', 'Retry failed scripts up to 2 times with error context', {
        default: false,
      })
      .required('code'),
  ),
];
