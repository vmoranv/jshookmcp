import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const binaryInstrumentTools: Tool[] = [
  tool('frida_attach', (t) =>
    t
      .desc(
        'Attach Frida to a local process, PID, or binary path and create a binary instrumentation session.',
      )
      .string('target', 'Target process name, PID, or binary path')
      .required('target'),
  ),
  tool('frida_enumerate_modules', (t) =>
    t
      .desc('Enumerate modules for an attached Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .required('sessionId')
      .query(),
  ),
  tool('ghidra_analyze', (t) =>
    t
      .desc(
        'Run binary metadata analysis with Ghidra headless when available, with structured fallback output when unavailable.',
      )
      .string('binaryPath', 'Absolute or workspace-relative path to the binary file')
      .number('timeout', 'Optional timeout in milliseconds for headless analysis')
      .required('binaryPath'),
  ),
  tool('generate_hooks', (t) =>
    t
      .desc('Generate a Frida interceptor script for a list of symbols.')
      .array('symbols', { type: 'string' }, 'Symbol names to hook')
      .object(
        'options',
        {
          includeArgs: { type: 'boolean', description: 'Emit argument logging on function entry' },
          includeRetAddr: {
            type: 'boolean',
            description: 'Emit return-address logging on function entry',
          },
        },
        'Optional Frida hook generation flags',
      )
      .required('symbols'),
  ),
  tool('unidbg_emulate', (t) =>
    t
      .desc(
        'Attempt to emulate a native function with unidbg, or return structured mock output when unavailable.',
      )
      .string('binaryPath', 'Path to the target binary')
      .string('functionName', 'Function name to emulate')
      .array('args', { type: 'string' }, 'Optional string arguments forwarded to emulation')
      .required('binaryPath', 'functionName'),
  ),
  tool('frida_run_script', (t) =>
    t
      .desc('Execute a Frida JavaScript snippet inside an attached Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .string('script', 'Frida JavaScript to execute')
      .required('sessionId', 'script'),
  ),
  tool('frida_detach', (t) =>
    t
      .desc('Detach from a Frida session and clean up resources.')
      .string('sessionId', 'Session id returned by frida_attach')
      .required('sessionId'),
  ),
  tool('frida_list_sessions', (t) => t.desc('List all active Frida sessions.').query()),
  tool('frida_generate_script', (t) =>
    t
      .desc('Generate a Frida interceptor script from templates (trace, intercept, replace, log).')
      .string('target', 'Target binary or module name')
      .string('template', 'Hook template type: trace, intercept, replace, log')
      .string('functionName', 'Function name to generate hook for')
      .required('target', 'template'),
  ),
  tool('get_available_plugins', (t) =>
    t.desc('List all available binary analysis plugins (frida, ghidra, ida, jadx).').query(),
  ),
  tool('ghidra_decompile', (t) =>
    t
      .desc('Decompile a specific function using Ghidra headless analysis.')
      .string('binaryPath', 'Path to the binary file')
      .string('functionName', 'Function name to decompile')
      .required('binaryPath', 'functionName'),
  ),
  tool('ida_decompile', (t) =>
    t
      .desc('Decompile a function using IDA Pro via plugin bridge.')
      .string('binaryPath', 'Path to the binary file')
      .string('functionName', 'Function name to decompile')
      .required('binaryPath', 'functionName'),
  ),
  tool('jadx_decompile', (t) =>
    t
      .desc('Decompile an APK class or method using JADX via plugin bridge.')
      .string('apkPath', 'Path to the APK file')
      .string('className', 'Fully qualified class name')
      .string('methodName', 'Method name to decompile')
      .required('apkPath', 'className'),
  ),
  tool('unidbg_launch', (t) =>
    t
      .desc('Launch an ARM/ARM64 .so library in the Unidbg emulator. First call ~3-5s warmup.')
      .string('soPath', 'Path to the .so library file')
      .string('arch', 'Architecture: arm or arm64')
      .required('soPath'),
  ),
  tool('unidbg_call', (t) =>
    t
      .desc('Call a JNI function in a running Unidbg emulator session.')
      .string('sessionId', 'Session id from unidbg_launch')
      .string('functionName', 'JNI function name to call')
      .required('sessionId', 'functionName'),
  ),
  tool('unidbg_trace', (t) =>
    t
      .desc('Get an execution trace from an Unidbg session (full/basic/instruction modes).')
      .string('sessionId', 'Session id from unidbg_launch')
      .required('sessionId'),
  ),
  tool('export_hook_script', (t) =>
    t
      .desc('Export generated hook templates as a complete, runnable Frida script.')
      .string('hookTemplates', 'JSON array of hook template objects'),
  ),
  tool('frida_enumerate_functions', (t) =>
    t
      .desc('Enumerate exported functions for a specific module in a Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .string('moduleName', 'Module name to enumerate exports from')
      .required('sessionId', 'moduleName')
      .query(),
  ),
  tool('frida_find_symbols', (t) =>
    t
      .desc('Search for symbols matching a pattern in a Frida session using ApiResolver.')
      .string('sessionId', 'Session id returned by frida_attach')
      .string('pattern', 'Symbol search pattern (e.g. "exports:*libssl*SSL*")')
      .required('sessionId', 'pattern')
      .query(),
  ),
];
