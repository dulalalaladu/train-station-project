import { createHmac, randomUUID } from 'node:crypto';

export interface RtasrAuthInput {
  readonly endpoint: string;
  readonly appId: string;
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
  readonly now: Date;
  /** Extra handshake params, e.g. lang, audio_encode, samplerate, eng_vad_mdn. */
  readonly params: Readonly<Record<string, string>>;
  readonly uuid?: string;
}

const BEIJING_OFFSET_MIN = 480;

/**
 * "2025-09-04T15:38:07+0800" style timestamp. ⚠️ exact `utc` format to be confirmed
 * with a real key (ADR 0003); override the offset via `offsetMinutes` if needed.
 */
export function formatRtasrUtc(now: Date, offsetMinutes = BEIJING_OFFSET_MIN): string {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const iso = shifted.toISOString().slice(0, 19);
  const abs = Math.abs(offsetMinutes);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${iso}${sign}${hh}${mm}`;
}

/** Strict RFC 3986 percent-encoding (encodeURIComponent leaves !'()* alone). */
export function urlencode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Params sorted by key, each key/value urlencoded, joined with `&`. */
export function canonicalQuery(params: Readonly<Record<string, string>>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${urlencode(k)}=${urlencode(params[k] as string)}`)
    .join('&');
}

export function rtasrSignature(canonical: string, accessKeySecret: string): string {
  return createHmac('sha1', accessKeySecret).update(canonical).digest('base64');
}

/** Signed handshake URL for the real-time transcription large model (plan §4.4.1). */
export function buildRtasrUrl(input: RtasrAuthInput): string {
  const params: Record<string, string> = {
    ...input.params,
    appId: input.appId,
    accessKeyId: input.accessKeyId,
    utc: formatRtasrUtc(input.now),
    uuid: input.uuid ?? randomUUID(),
  };
  const signature = rtasrSignature(canonicalQuery(params), input.accessKeySecret);
  return `${input.endpoint}?${canonicalQuery({ ...params, signature })}`;
}
