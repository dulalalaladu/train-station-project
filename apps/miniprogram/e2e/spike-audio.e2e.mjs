// Developer-tool smoke run for the T-005 spike page, driven by miniprogram-automator.
//
// Prerequisites (owner action: WeChat developer tool must be installed and logged in once):
//   - WECHAT_DEVTOOLS_CLI  path to the developer tool CLI (default: the Windows install path)
//   - "设置 → 安全设置 → 服务端口" enabled in the developer tool
//   - pnpm build has produced dist/ (this script builds it first)
//
// What can run in the developer tool: page compile, WebSocket multiplexing (audio + JSON),
// the energy gate and the echo/rtt path using the *synthetic* source, and (if the simulator
// implements it) WebAudio scheduling. What cannot: real microphone capture
// (RecorderManager frames / interruptions) -- that is covered only by the real-device procedure.
// The script reports every capability as pass / unavailable instead of failing on unavailable ones.
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import automator from 'miniprogram-automator';

import { startEchoServer } from '../../../tools/ws-echo/src/server.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath =
  process.env.WECHAT_DEVTOOLS_CLI ?? 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
const RUN_MS = Number(process.env.E2E_RUN_MS ?? 8000);
const PAGE = '/pages/spike-audio/spike-audio';

function check(results, name, ok, detail = '') {
  results.push({ name, status: ok ? 'pass' : 'fail', detail });
}

async function main() {
  const build = spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs')], {
    stdio: 'inherit',
  });
  if (build.status !== 0) throw new Error('build failed');

  const echo = await startEchoServer({ port: 0, host: '0.0.0.0' });
  const results = [];
  const mini = await automator.launch({ cliPath, projectPath: root });
  try {
    const page = await mini.reLaunch(PAGE);
    await page.waitFor(500);
    check(results, 'page compiles and loads', Boolean(page), PAGE);

    await page.setData({
      url: `ws://127.0.0.1:${echo.port}`,
      sourceIdx: 1, // synthetic tone: the simulator has no microphone
      frameIdx: 1,
    });
    await page.callMethod('onStart');
    await page.waitFor(RUN_MS);
    const view = await page.data('view');
    await page.callMethod('onStop');

    check(
      results,
      'websocket connected',
      view.phase === 'running' || view.phase === 'idle',
      view.phase,
    );
    check(results, 'recorder frames arrive (synthetic)', view.interval !== '—', view.interval);
    check(results, 'audio uplink sent', /发送 [1-9]/.test(view.uplink), view.uplink);
    check(results, 'echo round-trip measured', view.rtt !== '—', view.rtt);
    check(results, 'json multiplexed on same socket', view.jsonRtt !== '—', view.jsonRtt);
    const played = !view.underruns.startsWith('0 / 0');
    results.push({
      name: 'webaudio playback scheduled',
      status: played ? 'pass' : 'unavailable',
      detail: played ? view.underruns : 'simulator did not schedule WebAudio buffers',
    });
    results.push({
      name: 'real microphone / interruptions',
      status: 'unavailable',
      detail: 'not testable in developer tool; see docs/test-plans/miniprogram-audio-spike.md',
    });
  } finally {
    await mini.close();
    await echo.close();
  }
  return results;
}

const results = await main();
console.table(results);
await writeFile(join(root, 'e2e', 'last-run.json'), JSON.stringify(results, null, 2));
process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
