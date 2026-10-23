// Orchestrates one spike run: recorder → energy gate → binary frames on a single socket,
// echoed frames → jitter-scheduled WebAudio playback, JSON heartbeats on the same socket.
// All state lives in one immutable `Session` value that is replaced on every update.
import { DEFAULT_CONFIG, type SpikeConfig } from './config';
import { CHANNEL_ASR, CHANNEL_TALK, FLAG_END, decodeFrame, encodeFrame, nextSeq } from './frame';
import { endStream, initialPlayback, scheduleChunk, type PlaybackState } from './jitter';
import { buildCmdSubmit, buildPing, parseServerText } from './messages';
import {
  initialGate,
  int16ToFloat32,
  pcmDurationSec,
  rmsLevel,
  SAMPLE_RATE,
  stepGate,
  type GateState,
} from './pcm';
import type { Ports } from './ports';
import {
  addBytes,
  addSample,
  bytesPerSec,
  emptyRate,
  emptySeq,
  emptySent,
  emptyStats,
  recordSent,
  resolveSent,
  trackSeq,
  type RateWindow,
  type RunningStats,
  type SeqState,
  type SentLog,
} from './stats';

export type Phase = 'idle' | 'connecting' | 'running' | 'closed' | 'error';
export interface SpikeEvent {
  readonly t: number;
  readonly kind: string;
  readonly detail: string;
}

const MAX_EVENTS = 120;
const STALL_MS = 500;
const RATE_WINDOW_MS = 1000;

interface Session {
  readonly phase: Phase;
  readonly config: SpikeConfig;
  readonly startedAt: number;
  readonly events: readonly SpikeEvent[];
  readonly seq: number;
  readonly gate: GateState;
  readonly utteranceOpen: boolean;
  readonly lastFrameAt: number | undefined;
  readonly interval: RunningStats;
  readonly rate: RateWindow;
  readonly sent: number;
  readonly skipped: number;
  readonly sentLog: SentLog;
  readonly rtt: RunningStats;
  readonly playback: PlaybackState;
  readonly downSeq: SeqState;
  readonly pingRtt: RunningStats;
  readonly cmdRtt: RunningStats;
  readonly cmdCounter: number;
  readonly hiddenAt: number | undefined;
  readonly framesWhileHidden: number;
}

function freshSession(config: SpikeConfig, now: number): Session {
  return {
    phase: 'idle',
    config,
    startedAt: now,
    events: [],
    seq: 0,
    gate: initialGate(),
    utteranceOpen: false,
    lastFrameAt: undefined,
    interval: emptyStats(),
    rate: emptyRate(RATE_WINDOW_MS),
    sent: 0,
    skipped: 0,
    sentLog: emptySent(),
    rtt: emptyStats(),
    playback: initialPlayback(),
    downSeq: emptySeq(),
    pingRtt: emptyStats(),
    cmdRtt: emptyStats(),
    cmdCounter: 0,
    hiddenAt: undefined,
    framesWhileHidden: 0,
  };
}

export interface Snapshot {
  readonly phase: Phase;
  readonly events: readonly SpikeEvent[];
  readonly interval: { count: number; meanMs: number; minMs: number; maxMs: number };
  readonly uplink: { sent: number; skipped: number; bytesPerSec: number };
  readonly downlink: { received: number; lost: number; duplicate: number; reordered: number };
  readonly playback: {
    scheduled: number;
    underruns: number;
    underrunRate: number;
    maxLeadMs: number;
  };
  readonly rtt: { count: number; meanMs: number; maxMs: number };
  readonly json: {
    ping: { count: number; meanMs: number; maxMs: number };
    cmd: { count: number; meanMs: number; maxMs: number };
  };
}

function summary(s: RunningStats): { count: number; meanMs: number; maxMs: number } {
  return { count: s.count, meanMs: s.count === 0 ? 0 : s.sum / s.count, maxMs: s.max };
}

export class SpikeController {
  private session: Session = freshSession(DEFAULT_CONFIG, 0);
  private cancelTimers: readonly (() => void)[] = [];
  private active = false;

  constructor(private readonly ports: Ports) {}

  start(config: SpikeConfig): void {
    this.stop();
    this.active = true;
    this.session = { ...freshSession(config, this.ports.clock()), phase: 'connecting' };
    this.log(
      'start',
      `${config.url} frameSize=${config.frameSizeKb}KB jitter=${config.jitterMs}ms`,
    );
    this.ports.socket.open(config.url, {
      onOpen: () => this.guard(() => this.handleOpen()),
      onClose: (reason) => this.guard(() => this.handleClosed('closed', 'socket-close', reason)),
      onError: (message) => this.guard(() => this.handleClosed('error', 'socket-error', message)),
      onBinary: (data) => this.guard(() => this.handleBinary(data)),
      onText: (data) => this.guard(() => this.handleText(data)),
    });
  }

