#!/usr/bin/env node

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  AUTH_API_KEY_MARKER,
  AUTH_BEARER_MARKER,
  AUTH_SIGNATURE_MARKER,
  BODY_MARKER,
  CONSOLE_EXCEPTION_MARKER,
  CONSOLE_LOG_MARKER,
  GRAPHQL_BUFFER_PROBE_CODE,
  GRAPHQL_MARKER,
  HEAP_MARKER,
  HOOK_PRESET_MARKER,
  HTTP2_MARKER,
  INTERCEPT_MARKER,
  MEMORY_MARKER,
  ROOT_RELOAD_KEY,
  SCRIPT_TIMEOUT_MS,
  SOURCEMAP_MARKER,
  SSE_MARKER,
  TEST_CERT_PEM,
  TEST_KEY_PEM,
  WASM_MARKER,
  WEBPACK_MARKER,
  WS_MAGIC_GUID,
} from './runtime-probes/constants.mjs';
import { runAdvancedRuntimePhase } from './runtime-probes/phases/advanced-runtime/index.mjs';
import { prepareRuntimeFixtures } from './runtime-probes/phases/bootstrap.mjs';
import { runBrowserPhase } from './runtime-probes/phases/browser/index.mjs';
import { runMaintenanceWorkflowPhase } from './runtime-probes/phases/maintenance-workflow.mjs';
import { runStateBoardPhase } from './runtime-probes/phases/macro-stateboard.mjs';
import { runMetaPhase } from './runtime-probes/phases/meta.mjs';
import { runNetworkTlsPhase } from './runtime-probes/phases/network-tls.mjs';
import { runPlatformPhase } from './runtime-probes/phases/platform.mjs';
import { runProcessPhase } from './runtime-probes/phases/process/index.mjs';
import { runProtocolPhase } from './runtime-probes/phases/protocol.mjs';
import { runRuntimeObservabilityPhase } from './runtime-probes/phases/runtime-observability/index.mjs';
import { createEmptyReport, summarizeReport } from './runtime-probes/report.mjs';
import {
  buildRuntimeCoverage,
  callTool,
  callToolCaptureError,
  extractString,
  findFirstModule,
  findRegion,
  findRequestByUrl,
  flattenStrings,
  getArrayFromRecord,
  getCapability,
  getTabularRowValue,
  isCapabilityAvailable,
  isRecord,
  pemToDerHex,
  pickBrowserCdpTarget,
  pickScriptForV8Inspection,
  takeHexBytes,
  withTimeout,
} from './runtime-probes/helpers/core.mjs';
import {
  buildMockAsar,
  buildMockElectronExe,
  buildMiniappPkg,
  createRegistryFixtures,
} from './runtime-probes/helpers/fixtures.mjs';
import {
  buildMinimalTlsClientHelloRecordHex,
  createClientTransport,
  createTlsDecryptFixture,
  getCliValue,
  getFreePort,
  getNewestChromePid,
  getPreferredBrowserExecutable,
  sendRawHttpRequest,
  terminateProcessId,
  terminateProcessTree,
  waitForBrowserEndpoint,
} from './runtime-probes/helpers/runtime.mjs';
import { createProbeServer } from './runtime-probes/server/index.mjs';

const phaseConstants = {
  BODY_MARKER,
  HTTP2_MARKER,
  MEMORY_MARKER,
  HOOK_PRESET_MARKER,
  ROOT_RELOAD_KEY,
  TEST_CERT_PEM,
  CONSOLE_LOG_MARKER,
  CONSOLE_EXCEPTION_MARKER,
  AUTH_BEARER_MARKER,
  AUTH_API_KEY_MARKER,
  AUTH_SIGNATURE_MARKER,
  INTERCEPT_MARKER,
  HEAP_MARKER,
  SOURCEMAP_MARKER,
  GRAPHQL_BUFFER_PROBE_CODE,
  WEBPACK_MARKER,
};

const serverConstants = {
  BODY_MARKER,
  GRAPHQL_MARKER,
  HTTP2_MARKER,
  ROOT_RELOAD_KEY,
  SSE_MARKER,
  SOURCEMAP_MARKER,
  TEST_CERT_PEM,
  TEST_KEY_PEM,
  WASM_MARKER,
  WEBPACK_MARKER,
  WS_MAGIC_GUID,
};

