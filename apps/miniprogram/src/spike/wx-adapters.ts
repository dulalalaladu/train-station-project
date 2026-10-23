// Real wx.* implementations of the controller ports. Thin glue only: all decisions live in the
// controller. Not unit-testable without the WeChat runtime; exercised in the developer tool
// (synthetic source) and on real devices per docs/test-plans/miniprogram-audio-spike.md.
import { SAMPLE_RATE } from './pcm';
import type {
  PlayerPort,
  RecorderHandlers,
  RecorderPort,
  SocketHandlers,
  SocketPort,
  TimerPort,
} from './ports';
import type { InterruptionMode } from './report';

export function createWxTimers(): TimerPort {
  return {
    every(ms, fn) {
      const handle = setInterval(fn, ms);
      return () => clearInterval(handle);
    },
  };
}

export function createWxSocket(): SocketPort {
  let task: WechatMiniprogram.SocketTask | undefined;
  return {
    open(url: string, h: SocketHandlers): void {
      const t = wx.connectSocket({ url });
      task = t;
      t.onOpen(() => h.onOpen());
      t.onClose((res) => h.onClose(`${res.code} ${res.reason}`.trim()));
      t.onError((res) => h.onError(res.errMsg));
      t.onMessage((res) => {
        if (typeof res.data === 'string') h.onText(res.data);
        else h.onBinary(res.data);
      });
    },
    sendBinary(data) {
      task?.send({ data });
    },
    sendText(data) {
      task?.send({ data });
    },
    close() {
      task?.close({ code: 1000, reason: 'spike stop' });
      task = undefined;
    },
  };
}

const MAX_RECORD_MS = 60000;

export interface WxRecorder extends RecorderPort {
  setInterruptionMode(mode: InterruptionMode): void;
}

/**
 * RecorderManager wrapper. Listeners are registered once (the manager is a singleton) and routed to
 * the handlers of the current run. The 60 s duration cap is worked around by restarting on onStop
 * while a run is active; the resulting gap shows up as a stall in the frame-interval statistics.
 */
export function createWxRecorder(): WxRecorder {
  const manager = wx.getRecorderManager();
  let handlers: RecorderHandlers | undefined;
  let frameSizeKb = 2;
  let wanted = false;
  let mode: InterruptionMode = 'none';

  const begin = (): void => {
    manager.start({
      format: 'PCM',
      sampleRate: 16000,
      numberOfChannels: 1,
      frameSize: frameSizeKb,
      duration: MAX_RECORD_MS,
    });
  };

  manager.onFrameRecorded((res) => handlers?.onFrame(res.frameBuffer));
  manager.onError((res) => handlers?.onError(res.errMsg));
  manager.onStop(() => {
    handlers?.onStop();
    if (wanted) begin();
  });
  manager.onInterruptionBegin(() => handlers?.onInterruptionBegin());
  manager.onInterruptionEnd(() => {
    handlers?.onInterruptionEnd();
    if (!wanted) return;
    if (mode === 'start') begin();
    else if (mode === 'resume') manager.resume();
  });

  return {
    start(kb, h) {
      handlers = h;
      frameSizeKb = kb;
      wanted = true;
      begin();
    },
    stop() {
      wanted = false;
      manager.stop();
    },
    setInterruptionMode(next) {
      mode = next;
    },
  };
}

export function createWxPlayer(): PlayerPort {
  let ctx: WechatMiniprogram.WebAudioContext | undefined;
  const context = (): WechatMiniprogram.WebAudioContext => {
    if (ctx === undefined) {
      ctx = wx.createWebAudioContext();
      void ctx.resume();
    }
    return ctx;
  };
  return {
    currentTime: () => context().currentTime,
    schedule(samples, startAt) {
      const audio = context();
      const buffer = audio.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0, 0);
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      source.start(startAt);
    },
    close() {
      const current = ctx;
      ctx = undefined;
      void current?.close();
    },
  };
}
