import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, parseSpikeConfig } from '../src/spike/config';
import { buildCmdSubmit, buildPing, parseServerText } from '../src/spike/messages';

describe('parseSpikeConfig', () => {
  it('fills defaults for an empty input', () => {
    expect(parseSpikeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('keeps valid overrides', () => {
    const cfg = parseSpikeConfig({ url: 'wss://example.test/ws', frameSizeKb: 4, jitterMs: 200 });
    expect(cfg.url).toBe('wss://example.test/ws');
    expect(cfg.frameSizeKb).toBe(4);
    expect(cfg.jitterMs).toBe(200);
  });

  it('rejects non-websocket URLs', () => {
    expect(() => parseSpikeConfig({ url: 'http://x' })).toThrow(/url/);
    expect(() => parseSpikeConfig({ url: '' })).toThrow(/url/);
  });

  it('rejects unsupported frame sizes and jitter outside 0..500 ms', () => {
    expect(() => parseSpikeConfig({ frameSizeKb: 3 })).toThrow(/frameSizeKb/);
    expect(() => parseSpikeConfig({ jitterMs: 501 })).toThrow(/jitterMs/);
    expect(() => parseSpikeConfig({ jitterMs: -1 })).toThrow(/jitterMs/);
  });

  it('rejects a non-object input', () => {
    expect(() => parseSpikeConfig(null)).toThrow();
  });

  it('merges nested gate overrides over defaults', () => {
    const cfg = parseSpikeConfig({ gate: { threshold: 0.05 } });
    expect(cfg.gate.threshold).toBe(0.05);
    expect(cfg.gate.hangoverFrames).toBe(DEFAULT_CONFIG.gate.hangoverFrames);
  });
});

describe('messages', () => {
  it('builds ping and cmd.submit JSON', () => {
    expect(JSON.parse(buildPing(5))).toEqual({ type: 'ping', ts: 5 });
    expect(JSON.parse(buildCmdSubmit('c-1', 6))).toEqual({
      type: 'cmd.submit',
      command_id: 'c-1',
      ts: 6,
    });
  });

  it('parses pong and cmd.state replies', () => {
    expect(parseServerText('{"type":"pong","ts":5,"server_ts":9}')).toEqual({
      kind: 'pong',
      ts: 5,
    });
    expect(
      parseServerText(
        '{"type":"cmd.state","command_id":"c-1","state":"received","ts":9,"echo_ts":6}',
      ),
    ).toEqual({ kind: 'cmd.state', commandId: 'c-1', echoTs: 6 });
  });

  it('classifies server errors', () => {
    expect(parseServerText('{"type":"error","code":"BAD_MESSAGE","message":"x"}')).toEqual({
      kind: 'error',
      code: 'BAD_MESSAGE',
    });
  });

  it('returns unknown for invalid JSON or unexpected shapes', () => {
    expect(parseServerText('nope')).toEqual({ kind: 'unknown' });
    expect(parseServerText('{"type":"pong"}')).toEqual({ kind: 'unknown' });
    expect(parseServerText('42')).toEqual({ kind: 'unknown' });
  });
});
