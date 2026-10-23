import { z } from 'zod';

/** Env var names for each credential group. Values are never logged or echoed. */
export const IAT_ENV_NAMES = ['XFYUN_APP_ID', 'XFYUN_API_KEY', 'XFYUN_API_SECRET'] as const;
export const RTASR_ENV_NAMES = [
  'XFYUN_APP_ID',
  'XFYUN_RTASR_ACCESS_KEY_ID',
  'XFYUN_RTASR_ACCESS_KEY_SECRET',
] as const;

export class MissingCredentialsError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Missing required environment variables: ${missing.join(', ')}`);
    this.name = 'MissingCredentialsError';
    this.missing = missing;
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

export interface IatCredentials {
  readonly appId: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export interface RtasrCredentials {
  readonly appId: string;
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
}

const nonEmpty = z.string().trim().min(1);

function requireVars(env: Env, names: readonly string[]): Record<string, string> {
  const missing = names.filter((n) => !nonEmpty.safeParse(env[n]).success);
  if (missing.length > 0) throw new MissingCredentialsError(missing);
  return Object.fromEntries(names.map((n) => [n, (env[n] as string).trim()]));
}

export function loadIatCredentials(env: Env): IatCredentials {
  const v = requireVars(env, IAT_ENV_NAMES);
  return {
    appId: v['XFYUN_APP_ID'] as string,
    apiKey: v['XFYUN_API_KEY'] as string,
    apiSecret: v['XFYUN_API_SECRET'] as string,
  };
}

export function loadRtasrCredentials(env: Env): RtasrCredentials {
  const v = requireVars(env, RTASR_ENV_NAMES);
  return {
    appId: v['XFYUN_APP_ID'] as string,
    accessKeyId: v['XFYUN_RTASR_ACCESS_KEY_ID'] as string,
    accessKeySecret: v['XFYUN_RTASR_ACCESS_KEY_SECRET'] as string,
  };
}
