import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildMiniprogram, renderEnvModule } from '../scripts/build.mjs';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mp-build-'));
  await mkdir(join(root, 'src', 'pages', 'p'), { recursive: true });
  await writeFile(join(root, 'src', 'app.json'), '{"pages":[]}');
  await writeFile(join(root, 'src', 'types.d.ts'), 'declare const x: number;');
  await writeFile(join(root, 'src', 'env.ts'), "export const ENV = { wsUrl: 'ws://default' };");
  await writeFile(
    join(root, 'src', 'pages', 'p', 'p.ts'),
    "import { ENV } from '../../env';\nimport type { Foo } from './foo';\nexport const url: string = ENV.wsUrl;\nexport type Bar = Foo;\n",
  );
  await writeFile(join(root, 'src', 'pages', 'p', 'p.wxml'), '<view/>');
  await writeFile(join(root, 'src', 'notes.md'), 'ignored');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildMiniprogram', () => {
  it('transpiles ts to commonjs js and copies static assets only', async () => {
    const files = await buildMiniprogram({ srcDir: join(root, 'src'), outDir: join(root, 'dist') });
    expect(files).toEqual(['app.json', 'env.js', 'pages/p/p.js', 'pages/p/p.wxml'].sort());
    const js = await readFile(join(root, 'dist', 'pages', 'p', 'p.js'), 'utf8');
    expect(js).toContain('require("../../env")');
    expect(js).not.toContain('Foo');
    expect(js).not.toContain(': string');
  });

  it('bakes MP_WS_URL into env.js when provided', async () => {
    await buildMiniprogram({
      srcDir: join(root, 'src'),
      outDir: join(root, 'dist'),
      env: { MP_WS_URL: 'wss://gw.example.test/ws' },
    });
    const env = await readFile(join(root, 'dist', 'env.js'), 'utf8');
    expect(env).toContain('wss://gw.example.test/ws');
  });

  it('rejects a non-websocket MP_WS_URL', async () => {
    await expect(
      buildMiniprogram({
        srcDir: join(root, 'src'),
        outDir: join(root, 'dist'),
        env: { MP_WS_URL: 'http://nope' },
      }),
    ).rejects.toThrow(/MP_WS_URL/);
  });

  it('wipes stale output from a previous build', async () => {
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'stale.js'), '');
    const files = await buildMiniprogram({ srcDir: join(root, 'src'), outDir: join(root, 'dist') });
    expect(files).not.toContain('stale.js');
  });
});

describe('renderEnvModule', () => {
  it('escapes the URL safely as JSON', () => {
    expect(renderEnvModule('ws://a.test/x')).toContain('"wsUrl":"ws://a.test/x"');
  });
});
