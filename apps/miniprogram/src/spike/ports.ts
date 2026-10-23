// Platform seams. The controller only talks to these interfaces; wx-adapters.ts implements them
// with real wx.* APIs and the unit tests implement them with fakes.

export interface SocketHandlers {
  onOpen(): void;
  onClose(reason: string): void;
  onError(message: string): void;
  onBinary(data: ArrayBuffer): void;
  onText(data: string): void;
}

export interface SocketPort {
  open(url: string, handlers: SocketHandlers): void;
  sendBinary(data: ArrayBuffer): void;
  sendText(data: string): void;
  close(): void;
}

export interface RecorderHandlers {
  /** One raw PCM16LE mono 16 kHz frame, exactly as delivered by onFrameRecorded. */
  onFrame(pcm: ArrayBuffer): void;
  onError(message: string): void;
  onStop(): void;
  onInterruptionBegin(): void;
  onInterruptionEnd(): void;
}

export interface RecorderPort {
  start(frameSizeKb: number, handlers: RecorderHandlers): void;
  stop(): void;
}

export interface PlayerPort {
  /** AudioContext.currentTime in seconds. */
  currentTime(): number;
  /** Queue mono 16 kHz samples to begin at `startAt` (AudioContext time). */
  schedule(samples: Float32Array, startAt: number): void;
  close(): void;
}

export interface TimerPort {
  /** Repeat `fn` every `ms`; returns a cancel function. */
  every(ms: number, fn: () => void): () => void;
}

export interface Ports {
  readonly socket: SocketPort;
  readonly recorder: RecorderPort;
  readonly player: PlayerPort;
  readonly timers: TimerPort;
  /** Monotonic-ish milliseconds. */
  readonly clock: () => number;
}
