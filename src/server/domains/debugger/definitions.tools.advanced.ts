import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const DEBUGGER_ADVANCED_TOOLS: Tool[] = [
  tool('watch', (t) =>
    t
      .desc(
        `Manage watch expressions for monitoring variable values during debugging.

Actions:
- add: Add a watch expression (requires expression)
- remove: Remove by watchId
- list: List all watches
- evaluate_all: Evaluate all enabled watches (optional callFrameId)
- clear_all: Clear all watches`,
      )
      .enum('action', ['add', 'remove', 'list', 'evaluate_all', 'clear_all'], 'Watch operation')
      .string('expression', 'JavaScript expression to watch (action=add)')
      .string('name', 'Friendly name for the watch (action=add)')
      .string('watchId', 'Watch expression ID (action=remove)')
      .string('callFrameId', 'Call frame ID (action=evaluate_all)')
      .required('action'),
  ),
  tool('blackbox_add', (t) =>
    t
      .desc(`Blackbox scripts (skip during debugging)

Usage:
- Skip third-party library c...`)
      .string('urlPattern', 'URL pattern to blackbox (supports wildcards *)')
      .required('urlPattern')
      .idempotent(),
  ),
  tool('blackbox_add_common', (t) =>
    t
      .desc(`Blackbox all common libraries (one-click)

Includes:
- jquery, react, vue, an...`)
      .idempotent(),
  ),
  tool('blackbox_list', (t) => t.desc('List all blackboxed patterns').query()),
];
