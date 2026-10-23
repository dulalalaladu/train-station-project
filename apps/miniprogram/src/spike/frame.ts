// Binary frame codec for the single-WebSocket multiplexing protocol (plan §6.2):
//   [channel:u8][flags:u8][seq:u16 big-endian][payload PCM16LE 16 kHz]
// channel 1 = ASR/uplink audio, channel 2 = talk/downlink audio, flags bit0 = last frame.
// The authoritative codec will live in packages/protocol (T-008); this copy exists because a
// mini-program package cannot import outside its own root. Keep both byte-identical.

export const HEADER_BYTES = 4;
export const CHANNEL_ASR = 1;
export const CHANNEL_TALK = 2;
export const FLAG_END = 1;
const SEQ_MODULO = 0x10000;

export interface Frame {
  readonly channel: number;
  readonly flags: number;
  readonly seq: number;
  readonly pcm: Int16Array;
}

function checkByte(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be a u8, got ${value}`);
  }
}

/** Build a wire frame. PCM is copied, and platforms are assumed little-endian (all WeChat targets). */
export function encodeFrame(frame: Frame): ArrayBuffer {
  checkByte('channel', frame.channel);
  checkByte('flags', frame.flags);
  if (!Number.isInteger(frame.seq) || frame.seq < 0 || frame.seq >= SEQ_MODULO) {
    throw new RangeError(`seq must be a u16, got ${frame.seq}`);
  }
  const out = new ArrayBuffer(HEADER_BYTES + frame.pcm.byteLength);
  const view = new DataView(out);
  view.setUint8(0, frame.channel);
  view.setUint8(1, frame.flags);
  view.setUint16(2, frame.seq, false);
  new Uint8Array(out, HEADER_BYTES).set(
    new Uint8Array(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength),
  );
  return out;
}

/** Parse a wire frame, rejecting anything that is not a well-formed channel 1/2 frame. */
export function decodeFrame(buffer: ArrayBuffer): Frame {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error(`frame shorter than ${HEADER_BYTES}-byte header`);
  }
  const view = new DataView(buffer);
  const channel = view.getUint8(0);
  if (channel !== CHANNEL_ASR && channel !== CHANNEL_TALK) {
    throw new Error(`unknown channel ${channel}`);
  }
  const payloadBytes = buffer.byteLength - HEADER_BYTES;
  if (payloadBytes % 2 !== 0) throw new Error('odd PCM16 payload length');
  return {
    channel,
    flags: view.getUint8(1),
    seq: view.getUint16(2, false),
    pcm: new Int16Array(buffer.slice(HEADER_BYTES)),
  };
}

export function nextSeq(seq: number): number {
  return (seq + 1) % SEQ_MODULO;
}
