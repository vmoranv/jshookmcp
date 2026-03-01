import type { NetworkRequest } from '../monitor/ConsoleMonitor.js';
import type { SignaturePattern, TokenPattern } from './IntelligentAnalyzer.js';

export function detectSignaturePatternsInternal(requests: NetworkRequest[]): SignaturePattern[] {
  const patterns: SignaturePattern[] = [];

  const signatureKeywords = [
    'sign',
    'signature',
    'sig',
    'hmac',
    'hash',
    'digest',
    'checksum',
    'verify',
    'validation',
  ];

  for (const req of requests) {
    if (req.url.includes('?')) {
      try {
        const url = new URL(req.url);
        const params = url.searchParams;
        const paramNames = Array.from(params.keys());

        for (const keyword of signatureKeywords) {
          const matchedParams = paramNames.filter((p) => p.toLowerCase().includes(keyword));

          if (matchedParams.length > 0) {
            let signType: 'HMAC' | 'JWT' | 'Custom' = 'Custom';
            if (keyword.includes('hmac')) signType = 'HMAC';
            else if (keyword.includes('jwt')) signType = 'JWT';

            const otherParams = paramNames.filter(
              (p) =>
                !matchedParams.includes(p) &&
                !p.toLowerCase().includes('callback') &&
                !p.toLowerCase().includes('_')
            );

            patterns.push({
              type: signType,
              location: `${req.url} (URL params)`,
              parameters: otherParams,
              confidence: 0.82,
            });
          }
        }
      } catch {}
    }

    if (req.headers) {
      for (const [headerName, headerValue] of Object.entries(req.headers)) {
        const headerNameLower = headerName.toLowerCase();

        const isSignatureHeader = signatureKeywords.some((keyword) =>
          headerNameLower.includes(keyword)
        );

        if (isSignatureHeader && headerValue) {
          let signType: 'HMAC' | 'JWT' | 'Custom' = 'Custom';
          let confidence = 0.75;

          if (/^[a-f0-9]{64,}$/i.test(headerValue)) {
            signType = 'HMAC';
            confidence = 0.88;
          } else if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(headerValue)) {
            signType = 'JWT';
            confidence = 0.92;
          }

          const otherHeaders = Object.keys(req.headers).filter(
            (h) =>
              h.toLowerCase() !== headerNameLower &&
              !h.toLowerCase().includes('content-type') &&
              !h.toLowerCase().includes('user-agent')
          );

          patterns.push({
            type: signType,
            location: `${req.url} (header: ${headerName})`,
            parameters: otherHeaders,
            confidence,
          });
        }
      }
    }

    if (req.postData && req.postData.length > 0) {
      try {
        const bodyData = JSON.parse(req.postData);

        for (const [key, value] of Object.entries(bodyData)) {
          const keyLower = key.toLowerCase();
          const isSignatureField = signatureKeywords.some((keyword) => keyLower.includes(keyword));

          if (isSignatureField && typeof value === 'string') {
            let signType: 'HMAC' | 'JWT' | 'Custom' = 'Custom';
            let confidence = 0.7;

            if (/^[a-f0-9]{64,}$/i.test(value)) {
              signType = 'HMAC';
              confidence = 0.85;
            } else if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(value)) {
              signType = 'JWT';
              confidence = 0.9;
            }

            const otherFields = Object.keys(bodyData).filter((k) => k !== key);

            patterns.push({
              type: signType,
              location: `${req.url} (POST body: ${key})`,
              parameters: otherFields,
              confidence,
            });
          }
        }
      } catch {
        for (const keyword of signatureKeywords) {
          if (req.postData.includes(`${keyword}=`)) {
            patterns.push({
              type: 'Custom',
              location: `${req.url} (POST body)`,
              parameters: ['form-urlencoded data'],
              confidence: 0.65,
            });
            break;
          }
        }
      }
    }
  }

  return patterns;
}

