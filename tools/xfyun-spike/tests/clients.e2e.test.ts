import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_IAT_CREDENTIALS, MOCK_RTASR_CREDENTIALS } from '../mock/credentials.ts';
import { MOCK_ERROR_CODE } from '../mock/iat-handler.ts';
import { startMockXfyun, type MockXfyun } from '../mock/server.ts';
import type { Pacer } from '../src/audio/pcm.ts';
import { multilingualParameters, slmParameters } from '../src/clients/endpoints.ts';
import { runIatSession } from '../src/clients/iat-client.ts';
import { runRtasrSession } from '../src/clients/rtasr-client.ts';
import { HandshakeError, SessionTimeoutError, XfyunApiError } from '../src/errors.ts';
import { buildDhw } from '../src/protocol/iat-frames.ts';

/** Cadence is not what most tests exercise, so skip the 40 ms waits. */
const fastPacer: Pacer = {
  now: () => performance.now(),
  sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/** 440 Hz tone, `frames` x 1280 B of 16 kHz / 16 bit / mono PCM. */
function tone(frames = 40): Buffer {
  const samples = (frames * 1280) / 2;
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 16000)), i * 2);
  }
  return buf;
}

let server: MockXfyun | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const iatBase = {
  credentials: MOCK_IAT_CREDENTIALS,
  parameters: slmParameters(),
  pacer: fastPacer,
};

describe('slm client against the mock', () => {
  it('handshakes, streams 1280 B frames, merges wpgs results and closes', async () => {
    server = await startMockXfyun();
    const result = await runIatSession({
      ...iatBase,
      endpoint: `${server.baseUrl}/v1`,
      parameters: slmParameters({ ltc: 2, dhw: buildDhw(['道岔', '股道']) }),
      resId: 'res-123',
      audio: tone(),
    });
    expect(result.text).toBe('今天天气很好');
    expect(result.sid).toBe('mock-sid');
    expect(result.resultCount).toBe(4);
    expect(result.firstResultMs).toBeGreaterThanOrEqual(0);
    expect(result.finalMs).toBeGreaterThanOrEqual(0);

    const session = server.sessions[0]!;
    expect(session.violations).toEqual([]);
    expect(session.params).toMatchObject({ domain: 'slm', ltc: 2, dwa: 'wpgs', dhw: 'utf-8;道岔|股道' });
    expect(session.headerResId).toBe('res-123');
    const statuses = session.frames.map((f) => f.status);
    expect(statuses[0]).toBe(0);
    expect(statuses.at(-1)).toBe(2);
    expect(statuses.slice(1, -1).every((s) => s === 1)).toBe(true);
    expect(session.frames.filter((f) => f.status !== 2).every((f) => f.bytes === 1280)).toBe(true);
  });

  it('paces frames at ~40 ms with the real pacer', async () => {
    server = await startMockXfyun();
    await runIatSession({
      endpoint: `${server.baseUrl}/v1`,
      credentials: MOCK_IAT_CREDENTIALS,
      parameters: slmParameters(),
      audio: tone(16),
    });
    const at = server.sessions[0]!.frames.map((f) => f.atMs);
    const span = at[15]! - at[0]!;
    expect(span).toBeGreaterThan(15 * 40 * 0.85);
    expect(span).toBeLessThan(15 * 40 * 1.6);
  });

  it('surfaces vendor error codes as XfyunApiError', async () => {
    server = await startMockXfyun({ scenario: 'api-error' });
    const run = runIatSession({ ...iatBase, endpoint: `${server.baseUrl}/v1`, audio: tone(8) });
    await expect(run).rejects.toBeInstanceOf(XfyunApiError);
    await expect(run).rejects.toMatchObject({ code: MOCK_ERROR_CODE });
  });

  it('maps a bad signature to HandshakeError 401', async () => {
    server = await startMockXfyun();
    const run = runIatSession({
      ...iatBase,
      endpoint: `${server.baseUrl}/v1`,
      credentials: { ...MOCK_IAT_CREDENTIALS, apiSecret: 'wrong-secret' },
      audio: tone(4),
    });
    await expect(run).rejects.toBeInstanceOf(HandshakeError);
    await expect(run).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('maps clock skew beyond 300 s to HandshakeError 403', async () => {
    server = await startMockXfyun();
    const run = runIatSession({
      ...iatBase,
      endpoint: `${server.baseUrl}/v1`,
      audio: tone(4),
      now: () => new Date(Date.now() - 301_000),
    });
    await expect(run).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('times out when the final result does not arrive in time', async () => {
    server = await startMockXfyun();
    const slowPacer: Pacer = {
      now: () => performance.now(),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 50)),
    };
    const run = runIatSession({
      ...iatBase,
      endpoint: `${server.baseUrl}/v1`,
      audio: tone(40),
      pacer: slowPacer,
      timeoutMs: 300,
    });
    await expect(run).rejects.toBeInstanceOf(SessionTimeoutError);
  });
});

describe('multilingual client against the mock', () => {
  it('uses the multilingual parameters and returns the English script', async () => {
    server = await startMockXfyun();
    const result = await runIatSession({
      ...iatBase,
      endpoint: `${server.baseUrl}/v1`,
      parameters: multilingualParameters({ language: 'en_us' }),
      audio: tone(),
    });
    expect(result.text).toBe('return to base');
    expect(server.sessions[0]!.params).toMatchObject({ language: 'en_us' });
  });
});

describe('rtasr client against the mock', () => {
  const rtasrBase = { credentials: MOCK_RTASR_CREDENTIALS, pacer: fastPacer };

  it('handshakes with signed params, streams PCM, ends with {"end":true}', async () => {
    server = await startMockXfyun();
    const result = await runRtasrSession({
      ...rtasrBase,
      endpoint: `${server.baseUrl}/ast/communicate/v1`,
      audio: tone(),
      vadMode: 1,
    });
    expect(result.text).toBe('停下回巢');
    expect(result.sessionId).toBe('mock-session');
    expect(result.segmentCount).toBe(2);
    expect(result.firstResultMs).toBeGreaterThanOrEqual(0);
    const session = server.sessions[0]!;
    expect(session.ended).toBe(true);
    expect(session.violations).toEqual([]);
    expect(session.frames.every((f) => f.bytes === 1280)).toBe(true);
  });

  it('rejects a wrong accessKeySecret with HandshakeError 401', async () => {
    server = await startMockXfyun();
    const run = runRtasrSession({
      ...rtasrBase,
      endpoint: `${server.baseUrl}/ast/communicate/v1`,
      credentials: { ...MOCK_RTASR_CREDENTIALS, accessKeySecret: 'nope' },
      audio: tone(4),
    });
    await expect(run).rejects.toMatchObject({ name: 'HandshakeError', httpStatus: 401 });
  });

  it('surfaces an in-band error action', async () => {
    server = await startMockXfyun({ scenario: 'api-error' });
    const run = runRtasrSession({
      ...rtasrBase,
      endpoint: `${server.baseUrl}/ast/communicate/v1`,
      audio: tone(4),
    });
    await expect(run).rejects.toMatchObject({ name: 'XfyunApiError', code: String(MOCK_ERROR_CODE) });
  });
});
