import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  parseOptionalString,
  parseNetworkAuthorization,
  clamp,
  roundMs,
  computeRttStats,
  resolveAuthorizedTransportTarget,
} from './raw-helpers';
import { emitEvent, parseNumberArg } from './shared';
import { icmpProbe, traceroute, isIcmpAvailable } from '@native/IcmpProbe';

export class RawLatencyHandlers {
  constructor(private readonly eventBus?: EventBus<ServerEventMap>) {}

  async handleNetworkRttMeasure(args: Record<string, unknown>) {
    const urlRaw = parseOptionalString(args.url, 'url');
    if (!urlRaw) {
      throw new Error('url is required');
    }

    const probeType = (parseOptionalString(args.probeType, 'probeType') ?? 'tcp') as
      | 'tcp'
      | 'tls'
      | 'http';
    if (!['tcp', 'tls', 'http'].includes(probeType)) {
      throw new Error('probeType must be one of: tcp, tls, http');
    }

    const iterations = clamp(
      args.iterations !== undefined
        ? parseNumberArg(args.iterations, { defaultValue: 5, min: 1, integer: true })
        : 5,
      1,
      50,
    );
    const timeoutMs = clamp(
      args.timeoutMs !== undefined
        ? parseNumberArg(args.timeoutMs, { defaultValue: 5000, min: 100, integer: true })
        : 5000,
      100,
      30000,
    );
    const authorization = parseNetworkAuthorization(args.authorization);
    const { url, target } = await resolveAuthorizedTransportTarget(
      urlRaw,
      authorization,
      'RTT measurement',
    );

    const hostname = target.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const resolvedIp = target.resolvedAddress ?? hostname;
    const useHttps = url.protocol === 'https:';
    const samples: number[] = [];
    const errors: string[] = [];

    for (let index = 0; index < iterations; index += 1) {
      try {
        const rtt = await this.measureSingleRtt(
          hostname,
          resolvedIp,
          port,
          probeType,
          timeoutMs,
          useHttps,
        );
        samples.push(rtt);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const stats = computeRttStats(samples);

    emitEvent(this.eventBus, 'network:rtt_measured', {
      url: urlRaw,
      probeType,
      iterations,
      successCount: samples.length,
      errorCount: errors.length,
      stats,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge({
        target: { hostname, port, resolvedIp, probeType },
        stats,
        samples,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      })
      .json();
  }

  async handleNetworkTraceroute(args: Record<string, unknown>) {
    try {
      if (!isIcmpAvailable()) {
        return R.text(
          'ICMP traceroute not available on this platform (Windows: native API, Linux/macOS: requires root/CAP_NET_RAW)',
          true,
        );
      }
      const target = parseOptionalString(args.target, 'target');
      if (!target) {
        return R.text('target is required', true);
      }
      const maxHops = clamp(args.maxHops !== undefined ? Number(args.maxHops) : 30, 1, 64);
      const timeout = clamp(args.timeout !== undefined ? Number(args.timeout) : 5000, 100, 30000);
      const packetSize = clamp(
        args.packetSize !== undefined ? Number(args.packetSize) : 32,
        8,
        65500,
      );

      const result = traceroute({ target, maxHops, timeout, packetSize });
      return R.ok().json(result as unknown as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`Traceroute failed: ${message}`).json();
    }
  }

  async handleNetworkIcmpProbe(args: Record<string, unknown>) {
    try {
      if (!isIcmpAvailable()) {
        return R.text(
          'ICMP probe not available on this platform (Windows: native API, Linux/macOS: requires root/CAP_NET_RAW)',
          true,
        );
      }
      const target = parseOptionalString(args.target, 'target');
      if (!target) {
        return R.text('target is required', true);
      }
      const ttl = clamp(args.ttl !== undefined ? Number(args.ttl) : 128, 1, 255);
      const timeout = clamp(args.timeout !== undefined ? Number(args.timeout) : 5000, 100, 30000);
      const packetSize = clamp(
        args.packetSize !== undefined ? Number(args.packetSize) : 32,
        8,
        65500,
      );

      const result = icmpProbe({ target, ttl, packetSize, timeout });
      return R.ok().json(result as unknown as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`ICMP probe failed: ${message}`).json();
    }
  }

  measureSingleRtt(
    hostname: string,
    address: string,
    port: number,
    probeType: 'tcp' | 'tls' | 'http',
    timeoutMs: number,
    useHttps: boolean,
  ): Promise<number> {
    switch (probeType) {
      case 'tcp':
        return this.probeTcp(address, port, timeoutMs);
      case 'tls':
        return this.probeTls(hostname, address, port, timeoutMs);
      case 'http':
        return this.probeHttp(hostname, address, port, timeoutMs, useHttps);
    }
  }

  createPinnedLookup(address: string) {
    const family = net.isIP(address) === 6 ? 6 : 4;
    return (
      _hostname: string,
      optionsOrCallback: unknown,
      maybeCallback?: (
        error: NodeJS.ErrnoException | null,
        resolvedAddress: string,
        resolvedFamily: number,
      ) => void,
    ): void => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      callback?.(null, address, family);
    };
  }

  probeTcp(host: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const timer = setTimeout(
        () => reject(new Error(`TCP probe timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const socket = net.createConnection({ host, port }, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(roundMs(performance.now() - start));
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });
  }

  probeTls(hostname: string, address: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let settled = false;
      let socket: tls.TLSSocket | null = null;
      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket?.destroy();
        callback();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`TLS probe timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      socket = tls.connect(
        {
          host: hostname,
          port,
          lookup: this.createPinnedLookup(address),
          ...(net.isIP(hostname) === 0 ? { servername: hostname } : {}),
        },
        () => {
          finish(() => resolve(roundMs(performance.now() - start)));
        },
      );
      socket.on('error', (err) => {
        finish(() => reject(err));
      });
    });
  }

  probeHttp(
    hostname: string,
    address: string,
    port: number,
    timeoutMs: number,
    useHttps: boolean,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      let settled = false;
      let request: http.ClientRequest | null = null;
      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        request?.destroy();
        callback();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error(`HTTP probe timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      const requestFactory = useHttps ? https.request : http.request;
      request = requestFactory(
        {
          host: hostname,
          port,
          path: '/',
          method: 'HEAD',
          lookup: this.createPinnedLookup(address),
          ...(useHttps && net.isIP(hostname) === 0 ? { servername: hostname } : {}),
        },
        (response) => {
          response.resume();
          finish(() => resolve(roundMs(performance.now() - start)));
        },
      );
      request.on('error', (error) => {
        finish(() => reject(error));
      });
      request.end();
    });
  }
}
