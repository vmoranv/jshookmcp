import { execFile } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { promisify } from 'node:util';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const execFileAsync = promisify(execFile);

function parsePid(stdout) {
  const normalized = stdout.trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

function matchesBrowserCommand(command) {
  return /(chrome|chromium|msedge|edge)/i.test(command);
}

export async function getNewestChromePid() {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-Process chrome,msedge -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -Last 1 -ExpandProperty Id',
        ],
        { windowsHide: true, timeout: 10000 },
      );
      return parsePid(stdout);
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync(
      'pgrep',
      ['-n', '-f', 'Google Chrome|Chromium|chrome|msedge|Microsoft Edge'],
      { timeout: 10000 },
    );
    const pid = parsePid(stdout);
    if (pid) {
      return pid;
    }
  } catch {}

  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm='], { timeout: 10000 });
    const newestPid = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (!match) {
          return null;
        }
        const pid = Number.parseInt(match[1], 10);
        const command = match[2];
        if (!Number.isInteger(pid) || !matchesBrowserCommand(command)) {
          return null;
        }
        return { pid, command };
      })
      .filter((entry) => entry !== null)
      .toSorted((a, b) => b.pid - a.pid)[0];
    return newestPid ? String(newestPid.pid) : null;
  } catch {
    return null;
  }
}

export async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate free port');
  }
  return address.port;
}

export function buildMinimalTlsClientHelloRecordHex() {
  const version = Buffer.from([0x03, 0x03]);
  const random = Buffer.alloc(32, 0xab);
  const sessionId = Buffer.from([0x00]);
  const cipherSuites = Buffer.from([0x00, 0x04, 0x13, 0x01, 0x13, 0x02]);
  const compression = Buffer.from([0x01, 0x00]);
  const extensions = Buffer.from([0x00, 0x00]);
  const body = Buffer.concat([version, random, sessionId, cipherSuites, compression, extensions]);

  const handshakeHeader = Buffer.alloc(4);
  handshakeHeader[0] = 0x01;
  handshakeHeader[1] = (body.length >> 16) & 0xff;
  handshakeHeader[2] = (body.length >> 8) & 0xff;
  handshakeHeader[3] = body.length & 0xff;
  const handshake = Buffer.concat([handshakeHeader, body]);
  const recordHeader = Buffer.from([
    0x16,
    0x03,
    0x03,
    (handshake.length >> 8) & 0xff,
    handshake.length & 0xff,
  ]);
  return Buffer.concat([recordHeader, handshake]).toString('hex');
}

export function createTlsDecryptFixture() {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const plaintext = 'Hello, TLS!';
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  let encrypted = cipher.update(Buffer.from(plaintext, 'utf8'));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    plaintext,
    encryptedHex: encrypted.toString('hex'),
    keyHex: key.toString('hex'),
    nonceHex: nonce.toString('hex'),
    authTagHex: authTag.toString('hex'),
  };
}

export async function sendRawHttpRequest(port, requestText) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(requestText);
    });
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

export function getCliValue(flagName) {
  const inlinePrefix = `${flagName}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flagName) {
      const next = process.argv[index + 1];
      if (typeof next === 'string' && next.length > 0) {
        return next;
      }
      return undefined;
    }
    if (arg.startsWith(inlinePrefix)) {
      const value = arg.slice(inlinePrefix.length).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForBrowserEndpoint(browserURL, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${browserURL}/json/version`);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(
    `Timed out waiting for browser endpoint ${browserURL}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export function getPreferredBrowserExecutable() {
  const envCandidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const platformCandidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];

  for (const candidate of [...envCandidates, ...platformCandidates]) {
    if (!candidate) continue;
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    return candidate;
  }
  throw new Error('No Chrome-compatible executable found for browser_attach runtime probe');
}

export async function terminateProcessTree(childProcess) {
  if (!childProcess?.pid) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(childProcess.pid), '/T', '/F']);
      return;
    }
  } catch {}
  try {
    childProcess.kill('SIGTERM');
  } catch {}
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function terminateProcessId(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 15000 });
      return;
    }
  } catch {}

  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  await delay(500);
  if (!isPidAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

export function createClientTransport(toolProfile, extraEnv = {}) {
  return new StdioClientTransport({
    command: 'node',
    args: ['dist/index.mjs'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_TRANSPORT: 'stdio',
      MCP_TOOL_PROFILE: toolProfile,
      LOG_LEVEL: 'error',
      PUPPETEER_HEADLESS: 'true',
      ...extraEnv,
    },
    stderr: 'pipe',
  });
}
