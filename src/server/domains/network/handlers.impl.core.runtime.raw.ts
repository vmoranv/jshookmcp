import { RawDnsHttpHandlers } from '@server/domains/network/handlers/raw-dns-http-handlers';
import { RawHttp2Handlers } from '@server/domains/network/handlers/raw-http2-handlers';
import { RawLatencyHandlers } from '@server/domains/network/handlers/raw-latency-handlers';
import { AdvancedToolHandlersRuntime as AdvancedToolHandlersReplay } from '@server/domains/network/handlers.impl.core.runtime.replay';

/**
 * Legacy inheritance-compatible facade over the split raw network handlers.
 *
 * The runtime chain still extends this class, so keep the method surface stable
 * while delegating the actual implementations to the focused handler modules.
 */
export class AdvancedToolHandlersRaw extends AdvancedToolHandlersReplay {
  private readonly dnsHttp: RawDnsHttpHandlers;
  private readonly http2: RawHttp2Handlers;
  private readonly latency: RawLatencyHandlers;

  constructor(...args: ConstructorParameters<typeof AdvancedToolHandlersReplay>) {
    super(...args);
    this.dnsHttp = new RawDnsHttpHandlers(this.eventBus);
    this.http2 = new RawHttp2Handlers(this.eventBus);
    this.latency = new RawLatencyHandlers(this.eventBus);
  }

  handleHttpRequestBuild(args: Record<string, unknown>) {
    return this.dnsHttp.handleHttpRequestBuild(args);
  }

  handleHttpPlainRequest(args: Record<string, unknown>) {
    return this.dnsHttp.handleHttpPlainRequest(args);
  }

  handleHttp2Probe(args: Record<string, unknown>) {
    return this.http2.handleHttp2Probe(args);
  }

  handleHttp2FrameBuild(args: Record<string, unknown>) {
    return this.http2.handleHttp2FrameBuild(args);
  }

  handleNetworkRttMeasure(args: Record<string, unknown>) {
    return this.latency.handleNetworkRttMeasure(args);
  }
}
