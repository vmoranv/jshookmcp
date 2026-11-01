import type { NetworkRequest } from '@modules/monitor/ConsoleMonitor';
import type { SignaturePattern, TokenPattern } from '@modules/analyzer/IntelligentAnalyzer';
import { logger } from '@utils/logger';
import {
  PATTERN_SIGNATURE_CONFIDENCE_BODY_CUSTOM,
  PATTERN_SIGNATURE_CONFIDENCE_BODY_FORM,
  PATTERN_SIGNATURE_CONFIDENCE_BODY_HMAC,
  PATTERN_SIGNATURE_CONFIDENCE_BODY_JWT,
  PATTERN_SIGNATURE_CONFIDENCE_HEADER_CUSTOM,
  PATTERN_SIGNATURE_CONFIDENCE_HEADER_HMAC,
  PATTERN_SIGNATURE_CONFIDENCE_HEADER_JWT,
  PATTERN_SIGNATURE_CONFIDENCE_URL_PARAM,
  PATTERN_TOKEN_CONFIDENCE_BODY_CUSTOM,
  PATTERN_TOKEN_CONFIDENCE_BODY_FORM,
  PATTERN_TOKEN_CONFIDENCE_BODY_JWT,
  PATTERN_TOKEN_CONFIDENCE_HEADER_BEARER,
  PATTERN_TOKEN_CONFIDENCE_HEADER_CUSTOM,
  PATTERN_TOKEN_CONFIDENCE_HEADER_JWT,
  PATTERN_TOKEN_CONFIDENCE_PARAM_CUSTOM,
  PATTERN_TOKEN_CONFIDENCE_PARAM_JWT,
  PATTERN_TOKEN_CONFIDENCE_PARAM_OAUTH,
  PATTERN_TOKEN_MIN_LENGTH,
} from '@src/constants';

export function detectSignaturePatternsInternal(requests: NetworkRequest[]): SignaturePattern[] {
  const patterns: SignaturePattern[] = [];

  for (const req of requests) {
    collectUrlParamSignatures(req, patterns);
    collectHeaderSignatures(req, patterns);
    collectBodySignatures(req, patterns);
  }

  return patterns;
}

/** Keywords whose presence in a param/key/header name marks it a signature. */
const SIGNATURE_KEYWORDS = [
  'sign',
  'signature',
  'sig',
  'hmac',
  'jwt',
  'hash',
  'digest',
  'checksum',
  'verify',
  'validation',
];

/** Per-channel confidence constants — header and body differ. */
const HEADER_SIGNATURE_CONFIDENCE: SignatureConfidence = {
  custom: PATTERN_SIGNATURE_CONFIDENCE_HEADER_CUSTOM,
  hmac: PATTERN_SIGNATURE_CONFIDENCE_HEADER_HMAC,
  jwt: PATTERN_SIGNATURE_CONFIDENCE_HEADER_JWT,
};

const BODY_SIGNATURE_CONFIDENCE: SignatureConfidence = {
  custom: PATTERN_SIGNATURE_CONFIDENCE_BODY_CUSTOM,
  hmac: PATTERN_SIGNATURE_CONFIDENCE_BODY_HMAC,
  jwt: PATTERN_SIGNATURE_CONFIDENCE_BODY_JWT,
};

/** A hex digest of 64+ chars is treated as an HMAC. */
const HMAC_DIGEST_RE = /^[a-f0-9]{64,}$/i;
/** Three dot-separated base64url segments = a JWT. */
const JWT_SHAPE_RE = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;

/** Confidence triplet for one detection channel (URL / header / body). */
interface SignatureConfidence {
  custom: number;
  hmac: number;
  jwt: number;
}

/** Classify a signature value by shape using the channel's confidence set. */
function classifySignatureValue(
  value: string,
  confidence: SignatureConfidence,
): { signType: 'HMAC' | 'JWT' | 'Custom'; confidence: number } {
  if (HMAC_DIGEST_RE.test(value)) {
    return { signType: 'HMAC', confidence: confidence.hmac };
  }
  if (JWT_SHAPE_RE.test(value)) {
    return { signType: 'JWT', confidence: confidence.jwt };
  }
  return { signType: 'Custom', confidence: confidence.custom };
}

