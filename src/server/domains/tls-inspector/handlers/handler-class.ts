/**
 * TlsInspectorHandlers — thin facade over the split handler chain.
 */

import { TlsInspectorRawSocketHandlers } from './raw-socket-handlers';
import {
  handleSafe,
  ResponseBuilder,
  type ToolResponse,
} from '@server/domains/shared/ResponseBuilder';

/**
 * Run a TLS-inspector handler and normalise its outcome onto the shared
 * envelope.
 *
 * The TCP/TLS/WebSocket/session handlers report "operation attempted and
 * failed" as a `{ ok: false, error }` record instead of throwing. Passing that
 * through `handleSafe` stamped `success: true` on it (handleSafe's builder
 * starts from `.ok()`), so a failed `websocket_open` looked successful to every
 * caller that keys off `success`. Hoist the domain-local `ok:false` marker and
 * surface the same fields with `success:false`.
 */
function runTlsTool(fn: () => Promise<unknown>): Promise<ToolResponse> {
  return handleSafe(async () => {
    const result = await fn();
    if (
      typeof result === 'object' &&
      result !== null &&
      !Array.isArray(result) &&
      (result as { ok?: unknown }).ok === false
    ) {
      const record = result as Record<string, unknown>;
      const message =
        typeof record.error === 'string' && record.error.length > 0
          ? record.error
          : 'TLS inspector operation failed';
      return new ResponseBuilder().merge(record).fail(new Error(message)).json();
    }
    return result;
  });
}

export class TlsInspectorHandlers extends TlsInspectorRawSocketHandlers {
  handleTlsKeylogEnableTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsKeylogEnable(args));
  }
  handleTlsKeylogParseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsKeylogParse(args));
  }
  handleTlsKeylogDisableTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsKeylogDisable(args));
  }
  handleTlsKeylogSealTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsKeylogSeal(args));
  }
  handleTlsDecryptPayloadTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsDecryptPayload(args));
  }
  handleTlsKeylogSummarizeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsKeylogSummarize(args));
  }
  handleTlsKeylogLookupSecretTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsKeylogLookupSecret(args));
  }
  handleTlsCertPinBypassTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsCertPinBypass(args));
  }
  handleParseHandshakeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleParseHandshake(args));
  }
  handleCipherSuitesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleCipherSuites(args));
  }
  handleParseCertificateTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleParseCertificate(args));
  }
  handleTlsProbeEndpointTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsProbeEndpoint(args));
  }
  handleTcpOpenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTcpOpen(args));
  }
  handleTcpWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTcpWrite(args));
  }
  handleTcpReadUntilTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTcpReadUntil(args));
  }
  handleTcpCloseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTcpClose(args));
  }
  handleTlsOpenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsOpen(args));
  }
  handleTlsWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsWrite(args));
  }
  handleTlsReadUntilTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsReadUntil(args));
  }
  handleTlsCloseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleTlsClose(args));
  }
  handleWebSocketOpenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleWebSocketOpen(args));
  }
  handleWebSocketSendFrameTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleWebSocketSendFrame(args));
  }
  handleWebSocketReadFrameTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleWebSocketReadFrame(args));
  }
  handleWebSocketCloseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleWebSocketClose(args));
  }
  handleBypassCertPinningTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleBypassCertPinning(args));
  }
  handleRawTcpSendTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleRawTcpSend(args));
  }
  handleRawTcpListenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleRawTcpListen(args));
  }
  handleRawUdpSendTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleRawUdpSend(args));
  }
  handleRawUdpListenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return runTlsTool(() => this.handleRawUdpListen(args));
  }
}
