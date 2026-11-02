/**
 * APK manifest XML parsing utilities.
 * Shared APK manifest helpers reused across the APK tools.
 */

function readXmlAttr(tag: string, attr: string): string | undefined {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    tag.match(new RegExp(`\\b${escaped}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ??
    tag.match(new RegExp(`\\bandroid:${escaped}\\s*=\\s*"([^"]*)"`, 'i'))?.[1]
  );
}

export function listTags(xml: string, tagName: string): string[] {
  const tags: string[] = [];
  // `(?=[\s/>])` instead of `\b`: `\b` also matches `<activity-alias` (the
  // `-` is a non-word char), so collecting `<activity>` would swallow alias
  // tags and truncate the activity list. The lookahead requires a real tag
  // boundary — whitespace, `/` (self-closing), or `>`.
  const re = new RegExp(
    `<${tagName}(?=[\\s/>])[^>]*(?:/>|>[\\s\\S]*?<\\/${tagName}(?=[\\s/>])>)`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[0]) tags.push(match[0]);
  }
  return tags;
}

function uniqueStrings(values: string[], limit = 200): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

export interface ManifestSummary {
  packageName?: string;
  versionCode?: string;
  versionName?: string;
  minSdk?: string;
  targetSdk?: string;
  applicationClass?: string;
  applicationLabel?: string;
  debuggable?: string;
  launcherActivity?: string;
  permissions: string[];
  usesFeatures: string[];
  components: {
    activities: string[];
    activityAliases: string[];
    services: string[];
    receivers: string[];
    providers: string[];
  };
  counts: {
    permissions: number;
    activities: number;
    services: number;
    receivers: number;
    providers: number;
  };
}

export function summarizeManifestXml(xml: string): ManifestSummary {
  const manifestOpen = xml.match(/<manifest\b[^>]*>/i)?.[0] ?? '';
  const applicationOpen = xml.match(/<application\b[^>]*>/i)?.[0] ?? '';
  const activities = listTags(xml, 'activity');
  const activityAliases = listTags(xml, 'activity-alias');
  const services = listTags(xml, 'service');
  const receivers = listTags(xml, 'receiver');
  const providers = listTags(xml, 'provider');
  const permissions = uniqueStrings(
    [...xml.matchAll(/<uses-permission\b[^>]*\bandroid:name="([^"]+)"/gi)].map(
      (match) => match[1] ?? '',
    ),
    500,
  );
  const usesFeatures = uniqueStrings(
    [...xml.matchAll(/<uses-feature\b[^>]*\bandroid:name="([^"]+)"/gi)].map(
      (match) => match[1] ?? '',
    ),
    200,
  );
  const launcherTag =
    [...activities, ...activityAliases].find(
      (tag) =>
        /android\.intent\.action\.MAIN/i.test(tag) &&
        /android\.intent\.category\.LAUNCHER/i.test(tag),
    ) ?? '';

  const components = {
    activities: uniqueStrings(
      activities.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
    activityAliases: uniqueStrings(
      activityAliases.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      200,
    ),
    services: uniqueStrings(
      services.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
    receivers: uniqueStrings(
      receivers.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
    providers: uniqueStrings(
      providers.map((tag) => readXmlAttr(tag, 'name') ?? ''),
      500,
    ),
  };

  return {
    packageName: readXmlAttr(manifestOpen, 'package'),
    versionCode: readXmlAttr(manifestOpen, 'versionCode'),
    versionName: readXmlAttr(manifestOpen, 'versionName'),
    minSdk: xml.match(/<uses-sdk\b[^>]*\bandroid:minSdkVersion="([^"]+)"/i)?.[1],
    targetSdk: xml.match(/<uses-sdk\b[^>]*\bandroid:targetSdkVersion="([^"]+)"/i)?.[1],
    applicationClass: readXmlAttr(applicationOpen, 'name'),
    applicationLabel: readXmlAttr(applicationOpen, 'label'),
    debuggable: readXmlAttr(applicationOpen, 'debuggable'),
    launcherActivity: launcherTag ? readXmlAttr(launcherTag, 'name') : undefined,
    permissions,
    usesFeatures,
    components,
    counts: {
      // REAL tag counts from the raw scan — `components` are deduped and
      // truncated (limits of 500/200), so their lengths undercount.
      permissions: permissions.length,
      activities: activities.length,
      services: services.length,
      receivers: receivers.length,
      providers: providers.length,
    },
  };
}
