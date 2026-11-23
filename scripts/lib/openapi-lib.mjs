/**
 * Pure helpers for scripts/generate/openapi.mjs — OpenAPI 3.1 tool spec generation.
 *
 * Everything in this module is deterministic and side-effect free so that the
 * `--check` mode can recompute the document and byte-compare it against the
 * checked-in openapi.json (same contract as scripts/generate/metadata.mjs).
 */

export const OPENAPI_SPEC_VERSION = '3.1.0';
export const META_DOMAIN = 'meta';

/** Pretty output above this size falls back to a compact (single-line) JSON body. */
export const PRETTY_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;

/** Replace every non-alphanumeric run with `_` so a schema key is a valid OpenAPI component name. */
export function sanitizeSchemaKeyPart(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, '_');
}

/**
 * Map each tool to a unique `components.schemas` key (`<domain>_<tool>`).
 * Collisions (after sanitization) get a numeric suffix so every key stays
 * unique. The map is keyed by tool name, which requires tool names to be
 * unique across the whole surface — guaranteed by MCP registration semantics
 * (catalog and meta tools share one tool-name namespace).
 */
export function collectSchemaKeys(entries) {
  const keysByName = new Map();
  const usedKeys = new Set();

  for (const entry of entries) {
    const base = `${sanitizeSchemaKeyPart(entry.domain)}_${sanitizeSchemaKeyPart(entry.name)}`;
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    usedKeys.add(key);
    keysByName.set(entry.name, key);
  }

  return keysByName;
}

/** Short single-line summary: first non-empty line, cut at the first sentence end or 120 chars. */
export function buildToolSummary(description) {
  const firstLine = String(description ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return 'Invoke the tool.';
  }

  const sentenceEnd = firstLine.search(/[.!?](\s|$)/);
  const sentence = sentenceEnd >= 0 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;
  if (sentence.length <= 120) {
    return sentence;
  }
  return `${sentence.slice(0, 117)}...`;
}

/** Ensure the tool-provided JSON Schema is well-formed (defensive clone, default missing type). */
export function normalizeInputSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }
  const clone = structuredClone(schema);
  if (typeof clone.type !== 'string') {
    clone.type = 'object';
  }
  return clone;
}

