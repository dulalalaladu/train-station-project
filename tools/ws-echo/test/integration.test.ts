// End-to-end check of the spike data path without WeChat: the real SpikeController from
// apps/miniprogram talks to the real echo server over a real WebSocket. Only the platform seams
// (recorder, player, timers) are faked, so frame format, echo re-labelling, seq/rtt tracking,
// end-of-stream handling and JSON multiplexing are all exercised together.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { DEFAULT_CONFIG } from '../../../apps/miniprogram/src/spike/config';
import { SpikeController } from '../../../apps/miniprogram/src/spike/controller';
import { sineFrame } from '../../../apps/miniprogram/src/spike/pcm';
import type {
  Ports,
  RecorderHandlers,
  SocketHandlers,
} from '../../../apps/miniprogram/src/spike/ports';
import { startEchoServer, type EchoServer } from '../src/server.ts';

const openSockets: WebSocket[] = [];
let server: EchoServer | undefined;

afterEach(async () => {
  openSockets.splice(0).forEach((s) => s.terminate());
  await server?.close();
  server = undefined;
});

function nodeSocket(): Ports['socket'] {
  let ws: WebSocket | undefined;
  return {
    open(url: string, h: SocketHandlers) {
      ws = new WebSocket(url);
      openSockets.push(ws);
      ws.binaryType = 'arraybuffer';
      ws.on('open', () => h.onOpen());
      ws.on('close', (code, reason) => h.onClose(`${code} ${reason.toString()}`));
      ws.on('error', (err) => h.onError(err.message));
      ws.on('message', (data, isBinary) => {
        if (isBinary) h.onBinary(data as ArrayBuffer);
        else h.onText(data.toString());
      });
    },
    sendBinary: (d) => ws?.send(d),
    sendText: (d) => ws?.send(d),
    close: () => ws?.close(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}

describe('SpikeController ↔ ws-echo', () => {
  it('echoes audio, schedules playback and answers JSON on one socket', async () => {
    server = await startEchoServer({ port: 0, host: '127.0.0.1' });
    let recorder: RecorderHandlers | undefined;
    const tick: (() => void)[] = [];
    const scheduled: number[] = [];
    const ports: Ports = {
      clock: () => Date.now(),
      socket: nodeSocket(),
      recorder: {
        start: (_kb, h) => {
          recorder = h;
        },
        stop: () => undefined,
      },
      player: {
        currentTime: () => Date.now() / 1000,
        schedule: (samples) => scheduled.push(samples.length),
        close: () => undefined,
      },
      timers: {
        every: (_ms, fn) => {
          tick.push(fn);
          return () => undefined;
        },
      },
    };
    const controller = new SpikeController(ports);
    controller.start({ ...DEFAULT_CONFIG, url: `ws://127.0.0.1:${server.port}` });
    await waitUntil(() => recorder !== undefined);

    const pcm = sineFrame({ samples: 1024, freqHz: 440, amplitude: 0.5 }).buffer as ArrayBuffer;
    for (let i = 0; i < 10; i += 1) {
      recorder?.onFrame(pcm);
      tick.forEach((fn) => fn());
      await sleep(20);
    }
    await sleep(150);

    const snap = controller.snapshot();
    expect(snap.phase).toBe('running');
    expect(snap.uplink.sent).toBe(10);
    expect(snap.downlink).toMatchObject({ received: 10, lost: 0 });
    expect(scheduled).toHaveLength(10);
    expect(snap.rtt.count).toBe(10);
    expect(snap.json.ping.count).toBeGreaterThan(0);
    expect(snap.json.cmd.count).toBeGreaterThan(0);

    controller.stop();
    await sleep(50);
    expect(controller.snapshot().phase).toBe('idle');
  });
});
