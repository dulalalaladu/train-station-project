// Build the mini-program: transpile src/**/*.ts to CommonJS in dist/ and copy the static assets
// (json / wxml / wxss). The WeChat developer tool opens this package with miniprogramRoot=dist/.
// Type checking is a separate step (`pnpm typecheck`); this only strips types.
//   MP_WS_URL=wss://example.test/ws pnpm build   -> bakes the default gateway URL into dist/env.js
import { mkdir, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const STATIC_EXTENSIONS = new Set(['.json', '.wxml', '.wxss']);
const WS_URL_PATTERN = /^wss?:\/\/\S+$/;

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    }),
  );
  return nested.flat();
}

export function renderEnvModule(wsUrl) {
  if (!WS_URL_PATTERN.test(wsUrl)) {
    throw new Error('MP_WS_URL must be a ws:// or wss:// address');
  }
  return `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.ENV = ${JSON.stringify({ wsUrl })};\n`;
}

function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
      verbatimModuleSyntax: false,
    },
  });
  return result.outputText;
}

export async function buildMiniprogram({ srcDir, outDir, env = {} }) {
  await rm(outDir, { recursive: true, force: true });
  const written = [];
  for (const file of await listFiles(srcDir)) {
    const rel = relative(srcDir, file);
    const ext = extname(file);
    const isCode = ext === '.ts' && !file.endsWith('.d.ts');
    if (!isCode && !STATIC_EXTENSIONS.has(ext)) continue;
    const target = join(outDir, isCode ? rel.replace(/\.ts$/, '.js') : rel);
    await mkdir(dirname(target), { recursive: true });
    if (isCode) await writeFile(target, transpile(await readFile(file, 'utf8'), file));
    else await copyFile(file, target);
    written.push(relative(outDir, target).split(sep).join('/'));
  }
  if (env.MP_WS_URL) {
    await writeFile(join(outDir, 'env.js'), renderEnvModule(env.MP_WS_URL));
  }
  return written.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = await buildMiniprogram({
    srcDir: join(root, 'src'),
    outDir: join(root, 'dist'),
    env: process.env,
  });
  console.log(`built ${files.length} files into dist/`);
}
