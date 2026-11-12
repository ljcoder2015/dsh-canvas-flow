// SPDX-License-Identifier: MIT OR Apache-2.0
// Minimal Model Context Protocol server core: JSON-RPC 2.0 messages, protocol version
// negotiation, tool listing and tool calls. Transport-independent; `serveStdio` connects it to
// newline-delimited JSON on stdin/stdout. No dependencies.

/** Protocol revisions this server implements, newest first. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const ErrorCode = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

/** An error a tool reports to the model (returned as a tool result with `isError`). */
export class ToolError extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: isObject,
  array: Array.isArray,
};

/**
 * Checks `args` against a tool's input schema (the subset tools here use: object with typed,
 * optionally enumerated properties, `required` and `additionalProperties: false`). Returns a list
 * of problems, empty when valid.
 */
export function checkArguments(schema, args) {
  if (!isObject(args)) return ['arguments must be an object'];
  const problems = [];
  const props = schema.properties ?? {};
  for (const name of schema.required ?? []) if (args[name] === undefined) problems.push(`'${name}' is required`);
  for (const [name, value] of Object.entries(args)) {
    const prop = props[name];
    if (!prop) {
      if (schema.additionalProperties === false) problems.push(`unknown argument '${name}'`);
      continue;
    }
    if (prop.type && !TYPE_CHECKS[prop.type]?.(value)) problems.push(`'${name}' must be of type ${prop.type}`);
    else if (prop.enum && !prop.enum.includes(value)) problems.push(`'${name}' must be one of ${prop.enum.join(', ')}`);
    else if (prop.minimum !== undefined && value < prop.minimum) problems.push(`'${name}' must be at least ${prop.minimum}`);
  }
  return problems;
}

/**
 * Creates a server. `tools` are { name, title, description, inputSchema, annotations, handler },
 * where `handler(args)` returns a JSON-serializable object (sent as structured content and as
 * text) or throws `ToolError`. Returns { handle(message) -> Promise<response | null> }.
 */
export function createServer({ name, title, version, instructions, tools, log = () => {} }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  let negotiated = null;

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });

  async function callTool(params) {
    const tool = byName.get(params?.name);
    if (!tool) return { error: [ErrorCode.INVALID_PARAMS, `unknown tool '${params?.name}'`] };
    const args = params.arguments ?? {};
    const problems = checkArguments(tool.inputSchema, args);
    // Invalid arguments are reported to the model as a tool error so it can correct the call.
    if (problems.length) return { result: toolError(`Invalid arguments: ${problems.join('; ')}.`) };
    try {
      const value = await tool.handler(args);
      return { result: { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false } };
    } catch (e) {
      if (e instanceof ToolError) return { result: toolError(e.message) };
      log(`tool ${tool.name} failed: ${e?.stack ?? e}`);
      return { result: toolError(`Internal error: ${e?.message ?? e}`) };
    }
  }

  async function handle(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0') return fail(message?.id ?? null, ErrorCode.INVALID_REQUEST, 'invalid JSON-RPC 2.0 message');
    const { id, method, params } = message;
    const isNotification = id === undefined;
    if (typeof method !== 'string') {
      // A response from the client (this server sends no requests) or a malformed message.
      return isNotification || 'result' in message || 'error' in message ? null : fail(id, ErrorCode.INVALID_REQUEST, 'missing method');
    }
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...

    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        negotiated = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
        return ok(id, {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, title, version },
          ...(instructions ? { instructions } : {}),
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: tools.map(({ name: n, title: t, description, inputSchema, annotations }) => ({ name: n, title: t, description, inputSchema, ...(annotations ? { annotations } : {}) })),
        });
      case 'tools/call': {
        if (!isObject(params) || typeof params.name !== 'string') return fail(id, ErrorCode.INVALID_PARAMS, "tools/call needs a tool 'name'");
        const out = await callTool(params);
        return out.error ? fail(id, ...out.error) : ok(id, out.result);
      }
      default:
        return fail(id, ErrorCode.METHOD_NOT_FOUND, `method '${method}' is not supported`);
    }
  }

  return {
    handle,
    get protocolVersion() {
      return negotiated;
    },
  };
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Serves `server` over newline-delimited JSON-RPC: one message per line on `input`, responses on
 * `output`. Requests are answered in arrival order. Resolves when `input` ends.
 */
export function serveStdio(server, input, output, log = () => {}) {
  const write = (msg) => output.write(`${JSON.stringify(msg)}\n`);
  let buffer = '';
  let queue = Promise.resolve();
  const dispatch = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.PARSE_ERROR, message: 'parse error' } });
      return;
    }
    if (Array.isArray(message)) {
      write({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: 'batches are not supported' } });
      return;
    }
    queue = queue
      .then(() => server.handle(message))
      .then((response) => response && write(response))
      .catch((e) => {
        log(`request failed: ${e?.stack ?? e}`);
        if (message?.id !== undefined) write({ jsonrpc: '2.0', id: message.id, error: { code: ErrorCode.INTERNAL_ERROR, message: 'internal error' } });
      });
  };
  input.setEncoding?.('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) dispatch(line);
    }
  });
  return new Promise((resolve) => input.on('end', () => queue.then(resolve)));
}
