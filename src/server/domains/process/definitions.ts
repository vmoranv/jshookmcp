import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Process Manager Tool Definitions
 * MCP tools for cross-platform process management and debugging
 */

export const processToolDefinitions: Tool[] = [
  {
    name: 'process_find',
    description: 'Find processes by name pattern. Returns process IDs, names, paths, and window handles.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Process name pattern to search for (e.g., "chrome", "msedge")',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'process_list',
    description: 'List all running processes. Alias of process_find with empty pattern.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'process_get',
    description: 'Get detailed information about a specific process by PID.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID to query',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_windows',
    description: 'Get all window handles for a process.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID to get windows for',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_find_chromium',
    description:
      'Disabled by design: does not scan user-installed browser processes. Use managed browser sessions (browser_launch/browser_attach with explicit endpoint) instead.',
    inputSchema: {
      type: 'object',
      properties: {
        processName: {
          type: 'string',
          description: 'Process name pattern to search for (e.g., "chrome", "msedge", "chromium")',
          default: 'chromium',
        },
        windowClass: {
          type: 'string',
          description: 'Window class pattern to match (e.g., "Chrome_WidgetWin")',
        },
      },
    },
  },
  {
    name: 'process_check_debug_port',
    description: 'Check if a process has a debug port enabled for CDP attachment.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID to check',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'process_launch_debug',
    description: 'Launch an executable with remote debugging port enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        executablePath: {
          type: 'string',
          description: 'Full path to the executable to launch',
        },
        debugPort: {
          type: 'number',
          description: 'Debug port to use (default: 9222)',
          default: 9222,
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional command line arguments',
        },
      },
      required: ['executablePath'],
    },
  },
  {
    name: 'process_kill',
    description: 'Kill a process by PID.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID to kill',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read memory from a process at a specific address. Requires process to be attached.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        address: {
          type: 'string',
          description: 'Memory address to read (hex string like "0x12345678")',
        },
        size: {
          type: 'number',
          description: 'Number of bytes to read',
        },
      },
      required: ['pid', 'address', 'size'],
    },
  },
  {
    name: 'memory_write',
    description: 'Write data to process memory at a specific address. Requires process to be attached.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        address: {
          type: 'string',
          description: 'Memory address to write to (hex string like "0x12345678")',
        },
        data: {
          type: 'string',
          description: 'Data to write (hex string or base64)',
        },
        encoding: {
          type: 'string',
          enum: ['hex', 'base64'],
          description: 'Encoding of the data parameter',
          default: 'hex',
        },
      },
      required: ['pid', 'address', 'data'],
    },
  },
  {
    name: 'memory_scan',
    description: 'Scan process memory for a pattern or value. Useful for finding game values.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        pattern: {
          type: 'string',
          description: 'Pattern to search for (hex bytes like "48 8B 05" or value)',
        },
        patternType: {
          type: 'string',
          enum: ['hex', 'int32', 'int64', 'float', 'double', 'string'],
          description: 'Type of pattern to search',
          default: 'hex',
        },
      },
      required: ['pid', 'pattern'],
    },
  },
  {
    name: 'memory_check_protection',
    description: 'Check memory protection flags at a specific address. Detects if memory is writable/readable/executable.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        address: {
          type: 'string',
          description: 'Memory address to check (hex string like "0x12345678")',
        },
      },
      required: ['pid', 'address'],
    },
  },
  {
    name: 'memory_protect',
    description:
      'Alias of memory_check_protection. Check memory protection flags at a specific address.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        address: {
          type: 'string',
          description: 'Memory address to check (hex string like "0x12345678")',
        },
      },
      required: ['pid', 'address'],
    },
  },
  {
    name: 'memory_scan_filtered',
    description: 'Scan memory within a filtered set of addresses (secondary scan). Useful for narrowing down results.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        pattern: {
          type: 'string',
          description: 'Pattern to search for',
        },
        addresses: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of addresses to scan within (from previous scan)',
        },
        patternType: {
          type: 'string',
          enum: ['hex', 'int32', 'int64', 'float', 'double', 'string'],
          description: 'Type of pattern to search',
          default: 'hex',
        },
      },
      required: ['pid', 'pattern', 'addresses'],
    },
  },
  {
    name: 'memory_batch_write',
    description: 'Write multiple memory patches at once. Useful for applying cheats or modifications.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        patches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              address: { type: 'string', description: 'Memory address (hex)' },
              data: { type: 'string', description: 'Data to write' },
              encoding: { type: 'string', enum: ['hex', 'base64'], default: 'hex' },
            },
            required: ['address', 'data'],
          },
          description: 'Array of patches to apply',
        },
      },
      required: ['pid', 'patches'],
    },
  },
  {
    name: 'memory_dump_region',
    description: 'Dump a memory region to a file for analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        address: {
          type: 'string',
          description: 'Start address (hex)',
        },
        size: {
          type: 'number',
          description: 'Number of bytes to dump',
        },
        outputPath: {
          type: 'string',
          description: 'Output file path',
        },
      },
      required: ['pid', 'address', 'size', 'outputPath'],
    },
  },
  {
    name: 'memory_list_regions',
    description: 'List all memory regions in a process with protection flags.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
      },
      required: ['pid'],
    },
  },
  // Injection tools
  {
    name: 'inject_dll',
    description: 'Inject a DLL into a target process using CreateRemoteThread + LoadLibraryA. Requires administrator privileges.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        dllPath: {
          type: 'string',
          description: 'Full path to the DLL file to inject',
        },
      },
      required: ['pid', 'dllPath'],
    },
  },
  {
    name: 'module_inject_dll',
    description: 'Alias of inject_dll. Inject a DLL into a target process.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        dllPath: {
          type: 'string',
          description: 'Full path to the DLL file to inject',
        },
      },
      required: ['pid', 'dllPath'],
    },
  },
  {
    name: 'inject_shellcode',
    description: 'Inject and execute shellcode in a target process. Uses VirtualAllocEx + WriteProcessMemory + CreateRemoteThread.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        shellcode: {
          type: 'string',
          description: 'Shellcode bytes (hex string or base64)',
        },
        encoding: {
          type: 'string',
          enum: ['hex', 'base64'],
          description: 'Encoding of shellcode',
          default: 'hex',
        },
      },
      required: ['pid', 'shellcode'],
    },
  },
  {
    name: 'module_inject_shellcode',
    description: 'Alias of inject_shellcode. Inject and execute shellcode in a target process.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
        shellcode: {
          type: 'string',
          description: 'Shellcode bytes (hex string or base64)',
        },
        encoding: {
          type: 'string',
          enum: ['hex', 'base64'],
          description: 'Encoding of shellcode',
          default: 'hex',
        },
      },
      required: ['pid', 'shellcode'],
    },
  },
  // Anti-detection tools
  {
    name: 'check_debug_port',
    description: 'Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort).',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'enumerate_modules',
    description: 'List all loaded modules (DLLs) in a process with their base addresses.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'module_list',
    description: 'Alias of enumerate_modules. List loaded modules (DLLs) in a process.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Target process ID',
        },
      },
      required: ['pid'],
    },
  },
  // Reclassified reverse-engineering helper
  {
    name: 'electron_attach',
    description: 'Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS. Useful for debugging Electron applications or extracting extension data.',
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'CDP debugger port (default: 9229 for --inspect, 9222 for --remote-debugging-port)',
          default: 9229,
        },
        wsEndpoint: {
          type: 'string',
          description: 'Full WebSocket endpoint (overrides port). e.g. ws://127.0.0.1:9229/devtools/browser/xxx',
        },
        evaluate: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the first matching page',
        },
        pageUrl: {
          type: 'string',
          description: 'Filter pages by URL substring (e.g. "extension-host" to target VS Code extension host)',
        },
      },
    },
  },
];

export type ProcessToolName = (typeof processToolDefinitions)[number]['name'];
