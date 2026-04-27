import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import http2 from 'node:http2';
import tls from 'node:tls';
import { createProbeAssets } from './assets.mjs';

function parseWsFrames(buffer) {
  if (buffer.length < 2) {
    return null;
  }
  const first = buffer[0];
  const second = buffer[1];
  const masked = (second & 0x80) !== 0;
  let payloadLength = second & 0x7f;
  let offset = 2;
  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    const length = Number(buffer.readBigUInt64BE(offset));
    if (!Number.isSafeInteger(length)) {
      throw new Error('WebSocket frame too large');
    }
    payloadLength = length;
    offset += 8;
  }
  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes + payloadLength) {
    return null;
  }
  let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + payloadLength);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { bytesConsumed: offset + maskBytes + payloadLength, opcode: first & 0x0f, payload };
}

function sendWsText(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function createProbeServer(constants) {
  const {
    BODY_MARKER,
    GRAPHQL_MARKER,
    HTTP2_MARKER,
    ROOT_RELOAD_KEY,
    SSE_MARKER,
    SOURCEMAP_MARKER,
    TEST_CERT_PEM,
    TEST_KEY_PEM,
    WASM_MARKER,
    WEBPACK_MARKER,
    WS_MAGIC_GUID,
  } = constants;
  const assets = createProbeAssets({
    BODY_MARKER,
    GRAPHQL_MARKER,
    ROOT_RELOAD_KEY,
    SOURCEMAP_MARKER,
    WASM_MARKER,
    WEBPACK_MARKER,
  });
  let pluginRegistryPayload = assets.pluginRegistryPayload;
  let workflowRegistryPayload = assets.workflowRegistryPayload;
  const sockets = new Set();
  const tlsSockets = new Set();
  const httpServer = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end('missing url');
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(assets.rootPageHtml);
      return;
    }
    if (req.url === '/app.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(assets.rootAppScript);
      return;
    }
    if (req.url === '/plugins.index.json') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(pluginRegistryPayload));
      return;
    }
    if (req.url === '/workflows.index.json') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(workflowRegistryPayload));
      return;
    }
    if (req.url === '/graphql-page/' || req.url === '/graphql-page/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8" /><title>graphql probe</title><script>${assets.graphqlPageScript}</script></head><body><main><h1>${GRAPHQL_MARKER}</h1><button id="run-graphql" onclick="window.runGraphqlAudit('GraphQLButton')">Run GraphQL</button><pre id="graphql-output"></pre></main></body></html>`,
      );
      return;
    }
    if (req.url === '/webpack-page/' || req.url === '/webpack-page/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8" /><title>webpack probe</title><script>${assets.webpackPageScript}</script></head><body><main><h1>${WEBPACK_MARKER}</h1></main></body></html>`,
      );
      return;
    }
    if (req.url === '/wasm-page/' || req.url === '/wasm-page/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8" /><title>wasm probe</title><script>${assets.wasmPageScript}</script></head><body><main><h1>${WASM_MARKER}</h1></main></body></html>`,
      );
      return;
    }
    if (req.url === '/history/one') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>history-one</title></head><body><h1 data-page="one">history one</h1></body></html>',
      );
      return;
    }
    if (req.url === '/history/two') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>history-two</title></head><body><h1 data-page="two">history two</h1></body></html>',
      );
      return;
    }
    if (req.url === '/sourcemap/' || req.url === '/sourcemap/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><body><h1>sourcemap probe</h1><script src="/sourcemap/app.min.js"></script></body></html>',
      );
      return;
    }
    if (req.url === '/sourcemap/app.min.js') {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(assets.sourceMapScript);
      return;
    }
    if (req.url === '/sourcemap/app.min.js.map') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(assets.sourceMapPayload);
      return;
    }
    if (req.url === '/graphql') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type, x-runtime-audit',
          'access-control-allow-methods': 'POST, OPTIONS',
        });
        res.end();
        return;
      }
      const bodyText = await readRequestBody(req);
      let payload = null;
      try {
        payload = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        payload = null;
      }
      const query = typeof payload?.query === 'string' ? payload.query : '';
      const operationName =
        typeof payload?.operationName === 'string' ? payload.operationName : null;
      const variables =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload.variables
          : null;
      const requestedName =
        variables && typeof variables === 'object' && !Array.isArray(variables)
          ? variables.name
          : null;
      const responsePayload =
        query.includes('__schema') || operationName === 'IntrospectionQuery'
          ? assets.graphqlSchemaPayload
          : {
              data: {
                auditGreeting:
                  typeof requestedName === 'string'
                    ? `${GRAPHQL_MARKER}:${requestedName}`
                    : `${GRAPHQL_MARKER}:anonymous`,
                marker: GRAPHQL_MARKER,
                __typename: 'Query',
              },
            };
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(responsePayload));
      return;
    }
    if (req.url === '/wasm/runtime-audit.wasm') {
      res.writeHead(200, { 'content-type': 'application/wasm', 'cache-control': 'no-store' });
      res.end(assets.wasmProbeBytes);
      return;
    }
    if (req.url.startsWith('/body')) {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(assets.bodyPayload);
      return;
    }
    if (req.url.startsWith('/intercept-target')) {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end('original-intercept-body');
      return;
    }
    if (req.url.startsWith('/sse')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write(': connected\n\n');
      setTimeout(() => {
        res.write('id: evt-1\n');
        res.write(`data: ${SSE_MARKER}\n\n`);
      }, 150);
      setTimeout(() => {
        try {
          res.end();
        } catch {}
      }, 600);
      return;
    }
    res.writeHead(404).end('not found');
  });

  httpServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  const http2Server = http2.createServer();
  http2Server.on('stream', (stream, headers) => {
    const streamPath = typeof headers[':path'] === 'string' ? headers[':path'] : '/';
    if (streamPath !== '/h2') {
      stream.respond({ ':status': 404, 'content-type': 'text/plain; charset=utf-8' });
      stream.end('not found');
      return;
    }
    stream.respond({
      ':status': 200,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    stream.end(HTTP2_MARKER);
  });

  const tlsServer = tls.createServer({ key: TEST_KEY_PEM, cert: TEST_CERT_PEM }, (socket) => {
    tlsSockets.add(socket);
    socket.on('close', () => tlsSockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      const requestText = chunk.toString('utf8');
      if (!requestText.includes('\r\n\r\n')) {
        return;
      }
      socket.write(
        [
          'HTTP/1.1 200 OK',
          'Content-Type: text/plain; charset=utf-8',
          'Cache-Control: no-store',
          `Content-Length: ${Buffer.byteLength(BODY_MARKER, 'utf8')}`,
          'Connection: close',
          '',
          BODY_MARKER,
        ].join('\r\n'),
      );
      socket.end();
    });
  });

  httpServer.on('upgrade', (req, socket) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const secKey = req.headers['sec-websocket-key'];
    if (typeof secKey !== 'string') {
      socket.destroy();
      return;
    }
    const acceptKey = createHash('sha1')
      .update(secKey + WS_MAGIC_GUID)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        '',
      ].join('\r\n'),
    );
    sendWsText(socket, 'server-hello');
    let frameBuffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      while (frameBuffer.length > 0) {
        const frame = parseWsFrames(frameBuffer);
        if (!frame) break;
        frameBuffer = frameBuffer.subarray(frame.bytesConsumed);
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x1) {
          sendWsText(socket, `echo:${frame.payload.toString('utf8')}`);
        }
      }
    });
  });

  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  http2Server.listen(0, '127.0.0.1');
  await once(http2Server, 'listening');
  tlsServer.listen(0, '127.0.0.1');
  await once(tlsServer, 'listening');
  const address = httpServer.address();
  const http2Address = http2Server.address();
  const tlsAddress = tlsServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve probe server address');
  }
  if (!http2Address || typeof http2Address === 'string') {
    throw new Error('Failed to resolve HTTP/2 probe server address');
  }
  if (!tlsAddress || typeof tlsAddress === 'string') {
    throw new Error('Failed to resolve TLS probe server address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    http2Url: `http://127.0.0.1:${http2Address.port}/h2`,
    tlsPort: tlsAddress.port,
    graphqlEndpointUrl: `${baseUrl}/graphql`,
    graphqlPageUrl: `${baseUrl}/graphql-page/`,
    webpackPageUrl: `${baseUrl}/webpack-page/`,
    wasmPageUrl: `${baseUrl}/wasm-page/`,
    sourceMapPageUrl: `${baseUrl}/sourcemap/`,
    sourceMapUrl: assets.sourceMapDataUri,
    setRegistryFixtures({ plugins, workflows }) {
      if (Array.isArray(plugins)) {
        pluginRegistryPayload = { plugins };
      }
      if (Array.isArray(workflows)) {
        workflowRegistryPayload = { workflows };
      }
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      for (const socket of tlsSockets) socket.destroy();
      await new Promise((resolve) => httpServer.close(resolve));
      await new Promise((resolve) => http2Server.close(resolve));
      await new Promise((resolve) => tlsServer.close(resolve));
    },
  };
}
