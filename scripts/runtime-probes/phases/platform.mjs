import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function runPlatformPhase(ctx) {
  const { report, clients, helpers, state, constants } = ctx;
  const { client } = clients;
  const { callTool, callToolCaptureError, buildMockElectronExe, buildMockAsar, buildMiniappPkg } =
    helpers;
  const { BODY_MARKER, MEMORY_MARKER } = constants;

  report.platform.capabilities = await callTool(client, 'platform_capabilities', {}, 15000);

  state.platformProbeDir = await mkdtemp(join(tmpdir(), 'jshook-platform-audit-'));
  const electronExePath = join(state.platformProbeDir, 'mock-electron.exe');
  const electronUserdataDir = join(state.platformProbeDir, 'userdata');
  const mockElectronAppDir = join(state.platformProbeDir, 'mock-electron-app');
  const mockElectronResourcesDir = join(mockElectronAppDir, 'resources');
  const asarPath = join(mockElectronResourcesDir, 'app.asar');
  const miniappDir = join(state.platformProbeDir, 'miniapp');
  const miniappPkgPath = join(miniappDir, 'app.pkg');
  const dummyApkPath = join(state.platformProbeDir, 'runtime-audit.apk');
  const dummySoPath = join(state.platformProbeDir, 'libaudit.so');
  const v8BytecodeFixturePath = join(state.platformProbeDir, 'runtime-audit-bytecode.jsc');

  state.platformPaths = {
    electronExePath,
    electronUserdataDir,
    mockElectronAppDir,
    asarPath,
    miniappDir,
    miniappPkgPath,
    dummyApkPath,
    dummySoPath,
    v8BytecodeFixturePath,
  };

  await mkdir(electronUserdataDir, { recursive: true });
  await mkdir(mockElectronResourcesDir, { recursive: true });
  await mkdir(miniappDir, { recursive: true });
  await writeFile(
    electronExePath,
    buildMockElectronExe([0x31, 0x30, 0x31, 0x30, 0x72, 0x31, 0x30, 0x31]),
  );
  await writeFile(join(electronUserdataDir, 'config.json'), JSON.stringify({ key: 'value' }));
  await writeFile(join(electronUserdataDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
  await writeFile(
    asarPath,
    buildMockAsar([
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'runtime-audit-electron-app',
            version: '1.0.0',
            main: 'src/main.js',
            dependencies: { electron: '^30.0.0' },
          },
          null,
          2,
        ),
      },
      {
        path: 'src/main.js',
        content: [
          "const path = require('node:path');",
          "const { BrowserWindow } = require('electron');",
          'function createWindow() {',
          '  return new BrowserWindow({',
          '    width: 800,',
          '    height: 600,',
          '    webPreferences: {',
          "      preload: path.join(__dirname, 'preload.js'),",
          '    },',
          '    devTools: true,',
          '  });',
          '}',
          'module.exports = { createWindow };',
          '',
        ].join('\n'),
      },
      {
        path: 'src/preload.js',
        content: "window.__runtimeAuditElectronPreload = 'ready';\n",
      },
      { path: 'src/utils.js', content: 'export function helper() { return 1; }\n' },
    ]),
  );
  await writeFile(
    miniappPkgPath,
    buildMiniappPkg([
      {
        path: 'app.json',
        content: JSON.stringify({
          appId: 'wx-runtime-audit',
          pages: ['pages/home/index'],
          usingComponents: { auditCard: '/components/card/index' },
        }),
      },
      {
        path: 'app-config.json',
        content: JSON.stringify({
          appid: 'wx-runtime-audit',
          pages: ['pages/home/index'],
        }),
      },
      {
        path: 'pages/home/index.js',
        content: `module.exports = { marker: ${JSON.stringify(BODY_MARKER)} };\n`,
      },
      {
        path: 'components/card/index.js',
        content: 'Component({ properties: { title: String } });\n',
      },
      {
        path: 'page-frame.html',
        content: '<div id="runtime-miniapp-frame"></div>\n',
      },
    ]),
  );
  await writeFile(dummyApkPath, Buffer.from('PK\x03\x04runtime-audit-apk-fixture', 'binary'));
  await writeFile(dummySoPath, Buffer.from('\x7fELFruntime-audit-so-fixture', 'binary'));
  await writeFile(
    v8BytecodeFixturePath,
    [
      `const auditBytecodeMarker = ${JSON.stringify(MEMORY_MARKER)};`,
      'function runtimeAuditBytecodeProbe(input) {',
      "  const value = String(input || 'fallback');",
      "  return value + ':' + auditBytecodeMarker;",
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  report.platform.electronFuses = await callTool(
    client,
    'electron_check_fuses',
    { exePath: electronExePath },
    15000,
  );
  report.platform.electronUserdata = await callTool(
    client,
    'electron_scan_userdata',
    { dirPath: electronUserdataDir, maxFiles: 10, maxFileSizeKB: 32 },
    15000,
  );
  report.electron.inspectApp = await callToolCaptureError(
    client,
    'electron_inspect_app',
    { appPath: mockElectronAppDir },
    30000,
  );
  report.electron.patchFuses = await callToolCaptureError(
    client,
    'electron_patch_fuses',
    { exePath: electronExePath, profile: 'debug', createBackup: false },
    30000,
  );
  report.platform.asarExtract = await callTool(
    client,
    'asar_extract',
    { inputPath: asarPath, listOnly: true },
    15000,
  );
  report.platform.asarSearch = await callTool(
    client,
    'asar_search',
    { inputPath: asarPath, pattern: 'isPro|marker', fileGlob: '*.js', maxResults: 10 },
    15000,
  );
  report.platform.miniappScan = await callTool(
    client,
    'miniapp_pkg_scan',
    { searchPath: miniappDir },
    15000,
  );
  const miniappUnpackDir = join(state.platformProbeDir, 'miniapp-unpacked');
  report.platform.miniappUnpack = await callTool(
    client,
    'miniapp_pkg_unpack',
    { inputPath: miniappPkgPath, outputDir: miniappUnpackDir },
    30000,
  );
  report.platform.miniappAnalyze = await callTool(
    client,
    'miniapp_pkg_analyze',
    { unpackedDir: miniappUnpackDir },
    30000,
  );
}
