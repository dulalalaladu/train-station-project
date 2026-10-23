import { parseArgs } from 'node:util';
import { z } from 'zod';

export const INTERFACES = ['slm', 'multilingual', 'rtasr'] as const;
export type InterfaceName = (typeof INTERFACES)[number];

const optionsSchema = z.object({
  interface: z.enum(INTERFACES),
  audio: z.string().min(1),
  runs: z.coerce.number().int().min(1).max(200).default(1),
  mock: z.string().optional(),
  ltc: z.coerce.number().int().min(1).max(3).optional(),
  hotwords: z.string().optional(),
  resId: z.string().optional(),
  language: z.string().optional(),
  eos: z.coerce.number().int().positive().optional(),
  vad: z.coerce.number().int().min(1).max(2).optional(),
  out: z.string().optional(),
});

export type CliOptions = z.infer<typeof optionsSchema>;

export const USAGE = `Usage: node src/main.ts <slm|multilingual|rtasr> --audio <file.pcm|file.wav> [options]
  --runs N          repeat the session N times (latency P50/P95), default 1
  --mock <ws-url>   use the local mock server (loopback only, fake credentials)
  --ltc 1|2|3       slm only: 1 no filter / 2 Chinese only / 3 English only
  --hotwords a,b    slm/multilingual: session hot words (dhw)
  --res-id ID       slm: console-level hot word resource id
  --language CODE   multilingual only (⚠️ code per official doc)
  --eos MS          silence timeout
  --vad 1|2         rtasr only: eng_vad_mdn 1 far field / 2 near field
  --out FILE        write the JSON report to FILE
Credentials come from XFYUN_APP_ID, XFYUN_API_KEY, XFYUN_API_SECRET,
XFYUN_RTASR_ACCESS_KEY_ID, XFYUN_RTASR_ACCESS_KEY_SECRET.`;

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      audio: { type: 'string' },
      runs: { type: 'string' },
      mock: { type: 'string' },
      ltc: { type: 'string' },
      hotwords: { type: 'string' },
      'res-id': { type: 'string' },
      language: { type: 'string' },
      eos: { type: 'string' },
      vad: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const { 'res-id': resId, ...rest } = values;
  return optionsSchema.parse({ ...rest, ...(resId ? { resId } : {}), interface: positionals[0] });
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The mock accepts fake credentials, so it must never point at a remote host. */
export function assertLoopback(mockUrl: string): void {
  const host = new URL(mockUrl).hostname;
  if (!LOOPBACK_HOSTS.has(host) && !LOOPBACK_HOSTS.has(`[${host}]`)) {
    throw new Error(`--mock must be a loopback URL, got host "${host}"`);
  }
}
