import { describe, expect, it } from 'vitest';
import { buildDhw, buildFirstFrame, buildLastFrame, buildMiddleFrame, decodeResultText, parseIatResponse } from '../src/protocol/iat-frames.ts';
import { slmParameters, multilingualParameters } from '../src/clients/endpoints.ts';
import { mergeRtasr, parseRtasrMessage, rtasrText } from '../src/protocol/rtasr-frames.ts';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

describe('IAT request frames', () => {
  const frame = Buffer.alloc(1280, 7);

  it('first frame carries app_id, res_id, parameter.iat and status 0', () => {
    const f = JSON.parse(buildFirstFrame({ appId: 'app', resId: 'res', parameters: slmParameters({ ltc: 1, dhw: buildDhw(['道岔', '股道']) }) }, frame));
    expect(f.header).toEqual({ app_id: 'app', status: 0, res_id: 'res' });
    expect(f.parameter.iat).toMatchObject({ domain: 'slm', language: 'zh_cn', accent: 'mandarin', dwa: 'wpgs', ltc: 1, dhw: 'utf-8;道岔|股道' });
    expect(f.parameter.iat.result).toEqual({ encoding: 'utf8', compress: 'raw', format: 'json' });
    expect(f.payload.audio).toMatchObject({ encoding: 'raw', sample_rate: 16000, channels: 1, bit_depth: 16, seq: 1, status: 0 });
    expect(Buffer.from(f.payload.audio.audio, 'base64')).toHaveLength(1280);
  });

  it('omits res_id when not given and never uses legacy params', () => {
    const f = JSON.parse(buildFirstFrame({ appId: 'app', parameters: slmParameters() }, frame));
    expect(f.header.res_id).toBeUndefined();
    for (const legacy of ['ptt', 'nunum', 'nbest', 'wbest']) expect(f.parameter.iat[legacy]).toBeUndefined();
    expect(f.parameter.iat.accent).not.toBe('mulacc');
  });

  it('middle and last frames use status 1 / 2 and only header + payload', () => {
    const mid = JSON.parse(buildMiddleFrame('app', 5, frame));
    expect(mid.header.status).toBe(1);
    expect(mid.parameter).toBeUndefined();
    expect(mid.payload.audio.seq).toBe(5);
    const last = JSON.parse(buildLastFrame('app', 9));
    expect(last.header.status).toBe(2);
    expect(last.payload.audio).toMatchObject({ status: 2, audio: '' });
  });

  it('rejects hot words over 1024 bytes', () => {
    expect(() => buildDhw(['道岔'.repeat(300)])).toThrow(/1024/);
  });

  it('multilingual parameters take a configurable language', () => {
    expect(multilingualParameters({ language: 'xx_yy' }).language).toBe('xx_yy');
    expect(multilingualParameters().language).toBe('en_us');
  });
});

describe('IAT responses', () => {
  it('decodes word candidates and pgs/rg', () => {
    const seg = decodeResultText(b64({ sn: 3, ls: false, pgs: 'rpl', rg: [1, 2], ws: [{ bg: 0, cw: [{ w: '今天', sc: 0 }] }, { bg: 9, cw: [{ w: '天气' }] }] }));
    expect(seg).toEqual({ sn: 3, text: '今天天气', pgs: 'rpl', rg: [1, 2], ls: false });
  });

  it('parses header and nested result', () => {
    const raw = JSON.stringify({ header: { code: 0, message: 'success', sid: 'sid1', status: 2 }, payload: { result: { text: b64({ sn: 1, ws: [{ cw: [{ w: 'hi' }] }] }) } } });
    const r = parseIatResponse(raw);
    expect(r).toMatchObject({ code: 0, sid: 'sid1', status: 2, segment: { sn: 1, text: 'hi' } });
  });

  it('parses an error response without payload', () => {
    expect(parseIatResponse(JSON.stringify({ header: { code: 10163, message: 'bad param' } }))).toMatchObject({ code: 10163, segment: undefined });
  });

  it('rejects malformed responses', () => {
    expect(() => parseIatResponse('{"nope":1}')).toThrow();
  });
});

describe('RTASR messages', () => {
  const result = (type: string, w: string, seg = 0) => JSON.stringify({ msg_type: 'result', res_type: 'asr', data: { seg_id: seg, cn: { st: { type, rt: [{ ws: [{ cw: [{ w }] }] }] } } } });

  it('parses started, interim, final and error', () => {
    expect(parseRtasrMessage(JSON.stringify({ msg_type: 'action', data: { action: 'started', sessionId: 's1' } }))).toEqual({ kind: 'started', sessionId: 's1' });
    expect(parseRtasrMessage(result('1', '停'))).toEqual({ kind: 'result', segId: 0, final: false, text: '停' });
    expect(parseRtasrMessage(result('0', '停下', 2))).toEqual({ kind: 'result', segId: 2, final: true, text: '停下' });
    expect(parseRtasrMessage(JSON.stringify({ msg_type: 'action', data: { action: 'error', code: '35001', desc: 'x' } }))).toEqual({ kind: 'error', code: '35001', message: 'x' });
    expect(parseRtasrMessage(JSON.stringify({ code: '35005', desc: 'quota' }))).toEqual({ kind: 'error', code: '35005', message: 'quota' });
  });

  it('returns unknown for unrecognised payloads', () => {
    expect(parseRtasrMessage('{"msg_type":"other","data":{"x":1}}')).toEqual({ kind: 'unknown' });
  });

  it('merges by seg_id so later text replaces earlier', () => {
    let state: ReadonlyMap<number, string> = new Map();
    state = mergeRtasr(state, { kind: 'result', segId: 0, final: false, text: '停' });
    state = mergeRtasr(state, { kind: 'result', segId: 0, final: true, text: '停下' });
    state = mergeRtasr(state, { kind: 'result', segId: 1, final: true, text: '回巢' });
    expect(rtasrText(state)).toBe('停下回巢');
  });
});
