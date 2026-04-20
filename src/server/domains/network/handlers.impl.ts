/**
 * Network domain — composition facade.
 *
 * Delegates to six sub-handler modules:
 *   - CoreHandlers:       enable/disable/status/requests/response/stats
 *   - PerformanceHandlers: coverage/tracing/profiling
 *   - ConsoleHandlers:     exceptions/interceptors/tracers
 *   - ReplayHandlers:      auth extraction, HAR export, request replay
 *   - InterceptHandlers:   response interception
 *   - RawHandlers:         DNS, HTTP, HTTP/2, RTT
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { PerformanceMonitor } from '@server/domains/shared/modules';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { DetailedDataManager } from '@utils/DetailedDataManager';

import { CoreHandlers } from './handlers/core-handlers';
import { PerformanceHandlers } from './handlers/performance-handlers';
import { ConsoleHandlers } from './handlers/console-handlers';
import { ReplayHandlers } from './handlers/replay-handlers';
import { InterceptHandlers } from './handlers/intercept-handlers';
import { RawHandlers } from './handlers/raw-handlers';

export class AdvancedToolHandlers {
  protected collector: CodeCollector;
  protected consoleMonitor: ConsoleMonitor;
  protected eventBus?: EventBus<ServerEventMap>;

  protected performanceMonitor: PerformanceMonitor | null = null;
  protected detailedDataManager: DetailedDataManager = DetailedDataManager.getInstance();

  private core: CoreHandlers;
  private perf: PerformanceHandlers;
  private console_: ConsoleHandlers;
  private replay: ReplayHandlers;
  private intercept: InterceptHandlers;
  private raw: RawHandlers;

  constructor(
    collector: CodeCollector,
    consoleMonitor: ConsoleMonitor,
    eventBus?: EventBus<ServerEventMap>,
  ) {
    this.collector = collector;
    this.consoleMonitor = consoleMonitor;
    this.eventBus = eventBus;

    this.core = new CoreHandlers({ collector, consoleMonitor, eventBus });
    this.perf = new PerformanceHandlers({
      collector,
      getPerformanceMonitor: () => this.getPerformanceMonitor(),
    });
    this.console_ = new ConsoleHandlers({ consoleMonitor });
    this.replay = new ReplayHandlers({ consoleMonitor });
    this.intercept = new InterceptHandlers({ consoleMonitor, eventBus });
    this.raw = new RawHandlers(eventBus);
  }

  protected getPerformanceMonitor(): PerformanceMonitor {
    if (!this.performanceMonitor) {
      this.performanceMonitor = new PerformanceMonitor(this.collector);
    }
    return this.performanceMonitor;
  }

  handleNetworkEnable = (args: Record<string, unknown>) => this.core.handleNetworkEnable(args);
  handleNetworkDisable = (args: Record<string, unknown>) => this.core.handleNetworkDisable(args);
  handleNetworkGetStatus = (args: Record<string, unknown>) =>
    this.core.handleNetworkGetStatus(args);
  handleNetworkMonitor = (args: Record<string, unknown>) => this.core.handleNetworkMonitor(args);
  handleNetworkGetRequests = (args: Record<string, unknown>) =>
    this.core.handleNetworkGetRequests(args);
  handleNetworkGetResponseBody = (args: Record<string, unknown>) =>
    this.core.handleNetworkGetResponseBody(args);
  handleNetworkGetStats = (args: Record<string, unknown>) => this.core.handleNetworkGetStats(args);

  // ── Performance ──

  handlePerformanceGetMetrics = (args: Record<string, unknown>) =>
    this.perf.handlePerformanceGetMetrics(args);
  handlePerformanceStartCoverage = (args: Record<string, unknown>) =>
    this.perf.handlePerformanceStartCoverage(args);
  handlePerformanceStopCoverage = (args: Record<string, unknown>) =>
    this.perf.handlePerformanceStopCoverage(args);
  handlePerformanceTakeHeapSnapshot = (args: Record<string, unknown>) =>
    this.perf.handlePerformanceTakeHeapSnapshot(args);
  handlePerformanceTraceStart = (args: Record<string, unknown>) =>
    this.perf.handlePerformanceTraceStart(args);
  handlePerformanceTraceStop = (args: Record<string, unknown>) =>
    this.perf.handlePerformanceTraceStop(args);
  handlePerformanceTraceDispatch = (args: Record<string, unknown>) =>
    String(args['action'] ?? '') === 'stop'
      ? this.perf.handlePerformanceTraceStop(args)
      : this.perf.handlePerformanceTraceStart(args);
  handleProfilerCpuStart = (args: Record<string, unknown>) =>
    this.perf.handleProfilerCpuStart(args);
  handleProfilerCpuStop = (args: Record<string, unknown>) => this.perf.handleProfilerCpuStop(args);
  handleProfilerCpuDispatch = (args: Record<string, unknown>) =>
    String(args['action'] ?? '') === 'stop'
      ? this.perf.handleProfilerCpuStop(args)
      : this.perf.handleProfilerCpuStart(args);
  handleProfilerHeapSamplingStart = (args: Record<string, unknown>) =>
    this.perf.handleProfilerHeapSamplingStart(args);
  handleProfilerHeapSamplingStop = (args: Record<string, unknown>) =>
    this.perf.handleProfilerHeapSamplingStop(args);
  handleProfilerHeapSamplingDispatch = (args: Record<string, unknown>) =>
    String(args['action'] ?? '') === 'stop'
      ? this.perf.handleProfilerHeapSamplingStop(args)
      : this.perf.handleProfilerHeapSamplingStart(args);

  // ── Console ──

  handleConsoleGetExceptions = (args: Record<string, unknown>) =>
    this.console_.handleConsoleGetExceptions(args);
  handleConsoleInjectDispatch = (args: Record<string, unknown>) => {
    const type = String(args['type'] ?? '');
    switch (type) {
      case 'xhr':
        return this.console_.handleConsoleInjectXhrInterceptor(args);
      case 'fetch':
        return this.console_.handleConsoleInjectFetchInterceptor(args);
      case 'function':
        return this.console_.handleConsoleInjectFunctionTracer(args);
      default:
        return this.console_.handleConsoleInjectScriptMonitor(args);
    }
  };
  handleConsoleBuffersDispatch = (args: Record<string, unknown>) => {
    const action = String(args['action'] ?? '');
    return action === 'reset'
      ? this.console_.handleConsoleResetInjectedInterceptors(args)
      : this.console_.handleConsoleClearInjectedBuffers(args);
  };
  handleConsoleInjectScriptMonitor = (args: Record<string, unknown>) =>
    this.console_.handleConsoleInjectScriptMonitor(args);
  handleConsoleInjectXhrInterceptor = (args: Record<string, unknown>) =>
    this.console_.handleConsoleInjectXhrInterceptor(args);
  handleConsoleInjectFetchInterceptor = (args: Record<string, unknown>) =>
    this.console_.handleConsoleInjectFetchInterceptor(args);
  handleConsoleClearInjectedBuffers = (args: Record<string, unknown>) =>
    this.console_.handleConsoleClearInjectedBuffers(args);
  handleConsoleResetInjectedInterceptors = (args: Record<string, unknown>) =>
    this.console_.handleConsoleResetInjectedInterceptors(args);
  handleConsoleInjectFunctionTracer = (args: Record<string, unknown>) =>
    this.console_.handleConsoleInjectFunctionTracer(args);

  // ── Replay ──

  handleNetworkExtractAuth = (args: Record<string, unknown>) =>
    this.replay.handleNetworkExtractAuth(args);
  handleNetworkExportHar = (args: Record<string, unknown>) =>
    this.replay.handleNetworkExportHar(args);
  handleNetworkReplayRequest = (args: Record<string, unknown>) =>
    this.replay.handleNetworkReplayRequest(args);

  // ── Intercept ──

  handleNetworkInterceptResponse = (args: Record<string, unknown>) =>
    this.intercept.handleNetworkInterceptResponse(args);
  handleNetworkInterceptList = (args: Record<string, unknown>) =>
    this.intercept.handleNetworkInterceptList(args);
  handleNetworkInterceptDisable = (args: Record<string, unknown>) =>
    this.intercept.handleNetworkInterceptDisable(args);

  handleNetworkInterceptDispatch = (args: Record<string, unknown>) => {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'add':
        return this.intercept.handleNetworkInterceptResponse(args);
      case 'list':
        return this.intercept.handleNetworkInterceptList(args);
      case 'disable':
        return this.intercept.handleNetworkInterceptDisable(args);
      default:
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: `Invalid action: "${action}". Expected one of: add, list, disable`,
            },
          ],
          isError: true,
        });
    }
  };

  // ── Raw (DNS / HTTP / HTTP2 / RTT) ──

  handleHttpRequestBuild = (args: Record<string, unknown>) => this.raw.handleHttpRequestBuild(args);
  handleHttpPlainRequest = (args: Record<string, unknown>) => this.raw.handleHttpPlainRequest(args);
  handleHttp2Probe = (args: Record<string, unknown>) => this.raw.handleHttp2Probe(args);
  handleHttp2FrameBuild = (args: Record<string, unknown>) => this.raw.handleHttp2FrameBuild(args);
  handleNetworkRttMeasure = (args: Record<string, unknown>) =>
    this.raw.handleNetworkRttMeasure(args);
}
