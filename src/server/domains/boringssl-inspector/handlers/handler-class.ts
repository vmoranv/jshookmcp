/**
 * BoringsslInspectorHandlers — thin facade over the split handler chain.
 */

import { BoringsslInspectorRawSocketHandlers } from './raw-socket-handlers';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

export class BoringsslInspectorHandlers extends BoringsslInspectorRawSocketHandlers {
  handleTlsKeylogEnableTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsKeylogEnable(args));
  }
  handleTlsKeylogParseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsKeylogParse(args));
  }
  handleTlsKeylogDisableTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsKeylogDisable(args));
  }
  handleTlsDecryptPayloadTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsDecryptPayload(args));
  }
  handleTlsKeylogSummarizeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsKeylogSummarize(args));
  }
  handleTlsKeylogLookupSecretTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsKeylogLookupSecret(args));
  }
  handleTlsCertPinBypassTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsCertPinBypass(args));
  }
  handleParseHandshakeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleParseHandshake(args));
  }
  handleCipherSuitesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCipherSuites(args));
  }
  handleParseCertificateTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleParseCertificate(args));
  }
  handleTlsProbeEndpointTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsProbeEndpoint(args));
  }
  handleTcpOpenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTcpOpen(args));
  }
  handleTcpWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTcpWrite(args));
  }
  handleTcpReadUntilTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTcpReadUntil(args));
  }
  handleTcpCloseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTcpClose(args));
  }
  handleTlsOpenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsOpen(args));
  }
  handleTlsWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsWrite(args));
  }
  handleTlsReadUntilTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsReadUntil(args));
  }
  handleTlsCloseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTlsClose(args));
  }
  handleWebSocketOpenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebSocketOpen(args));
  }
  handleWebSocketSendFrameTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebSocketSendFrame(args));
  }
  handleWebSocketReadFrameTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebSocketReadFrame(args));
  }
  handleWebSocketCloseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebSocketClose(args));
  }
  handleBypassCertPinningTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleBypassCertPinning(args));
  }
  handleRawTcpSendTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRawTcpSend(args));
  }
  handleRawTcpListenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRawTcpListen(args));
  }
  handleRawUdpSendTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRawUdpSend(args));
  }
  handleRawUdpListenTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRawUdpListen(args));
  }
}
