export async function handlePullApk(args: Record<string, unknown>) {
  return {
    apkPath: '/tmp/app.apk',
    ...args,
  };
}

export async function handleAnalyzeApk(args: Record<string, unknown>) {
  return {
    packageName: args['packageName'] ?? '',
    versionName: '0.0.0',
    permissions: [],
  };
}
