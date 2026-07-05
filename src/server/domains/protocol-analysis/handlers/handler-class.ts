import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { ProtocolAnalysisHttpHandlers } from './http-handlers';

/**
 * ProtocolAnalysisHandlers — thin facade over the split handler chain.
 */
export class ProtocolAnalysisHandlers extends ProtocolAnalysisHttpHandlers {
  handleDefinePatternTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleDefinePattern(args));
  }

  handleAutoDetectTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleAutoDetect(args));
  }

  handleInferFieldsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleInferFields(args));
  }

  handleInferStateMachineTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleInferStateMachine(args));
  }

  handleExportSchemaTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleExportSchema(args));
  }

  handleVisualizeStateTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleVisualizeState(args));
  }

  handlePayloadTemplateBuildTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handlePayloadTemplateBuild(args));
  }

  handlePayloadMutateTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handlePayloadMutate(args));
  }

  handleEthernetFrameBuildTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleEthernetFrameBuild(args));
  }

  handleArpBuildTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleArpBuild(args));
  }

  handleRawIpPacketBuildTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleRawIpPacketBuild(args));
  }

  handleIcmpEchoBuildTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleIcmpEchoBuild(args));
  }

  handleChecksumApplyTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleChecksumApply(args));
  }

  handlePcapWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handlePcapWrite(args));
  }

  handlePcapReadTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handlePcapRead(args));
  }

  handlePcapngWriteTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handlePcapngWrite(args));
  }

  handlePcapngReadTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handlePcapngRead(args));
  }

  handleProtoDissectDnsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleProtoDissectDns(args));
  }

  handleProtoDissectHttpTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleProtoDissectHttp(args));
  }

  handleProtoFingerprintTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleProtoFingerprint(args));
  }
}
