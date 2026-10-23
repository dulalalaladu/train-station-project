import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMockXfyun, type MockXfyun } from '../mock/server.ts';
import { assertLoopback, parseCliArgs } from '../src/cli-args.ts';
import { runCli } from '../src/cli.ts';

let dir: string;
let server: MockXfyun | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xfyun-spike-'));
  await writeFile(join(dir, 'a.pcm'), Buffer.alloc(1280 * 6));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('cli args', () => {
  it('parses interface and options', () => {
    const o = parseCliArgs(['slm', '--audio', 'a.pcm', '--runs', '20', '--ltc', '3', '--res-id', 'r1', '--hotwords', 'a,b']);
    expect(o).toMatchObject({ interface: 'slm', audio: 'a.pcm', runs: 20, ltc: 3, resId: 'r1', hotwords: 'a,b' });
  });

  it('rejects unknown interfaces and out-of-range values', () => {
    expect(() => parseCliArgs(['bogus', '--audio', 'a'])).toThrow();
    expect(() => parseCliArgs(['slm', '--audio', 'a', '--ltc', '9'])).toThrow();
    expect(() => parseCliArgs(['slm'])).toThrow();
  });

  it('only accepts loopback mock URLs', () => {
    expect(() => assertLoopback('ws://127.0.0.1:8765')).not.toThrow();
    expect(() => assertLoopback('ws://localhost:1')).not.toThrow();
    expect(() => assertLoopback('wss://iat.xf-yun.com')).toThrow(/loopback/);
  });
});

describe('runCli', () => {
  const audio = () => join(dir, 'a.pcm');

  it('prints usage with no args', async () => {
    const lines: string[] = [];
    expect(await runCli([], {}, (l) => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toContain('Usage');
  });

  it('fails clearly when credentials are missing and sends nothing', async () => {
    const lines: string[] = [];
    const code = await runCli(['slm', '--audio', audio()], {}, (l) => lines.push(l));
    expect(code).toBe(2);
    expect(lines.join('\n')).toMatch(/XFYUN_APP_ID, XFYUN_API_KEY, XFYUN_API_SECRET/);
  });

  it('runs N sessions against the mock and reports P50/P95', async () => {
    server = await startMockXfyun();
    const out = join(dir, 'report.json');
    const code = await runCli(
      ['slm', '--audio', audio(), '--mock', server.baseUrl, '--runs', '3', '--out', out],
      {},
      () => undefined,
    );
    expect(code).toBe(0);
    const report = JSON.parse(await readFile(out, 'utf8'));
    expect(report).toMatchObject({ interface: 'slm', mock: true, runs: 3, succeeded: 3, errors: [], texts: ['今天天气很好'] });
    expect(report.finalMs).toMatchObject({ n: 3 });
    expect(report.finalMs.p95).toBeGreaterThanOrEqual(report.finalMs.p50);
  });

  it.each(['multilingual', 'rtasr'])('runs %s against the mock', async (kind) => {
    server = await startMockXfyun();
    const lines: string[] = [];
    const extra = kind === 'multilingual' ? ['--language', 'en_us'] : ['--vad', '2'];
    const code = await runCli([kind, '--audio', audio(), '--mock', server.baseUrl, ...extra], {}, (l) => lines.push(l));
    expect(code).toBe(0);
    expect(JSON.parse(lines.join('\n')).succeeded).toBe(1);
  });

  it('exits 1 and records errors when sessions fail', async () => {
    server = await startMockXfyun({ scenario: 'api-error' });
    const lines: string[] = [];
    const code = await runCli(['slm', '--audio', audio(), '--mock', server.baseUrl, '--runs', '2'], {}, (l) => lines.push(l));
    expect(code).toBe(1);
    const report = JSON.parse(lines.join('\n'));
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]).toContain('10163');
  });

  it('refuses a non-loopback mock URL', async () => {
    const code = await runCli(['slm', '--audio', audio(), '--mock', 'wss://iat.xf-yun.com'], {}, () => undefined);
    expect(code).toBe(2);
  });
});
