import { readFile, writeFile } from 'node:fs/promises';
import { MOCK_IAT_CREDENTIALS, MOCK_RTASR_CREDENTIALS } from '../mock/credentials.ts';
import { assertLoopback, parseCliArgs, USAGE, type CliOptions } from './cli-args.ts';
import { ENDPOINTS, multilingualParameters, slmParameters } from './clients/endpoints.ts';
import { runIatSession } from './clients/iat-client.ts';
import { runRtasrSession } from './clients/rtasr-client.ts';
import { loadIatCredentials, loadRtasrCredentials, type Env } from './config.ts';
import { summarize, type LatencySummary } from './metrics.ts';
import { buildDhw } from './protocol/iat-frames.ts';

export interface RunSample {
  readonly text: string;
  readonly firstResultMs: number | undefined;
  readonly finalMs: number;
}

export interface Report {
  readonly interface: string;
  readonly mock: boolean;
  readonly runs: number;
  readonly succeeded: number;
  readonly errors: readonly string[];
  readonly texts: readonly string[];
  readonly firstResultMs: LatencySummary | undefined;
  readonly finalMs: LatencySummary | undefined;
}

type Runner = (audio: Buffer) => Promise<RunSample>;

const MOCK_PATHS = { iat: '/v1', rtasr: '/ast/communicate/v1' } as const;

function endpointFor(opts: CliOptions): string {
  if (opts.mock) {
    assertLoopback(opts.mock);
    return opts.mock.replace(/\/$/, '') + (opts.interface === 'rtasr' ? MOCK_PATHS.rtasr : MOCK_PATHS.iat);
  }
  return ENDPOINTS[opts.interface];
}

/** Builds the per-interface runner. Real credentials are read from env, never defaulted. */
export function makeRunner(opts: CliOptions, env: Env): Runner {
  const endpoint = endpointFor(opts);
  const dhw = opts.hotwords ? buildDhw(opts.hotwords.split(',').map((w) => w.trim())) : undefined;
  if (opts.interface === 'rtasr') {
    const credentials = opts.mock ? MOCK_RTASR_CREDENTIALS : loadRtasrCredentials(env);
    return (audio) =>
      runRtasrSession({ endpoint, credentials, audio, ...(opts.vad ? { vadMode: opts.vad as 1 | 2 } : {}) });
  }
  const credentials = opts.mock ? MOCK_IAT_CREDENTIALS : loadIatCredentials(env);
  const parameters =
    opts.interface === 'slm'
      ? slmParameters({ ...(opts.eos ? { eos: opts.eos } : {}), ...(opts.ltc ? { ltc: opts.ltc as 1 | 2 | 3 } : {}), ...(dhw ? { dhw } : {}) })
      : multilingualParameters({ ...(opts.eos ? { eos: opts.eos } : {}), ...(opts.language ? { language: opts.language } : {}), ...(dhw ? { dhw } : {}) });
  return (audio) =>
    runIatSession({ endpoint, credentials, parameters, audio, ...(opts.resId ? { resId: opts.resId } : {}) });
}

export async function collectSamples(
  runner: Runner,
  audio: Buffer,
  runs: number,
): Promise<{ samples: RunSample[]; errors: string[] }> {
  const samples: RunSample[] = [];
  const errors: string[] = [];
  for (let i = 0; i < runs; i += 1) {
    try {
      samples.push(await runner(audio));
    } catch (err) {
      errors.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
  }
  return { samples, errors };
}

export function buildReport(
  opts: CliOptions,
  samples: readonly RunSample[],
  errors: readonly string[],
): Report {
  const first = samples.flatMap((s) => (s.firstResultMs === undefined ? [] : [s.firstResultMs]));
  const final = samples.map((s) => s.finalMs);
  return {
    interface: opts.interface,
    mock: Boolean(opts.mock),
    runs: opts.runs,
    succeeded: samples.length,
    errors,
    texts: [...new Set(samples.map((s) => s.text))],
    firstResultMs: first.length > 0 ? summarize(first) : undefined,
    finalMs: final.length > 0 ? summarize(final) : undefined,
  };
}

/** Entry point used by main.ts and tests. Returns the process exit code. */
export async function runCli(argv: readonly string[], env: Env, log: (line: string) => void): Promise<number> {
  try {
    if (argv.length === 0 || argv.includes('--help')) return (log(USAGE), argv.length === 0 ? 2 : 0);
    const opts = parseCliArgs(argv);
    const runner = makeRunner(opts, env);
    const audio = await readFile(opts.audio);
    const { samples, errors } = await collectSamples(runner, audio, opts.runs);
    const report = buildReport(opts, samples, errors);
    const json = JSON.stringify(report, null, 2);
    if (opts.out) await writeFile(opts.out, json, 'utf8');
    log(json);
    return errors.length === 0 ? 0 : 1;
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
