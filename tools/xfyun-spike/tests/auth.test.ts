import { describe, expect, it } from 'vitest';
import { buildIatAuthUrl, iatAuthorization, rfc1123 } from '../src/auth/iat-auth.ts';
import { buildRtasrUrl, canonicalQuery, formatRtasrUtc, urlencode } from '../src/auth/rtasr-auth.ts';

// Expected values were computed independently with .NET HMACSHA256/HMACSHA1 (not this code).
const FIXED = new Date('2024-05-14T08:46:48Z');

describe('IAT signing (HMAC-SHA256, host date request-line)', () => {
  it('formats RFC1123 GMT dates', () => {
    expect(rfc1123(FIXED)).toBe('Tue, 14 May 2024 08:46:48 GMT');
  });

  it('produces the known authorization for fixed time and fake keys', () => {
    const expectedSig = 'gwwp4p2s5E2iPt4xs8ZHsf8KhKD7EhS45bWSwJOs/II=';
    const expectedAuth =
      'YXBpX2tleT0iZmFrZS1hcGkta2V5IiwgYWxnb3JpdGhtPSJobWFjLXNoYTI1NiIsIGhlYWRlcnM9Imhvc3QgZGF0ZSByZXF1ZXN0LWxpbmUiLCBzaWduYXR1cmU9Imd3d3A0cDJzNUUyaVB0NHhzOFpIc2Y4S2hLRDdFaFM0NWJXU3dKT3MvSUk9Ig==';
    expect(iatAuthorization('fake-api-key', expectedSig)).toBe(expectedAuth);

    const url = new URL(
      buildIatAuthUrl({
        endpoint: 'wss://iat.xf-yun.com/v1',
        apiKey: 'fake-api-key',
        apiSecret: 'fake-api-secret',
        now: FIXED,
      }),
    );
    expect(url.origin).toBe('wss://iat.xf-yun.com');
    expect(url.pathname).toBe('/v1');
    expect(url.searchParams.get('authorization')).toBe(expectedAuth);
    expect(url.searchParams.get('date')).toBe('Tue, 14 May 2024 08:46:48 GMT');
    expect(url.searchParams.get('host')).toBe('iat.xf-yun.com');
  });

  it('signs the multilingual host separately', () => {
    const a = buildIatAuthUrl({ endpoint: 'wss://iat.cn-huabei-1.xf-yun.com/v1', apiKey: 'k', apiSecret: 's', now: FIXED });
    const b = buildIatAuthUrl({ endpoint: 'wss://iat.xf-yun.com/v1', apiKey: 'k', apiSecret: 's', now: FIXED });
    expect(new URL(a).searchParams.get('host')).toBe('iat.cn-huabei-1.xf-yun.com');
    expect(new URL(a).searchParams.get('authorization')).not.toBe(new URL(b).searchParams.get('authorization'));
  });
});

describe('RTASR signing (sorted urlencoded params, HMAC-SHA1, Base64)', () => {
  const params = { lang: 'autodialect', audio_encode: 'pcm_s16le', samplerate: '16000', eng_vad_mdn: '1' };

  it('formats utc with +0800 offset', () => {
    expect(formatRtasrUtc(FIXED)).toBe('2024-05-14T16:46:48+0800');
    expect(formatRtasrUtc(FIXED, 0)).toBe('2024-05-14T08:46:48+0000');
    expect(formatRtasrUtc(FIXED, -330)).toBe('2024-05-14T03:16:48-0530');
  });

  it('percent-encodes strictly and sorts by key', () => {
    expect(urlencode("a b+c!'()*")).toBe('a%20b%2Bc%21%27%28%29%2A');
    expect(canonicalQuery({ b: '2', a: '1 1' })).toBe('a=1%201&b=2');
  });

  it('produces the known signature for fixed inputs and fake keys', () => {
    const url = new URL(
      buildRtasrUrl({
        endpoint: 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1',
        appId: 'fake-app-id',
        accessKeyId: 'fake-access-key-id',
        accessKeySecret: 'fake-access-key-secret',
        now: FIXED,
        params,
        uuid: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(url.pathname).toBe('/ast/communicate/v1');
    expect(url.searchParams.get('signature')).toBe('pansevTgq/LqE9kCceFX5/iwL+Y=');
    expect(url.searchParams.get('appId')).toBe('fake-app-id');
    expect(url.searchParams.get('accessKeyId')).toBe('fake-access-key-id');
    expect(url.searchParams.get('utc')).toBe('2024-05-14T16:46:48+0800');
    expect(url.searchParams.get('lang')).toBe('autodialect');
  });

  it('never leaks the secret into the URL', () => {
    const url = buildRtasrUrl({
      endpoint: 'wss://h/p', appId: 'a', accessKeyId: 'i', accessKeySecret: 'TOP-SECRET', now: FIXED, params,
    });
    expect(url).not.toContain('TOP-SECRET');
  });
});
