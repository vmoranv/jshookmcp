/**
 * ADB WebView CDP debugging handlers.
 */

import { ADBConnector } from '@modules/adb/ADBConnector';

export async function handleWebViewList(connector: ADBConnector, args: Record<string, unknown>) {
  const serial = args.serial as string;
  const hostPort = typeof args.hostPort === 'number' ? args.hostPort : 9222;

  if (!serial || typeof serial !== 'string') {
    throw new Error('Missing required argument: serial');
  }

  const targets = await connector.listWebViewTargets(serial, hostPort);
  return {
    serial,
    targetCount: targets.length,
    targets,
  };
}

export async function handleWebViewAttach(connector: ADBConnector, args: Record<string, unknown>) {
  const serial = args.serial as string;
  const targetId = args.targetId as string;
  const hostPort = typeof args.hostPort === 'number' ? args.hostPort : 9222;

  if (!serial || typeof serial !== 'string') {
    throw new Error('Missing required argument: serial');
  }
  if (!targetId || typeof targetId !== 'string') {
    throw new Error('Missing required argument: targetId');
  }

  // Forward port and get target list to find the specific target
  await connector.forwardPort(serial, hostPort, 9222);

  const targets = await connector.listWebViewTargets(serial, hostPort);
  const target = targets.find((t) => t.id === targetId);

  if (!target) {
    throw new Error(
      `WebView target "${targetId}" not found on device ${serial}. Call adb_webview_list first.`,
    );
  }

  return {
    serial,
    targetId,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    title: target.title,
    url: target.url,
    type: target.type,
    portForward: `tcp:${hostPort} -> tcp:9222`,
    hint: `Connect to ${target.webSocketDebuggerUrl} via Chrome DevTools Protocol`,
  };
}
