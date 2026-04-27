export const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const BODY_MARKER = 'payload-marker-20260425';
export const SSE_MARKER = 'payload-marker-sse-20260425';
export const HTTP2_MARKER = 'payload-marker-h2-20260425';
export const SOURCEMAP_MARKER = 'payload-marker-sourcemap-20260425';
export const CONSOLE_LOG_MARKER = 'payload-marker-console-20260426';
export const CONSOLE_EXCEPTION_MARKER = 'payload-marker-console-exception-20260426';
export const AUTH_BEARER_MARKER = 'bearer-audit-20260426';
export const AUTH_API_KEY_MARKER = 'api-key-audit-20260426';
export const AUTH_SIGNATURE_MARKER = 'sig-audit-20260426';
export const INTERCEPT_MARKER = 'intercepted-body-20260426';
export const HEAP_MARKER = 'heap-marker-20260426';
export const HOOK_PRESET_MARKER = 'hook-preset-marker-20260426';
export const GRAPHQL_MARKER = 'graphql-marker-20260426';
export const WEBPACK_MARKER = 'webpack-marker-20260426';
export const WASM_MARKER = 'wasm-marker-20260426';
export const MEMORY_MARKER = 'memory-marker-20260427';
export const ROOT_RELOAD_KEY = '__audit_reload_count';
export const SCRIPT_TIMEOUT_MS = 14 * 60 * 1000;
export const GRAPHQL_BUFFER_PROBE_CODE = `(() => ({
  fetchArrayLength: Array.isArray(window.__fetchRequests) ? window.__fetchRequests.length : null,
  xhrArrayLength: Array.isArray(window.__xhrRequests) ? window.__xhrRequests.length : null,
  hasFetchGetter: typeof window.__getFetchRequests === "function",
  hasXhrGetter: typeof window.__getXHRRequests === "function",
  fetchInterceptorInstalled: window.__fetchInterceptorInstalled ?? null,
  fetchInterceptorInjected: window.__fetchInterceptorInjected ?? null,
}))()`;

