// Usage: pnpm --filter @railvoice/ws-echo start -- [--port 8787] [--host 0.0.0.0]
//          [--delay-ms 0] [--jitter-ms 0] [--drop-pct 0]
// Environment fallbacks: ECHO_PORT, ECHO_HOST, ECHO_DELAY_MS, ECHO_JITTER_MS, ECHO_DROP_PCT.
import { parseArgs } from 'node:util';

import { startEchoServer } from './server.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    host: { type: 'string' },
    'delay-ms': { type: 'string' },
    'jitter-ms': { type: 'string' },
    'drop-pct': { type: 'string' },
  },
});

function numberOption(flag: string | undefined, envName: string, fallback: number): number {
  const raw = flag ?? process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(`Invalid number for ${envName}: ${raw}`);
    process.exit(2);
  }
  return value;
}

const server = await startEchoServer({
  port: numberOption(values.port, 'ECHO_PORT', 8787),
  host: values.host ?? process.env['ECHO_HOST'] ?? '0.0.0.0',
  impairment: {
    delayMs: numberOption(values['delay-ms'], 'ECHO_DELAY_MS', 0),
    jitterMs: numberOption(values['jitter-ms'], 'ECHO_JITTER_MS', 0),
    dropPct: numberOption(values['drop-pct'], 'ECHO_DROP_PCT', 0),
  },
  log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
});

process.on('SIGINT', () => {
  void server.close().then(() => process.exit(0));
});
