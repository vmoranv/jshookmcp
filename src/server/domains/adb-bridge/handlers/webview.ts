export async function handleWebViewList(_args: Record<string, unknown>) {
  return {
    targetCount: 0,
    targets: [],
  };
}

export async function handleWebViewAttach(args: Record<string, unknown>) {
  return {
    targetId: args['targetId'] ?? '',
    webSocketDebuggerUrl: 'ws://localhost/devtools/page/mock',
  };
}
