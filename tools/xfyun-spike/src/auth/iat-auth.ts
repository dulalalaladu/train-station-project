import { createHmac } from 'node:crypto';

export interface IatAuthInput {
  /** e.g. wss://iat.xf-yun.com/v1 (ws:// allowed for the local mock only). */
  readonly endpoint: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly now: Date;
}

/** RFC 1123 GMT date, e.g. "Tue, 14 May 2024 08:46:48 GMT". */
export function rfc1123(now: Date): string {
  return now.toUTCString();
}

export function iatSignatureOrigin(host: string, date: string, path: string): string {
  return `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
}

export function iatSignature(origin: string, apiSecret: string): string {
  return createHmac('sha256', apiSecret).update(origin).digest('base64');
}

export function iatAuthorization(apiKey: string, signature: string): string {
  const origin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  return Buffer.from(origin, 'utf8').toString('base64');
}

/**
 * Builds the signed handshake URL: HMAC-SHA256 over "host date request-line",
 * Base64 `authorization` + `date` + `host` in the query string (plan §4.4.1).
 */
export function buildIatAuthUrl(input: IatAuthInput): string {
  const url = new URL(input.endpoint);
  const date = rfc1123(input.now);
  const origin = iatSignatureOrigin(url.host, date, url.pathname);
  const authorization = iatAuthorization(input.apiKey, iatSignature(origin, input.apiSecret));
  const query = new URLSearchParams({ authorization, date, host: url.host });
  return `${url.protocol}//${url.host}${url.pathname}?${query.toString()}`;
}