  stop(): void {
    if (!this.active) return;
    this.sendEndMarkerIfOpen();
    this.teardown();
    this.ports.socket.close();
    this.ports.player.close();
    this.session = { ...this.session, phase: 'idle' };
  }

  resetStats(): void {
    const fresh = freshSession(this.session.config, this.ports.clock());
    this.session = {
      ...fresh,
      phase: this.session.phase,
      events: this.session.events,
      seq: this.session.seq,
    };
    this.log('reset', 'statistics cleared');
  }

  onHide(): void {
    // Also log when the socket already died, so a background-induced disconnect is visible.
    if (this.session.phase === 'idle') return;
    this.session = { ...this.session, hiddenAt: this.ports.clock(), framesWhileHidden: 0 };
    this.log('hide', 'page hidden / app in background');
  }

  onShow(): void {
    if (this.session.phase === 'idle' || this.session.hiddenAt === undefined) return;
    const away = this.ports.clock() - this.session.hiddenAt;
    const ws = this.session.phase === 'running' ? 'open' : this.session.phase;
    this.log('show', `awayMs=${away} ws=${ws} framesWhileHidden=${this.session.framesWhileHidden}`);
    this.session = { ...this.session, hiddenAt: undefined };
  }

  snapshot(): Snapshot {
    const s = this.session;
    const { count, min, max } = s.interval;
    const scheduled = s.playback.scheduled;
    return {
      phase: s.phase,
      events: s.events,
      interval: { count, meanMs: count === 0 ? 0 : s.interval.sum / count, minMs: min, maxMs: max },
      uplink: {
        sent: s.sent,
        skipped: s.skipped,
        bytesPerSec: bytesPerSec(s.rate, this.ports.clock()),
      },
      downlink: {
        received: s.downSeq.received,
        lost: s.downSeq.lost,
        duplicate: s.downSeq.duplicate,
        reordered: s.downSeq.reordered,
      },
      playback: {
        scheduled,
        underruns: s.playback.underruns,
        underrunRate: scheduled === 0 ? 0 : s.playback.underruns / scheduled,
        maxLeadMs: s.playback.maxLeadSec * 1000,
      },
      rtt: summary(s.rtt),
      json: { ping: summary(s.pingRtt), cmd: summary(s.cmdRtt) },
    };
  }

  private guard(fn: () => void): void {
    if (this.active) fn();
  }

  private log(kind: string, detail: string): void {
    const t = this.ports.clock() - this.session.startedAt;
    const events = [...this.session.events, { t, kind, detail }].slice(-MAX_EVENTS);
    this.session = { ...this.session, events };
  }

  private teardown(): void {
    this.cancelTimers.forEach((cancel) => cancel());
    this.cancelTimers = [];
    this.ports.recorder.stop();
    this.active = false;
  }

  private handleOpen(): void {
    const { config } = this.session;
    this.session = { ...this.session, phase: 'running' };
    this.log('socket-open', config.url);
    const timers = [
      this.ports.timers.every(config.heartbeatMs, () => this.guard(() => this.sendPing())),
    ];
    if (config.cmdIntervalMs > 0) {
      timers.push(
        this.ports.timers.every(config.cmdIntervalMs, () => this.guard(() => this.sendCmd())),
      );
    }
    this.cancelTimers = timers;
    this.ports.recorder.start(config.frameSizeKb, {
      onFrame: (pcm) => this.guard(() => this.handleFrame(pcm)),
      onError: (message) => this.guard(() => this.log('recorder-error', message)),
      onStop: () => this.guard(() => this.log('recorder-stop', '')),
      onInterruptionBegin: () =>
        this.guard(() => this.log('interruption-begin', 'recorder interrupted')),
      onInterruptionEnd: () =>
        this.guard(() => this.log('interruption-end', 'recorder interruption ended')),
    });
  }

  private handleClosed(phase: Phase, kind: string, detail: string): void {
    this.teardown();
    this.ports.player.close();
    this.session = { ...this.session, phase };
    this.log(kind, detail);
  }

  private sendPing(): void {
    this.ports.socket.sendText(buildPing(this.ports.clock()));
  }

