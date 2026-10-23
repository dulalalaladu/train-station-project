import type { IatParameters } from '../protocol/iat-frames.ts';

export const ENDPOINTS = {
  slm: 'wss://iat.xf-yun.com/v1',
  multilingual: 'wss://iat.cn-huabei-1.xf-yun.com/v1',
  rtasr: 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1',
} as const;

export interface SlmOptions {
  readonly eos?: number;
  readonly ltc?: 1 | 2 | 3;
  readonly dhw?: string;
}

/**
 * Dictation large model (中英): domain/language/accent are fixed by the vendor.
 * Legacy params from the requirements doc (accent=mulacc, ptt, nunum, nbest/wbest)
 * are deliberately not supported (plan §1.4).
 */
export function slmParameters(opts: SlmOptions = {}): IatParameters {
  return {
    domain: 'slm',
    language: 'zh_cn',
    accent: 'mandarin',
    dwa: 'wpgs',
    eos: opts.eos ?? 6000,
    ...(opts.ltc ? { ltc: opts.ltc } : {}),
    ...(opts.dhw ? { dhw: opts.dhw } : {}),
  };
}

export interface MultilingualOptions {
  /** ⚠️ Language code per the official multilingual doc; `en_us` is a placeholder until verified. */
  readonly language?: string;
  readonly eos?: number;
  readonly dhw?: string;
}

export const MULTILINGUAL_DEFAULT_LANGUAGE = 'en_us';

/** ⚠️ Multilingual model parameters follow the IAT envelope; language code is unverified. */
export function multilingualParameters(opts: MultilingualOptions = {}): IatParameters {
  return {
    domain: 'slm',
    language: opts.language ?? MULTILINGUAL_DEFAULT_LANGUAGE,
    accent: 'mandarin',
    eos: opts.eos ?? 6000,
    ...(opts.dhw ? { dhw: opts.dhw } : {}),
  };
}
