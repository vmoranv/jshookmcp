/**
 * ADB APK pull and analysis handlers.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADBConnector } from '@modules/adb/ADBConnector';

export async function handlePullApk(connector: ADBConnector, args: Record<string, unknown>) {
  const serial = args.serial as string;
  const packageName = args.packageName as string;
  let outputPath = args.outputPath as string | undefined;

  if (!serial || typeof serial !== 'string') {
    throw new Error('Missing required argument: serial');
  }
  if (!packageName || typeof packageName !== 'string') {
    throw new Error('Missing required argument: packageName');
  }

  if (!outputPath || typeof outputPath !== 'string') {
    const safeName = packageName.replace(/[^a-zA-Z0-9._-]/g, '_');
    outputPath = join(tmpdir(), `${safeName}.apk`);
  }

  const result = await connector.pullApk(serial, packageName, outputPath);
  return {
    apkPath: result,
    packageName,
  };
}

export async function handleAnalyzeApk(connector: ADBConnector, args: Record<string, unknown>) {
  const serial = args.serial as string;
  const packageName = args.packageName as string;

  if (!serial || typeof serial !== 'string') {
    throw new Error('Missing required argument: serial');
  }
  if (!packageName || typeof packageName !== 'string') {
    throw new Error('Missing required argument: packageName');
  }

  const apkInfo = await connector.parseApkInfo(serial, packageName);
  return apkInfo;
}
