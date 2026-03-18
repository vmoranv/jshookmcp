export interface SkipListConfig {
  electronPath: string;
  miniappPath: string;
  asarPath: string;
}

export function buildSkipSet(config: SkipListConfig): Set<string> {
  return new Set([
    'captcha_wait',
    'register_account_flow',
    'inject_dll',
    'module_inject_dll',
    'inject_shellcode',
    'module_inject_shellcode',
    'memory_write',
    'memory_batch_write',
    'memory_protect',
    'process_kill',
    'frida_bridge',
    'jadx_bridge',
    'camoufox_server_launch',
    'camoufox_server_close',
    'browser_attach',
    'extension_execute_in_context',
    'wasm_offline_run',
    'module_list',
    'check_debug_port',
    'debugger_load_session',
    'install_extension',
    'captcha_vision_solve',
    'widget_challenge_solve',
    'run_extension_workflow', // 动态获取的 workflowId 可能需要额外配置，暂跳过
    ...(!config.electronPath ? ['electron_attach', 'electron_inspect_app'] : []),
    ...(!config.miniappPath
      ? ['miniapp_pkg_analyze', 'miniapp_pkg_scan', 'miniapp_pkg_unpack']
      : []),
    ...(!config.asarPath ? ['asar_extract'] : []),
  ]);
}
