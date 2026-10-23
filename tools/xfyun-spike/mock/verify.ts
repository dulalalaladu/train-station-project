import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { canonicalQuery, rtasrSignature } from '../src/auth/rtasr-auth.ts';
import { iatSignature, iatSignatureOrigin } from '../src/auth/iat-auth.ts';
import { MOCK_IAT_CREDENTIALS, MOCK_RTASR_CREDENTIALS } from './credentials.ts';

export interface AuthFailure {
  readonly status: number;
  readonly reason: string;
}

const MAX_SKEW_MS = 300_000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function parseAuthorization(b64: string): Record<string, string> {
  const text = Buffer.from(b64, 'base64').toString('utf8');
  const pairs = [...text.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]] as const);
  return Object.fromEntries(pairs);
}

/**
 * Mirrors the documented IAT checks: HMAC-SHA256 over "host date request-line",
 * date within +-300 s. Status codes (401 signature / 403 skew) are ⚠️ unverified.
 */
export function verifyIatHandshake(req: IncomingMessage, now: Date): AuthFailure | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const authorization = url.searchParams.get('authorization');
  const date = url.searchParams.get('date');
  if (!authorization || !date) return { status: 401, reason: 'missing authorization/date' };
  const skew = Math.abs(now.getTime() - new Date(date).getTime());
  if (!(skew <= MAX_SKEW_MS)) return { status: 403, reason: 'date out of range' };
  const parts = parseAuthorization(authorization);
  const host = req.headers.host ?? '';
  const expected = iatSignature(iatSignatureOrigin(host, date, url.pathname), MOCK_IAT_CREDENTIALS.apiSecret);
  const ok = parts['api_key'] === MOCK_IAT_CREDENTIALS.apiKey && safeEqual(parts['signature'] ?? '', expected);
  return ok ? undefined : { status: 401, reason: 'HMAC signature cannot be verified' };
}

export function verifyRtasrHandshake(req: IncomingMessage): AuthFailure | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const params = Object.fromEntries(url.searchParams.entries());
  const { signature, ...rest } = params;
  const required = ['appId', 'accessKeyId', 'utc', 'uuid'];
  if (!signature || required.some((k) => !rest[k])) return { status: 400, reason: 'missing params' };
  const expected = rtasrSignature(canonicalQuery(rest), MOCK_RTASR_CREDENTIALS.accessKeySecret);
  const ok = rest['accessKeyId'] === MOCK_RTASR_CREDENTIALS.accessKeyId && safeEqual(signature, expected);
  return ok ? undefined : { status: 401, reason: 'signature mismatch' };
}

