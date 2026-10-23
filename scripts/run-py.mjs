#!/usr/bin/env node
// Cross-platform bridge between pnpm/Turbo and the uv (Python) workspace.
//
//   node scripts/run-py.mjs sync [--soft]   install the whole uv workspace (repo root)
//   node scripts/run-py.mjs lint            ruff + black --check   (run from a package dir)
//   node scripts/run-py.mjs test            pytest (+ coverage gate from the package's pyproject)
//
// Python members expose these through a tiny package.json so `pnpm -r lint|test`
// covers them. Shared tool config lives in the root pyproject.toml; it is passed
// explicitly because black/ruff stop at the nearest pyproject.toml of a member.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_CONFIG = join(ROOT, 'pyproject.toml');
const UV_INSTALL_HINT =
  'uv is required for Python packages (plan §4.5). Install: https://docs.astral.sh/uv/getting-started/installation/';

const run = (args, cwd = process.cwd()) =>
  spawnSync('uv', args, { cwd, stdio: 'inherit', shell: false });

const uvAvailable = () => {
  const probe = spawnSync('uv', ['--version'], { stdio: 'ignore', shell: false });
  return probe.status === 0;
};

const venvReady = () => existsSync(join(ROOT, '.venv'));

const COMMANDS = {
  lint: () => [
    ['run', '--no-sync', 'ruff', 'check', '--config', ROOT_CONFIG, '.'],
    ['run', '--no-sync', 'black', '--check', '--config', ROOT_CONFIG, '.'],
  ],
  test: () => [['run', '--no-sync', 'pytest']],
};

const sync = (soft) => {
  if (!uvAvailable()) {
    console.warn(`[run-py] ${UV_INSTALL_HINT}`);
    return soft ? 0 : 1;
  }
  return run(['sync', '--all-packages', '--locked'], ROOT).status ?? 1;
};

const runSteps = (name) => {
  if (!uvAvailable()) {
    console.error(`[run-py] ${UV_INSTALL_HINT}`);
    return 1;
  }
  if (!venvReady()) {
    console.error('[run-py] Python env missing. Run `pnpm install` (or `pnpm py:sync`) first.');
    return 1;
  }
  for (const args of COMMANDS[name]()) {
    const status = run(args).status ?? 1;
    if (status !== 0) return status;
  }
  return 0;
};

const main = (argv) => {
  const [command, ...flags] = argv;
  if (command === 'sync') return sync(flags.includes('--soft'));
  if (command in COMMANDS) return runSteps(command);
  console.error(`[run-py] unknown command "${command}" (expected sync|lint|test)`);
  return 2;
};

process.exit(main(process.argv.slice(2)));
