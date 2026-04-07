/**
 * ADB Bridge domain tool handlers facade.
 *
 * Thin wrapper — delegates to focused handlers under handlers/,
 * with error handling and response formatting.
 */

import type { ToolResponse } from '@server/types';
import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';
import { ADBConnector } from '@modules/adb/ADBConnector';
import { handleListDevices, handleShell } from './device';
import { handlePullApk, handleAnalyzeApk } from './apk';
import { handleWebViewList, handleWebViewAttach } from './webview';

export class ADBBridgeHandlers {
  private readonly connector: ADBConnector;

  constructor() {
    this.connector = new ADBConnector();
  }

  async handleDeviceList(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleListDevices(this.connector, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handleShell(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleShell(this.connector, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handlePullApk(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handlePullApk(this.connector, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handleAnalyzeApk(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleAnalyzeApk(this.connector, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handleWebViewList(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleWebViewList(this.connector, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handleWebViewAttach(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleWebViewAttach(this.connector, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }
}
