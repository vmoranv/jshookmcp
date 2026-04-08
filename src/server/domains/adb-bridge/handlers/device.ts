export async function handleListDevices(_args: Record<string, unknown>) {
  return {
    deviceCount: 0,
    devices: [],
  };
}

export async function handleShell(_context: unknown, args: Record<string, unknown>) {
  return {
    stdout: '',
    exitCode: 0,
    ...args,
  };
}