function buildPostOperation({ toolName, description, schemaKey, tags, extensions }) {
  return {
    post: {
      operationId: toolName,
      summary: buildToolSummary(description),
      description: String(description ?? ''),
      tags,
      ...extensions,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaKey}` },
          },
        },
      },
      responses: {
        200: {
          description: 'Tool execution result returned as MCP tool result text content.',
          content: {
            'text/plain': {
              schema: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

/**
 * Build the full OpenAPI 3.1 document.
 *
 * @param {object} input
 * @param {string} input.name package.json name (used as info.title)
 * @param {string} input.version package.json version
 * @param {string} input.description package.json description
 * @param {Array<{name: string, description: string, inputSchema: object, domain: string, profiles?: string[] | null}>} input.catalogEntries
 * @param {Array<{name: string, description: string, inputSchema: object}>} input.metaTools
 */
export function buildOpenApiDocument({ name, version, description, catalogEntries, metaTools }) {
  const sortedCatalog = [...catalogEntries].toSorted(
    (a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name),
  );
  const sortedMeta = [...metaTools].toSorted((a, b) => a.name.localeCompare(b.name));
  const schemaKeys = collectSchemaKeys([
    ...sortedCatalog,
    ...sortedMeta.map((tool) => ({ ...tool, domain: META_DOMAIN })),
  ]);

  const paths = {};
  const schemas = {};

  for (const entry of sortedCatalog) {
    const schemaKey = schemaKeys.get(entry.name);
    const extensions = { 'x-domain': entry.domain };
    if (Array.isArray(entry.profiles) && entry.profiles.length > 0) {
      extensions['x-profiles'] = [...entry.profiles];
    }
    paths[`/${entry.domain}/${entry.name}`] = buildPostOperation({
      toolName: entry.name,
      description: entry.description,
      schemaKey,
      tags: [entry.domain],
      extensions,
    });
    schemas[schemaKey] = normalizeInputSchema(entry.inputSchema);
  }

  for (const tool of sortedMeta) {
    const schemaKey = schemaKeys.get(tool.name);
    paths[`/${META_DOMAIN}/${tool.name}`] = buildPostOperation({
      toolName: tool.name,
      description: tool.description,
      schemaKey,
      tags: [META_DOMAIN],
      extensions: {},
    });
    schemas[schemaKey] = normalizeInputSchema(tool.inputSchema);
  }

  const domainNames = [...new Set(sortedCatalog.map((entry) => entry.domain))].toSorted((a, b) =>
    a.localeCompare(b),
  );

  return {
    openapi: OPENAPI_SPEC_VERSION,
    info: {
      title: name,
      version,
      description,
    },
    servers: [
      {
        url: 'stdio://jshookmcp',
        description:
          'Default MCP stdio transport: run `jshookmcp` and speak MCP JSON-RPC 2.0 over stdin/stdout. ' +
          'Each path below maps to one MCP tool invocation; the POST body is the tool inputSchema payload.',
      },
      {
        url: 'http://127.0.0.1:{port}/mcp',
        description:
          'MCP Streamable HTTP transport, enabled with MCP_TRANSPORT=http; endpoint path is /mcp.',
        variables: {
          port: {
            default: '3000',
            description: 'HTTP listen port (MCP_PORT, default 3000).',
          },
        },
      },
    ],
    tags: [
      ...domainNames.map((domain) => ({ name: domain })),
      {
        name: META_DOMAIN,
        description: 'Search and activation meta-tools registered outside the domain catalog.',
      },
    ],
    paths,
    components: {
      schemas,
    },
  };
}

/**
 * Deeply sort object keys (arrays keep their order) so serialization is
 * byte-stable regardless of insertion order from the data source.
 */
export function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, child]) => [key, sortDeep(child)]);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/** Deterministic serialization; falls back to compact JSON when pretty output exceeds the size limit. */
export function serializeDocument(document) {
  const sorted = sortDeep(document);
  const pretty = `${JSON.stringify(sorted, null, 2)}\n`;
  if (Buffer.byteLength(pretty, 'utf8') <= PRETTY_SIZE_LIMIT_BYTES) {
    return pretty;
  }
  return `${JSON.stringify(sorted)}\n`;
}

/**
 * Recursively compare two JSON-shaped values and return the path of the first
 * difference (e.g. `$.paths["/adb-bridge/adb_apk_analyze"].post.description`),
 * or null when identical. Structural mismatches (type changes, missing keys)
 * are reported at the shallowest differing path. Plain-identifier keys use dot
 * notation; other keys (and array indices) use bracket notation.
 */
export function findFirstDifference(actual, expected, path = '$') {
  if (actual === expected) {
    return null;
  }

  const actualType = actual === null ? 'null' : typeof actual;
  const expectedType = expected === null ? 'null' : typeof expected;
  if (actualType !== expectedType || Array.isArray(actual) !== Array.isArray(expected)) {
    return path;
  }

  if (actualType === 'object') {
    const actualKeys = new Set(Object.keys(actual));
    const expectedKeys = new Set(Object.keys(expected));
    const joinPath = (key) =>
      Array.isArray(actual)
        ? `${path}[${key}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
          ? `${path}.${key}`
          : `${path}[${JSON.stringify(key)}]`;

    for (const key of expectedKeys) {
      if (!actualKeys.has(key)) {
        return joinPath(key);
      }
    }
    for (const key of actualKeys) {
      if (!expectedKeys.has(key)) {
        return joinPath(key);
      }
    }
    for (const key of expectedKeys) {
      const difference = findFirstDifference(actual[key], expected[key], joinPath(key));
      if (difference) {
        return difference;
      }
    }
    return null;
  }

  return path;
}
