// JSON text frames carried on the same socket as the audio frames (plan §6.2: `type` is the route key).

export function buildPing(ts: number): string {
  return JSON.stringify({ type: 'ping', ts });
}

/** Stand-in for a `cmd.submit`; the echo server answers it with a `cmd.state` receipt. */
export function buildCmdSubmit(commandId: string, ts: number): string {
  return JSON.stringify({ type: 'cmd.submit', command_id: commandId, ts });
}

export type ServerText =
  | { readonly kind: 'pong'; readonly ts: number }
  | { readonly kind: 'cmd.state'; readonly commandId: string; readonly echoTs: number }
  | { readonly kind: 'error'; readonly code: string }
  | { readonly kind: 'unknown' };

const UNKNOWN: ServerText = { kind: 'unknown' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow a server text frame; anything unexpected becomes `unknown` instead of throwing. */
export function parseServerText(raw: string): ServerText {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNKNOWN;
  }
  if (!isRecord(parsed)) return UNKNOWN;
  if (parsed['type'] === 'pong' && typeof parsed['ts'] === 'number') {
    return { kind: 'pong', ts: parsed['ts'] };
  }
  if (
    parsed['type'] === 'cmd.state' &&
    typeof parsed['command_id'] === 'string' &&
    typeof parsed['echo_ts'] === 'number'
  ) {
    return { kind: 'cmd.state', commandId: parsed['command_id'], echoTs: parsed['echo_ts'] };
  }
  if (parsed['type'] === 'error' && typeof parsed['code'] === 'string') {
    return { kind: 'error', code: parsed['code'] };
  }
  return UNKNOWN;
}
