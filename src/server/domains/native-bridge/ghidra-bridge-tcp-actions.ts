/**
 * ghidra_bridge TCP backend — action → bridge eval/exec mapping.
 *
 * Each action runs one (cheap, expression-only) or two (exec defines a
 * helper, eval calls it) round-trips against the pip ghidra_bridge server.
 * The helpers speak the Ghidra flat API (`currentProgram` lives in the
 * server's `__main__` namespace per the bridge README) and are written in
 * Python 2/3-compatible syntax — the server-side script engine is Jython
 * 2.7 in stock Ghidra and Python 3 under PyGhidra.
 *
 * Injection safety: every user-supplied value (function names, search
 * patterns, script paths) travels as an eval kwarg — the server makes them
 * the expression's locals — never spliced into the Python source itself.
 */

import {
  ghidraBridgeEval,
  ghidraBridgeExec,
  ghidraBridgePing,
  type GhidraBridgeTcpOptions,
} from './ghidra-bridge-tcp';

const COMMON_OPTIONS: GhidraBridgeTcpOptions = {};

export interface TcpActionResult extends Record<string, unknown> {
  success: boolean;
  action: string;
  backend: 'ghidra-bridge-py';
}

export function tcpBackendOptions(): GhidraBridgeTcpOptions {
  return COMMON_OPTIONS;
}

export async function tcpStatus(): Promise<TcpActionResult> {
  const reachable = await ghidraBridgePing(COMMON_OPTIONS);
  return { success: true, action: 'status', backend: 'ghidra-bridge-py', reachable };
}

export async function tcpListFunctions(): Promise<TcpActionResult> {
  const functions = await ghidraBridgeEval(
    '[f.getName() for f in currentProgram.getFunctionManager().getFunctions(True)]',
    {},
    COMMON_OPTIONS,
  );
  return { success: true, action: 'list_functions', backend: 'ghidra-bridge-py', functions };
}

/**
 * decompile_function: the decompiler is stateful (open/dispose), which eval's
 * single-expression grammar cannot express — so exec defines a helper first,
 * then eval invokes it. The helper is re-defined on every call (idempotent).
 */
const DECOMPILE_HELPER = [
  'def _jshook_bridge_decompile_fn(_jshook_fn):',
  '    from ghidra.app.decompiler import DecompInterface',
  '    from ghidra.util.task import ConsoleTaskMonitor',
  '    _jshook_decomp = DecompInterface()',
  '    _jshook_decomp.openProgram(currentProgram)',
  '    try:',
  '        for _jshook_f in currentProgram.getFunctionManager().getFunctions(True):',
  '            if _jshook_f.getName() == _jshook_fn:',
  '                _jshook_r = _jshook_decomp.decompileFunction(_jshook_f, 60, ConsoleTaskMonitor())',
  '                if _jshook_r is not None and _jshook_r.decompileCompleted() and _jshook_r.getDecompiledFunction() is not None:',
  '                    return _jshook_r.getDecompiledFunction().getC()',
  '                return None',
  '        return None',
  '    finally:',
  '        _jshook_decomp.dispose()',
].join('\n');

export async function tcpDecompileFunction(functionName: string): Promise<TcpActionResult> {
  await ghidraBridgeExec(DECOMPILE_HELPER, {}, COMMON_OPTIONS);
  const decompiled = await ghidraBridgeEval(
    '_jshook_bridge_decompile_fn(_jshook_fn)',
    { _jshook_fn: functionName },
    COMMON_OPTIONS,
  );
  return {
    success: true,
    action: 'decompile_function',
    backend: 'ghidra-bridge-py',
    functionName,
    decompiled,
  };
}

const XREFS_HELPER = [
  'def _jshook_bridge_xrefs_fn(_jshook_fn):',
  '    _jshook_out = []',
  '    for _jshook_f in currentProgram.getFunctionManager().getFunctions(True):',
  '        if _jshook_f.getName() == _jshook_fn:',
  '            for _jshook_ref in getReferencesTo(_jshook_f.getEntryPoint()):',
  "                _jshook_out.append(str(_jshook_ref.getFromAddress()) + ' -> ' + str(_jshook_ref.getReferenceType()))",
  '    return _jshook_out',
].join('\n');

