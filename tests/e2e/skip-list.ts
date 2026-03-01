export interface SkipListConfig {
  electronPath: string;
  miniappPath: string;
}

export function buildSkipSet(config: SkipListConfig): Set<string> {
  return new Set([
    'captcha_wait', 'register_account_flow',
    'inject_dll', 'module_inject_dll', 'inject_shellcode', 'module_inject_shellcode',
    'memory_write', 'memory_batch_write', 'memory_protect',
    'process_kill',
    'frida_bridge', 'jadx_bridge',
    'camoufox_server_launch', 'camoufox_server_close',
    'browser_attach', 'extension_execute_in_context', 'wasm_offline_run',
    'module_list', 'check_debug_port',
    'debugger_load_session',
    ...(!config.electronPath ? ['electron_attach', 'electron_inspect_app'] : []),
    ...(!config.miniappPath ? ['miniapp_pkg_analyze', 'miniapp_pkg_scan', 'miniapp_pkg_unpack'] : []),
  ]);
}