export function detectTokenPatternsInternal(requests: NetworkRequest[]): TokenPattern[] {
  const patterns: TokenPattern[] = [];

  const jwtRegex = /[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g;

  const tokenHeaderKeywords = [
    'authorization',
    'token',
    'auth',
    'access',
    'bearer',
    'session',
    'credential',
    'api-key',
    'apikey',
    'x-token',
    'x-auth',
    'x-access',
    'x-api-key',
    'x-session',
  ];

  for (const req of requests) {
    if (req.headers) {
      for (const [headerName, headerValue] of Object.entries(req.headers)) {
        const headerNameLower = headerName.toLowerCase();

        const isTokenHeader = tokenHeaderKeywords.some((keyword) =>
          headerNameLower.includes(keyword)
        );

        if (isTokenHeader && headerValue) {
          const jwtMatch = headerValue.match(jwtRegex);
          if (jwtMatch) {
            patterns.push({
              type: 'JWT',
              location: `${req.url} (header: ${headerName})`,
              format: `JWT in ${headerName} header`,
              confidence: 0.95,
            });
          } else if (headerValue.toLowerCase().startsWith('bearer ')) {
            patterns.push({
              type: 'Custom',
              location: `${req.url} (header: ${headerName})`,
              format: `Bearer token in ${headerName} header`,
              confidence: 0.9,
            });
          } else if (headerValue.length > 20 && /^[A-Za-z0-9_\-+=\/]+$/.test(headerValue)) {
            patterns.push({
              type: 'Custom',
              location: `${req.url} (header: ${headerName})`,
              format: `Custom token in ${headerName} header (length: ${headerValue.length})`,
              confidence: 0.75,
            });
          }
        }
      }
    }

    if (req.url.includes('?')) {
      try {
        const url = new URL(req.url);
        const params = url.searchParams;

        const tokenParamKeywords = [
          'token',
          'access_token',
          'accesstoken',
          'auth',
          'authorization',
          'session',
          'sessionid',
          'api_key',
          'apikey',
          'key',
          'credential',
        ];

        for (const [paramName, paramValue] of params.entries()) {
          const paramNameLower = paramName.toLowerCase();

          const isTokenParam = tokenParamKeywords.some((keyword) =>
            paramNameLower.includes(keyword)
          );

          if (isTokenParam && paramValue) {
            const jwtMatch = paramValue.match(jwtRegex);
            if (jwtMatch) {
              patterns.push({
                type: 'JWT',
                location: `${req.url} (param: ${paramName})`,
                format: `JWT in URL parameter '${paramName}'`,
                confidence: 0.92,
              });
            } else if (paramName.toLowerCase().includes('access_token')) {
              patterns.push({
                type: 'OAuth',
                location: `${req.url} (param: ${paramName})`,
                format: `OAuth token in URL parameter '${paramName}'`,
                confidence: 0.88,
              });
            } else if (paramValue.length > 20) {
              patterns.push({
                type: 'Custom',
                location: `${req.url} (param: ${paramName})`,
                format: `Custom token in URL parameter '${paramName}' (length: ${paramValue.length})`,
                confidence: 0.7,
              });
            }
          }
        }
      } catch {}
    }

    if (req.postData && req.postData.length > 0) {
      try {
        const bodyData = JSON.parse(req.postData);

        const tokenParamKeywords = [
          'token',
          'access_token',
          'auth',
          'authorization',
          'session',
          'api_key',
        ];

        for (const [key, value] of Object.entries(bodyData)) {
          const keyLower = key.toLowerCase();
          const isTokenField = tokenParamKeywords.some((keyword) => keyLower.includes(keyword));

          if (isTokenField && typeof value === 'string' && value.length > 20) {
            const jwtMatch = value.match(jwtRegex);
            if (jwtMatch) {
              patterns.push({
                type: 'JWT',
                location: `${req.url} (POST body: ${key})`,
                format: `JWT in POST body field '${key}'`,
                confidence: 0.93,
              });
            } else {
              patterns.push({
                type: 'Custom',
                location: `${req.url} (POST body: ${key})`,
                format: `Custom token in POST body field '${key}' (length: ${value.length})`,
                confidence: 0.72,
              });
            }
          }
        }
      } catch {
        const tokenParamKeywords = ['token', 'access_token', 'auth', 'session', 'api_key'];
        for (const keyword of tokenParamKeywords) {
          if (req.postData.includes(`${keyword}=`)) {
            patterns.push({
              type: 'Custom',
              location: `${req.url} (POST body)`,
              format: `Token in POST body (form-urlencoded, field: ${keyword})`,
              confidence: 0.68,
            });
          }
        }
      }
    }
  }

  return patterns;
}
