// T-005 spike page: PCM chunks → single WebSocket → echo → WebAudio playback, with live metrics.
// All logic lives in src/spike/*; this file only binds UI events and wx calls to it.
import { ENV } from '../../env';
import { FRAME_SIZES_KB, parseSpikeConfig } from '../../spike/config';
import { SpikeController } from '../../spike/controller';
import type { Ports } from '../../spike/ports';
import { buildReport, type AudioSource, type InterruptionMode } from '../../spike/report';
import { createSyntheticRecorder } from '../../spike/synthetic';
import { toView } from '../../spike/view-model';
import {
  createWxPlayer,
  createWxRecorder,
  createWxSocket,
  createWxTimers,
  type WxRecorder,
} from '../../spike/wx-adapters';

const URL_STORAGE_KEY = 'spike-audio.url';
const UI_REFRESH_MS = 500;
const JITTER_CHOICES = [80, 120, 160, 200, 300];
const SOURCES: readonly AudioSource[] = ['mic', 'synthetic'];
const INTERRUPTION_MODES: readonly InterruptionMode[] = ['none', 'start', 'resume'];

const timers = createWxTimers();
let controller: SpikeController | undefined;
let micRecorder: WxRecorder | undefined;
let refreshStop: (() => void) | undefined;
let startedAt = 0;

function readEnv(): Record<string, string> {
  const device = wx.getDeviceInfo();
  const app = wx.getAppBaseInfo();
  return {
    model: device.model,
    system: device.system,
    platform: device.platform,
    wechat: app.version,
    sdk: app.SDKVersion,
  };
}

function buildPorts(source: AudioSource): Ports {
  micRecorder ??= createWxRecorder();
  return {
    socket: createWxSocket(),
    player: createWxPlayer(),
    timers,
    clock: () => Date.now(),
    recorder: source === 'mic' ? micRecorder : createSyntheticRecorder(timers),
  };
}

Page({
  data: {
    url: ENV.wsUrl,
    frameLabels: FRAME_SIZES_KB.map((kb) => `${kb} KB (≈${kb * 32} ms)`),
    frameIdx: 1,
    jitterLabels: JITTER_CHOICES.map((ms) => `${ms} ms`),
    jitterIdx: 2,
    sourceLabels: ['麦克风（真机）', '合成音（开发者工具）'],
    sourceIdx: 0,
    interruptionLabels: ['中断后不处理', '中断后 start()', '中断后 resume()'],
    interruptionIdx: 0,
    silenceGate: true,
    running: false,
    error: '',
    envText: '',
    view: toView(new SpikeController(buildPortsStub()).snapshot()),
  },

  onLoad() {
    const saved = wx.getStorageSync<string>(URL_STORAGE_KEY);
    this.setData({ url: saved || ENV.wsUrl, envText: JSON.stringify(readEnv()) });
    wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
  },

  onShow() {
    controller?.onShow();
  },

  onHide() {
    controller?.onHide();
  },

  onUnload() {
    this.stopRun();
  },

  onUrlInput(e: WechatMiniprogram.Input) {
    this.setData({ url: e.detail.value });
  },

  onPick(e: WechatMiniprogram.CustomEvent<{ value: string }, { field: string }>) {
    const field = e.currentTarget.dataset['field'] as string;
    this.setData({ [field]: Number(e.detail.value) });
  },

  onGateChange(e: WechatMiniprogram.SwitchChange) {
    this.setData({ silenceGate: e.detail.value });
  },

  async onStart() {
    const d = this.data;
    const source = SOURCES[d.sourceIdx] ?? 'mic';
    try {
      const config = parseSpikeConfig({
        url: d.url,
        frameSizeKb: FRAME_SIZES_KB[d.frameIdx],
        jitterMs: JITTER_CHOICES[d.jitterIdx],
        silenceGate: d.silenceGate,
      });
      if (source === 'mic') await wx.authorize({ scope: 'scope.record' });
      wx.setStorageSync(URL_STORAGE_KEY, config.url);
      this.beginRun(config, source);
    } catch (err) {
      this.setData({ error: err instanceof Error ? err.message : JSON.stringify(err) });
    }
  },

  beginRun(config: ReturnType<typeof parseSpikeConfig>, source: AudioSource) {
    this.stopRun();
    const ports = buildPorts(source);
    micRecorder?.setInterruptionMode(INTERRUPTION_MODES[this.data.interruptionIdx] ?? 'none');
    controller = new SpikeController(ports);
    controller.start(config);
    startedAt = Date.now();
    refreshStop = timers.every(UI_REFRESH_MS, () => this.refresh());
    this.setData({ running: true, error: '' });
  },

  onStop() {
    this.stopRun();
  },

  stopRun() {
    refreshStop?.();
    refreshStop = undefined;
    controller?.stop();
    this.refresh();
    this.setData({ running: false });
  },

  onReset() {
    controller?.resetStats();
    this.refresh();
  },

  refresh() {
    if (controller) this.setData({ view: toView(controller.snapshot()) });
  },

  onCopyReport() {
    if (!controller) return;
    const d = this.data;
    const text = buildReport({
      env: readEnv(),
      config: parseSpikeConfig({
        url: d.url,
        frameSizeKb: FRAME_SIZES_KB[d.frameIdx],
        jitterMs: JITTER_CHOICES[d.jitterIdx],
        silenceGate: d.silenceGate,
      }),
      source: SOURCES[d.sourceIdx] ?? 'mic',
      interruptionMode: INTERRUPTION_MODES[d.interruptionIdx] ?? 'none',
      durationMs: Date.now() - startedAt,
      snapshot: controller.snapshot(),
    });
    void wx.setClipboardData({ data: text });
  },
});

/** Inert ports so the idle view model can be rendered before the first run. */
function buildPortsStub(): Ports {
  const noop = (): void => undefined;
  return {
    clock: () => 0,
    timers: { every: () => noop },
    socket: { open: noop, sendBinary: noop, sendText: noop, close: noop },
    recorder: { start: noop, stop: noop },
    player: { currentTime: () => 0, schedule: noop, close: noop },
  };
}