  private sendCmd(): void {
    const id = `spike-${this.session.cmdCounter}`;
    this.session = { ...this.session, cmdCounter: this.session.cmdCounter + 1 };
    this.ports.socket.sendText(buildCmdSubmit(id, this.ports.clock()));
  }

  private handleFrame(buffer: ArrayBuffer): void {
    const now = this.ports.clock();
    this.noteFrameTiming(now);
    if (buffer.byteLength % 2 !== 0) {
      this.log('bad-frame', `odd recorder frame length ${buffer.byteLength}`);
      return;
    }
    const pcm = new Int16Array(buffer);
    const { config } = this.session;
    const step = config.silenceGate
      ? stepGate(this.session.gate, rmsLevel(pcm), config.gate)
      : { send: true, endOfSpeech: false, state: this.session.gate };
    this.session = { ...this.session, gate: step.state };
    if (!step.send) {
      this.session = { ...this.session, skipped: this.session.skipped + 1 };
      return;
    }
    this.sendAudio(pcm, step.endOfSpeech ? FLAG_END : 0, now);
  }

  private noteFrameTiming(now: number): void {
    const s = this.session;
    const gap = s.lastFrameAt === undefined ? undefined : now - s.lastFrameAt;
    this.session = {
      ...s,
      lastFrameAt: now,
      interval: gap === undefined ? s.interval : addSample(s.interval, gap),
      framesWhileHidden: s.hiddenAt === undefined ? s.framesWhileHidden : s.framesWhileHidden + 1,
    };
    if (gap !== undefined && gap > STALL_MS)
      this.log('stall', `recorder gap ${Math.round(gap)} ms`);
  }

  private sendAudio(pcm: Int16Array, flags: number, now: number): void {
    const s = this.session;
    const wire = encodeFrame({ channel: CHANNEL_ASR, flags, seq: s.seq, pcm });
    this.ports.socket.sendBinary(wire);
    this.session = {
      ...s,
      seq: nextSeq(s.seq),
      sent: s.sent + 1,
      utteranceOpen: flags !== FLAG_END,
      rate: addBytes(s.rate, now, wire.byteLength),
      sentLog: recordSent(s.sentLog, s.seq, now),
    };
  }

  private sendEndMarkerIfOpen(): void {
    const s = this.session;
    if (!this.active || s.phase !== 'running' || !s.utteranceOpen) return;
    const wire = encodeFrame({
      channel: CHANNEL_ASR,
      flags: FLAG_END,
      seq: s.seq,
      pcm: new Int16Array(0),
    });
    this.ports.socket.sendBinary(wire);
    this.session = { ...s, seq: nextSeq(s.seq), utteranceOpen: false };
  }

  private handleBinary(data: ArrayBuffer): void {
    let frame;
    try {
      frame = decodeFrame(data);
    } catch (err) {
      this.log('bad-frame', err instanceof Error ? err.message : 'decode failed');
      return;
    }
    if (frame.channel !== CHANNEL_TALK) {
      this.log('bad-frame', `unexpected downlink channel ${frame.channel}`);
      return;
    }
    const now = this.ports.clock();
    const resolved = resolveSent(this.session.sentLog, frame.seq, now);
    this.session = {
      ...this.session,
      downSeq: trackSeq(this.session.downSeq, frame.seq),
      sentLog: resolved.pending,
      rtt:
        resolved.rtt === undefined ? this.session.rtt : addSample(this.session.rtt, resolved.rtt),
    };
    this.play(frame.pcm, (frame.flags & FLAG_END) !== 0);
  }

  private play(pcm: Int16Array, endOfStream: boolean): void {
    let playback = this.session.playback;
    if (pcm.length > 0) {
      const result = scheduleChunk(
        playback,
        this.ports.player.currentTime(),
        pcmDurationSec(pcm.length, SAMPLE_RATE),
        this.session.config.jitterMs / 1000,
      );
      this.ports.player.schedule(int16ToFloat32(pcm), result.startAt);
      playback = result.state;
    }
    this.session = { ...this.session, playback: endOfStream ? endStream(playback) : playback };
  }

  private handleText(raw: string): void {
    const msg = parseServerText(raw);
    const now = this.ports.clock();
    if (msg.kind === 'pong') {
      this.session = { ...this.session, pingRtt: addSample(this.session.pingRtt, now - msg.ts) };
    } else if (msg.kind === 'cmd.state') {
      this.session = { ...this.session, cmdRtt: addSample(this.session.cmdRtt, now - msg.echoTs) };
    } else if (msg.kind === 'error') {
      this.log('server-error', msg.code);
    }
  }
}
