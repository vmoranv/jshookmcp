import type { BenchSuite } from '../harness';
import { encodingSuite } from './encoding.suite';
import { protocolSuite } from './protocol-analysis.suite';
import { transformSuite } from './transform.suite';
import { networkSuite } from './network.suite';
import { exploitSuite } from './exploit-dev.suite';
import { sourcemapSuite } from './sourcemap.suite';
import { binarySuite } from './binary-instrument.suite';
import { wasmSuite } from './wasm.suite';
import { coreSuite } from './core.suite';
import { existingTestsSuite } from '../existing-tests-coverage.suite';
import { platformSuite } from './platform.suite';
import { memorySuite } from './memory.suite';
import { tlsSuite } from './tls-inspector.suite';
import { tlsInspectorFullSuite } from './tls-inspector-full.suite';
import { dartSuite } from './dart-inspector.suite';
import { maintenanceSuite } from './maintenance.suite';
import { electronFusesSuite } from './electron-fuses.suite';
import { sourcemapTc39Suite } from './sourcemap-tc39.suite';
import { offlineToolsSuite } from './offline-tools.suite';
import { sessionSuite } from './session.suite';
import { tasksSuite } from './tasks.suite';
import { coordinationSuite } from './coordination.suite';
import { crossDomainSuite } from './cross-domain.suite';
import { nativeBridgeSuite } from './native-bridge.suite';
import { processSuite } from './process.suite';
import { traceSuite } from './trace.suite';
import { miscResidualSuite } from './misc-residual.suite';

export const ALL_SUITES: readonly BenchSuite[] = [
  encodingSuite,
  protocolSuite,
  transformSuite,
  networkSuite,
  exploitSuite,
  sourcemapSuite,
  binarySuite,
  wasmSuite,
  coreSuite,
  existingTestsSuite,
  platformSuite,
  memorySuite,
  tlsSuite,
  tlsInspectorFullSuite,
  dartSuite,
  maintenanceSuite,
  electronFusesSuite,
  sourcemapTc39Suite,
  offlineToolsSuite,
  sessionSuite,
  tasksSuite,
  coordinationSuite,
  crossDomainSuite,
  nativeBridgeSuite,
  processSuite,
  traceSuite,
  miscResidualSuite,
];
