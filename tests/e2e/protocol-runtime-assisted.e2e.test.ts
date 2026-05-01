import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

interface CapturedFixtureRequest {
  method: string;
  url: string;
  body: string;
}

interface NetworkRequestsResponse {
  requests: Array<{
    requestId?: string;
    url: string;
    method: string;
    postData?: string;
  }>;
}

interface RuntimeEvaluationBody {
  result?: {
    url?: string;
    sig?: string | null;
    status?: number;
  };
}

interface CryptoExtractResponse {
  extractedCode?: string;
  dependencies?: string[];
  size?: number;
}

interface CryptoHarnessResponse {
  allPassed: boolean;
  results: Array<{
    input: string;
    output: string;
    error?: string;
  }>;
}

const FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <button id="sign-btn">sign</button>
    <script>
      window.signPayload = function signPayload(input) {
        const value = String(input);
        let acc = 0;
        for (let i = 0; i < value.length; i += 1) {
          acc = (acc + value.charCodeAt(i)) & 255;
        }
        return acc.toString(16).padStart(2, '0');
      };

      window.fireSignedRequest = async function fireSignedRequest(payload) {
        const sig = window.signPayload(payload);
        const url = '/signed-endpoint?payload=' + encodeURIComponent(payload) + '&sig=' + sig;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload, sig }),
        });
        return { url, sig, status: response.status };
      };

      document.getElementById('sign-btn').addEventListener('click', async () => {
        await window.fireSignedRequest('alpha');
      });
    </script>
  </body>
</html>`;

async function startFixtureServer(): Promise<{
  server: Server;
  baseUrl: string;
  receivedRequests: CapturedFixtureRequest[];
}> {
  const receivedRequests: CapturedFixtureRequest[] = [];
  const server = createServer((req, res) => {
    const requestUrl = req.url ?? '/';

    if (requestUrl === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && requestUrl.startsWith('/signed-endpoint')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        receivedRequests.push({
          method: req.method ?? 'POST',
          url: requestUrl,
          body,
        });
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.method === 'GET' && (requestUrl === '/' || requestUrl.startsWith('/?'))) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(FIXTURE_HTML);
      return;
    }

    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
    });
    res.end('not found');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve fixture server address');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    receivedRequests,
  };
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitForFixtureRequest(
  receivedRequests: CapturedFixtureRequest[],
): Promise<CapturedFixtureRequest> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const request = receivedRequests.find(
      (item) => item.method === 'POST' && item.url.includes('/signed-endpoint'),
    );
    if (request) {
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for fixture server to receive signed request');
}

async function waitForCapturedSignedRequest(
  client: MCPTestClient,
): Promise<NetworkRequestsResponse['requests'][number]> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const requests = await client.call(
      'network_get_requests',
      { url: 'signed-endpoint', method: 'POST', tail: 5 },
      20_000,
    );
    expect(requests.result.status).not.toBe('FAIL');

    const requestsBody = requests.parsed as NetworkRequestsResponse;
    const signedRequest = requestsBody.requests.find((item) =>
      item.url.includes('signed-endpoint'),
    );
    if (signedRequest) {
      return signedRequest;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error('Signed request was not captured by network_get_requests');
}

describe('Protocol Runtime-Assisted E2E', { timeout: 240_000, sequential: true }, () => {
  const client = new MCPTestClient();
  let fixtureServer: Server | null = null;
  let fixtureBaseUrl = '';
  let receivedRequests: CapturedFixtureRequest[] = [];

  beforeAll(async () => {
    const fixture = await startFixtureServer();
    fixtureServer = fixture.server;
    fixtureBaseUrl = fixture.baseUrl;
    receivedRequests = fixture.receivedRequests;
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
    await closeServer(fixtureServer);
  });

  test('PROTOCOL-RUNTIME-01: extract runtime sign function and validate it with pure-compute harness', async () => {
    const requiredTools = [
      'browser_launch',
      'page_navigate',
      'network_enable',
      'page_evaluate',
      'network_get_requests',
      'crypto_extract_standalone',
      'crypto_test_harness',
    ];
    const missing = requiredTools.filter((toolName) => !client.getToolMap().has(toolName));
    if (missing.length > 0) {
      client.recordSynthetic('protocol-runtime-assisted', 'SKIP', `Missing: ${missing.join(', ')}`);
      return;
    }

    const launch = await client.call('browser_launch', { headless: true }, 60_000);
    expect(launch.result.status).not.toBe('FAIL');

    const enable = await client.call('network_enable', {}, 15_000);
    expect(enable.result.status).not.toBe('FAIL');

    const navigate = await client.call(
      'page_navigate',
      { url: fixtureBaseUrl, waitUntil: 'load', timeout: 15_000 },
      30_000,
    );
    expect(navigate.result.status).not.toBe('FAIL');

    const runtimeExec = await client.call(
      'page_evaluate',
      {
        code: `(() => window.fireSignedRequest('alpha'))()`,
      },
      20_000,
    );
    expect(runtimeExec.result.status).not.toBe('FAIL');

    const runtimeBody = runtimeExec.parsed as RuntimeEvaluationBody;
    expect(runtimeBody.result?.sig).toBe('06');
    expect(runtimeBody.result?.status).toBe(200);
    expect(runtimeBody.result?.url).toContain('payload=alpha');
    expect(runtimeBody.result?.url).toContain('sig=06');

    const deliveredRequest = await waitForFixtureRequest(receivedRequests);
    expect(deliveredRequest.body).toContain('"payload":"alpha"');
    expect(deliveredRequest.body).toContain('"sig":"06"');

    const signedRequest = await waitForCapturedSignedRequest(client);
    expect(signedRequest.url).toContain('payload=alpha');
    expect(signedRequest.url).toContain('sig=06');
    expect(signedRequest.postData ?? '').toContain('"payload":"alpha"');
    expect(signedRequest.postData ?? '').toContain('"sig":"06"');

    const extracted = await client.call(
      'crypto_extract_standalone',
      { targetFunction: 'window.signPayload', includePolyfills: true },
      20_000,
    );
    expect(extracted.result.status).toBe('PASS');

    const extractedBody = extracted.parsed as CryptoExtractResponse;
    expect(extractedBody.extractedCode).toContain('const signPayload');
    expect(extractedBody.extractedCode).toContain('globalThis.signPayload');
    expect((extractedBody.size ?? 0) > 0).toBe(true);

    const harness = await client.call(
      'crypto_test_harness',
      {
        code: extractedBody.extractedCode,
        functionName: 'signPayload',
        testInputs: ['alpha', 'beta', 'signed-payload'],
      },
      20_000,
    );
    expect(harness.result.status).toBe('PASS');

    const harnessBody = harness.parsed as CryptoHarnessResponse;
    expect(harnessBody.allPassed).toBe(true);
    expect(harnessBody.results[0]).toMatchObject({ input: 'alpha', output: '06' });
    expect(harnessBody.results[1]).toMatchObject({ input: 'beta', output: '9c' });
    expect(harnessBody.results[2]).toMatchObject({ input: 'signed-payload', output: '91' });
  });
});
