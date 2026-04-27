import dgram from 'node:dgram';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';

export async function runNetworkTlsPhase(ctx) {
  const { report, server, clients, helpers, constants, paths } = ctx;
  const { client } = clients;
  const {
    callTool,
    flattenStrings,
    getFreePort,
    pemToDerHex,
    createTlsDecryptFixture,
    buildMinimalTlsClientHelloRecordHex,
  } = helpers;
  const { BODY_MARKER, HTTP2_MARKER, TEST_CERT_PEM } = constants;
  const { runtimeArtifactDir } = paths;

  report.network.httpRequestBuild = await callTool(
    client,
    'http_request_build',
    {
      method: 'GET',
      target: '/body?via=raw-http',
      host: '127.0.0.1',
      headers: { 'X-Audit-Probe': '1' },
    },
    15000,
  );
  report.network.rawHttp = await callTool(
    client,
    'http_plain_request',
    {
      host: '127.0.0.1',
      port: Number(new URL(server.baseUrl).port),
      requestText:
        typeof report.network.httpRequestBuild?.requestText === 'string'
          ? report.network.httpRequestBuild.requestText
          : 'GET /body?via=raw-http HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
    },
    30000,
  );
  report.network.rawBodyHasMarker = flattenStrings(report.network.rawHttp).some((entry) =>
    entry.includes(BODY_MARKER),
  );
  report.network.http2FrameBuild = await callTool(
    client,
    'http2_frame_build',
    { frameType: 'PING', pingOpaqueDataHex: '0011223344556677' },
    15000,
  );
  report.network.http2 = await callTool(
    client,
    'http2_probe',
    {
      url: server.http2Url,
      timeoutMs: 15000,
      maxBodyBytes: 16384,
    },
    30000,
  );
  report.network.http2BodyHasMarker = flattenStrings(report.network.http2).some((entry) =>
    entry.includes(HTTP2_MARKER),
  );
  report.network.rtt = await callTool(
    client,
    'network_rtt_measure',
    {
      url: server.baseUrl,
      probeType: 'http',
      iterations: 1,
      timeoutMs: 5000,
    },
    30000,
  );
  report.network.tcpOpen = await callTool(
    client,
    'tcp_open',
    {
      host: '127.0.0.1',
      port: Number(new URL(server.baseUrl).port),
      timeoutMs: 5000,
    },
    30000,
  );
  const tcpSessionId =
    typeof report.network.tcpOpen?.sessionId === 'string' ? report.network.tcpOpen.sessionId : null;
  if (tcpSessionId) {
    report.network.tcpWrite = await callTool(
      client,
      'tcp_write',
      {
        sessionId: tcpSessionId,
        dataText:
          'GET /body?via=tcp-session HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      },
      30000,
    );
    report.network.tcpRead = await callTool(
      client,
      'tcp_read_until',
      {
        sessionId: tcpSessionId,
        delimiterText: BODY_MARKER,
        includeDelimiter: true,
        timeoutMs: 5000,
      },
      30000,
    );
    report.network.tcpClose = await callTool(
      client,
      'tcp_close',
      { sessionId: tcpSessionId },
      15000,
    );
  }

  report.network.tlsOpen = await callTool(
    client,
    'tls_open',
    {
      host: '127.0.0.1',
      port: server.tlsPort,
      servername: 'localhost',
      caPem: TEST_CERT_PEM,
      alpnProtocols: ['http/1.1'],
      timeoutMs: 5000,
    },
    30000,
  );
  const tlsSessionId =
    typeof report.network.tlsOpen?.sessionId === 'string' ? report.network.tlsOpen.sessionId : null;
  if (tlsSessionId) {
    report.network.tlsWrite = await callTool(
      client,
      'tls_write',
      {
        sessionId: tlsSessionId,
        dataText: 'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
      },
      30000,
    );
    report.network.tlsRead = await callTool(
      client,
      'tls_read_until',
      {
        sessionId: tlsSessionId,
        delimiterText: BODY_MARKER,
        includeDelimiter: true,
        timeoutMs: 5000,
      },
      30000,
    );
    report.network.tlsClose = await callTool(
      client,
      'tls_close',
      { sessionId: tlsSessionId },
      15000,
    );
  }

  report.network.rawWebSocketOpen = await callTool(
    client,
    'websocket_open',
    { url: server.wsUrl, timeoutMs: 5000 },
    30000,
  );
  const rawWebSocketSessionId =
    typeof report.network.rawWebSocketOpen?.sessionId === 'string'
      ? report.network.rawWebSocketOpen.sessionId
      : null;
  if (rawWebSocketSessionId) {
    report.network.rawWebSocketHello = await callTool(
      client,
      'websocket_read_frame',
      { sessionId: rawWebSocketSessionId, timeoutMs: 5000 },
      30000,
    );
    report.network.rawWebSocketSend = await callTool(
      client,
      'websocket_send_frame',
      {
        sessionId: rawWebSocketSessionId,
        frameType: 'text',
        dataText: 'hello',
        timeoutMs: 5000,
      },
      30000,
    );
    report.network.rawWebSocketReply = await callTool(
      client,
      'websocket_read_frame',
      { sessionId: rawWebSocketSessionId, timeoutMs: 5000 },
      30000,
    );
    report.network.rawWebSocketClose = await callTool(
      client,
      'websocket_close',
      {
        sessionId: rawWebSocketSessionId,
        closeCode: 1000,
        closeReason: 'done',
        timeoutMs: 1000,
      },
      15000,
    );
  }
  report.network.traceroute = await callTool(
    client,
    'network_traceroute',
    { target: '127.0.0.1', maxHops: 2, timeout: 1000 },
    15000,
  );
  report.network.icmpProbe = await callTool(
    client,
    'network_icmp_probe',
    { target: '127.0.0.1', ttl: 8, timeout: 1000 },
    15000,
  );
  report.tls.parseCertificate = await callTool(
    client,
    'tls_parse_certificate',
    { rawHex: pemToDerHex(TEST_CERT_PEM) },
    15000,
  );
  report.tls.probeEndpoint = await callTool(
    client,
    'tls_probe_endpoint',
    {
      host: 'localhost',
      port: server.tlsPort,
      servername: 'localhost',
      caPem: TEST_CERT_PEM,
      alpnProtocols: ['http/1.1'],
      timeoutMs: 5000,
    },
    30000,
  );
  report.tls.keylogEnable = await callTool(client, 'tls_keylog_enable', {}, 15000);
  const tlsKeylogPath =
    typeof report.tls.keylogEnable?.keyLogPath === 'string'
      ? report.tls.keylogEnable.keyLogPath
      : join(runtimeArtifactDir, 'runtime-audit.sslkeylog');
  const tlsKeylogContent = [
    'CLIENT_RANDOM aabb0011 11112222',
    'SERVER_HANDSHAKE_TRAFFIC_SECRET aabb0011 33334444',
  ].join('\n');
  await writeFile(tlsKeylogPath, `${tlsKeylogContent}\n`, 'utf8');
  report.tls.keylogParse = await callTool(
    client,
    'tls_keylog_parse',
    { path: tlsKeylogPath },
    15000,
  );
  report.tls.keylogSummarize = await callTool(
    client,
    'tls_keylog_summarize',
    { content: tlsKeylogContent },
    15000,
  );
  report.tls.keylogLookup = await callTool(
    client,
    'tls_keylog_lookup_secret',
    { clientRandom: 'aabb0011', label: 'CLIENT_RANDOM' },
    15000,
  );
  report.tls.keylogDisable = await callTool(
    client,
    'tls_keylog_disable',
    { path: tlsKeylogPath },
    15000,
  );
  const tlsDecryptFixture = createTlsDecryptFixture();
  report.tls.decryptPayload = await callTool(
    client,
    'tls_decrypt_payload',
    {
      encryptedHex: tlsDecryptFixture.encryptedHex,
      keyHex: tlsDecryptFixture.keyHex,
      nonceHex: tlsDecryptFixture.nonceHex,
      algorithm: 'aes-256-gcm',
      authTagHex: tlsDecryptFixture.authTagHex,
    },
    15000,
  );
  report.tls.parseHandshake = await callTool(
    client,
    'tls_parse_handshake',
    { rawHex: buildMinimalTlsClientHelloRecordHex() },
    15000,
  );
  report.tls.cipherSuites = await callTool(client, 'tls_cipher_suites', { filter: 'AES' }, 15000);

  const rawTcpSendServer = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      socket.end(`ACK:${Buffer.concat(chunks).toString('utf8')}`);
    });
  });
  rawTcpSendServer.listen(0, '127.0.0.1');
  await once(rawTcpSendServer, 'listening');
  const rawTcpSendAddress = rawTcpSendServer.address();
  if (!rawTcpSendAddress || typeof rawTcpSendAddress === 'string') {
    throw new Error('Failed to resolve raw TCP send fixture address');
  }
  report.tls.rawTcpSend = await callTool(
    client,
    'net_raw_tcp_send',
    {
      host: '127.0.0.1',
      port: rawTcpSendAddress.port,
      dataText: 'raw-tcp-audit',
      timeout: 5000,
    },
    15000,
  );
  await new Promise((resolve) => rawTcpSendServer.close(resolve));

  const rawTcpListenPort = await getFreePort();
  const rawTcpListenPromise = callTool(
    client,
    'net_raw_tcp_listen',
    { port: rawTcpListenPort, timeout: 5000 },
    15000,
  );
  setTimeout(() => {
    const socket = net.createConnection({ host: '127.0.0.1', port: rawTcpListenPort }, () => {
      socket.end('raw-tcp-listen-audit');
    });
    socket.on('error', () => {});
  }, 150);
  report.tls.rawTcpListen = await rawTcpListenPromise;

  const rawUdpEchoServer = dgram.createSocket('udp4');
  rawUdpEchoServer.on('message', (msg, rinfo) => {
    rawUdpEchoServer.send(Buffer.from(`echo:${msg.toString('utf8')}`), rinfo.port, rinfo.address);
  });
  await new Promise((resolve, reject) => {
    rawUdpEchoServer.once('error', reject);
    rawUdpEchoServer.bind(0, '127.0.0.1', resolve);
  });
  const rawUdpEchoAddress = rawUdpEchoServer.address();
  if (!rawUdpEchoAddress || typeof rawUdpEchoAddress === 'string') {
    throw new Error('Failed to resolve raw UDP send fixture address');
  }
  report.tls.rawUdpSend = await callTool(
    client,
    'net_raw_udp_send',
    {
      host: '127.0.0.1',
      port: rawUdpEchoAddress.port,
      dataText: 'raw-udp-audit',
      timeout: 5000,
    },
    15000,
  );
  await new Promise((resolve) => rawUdpEchoServer.close(resolve));

  const rawUdpListenPort = await getFreePort();
  const rawUdpListenPromise = callTool(
    client,
    'net_raw_udp_listen',
    { port: rawUdpListenPort, timeout: 5000 },
    15000,
  );
  setTimeout(() => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => socket.close());
    socket.send(Buffer.from('raw-udp-listen-audit'), rawUdpListenPort, '127.0.0.1', () =>
      socket.close(),
    );
  }, 150);
  report.tls.rawUdpListen = await rawUdpListenPromise;
}
