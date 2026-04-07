/**
 * ADB device listing and shell command handlers.
 */

import { ADBConnector } from '@modules/adb/ADBConnector';

export async function handleListDevices(connector: ADBConnector, _args: Record<string, unknown>) {
  const devices = await connector.listDevices();
  return {
    deviceCount: devices.length,
    devices,
  };
}

export async function handleShell(connector: ADBConnector, args: Record<string, unknown>) {
  const serial = args.serial as string;
  const command = args.command as string;

  if (!serial || typeof serial !== 'string') {
    throw new Error('Missing required argument: serial');
  }
  if (!command || typeof command !== 'string') {
    throw new Error('Missing required argument: command');
  }

  const result = await connector.shellCommand(serial, command);
  return {
    serial,
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