async function resolveTlsFixtureConstants() {
  try {
    const require = createRequire(import.meta.url);
    const playwrightPackageJson = require.resolve('playwright-core/package.json');
    const cryptoModuleUrl = pathToFileURL(
      join(dirname(playwrightPackageJson), 'lib', 'server', 'utils', 'crypto.js'),
    ).href;
    const module = await import(cryptoModuleUrl);
    const generated = module.generateSelfSignedCertificate?.('localhost');
    if (generated?.cert && generated?.key) {
      return {
        certPem: generated.cert,
        keyPem: generated.key,
      };
    }
  } catch {}

  return {
    certPem: TEST_CERT_PEM,
    keyPem: TEST_KEY_PEM,
  };
}

const phaseHelpers = {
  withTimeout,
  callTool,
  callToolCaptureError,
  createClientTransport,
  createRegistryFixtures,
  isRecord,
  isCapabilityAvailable,
  getCapability,
  extractString,
  flattenStrings,
  getArrayFromRecord,
  findFirstModule,
  findRegion,
  takeHexBytes,
  findRequestByUrl,
  pickScriptForV8Inspection,
  pickBrowserCdpTarget,
  getFreePort,
  pemToDerHex,
  createTlsDecryptFixture,
  buildMinimalTlsClientHelloRecordHex,
  buildMockElectronExe,
  buildMockAsar,
  buildMiniappPkg,
  sendRawHttpRequest,
  waitForBrowserEndpoint,
  getPreferredBrowserExecutable,
  terminateProcessTree,
  terminateProcessId,
  getNewestChromePid,
  getTabularRowValue,
};