/** Signature candidates carried in query parameters. */
function collectUrlParamSignatures(req: NetworkRequest, patterns: SignaturePattern[]): void {
  if (!req.url.includes('?')) return;

  try {
    const params = new URL(req.url).searchParams;
    const paramNames = Array.from(params.keys());

    for (const keyword of SIGNATURE_KEYWORDS) {
      const matchedParams = paramNames.filter((p) => p.toLowerCase().includes(keyword));
      if (matchedParams.length === 0) continue;

      let signType: 'HMAC' | 'JWT' | 'Custom' = 'Custom';
      if (keyword.includes('hmac')) signType = 'HMAC';
      else if (keyword.includes('jwt')) signType = 'JWT';

      const otherParams = paramNames.filter(
        (p) =>
          !matchedParams.includes(p) &&
          !p.toLowerCase().includes('callback') &&
          !p.toLowerCase().includes('_'),
      );

      patterns.push({
        type: signType,
        location: `${req.url} (URL params)`,
        parameters: otherParams,
        confidence: PATTERN_SIGNATURE_CONFIDENCE_URL_PARAM,
      });
    }
  } catch (err) {
    logger.debug(
      `[AuthPatterns] URL parse failed for signature detection: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Signature candidates carried in request headers. */
function collectHeaderSignatures(req: NetworkRequest, patterns: SignaturePattern[]): void {
  if (!req.headers) return;

  for (const [headerName, headerValue] of Object.entries(req.headers)) {
    const headerNameLower = headerName.toLowerCase();
    const isSignatureHeader = SIGNATURE_KEYWORDS.some((keyword) =>
      headerNameLower.includes(keyword),
    );
    if (!isSignatureHeader || !headerValue) continue;

    const { signType, confidence } = classifySignatureValue(
      headerValue,
      HEADER_SIGNATURE_CONFIDENCE,
    );

    const otherHeaders = Object.keys(req.headers).filter(
      (h) =>
        h.toLowerCase() !== headerNameLower &&
        !h.toLowerCase().includes('content-type') &&
        !h.toLowerCase().includes('user-agent'),
    );

    patterns.push({
      type: signType,
      location: `${req.url} (header: ${headerName})`,
      parameters: otherHeaders,
      confidence,
    });
  }
}

/** Signature candidates carried in a JSON or form-encoded POST body. */
function collectBodySignatures(req: NetworkRequest, patterns: SignaturePattern[]): void {
  if (!req.postData || req.postData.length === 0) return;

  let bodyData: Record<string, unknown>;
  try {
    bodyData = JSON.parse(req.postData) as Record<string, unknown>;
  } catch {
    collectFormBodySignatures(req, patterns);
    return;
  }

  for (const [key, value] of Object.entries(bodyData)) {
    const keyLower = key.toLowerCase();
    const isSignatureField = SIGNATURE_KEYWORDS.some((keyword) => keyLower.includes(keyword));
    if (!isSignatureField || typeof value !== 'string') continue;

    const { signType, confidence } = classifySignatureValue(value, BODY_SIGNATURE_CONFIDENCE);

    patterns.push({
      type: signType,
      location: `${req.url} (POST body: ${key})`,
      parameters: Object.keys(bodyData).filter((k) => k !== key),
      confidence,
    });
  }
}

/** Form-urlencoded fallback when the body is not JSON. */
function collectFormBodySignatures(req: NetworkRequest, patterns: SignaturePattern[]): void {
  const postData = req.postData ?? '';
  for (const keyword of SIGNATURE_KEYWORDS) {
    if (!postData.includes(`${keyword}=`)) continue;
    patterns.push({
      type: 'Custom',
      location: `${req.url} (POST body)`,
      parameters: ['form-urlencoded data'],
      confidence: PATTERN_SIGNATURE_CONFIDENCE_BODY_FORM,
    });
    break;
  }
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
          headerNameLower.includes(keyword),
        );

        if (isTokenHeader && headerValue) {
          const jwtMatch = headerValue.match(jwtRegex);
          if (jwtMatch) {
            patterns.push({
              type: 'JWT',
              location: `${req.url} (header: ${headerName})`,
              format: `JWT in ${headerName} header`,
              confidence: PATTERN_TOKEN_CONFIDENCE_HEADER_JWT,
            });
          } else if (headerValue.toLowerCase().startsWith('bearer ')) {
            patterns.push({
              type: 'Custom',
              location: `${req.url} (header: ${headerName})`,
              format: `Bearer token in ${headerName} header`,
              confidence: PATTERN_TOKEN_CONFIDENCE_HEADER_BEARER,
            });
          } else if (
            headerValue.length > PATTERN_TOKEN_MIN_LENGTH &&
            /^[A-Za-z0-9_\-+=/]+$/.test(headerValue)
          ) {
            patterns.push({
              type: 'Custom',
              location: `${req.url} (header: ${headerName})`,
              format: `Custom token in ${headerName} header (length: ${headerValue.length})`,
              confidence: PATTERN_TOKEN_CONFIDENCE_HEADER_CUSTOM,
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
            paramNameLower.includes(keyword),
          );

          if (isTokenParam && paramValue) {
            const jwtMatch = paramValue.match(jwtRegex);
            if (jwtMatch) {
              patterns.push({
                type: 'JWT',
                location: `${req.url} (param: ${paramName})`,
                format: `JWT in URL parameter '${paramName}'`,
                confidence: PATTERN_TOKEN_CONFIDENCE_PARAM_JWT,
              });
            } else if (paramName.toLowerCase().includes('access_token')) {
              patterns.push({
                type: 'OAuth',
                location: `${req.url} (param: ${paramName})`,
                format: `OAuth token in URL parameter '${paramName}'`,
                confidence: PATTERN_TOKEN_CONFIDENCE_PARAM_OAUTH,
              });
            } else if (paramValue.length > PATTERN_TOKEN_MIN_LENGTH) {
              patterns.push({
                type: 'Custom',
                location: `${req.url} (param: ${paramName})`,
                format: `Custom token in URL parameter '${paramName}' (length: ${paramValue.length})`,
                confidence: PATTERN_TOKEN_CONFIDENCE_PARAM_CUSTOM,
              });
            }
          }
        }
      } catch (err) {
        logger.debug(
          `[AuthPatterns] URL parse failed for token detection: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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

          if (
            isTokenField &&
            typeof value === 'string' &&
            value.length > PATTERN_TOKEN_MIN_LENGTH
          ) {
            const jwtMatch = value.match(jwtRegex);
            if (jwtMatch) {
              patterns.push({
                type: 'JWT',
                location: `${req.url} (POST body: ${key})`,
                format: `JWT in POST body field '${key}'`,
                confidence: PATTERN_TOKEN_CONFIDENCE_BODY_JWT,
              });
            } else {
              patterns.push({
                type: 'Custom',
                location: `${req.url} (POST body: ${key})`,
                format: `Custom token in POST body field '${key}' (length: ${value.length})`,
                confidence: PATTERN_TOKEN_CONFIDENCE_BODY_CUSTOM,
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
              confidence: PATTERN_TOKEN_CONFIDENCE_BODY_FORM,
            });
          }
        }
      }
    }
  }

  return patterns;
}
