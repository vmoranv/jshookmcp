type TestHostsMap = {
  root: string;
  www: string;
  api: string;
  cdn: string;
  ads: string;
  cdp: string;
  lab: string;
  a: string;
  b: string;
  c: string;
  target: string;
  other: string;
  first: string;
  second: string;
  current: string;
  stale: string;
  test: string;
  nonexistent: string;
  notFound: string;
  meta: string;
  good: string;
  bad: string;
  old: string;
  new: string;
  evil: string;
  noSuchHost: string;
  noTitle: string;
  page1: string;
  page2: string;
  x: string;
};

export const TEST_DOMAIN_SUFFIXES = {
  bare: '',
  example: 'example',
  exampleCom: 'example.com',
  invalid: 'invalid',
  local: 'local',
  test: 'test',
} as const;

export type TestDomainSuffix = keyof typeof TEST_DOMAIN_SUFFIXES;
export type TestUrlScheme = 'ftp' | 'http' | 'https' | 'ws' | 'wss';

type TestUrlsMap = TestHostsMap;

type TestHttpUrlsMap = {
  root: string;
  www: string;
  a: string;
  b: string;
  c: string;
  lab: string;
  x: string;
};

type TestWsUrlsMap = {
  root: string;
  api: string;
  cdp: string;
  other: string;
  first: string;
  second: string;
  old: string;
  new: string;
};

type TestFtpUrlsMap = {
  root: string;
};

export const TEST_HOSTS: TestHostsMap = {
  root: 'example.com',
  www: 'www.example.com',
  api: 'api.example.com',
  cdn: 'cdn.example.com',
  ads: 'ads.example.com',
  cdp: 'cdp.example.com',
  lab: 'lab.example.com',
  a: 'a.example.com',
  b: 'b.example.com',
  c: 'c.example.com',
  target: 'target.example.com',
  other: 'other.example.com',
  first: 'first.example.com',
  second: 'second.example.com',
  current: 'current.example.com',
  stale: 'stale.example.com',
  test: 'test.example.com',
  nonexistent: 'nonexistent.example.com',
  notFound: 'notfound.example.com',
  meta: 'meta.example.com',
  good: 'good.example.com',
  bad: 'bad.example.com',
  old: 'old.example.com',
  new: 'new.example.com',
  evil: 'evil.example.com',
  noSuchHost: 'no-such-host.example.com',
  noTitle: 'no-title.example.com',
  page1: 'page1.example.com',
  page2: 'page2.example.com',
  x: 'x.example.com',
};

export const TEST_URLS: TestUrlsMap = {
  root: `https://${TEST_HOSTS.root}`,
  www: `https://${TEST_HOSTS.www}`,
  api: `https://${TEST_HOSTS.api}`,
  cdn: `https://${TEST_HOSTS.cdn}`,
  ads: `https://${TEST_HOSTS.ads}`,
  cdp: `https://${TEST_HOSTS.cdp}`,
  lab: `https://${TEST_HOSTS.lab}`,
  a: `https://${TEST_HOSTS.a}`,
  b: `https://${TEST_HOSTS.b}`,
  c: `https://${TEST_HOSTS.c}`,
  target: `https://${TEST_HOSTS.target}`,
  other: `https://${TEST_HOSTS.other}`,
  first: `https://${TEST_HOSTS.first}`,
  second: `https://${TEST_HOSTS.second}`,
  current: `https://${TEST_HOSTS.current}`,
  stale: `https://${TEST_HOSTS.stale}`,
  test: `https://${TEST_HOSTS.test}`,
  nonexistent: `https://${TEST_HOSTS.nonexistent}`,
  notFound: `https://${TEST_HOSTS.notFound}`,
  meta: `https://${TEST_HOSTS.meta}`,
  good: `https://${TEST_HOSTS.good}`,
  bad: `https://${TEST_HOSTS.bad}`,
  old: `https://${TEST_HOSTS.old}`,
  new: `https://${TEST_HOSTS.new}`,
  evil: `https://${TEST_HOSTS.evil}`,
  noSuchHost: `https://${TEST_HOSTS.noSuchHost}`,
  noTitle: `https://${TEST_HOSTS.noTitle}`,
  page1: `https://${TEST_HOSTS.page1}`,
  page2: `https://${TEST_HOSTS.page2}`,
  x: `https://${TEST_HOSTS.x}`,
};

export const TEST_HTTP_URLS: TestHttpUrlsMap = {
  root: `http://${TEST_HOSTS.root}`,
  www: `http://${TEST_HOSTS.www}`,
  a: `http://${TEST_HOSTS.a}`,
  b: `http://${TEST_HOSTS.b}`,
  c: `http://${TEST_HOSTS.c}`,
  lab: `http://${TEST_HOSTS.lab}`,
  x: `http://${TEST_HOSTS.x}`,
};

export const TEST_WS_URLS: TestWsUrlsMap = {
  root: `wss://${TEST_HOSTS.root}`,
  api: `wss://${TEST_HOSTS.api}`,
  cdp: `wss://${TEST_HOSTS.cdp}`,
  other: `wss://${TEST_HOSTS.other}`,
  first: `wss://${TEST_HOSTS.first}`,
  second: `wss://${TEST_HOSTS.second}`,
  old: `wss://${TEST_HOSTS.old}`,
  new: `wss://${TEST_HOSTS.new}`,
};

export const TEST_FTP_URLS: TestFtpUrlsMap = {
  root: `ftp://${TEST_HOSTS.root}`,
};

export function buildTestHost(label: string, suffix: TestDomainSuffix = 'exampleCom'): string {
  const normalizedLabel = label.trim().replace(/^\.+|\.+$/g, '');
  const normalizedSuffix = TEST_DOMAIN_SUFFIXES[suffix];

  if (!normalizedSuffix) {
    return normalizedLabel;
  }

  return normalizedLabel ? `${normalizedLabel}.${normalizedSuffix}` : normalizedSuffix;
}

export function withPath(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.replace(/^\/+/, '');

  return normalizedPath ? `${normalizedBase}/${normalizedPath}` : normalizedBase;
}

export function buildTestUrl(
  label: string,
  options: {
    path?: string;
    scheme?: TestUrlScheme;
    suffix?: TestDomainSuffix;
  } = {},
): string {
  const { path = '', scheme = 'https', suffix = 'exampleCom' } = options;
  const host = buildTestHost(label, suffix);

  if (path === '/') {
    return `${scheme}://${host}/`;
  }

  return withPath(`${scheme}://${host}`, path);
}

export const E2E_DEFAULT_TARGET_URL = 'https://vmoranv.github.io/jshookmcp/';
export const E2E_DEFAULT_TARGET_GLOB = '*vmoranv.github.io/jshookmcp/*';