async function main() {
  const tlsFixture = await resolveTlsFixtureConstants();
  phaseConstants.TEST_CERT_PEM = tlsFixture.certPem;
  serverConstants.TEST_CERT_PEM = tlsFixture.certPem;
  serverConstants.TEST_KEY_PEM = tlsFixture.keyPem;

  const jsonOnly = process.argv.includes('--json');
  const jsonOutputPath = (() => {
    const cliValue = getCliValue('--json-out');
    if (typeof cliValue === 'string' && cliValue.trim().length > 0) {
      return pathResolve(cliValue.trim());
    }
    const envValue = process.env.RUNTIME_AUDIT_JSON_PATH?.trim();
    if (typeof envValue === 'string' && envValue.length > 0) {
      return pathResolve(envValue);
    }
    return null;
  })();

  const server = await createProbeServer(serverConstants);
  const runtimeArtifactDir = join(process.cwd(), '.tmp_mcp_artifacts');
  const runtimeMacroDir = join(process.cwd(), 'macros');
  const runtimeMacroPath = join(runtimeMacroDir, 'runtime-audit-macro.json');
  const runtimeIds = {
    runtimeMacroId: 'runtime_audit_macro',
    runtimeExtensionId: 'runtime-audit-extension',
  };
  const paths = {
    runtimeArtifactDir,
    runtimeMacroDir,
    runtimeMacroPath,
    extensionRegistryRoot: join(runtimeArtifactDir, 'runtime-extension-registry'),
    runtimeWorkflowRoot: join(runtimeArtifactDir, 'runtime-workflows'),
    runtimePluginRoot: join(runtimeArtifactDir, 'runtime-plugins'),
    runtimeExtensionPath: join(runtimeArtifactDir, 'runtime-audit-extension.mjs'),
    extensionRegistryFile: join(runtimeArtifactDir, 'runtime-extension-registry', 'plugins.json'),
  };
  const sharedEnv = {
    EXTENSION_REGISTRY_BASE_URL: server.baseUrl,
    MCP_EXTENSION_REGISTRY_DIR: paths.extensionRegistryRoot,
    MCP_WORKFLOW_ROOTS: paths.runtimeWorkflowRoot,
    MCP_PLUGIN_ROOTS: paths.runtimePluginRoot,
  };
  const client = new Client({ name: 'runtime-tool-probe', version: '1.0.0' }, { capabilities: {} });
  const metaClient = new Client(
    { name: 'runtime-tool-probe-search-profile', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = createClientTransport('full', sharedEnv);
  const metaTransport = createClientTransport('search', sharedEnv);
  const report = createEmptyReport({
    generatedAt: new Date().toISOString(),
    baseUrl: server.baseUrl,
    wsUrl: server.wsUrl,
    http2Url: server.http2Url,
  });
  const state = {
    platformProbeDir: null,
    platformPaths: null,
    browserContext: null,
    instrumentationSessionId: null,
    extensionRegistryBackup: null,
    extensionRegistryExisted: false,
    runtimeResources: {
      attachClient: null,
      attachTransport: null,
      isolatedBinaryClient: null,
      isolatedBinaryTransport: null,
      externalBrowserProc: null,
      externalBrowserUserDataDir: null,
      processLaunchUserDataDir: null,
      processLaunchPid: null,
      memoryProbeProc: null,
      memoryProbePid: null,
      electronDebugPid: null,
      electronDebugUserDataDir: null,
    },
  };
  const phaseContext = {
    report,
    server,
    clients: { client, metaClient },
    paths,
    runtimeIds,
    sharedEnv,
    state,
    constants: phaseConstants,
    helpers: phaseHelpers,
  };

  let failure = null;
  try {
    await withTimeout(client.connect(transport), 'connect', 30000);
    await withTimeout(metaClient.connect(metaTransport), 'connect-meta', 30000);
    await prepareRuntimeFixtures(phaseContext);
    await runMetaPhase(phaseContext);
    await runPlatformPhase(phaseContext);
    await runProtocolPhase(phaseContext);
    await runMaintenanceWorkflowPhase(phaseContext);
    await runStateBoardPhase(phaseContext);
    await runBrowserPhase(phaseContext);
    await runNetworkTlsPhase(phaseContext);
    await runProcessPhase(phaseContext);
    await runRuntimeObservabilityPhase(phaseContext);
    await runAdvancedRuntimePhase(phaseContext);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    failure = error;
  } finally {
    const {
      attachClient,
      attachTransport,
      isolatedBinaryClient,
      isolatedBinaryTransport,
      externalBrowserProc,
      externalBrowserUserDataDir,
      processLaunchUserDataDir,
      processLaunchPid,
      memoryProbeProc,
      electronDebugPid,
      electronDebugUserDataDir,
    } = state.runtimeResources;

    if (attachClient && attachTransport) {
      try {
        report.browser.attachExternalClose = await callTool(
          attachClient,
          'browser_close',
          {},
          15000,
        );
      } catch (error) {
        report.browser.attachExternalCloseError =
          error instanceof Error ? error.message : String(error);
      }
    }
    try {
      await attachTransport?.close();
    } catch {}
    try {
      await attachClient?.close();
    } catch {}
    try {
      await isolatedBinaryTransport?.close();
    } catch {}
    try {
      await isolatedBinaryClient?.close();
    } catch {}
    await terminateProcessTree(externalBrowserProc);
    await terminateProcessTree(memoryProbeProc);
    if (externalBrowserUserDataDir) {
      try {
        await rm(externalBrowserUserDataDir, { recursive: true, force: true });
      } catch {}
    }
    await terminateProcessId(processLaunchPid);
    await terminateProcessId(electronDebugPid);
    if (processLaunchUserDataDir) {
      try {
        await rm(processLaunchUserDataDir, { recursive: true, force: true });
      } catch {}
    }
    if (electronDebugUserDataDir) {
      try {
        await rm(electronDebugUserDataDir, { recursive: true, force: true });
      } catch {}
    }
    try {
      report.proxy.stop = await callTool(client, 'proxy_stop', {}, 15000);
    } catch (error) {
      report.proxy.stopError = error instanceof Error ? error.message : String(error);
    }
    try {
      report.browser.close = await callTool(client, 'browser_close', {}, 15000);
    } catch (error) {
      report.browser.closeError = error instanceof Error ? error.message : String(error);
    }
    try {
      await transport.close();
    } catch {}
    try {
      await client.close();
    } catch {}
    try {
      await metaTransport.close();
    } catch {}
    try {
      await metaClient.close();
    } catch {}
    await server.close();
    try {
      await rm(runtimeMacroPath, { force: true });
    } catch {}
    try {
      await rm(paths.runtimeExtensionPath, { force: true });
    } catch {}
    if (paths.extensionRegistryFile) {
      try {
        if (state.extensionRegistryExisted) {
          await writeFile(paths.extensionRegistryFile, state.extensionRegistryBackup ?? '', 'utf8');
        } else {
          await rm(paths.extensionRegistryFile, { force: true });
        }
      } catch {}
    }
    try {
      await rm(paths.extensionRegistryRoot, { recursive: true, force: true });
    } catch {}
    if (state.platformProbeDir) {
      try {
        await rm(state.platformProbeDir, { recursive: true, force: true });
      } catch {}
    }
  }

  report.runtimeCoverage = buildRuntimeCoverage(report.tools);

  if (jsonOutputPath) {
    await mkdir(dirname(jsonOutputPath), { recursive: true });
    await writeFile(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (jsonOnly && !jsonOutputPath) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(summarizeReport(report));
  }

  if (failure) {
    throw failure;
  }
}

await withTimeout(main(), 'runtime probe script', SCRIPT_TIMEOUT_MS);
