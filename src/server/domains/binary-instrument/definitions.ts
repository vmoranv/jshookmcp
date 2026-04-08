import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const binaryInstrumentTools: Tool[] = [
  tool('frida_attach')
    .desc(
      'Attach Frida to a local process, PID, or binary path and create a binary instrumentation session.',
    )
    .string('target', 'Target process name, PID, or binary path')
    .required('target')
    .build(),

  tool('frida_enumerate_modules')
    .desc('Enumerate modules for an attached Frida session.')
    .string('sessionId', 'Session id returned by frida_attach')
    .required('sessionId')
    .readOnly()
    .idempotent()
    .build(),

  tool('ghidra_analyze')
    .desc(
      'Run binary metadata analysis with Ghidra headless when available, with structured fallback output when unavailable.',
    )
    .string('binaryPath', 'Absolute or workspace-relative path to the binary file')
    .number('timeout', 'Optional timeout in milliseconds for headless analysis')
    .required('binaryPath')
    .build(),

  tool('generate_hooks')
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
    .required('symbols')
    .build(),

  tool('unidbg_emulate')
    .desc(
      'Attempt to emulate a native function with unidbg, or return structured mock output when unavailable.',
    )
    .string('binaryPath', 'Path to the target binary')
    .string('functionName', 'Function name to emulate')
    .array('args', { type: 'string' }, 'Optional string arguments forwarded to emulation')
    .required('binaryPath', 'functionName')
    .build(),

  tool('frida_run_script')
    .desc('Execute a Frida JavaScript snippet inside an attached Frida session.')
    .string('sessionId', 'Session id returned by frida_attach')
    .string('script', 'Frida JavaScript to execute')
    .required('sessionId', 'script')
    .build(),

  tool('frida_detach')
    .desc('Detach from a Frida session and clean up resources.')
    .string('sessionId', 'Session id returned by frida_attach')
    .required('sessionId')
    .build(),

  tool('frida_list_sessions')
    .desc('List all active Frida sessions.')
    .readOnly()
    .idempotent()
    .build(),

  tool('frida_generate_script')
    .desc('Generate a Frida interceptor script from templates (trace, intercept, replace, log).')
    .string('target', 'Target binary or module name')
    .string('template', 'Hook template type: trace, intercept, replace, log')
    .string('functionName', 'Function name to generate hook for')
    .required('target', 'template')
    .build(),

  tool('get_available_plugins')
    .desc('List all available binary analysis plugins (frida, ghidra, ida, jadx).')
    .readOnly()
    .idempotent()
    .build(),

  tool('ghidra_decompile')
    .desc('Decompile a specific function using Ghidra headless analysis.')
    .string('binaryPath', 'Path to the binary file')
    .string('functionName', 'Function name to decompile')
    .required('binaryPath', 'functionName')
    .build(),

  tool('ida_decompile')
    .desc('Decompile a function using IDA Pro via plugin bridge.')
    .string('binaryPath', 'Path to the binary file')
    .string('functionName', 'Function name to decompile')
    .required('binaryPath', 'functionName')
    .build(),

  tool('jadx_decompile')
    .desc('Decompile an APK class or method using JADX via plugin bridge.')
    .string('apkPath', 'Path to the APK file')
    .string('className', 'Fully qualified class name')
    .string('methodName', 'Method name to decompile')
    .required('apkPath', 'className')
    .build(),

  tool('unidbg_launch')
    .desc('Launch an ARM/ARM64 .so library in the Unidbg emulator. First call ~3-5s warmup.')
    .string('soPath', 'Path to the .so library file')
    .string('arch', 'Architecture: arm or arm64')
    .required('soPath')
    .build(),

  tool('unidbg_call')
    .desc('Call a JNI function in a running Unidbg emulator session.')
    .string('sessionId', 'Session id from unidbg_launch')
    .string('functionName', 'JNI function name to call')
    .required('sessionId', 'functionName')
    .build(),

  tool('unidbg_trace')
    .desc('Get an execution trace from an Unidbg session (full/basic/instruction modes).')
    .string('sessionId', 'Session id from unidbg_launch')
    .required('sessionId')
    .build(),

  tool('export_hook_script')
    .desc('Export generated hook templates as a complete, runnable Frida script.')
    .string('hookTemplates', 'JSON array of hook template objects')
    .build(),

  tool('frida_enumerate_functions')
    .desc('Enumerate exported functions for a specific module in a Frida session.')
    .string('sessionId', 'Session id returned by frida_attach')
    .string('moduleName', 'Module name to enumerate exports from')
    .required('sessionId', 'moduleName')
    .readOnly()
    .idempotent()
    .build(),

  tool('frida_find_symbols')
    .desc('Search for symbols matching a pattern in a Frida session using ApiResolver.')
    .string('sessionId', 'Session id returned by frida_attach')
    .string('pattern', 'Symbol search pattern (e.g. "exports:*libssl*SSL*")')
    .required('sessionId', 'pattern')
    .readOnly()
    .idempotent()
    .build(),
];