export async function tcpGetXrefs(functionName: string): Promise<TcpActionResult> {
  await ghidraBridgeExec(XREFS_HELPER, {}, COMMON_OPTIONS);
  const xrefs = await ghidraBridgeEval(
    '_jshook_bridge_xrefs_fn(_jshook_fn)',
    { _jshook_fn: functionName },
    COMMON_OPTIONS,
  );
  return {
    success: true,
    action: 'get_xrefs',
    backend: 'ghidra-bridge-py',
    symbol: functionName,
    xrefs,
  };
}

const STRINGS_HELPER = [
  'def _jshook_bridge_strings_fn(_jshook_needle):',
  '    _jshook_out = []',
  '    _jshook_iter = currentProgram.getListing().getDefinedData(True)',
  '    while _jshook_iter.hasNext():',
  '        _jshook_d = _jshook_iter.next()',
  '        _jshook_tn = str(_jshook_d.getDataType()).lower()',
  "        if 'string' in _jshook_tn or 'unicode' in _jshook_tn:",
  '            _jshook_s = str(_jshook_d.getValue())',
  '            if _jshook_needle is None or _jshook_needle in _jshook_s:',
  "                _jshook_out.append(str(_jshook_d.getAddress()) + ': ' + _jshook_s)",
  '            if len(_jshook_out) >= 500:',
  '                break',
  '    return _jshook_out',
].join('\n');

export async function tcpSearchStrings(
  searchPattern: string | undefined,
): Promise<TcpActionResult> {
  await ghidraBridgeExec(STRINGS_HELPER, {}, COMMON_OPTIONS);
  const strings = await ghidraBridgeEval(
    '_jshook_bridge_strings_fn(_jshook_needle)',
    { _jshook_needle: searchPattern ?? null },
    COMMON_OPTIONS,
  );
  return { success: true, action: 'search_strings', backend: 'ghidra-bridge-py', strings };
}

export async function tcpGetSegments(): Promise<TcpActionResult> {
  const segments = await ghidraBridgeEval(
    '[str(_jshook_b.getName()) + " " + str(_jshook_b.getStart()) + "-" + str(_jshook_b.getEnd()) + " (" + str(_jshook_b.getSize()) + " bytes)" for _jshook_b in currentProgram.getMemory().getBlocks()]',
    {},
    COMMON_OPTIONS,
  );
  return { success: true, action: 'get_segments', backend: 'ghidra-bridge-py', segments };
}

const RUN_SCRIPT_HELPER = [
  'def _jshook_bridge_run_script_fn(_jshook_path):',
  "    _jshook_ns = {'__name__': '__jshook_script__'}",
  '    _jshook_f = open(_jshook_path)',
  '    try:',
  "        exec(compile(_jshook_f.read(), _jshook_path, 'exec'), _jshook_ns)",
  '    finally:',
  '        _jshook_f.close()',
].join('\n');

export async function tcpRunScript(scriptPath: string): Promise<TcpActionResult> {
  await ghidraBridgeExec(RUN_SCRIPT_HELPER, {}, COMMON_OPTIONS);
  await ghidraBridgeEval(
    '_jshook_bridge_run_script_fn(_jshook_path)',
    { _jshook_path: scriptPath },
    COMMON_OPTIONS,
  );
  return {
    success: true,
    action: 'run_script',
    backend: 'ghidra-bridge-py',
    scriptPath,
    result: 'script executed in the bridge server context (exec has no return value)',
  };
}

/**
 * Dispatch a ghidra_bridge action over the TCP backend. Returns undefined
 * when the action has no TCP mapping (open_project) so the caller can
 * surface a targeted unsupported message.
 */
export async function dispatchTcpAction(
  action: string,
  args: Record<string, unknown>,
): Promise<TcpActionResult | undefined> {
  switch (action) {
    case 'status':
      return tcpStatus();
    case 'list_functions':
      return tcpListFunctions();
    case 'decompile_function': {
      const name = args.functionName as string;
      if (!name) throw new Error('functionName is required for decompile_function');
      return tcpDecompileFunction(name);
    }
    case 'run_script': {
      const scriptPath = args.scriptPath as string;
      if (!scriptPath) throw new Error('scriptPath is required for run_script');
      return tcpRunScript(scriptPath);
    }
    case 'get_xrefs': {
      const name = args.functionName as string;
      if (!name) throw new Error('functionName is required for get_xrefs');
      return tcpGetXrefs(name);
    }
    case 'search_strings':
      return tcpSearchStrings(args.searchPattern as string | undefined);
    case 'get_segments':
      return tcpGetSegments();
    default:
      return undefined;
  }
}