export const TEST_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAw5ph3jyxq4RKueHGkMvnKpysHDHd+UipLwLFT5j2tlaa6YFY
hxhYfQalHf8AtGTW74czhlX9R365GwlBHhE7fR4vcGsxWbnpd/re8AEmLiW9YLrY
C7Ecw/uBpWOEf7EbYp3mh0anTfU9Zbec5CXH1IYl+tFk5luwc0mW7IL/1uZVStBC
+ttSju0bsuFGduGlCpoQwgXAoMWgPkpFIAQJ8N4nOKoe1LlAYT3/s0uqX07C9x+b
BpxdSOu9GhVSAzZ3qq9zlXyzn4XanHEBow4JmyrD8yiEF4qj1GaZnoSASOp3duhg
bH4BCUBPEjpA95OsgUzHptDRKeK+GUfyRhVgFQIDAQABAoIBAA8qZNynfYoEFYwg
dHYNDSUJZTHBbwmxJ8boktZHUJeWEug4Wl4NFe1JqtsuxoX2DJEhPS409BCLQ3xU
ZRtY8DEU+k4fzYF8r9yY05itqiFpVSvPCMmtR4LteOGTG/aPi4VDo1hJMtcRRNui
VxR8VmhEp2SxP/65TK6/nadER+RIMEzk18BdLGerYMS5RfcPcDtU2zDm997niwh6
cOfUk7UqyrOZ7blO+7ZX2b8MYn20aMfTqW/w764tbbnA9CUK5tA4uRvPU9vW7Abm
ZyzGdOX53EIefWFdREXI1x0lCbgkZ3NtxTTDLww8XzBGzPgtahNhiXUmQA20z5fX
YAtQ+uECgYEA5rz4Y4D2zMIqVXyn8AjBBy/neEP3B9rHinWpFhkxvBSOLzmxfkgu
0ZQpjYw0WGb6pTVlfZLFKSKBAdZeFhIkM6ZptF19Y5YgjasEjl7ey5Z4GKZY8S7L
HlEWa3/JL8Wmi7n/Kt794atQm8GDki5EsmvXPlJ98hqoYjlYagwUr7UCgYEA2QSp
DH538zK7HpNTluBSTZVRcmDnZePVzvJPEWn5CGkHArhRRO5lYFZ6pwhwqCfEgUxd
3b16spBJqTs+H2NllBQ3XyPSpCCVB+39F1lp49OdDm0haxcQ+zBBAgZKA4ics1tp
eSM6BsjwC1lhNgk8UrPG1bXtUU0g018cvhZOauECgYAXpvtXR9sEtkqcpMCaTGtt
Dy4NF/p0paqauODyUPbWLs08bg+RwFh8R1HTHrIm9bdvw/95Vdg8FTtgMtdGL+ni
GYbwZDz8PmFr5EH9TiBMgkohTLwFTSSpIOrJbjnzWbFu1Uwg2ubvgR4sOTQBghis
qX1Q+CfM74qfNv2nMUHVmQKBgD7WOpyDgffJGKUhw3JMQYh1U7/qjxXRgncJcht4
s8LbpkwDUoTDAleCssDqkLQfz6Yglo097+kEHlAB91rfTOozcFT76mHbjUtefYnl
OePdwfwLXUHEzAXvUuNjLssXI0hLj56jtImCZP7kQmGDCxRnOYtnwe9ohbiuMYRY
sRwBAoGARZcKdUUPs5X+Q7DxMRg7f5Yv3i7aqiAi/dZysb5W5On+xFXIJx/OPdQC
WKWO8S/U+5KFZQkJ5yxUcJXezd+HguoB5CL6BEQbfxTvDQW+AesXtmiIpoWqIKx4
cDY9yGCvWTzQwOVjlsEOsOpdZPvxPdZ4pG0tR5aF8BkHf0fKa2g=
-----END RSA PRIVATE KEY-----
`;

export const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIBATANBgkqhG9w0BAQsFADAtMRIwEAYDVQQDEwlsb2Nh
bGhvc3QxFzAVBgNVBAoTDmpzaG9va21jcC10ZXN0MB4XDTI0MDEwMTAwMDAwMFoX
DTM0MDEwMTAwMDAwMFowLTESMBAGA1UEAxMJbG9jYWxob3N0MRcwFQYDVQQKEw5q
c2hvb2ttY3AtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMOa
Yd48sauESrnhxpDL5yqcrBwx3flIqS8CxU+Y9rZWmumBWIcYWH0GpR3/ALRk1u+H
M4ZV/Ud+uRsJQR4RO30eL3BrMVm56Xf63vABJi4lvWC62AuxHMP7gaVjhH+xG2Kd
5odGp031PWW3nOQlx9SGJfrRZOZbsHNJluyC/9bmVUrQQvrbUo7tG7LhRnbhpQqa
EMIFwKDFoD5KRSAECfDeJziqHtS5QGE9/7NLql9OwvcfmwacXUjrvRoVUgM2d6qv
c5V8s5+F2pxxAaMOCZsqw/MohBeKo9RmmZ6EgEjqd3boYGx+AQlATxI6QPeTrIFM
x6bQ0SnivhlH8kYVYBUCAwEAAaNFMEMwCQYDVR0TBAIwADALBgNVHQ8EBAMCBaAw
EwYDVR0lBAwwCgYIKwYBBQUHAwEwFAYDVR0RBA0wC4IJbG9jYWxob3N0MA0GCSqG
SIb3DQEBCwUAA4IBAQAImU5ZLT6Rqhd3rWfsipnplqg1SJ8HiS6zKXMYqZ6sh90s
0l3ycj/EM+YnStK+pgHT1g9IRJ+Js8SBqsbhdXHh80cyw82qN1gE8aaLWrcQJBRk
38Cad5dmX/K6r5XmzJ9sAmbumm/YD72HnKOmjRqGu077sgUxFRBKOVS9gkFtSHIW
5BQFM7EF8xLRpGo5ObdBYt2NZyLVyxxbggj3x3II+wCvAQgi8NXOGbL8FOgGWWDH
hYl+QoIs6H1FE3av1uQdZn9ILfBfiq8jj2j85p/WwizYvSDGa78bcuwh8u/T2KIr
2Sn1Vm9W0vOLfa5gF6/w138SPqk5/LSzYSgnNR9q
-----END CERTIFICATE-----
`;
