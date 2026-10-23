import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GATE,
  initialGate,
  int16ToFloat32,
  pcmDurationSec,
  rmsLevel,
  stepGate,
  sineFrame,
} from '../src/spike/pcm';

describe('rmsLevel', () => {
  it('is 0 for silence and for an empty frame', () => {
    expect(rmsLevel(new Int16Array(100))).toBe(0);
    expect(rmsLevel(new Int16Array(0))).toBe(0);
  });

  it('is ~1 for a full-scale square wave', () => {
    const full = new Int16Array(64).fill(32767);
    expect(rmsLevel(full)).toBeCloseTo(1, 3);
  });

  it('gives 1/sqrt(2) for a full-scale sine', () => {
    expect(rmsLevel(sineFrame({ samples: 1600, freqHz: 400, amplitude: 1 }))).toBeCloseTo(
      Math.SQRT1_2,
      2,
    );
  });
});

describe('int16ToFloat32', () => {
  it('maps to [-1, 1) without clipping', () => {
    const out = int16ToFloat32(Int16Array.from([0, 16384, -32768, 32767]));
    expect(Array.from(out)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });
});

describe('pcmDurationSec', () => {
  it('computes seconds from samples and rate', () => {
    expect(pcmDurationSec(1024, 16000)).toBeCloseTo(0.064, 6);
  });
});

describe('stepGate', () => {
  const cfg = { threshold: 0.02, hangoverFrames: 2 };

  it('stays closed on silence', () => {
    const step = stepGate(initialGate(), 0.001, cfg);
    expect(step).toEqual({ send: false, endOfSpeech: false, state: { open: false, quiet: 0 } });
  });

  it('opens on speech and sends', () => {
    const step = stepGate(initialGate(), 0.5, cfg);
    expect(step.send).toBe(true);
    expect(step.state.open).toBe(true);
  });

  it('keeps sending through the hangover, then closes with an end-of-speech marker', () => {
    let state = stepGate(initialGate(), 0.5, cfg).state;
    const a = stepGate(state, 0, cfg);
    expect(a.send).toBe(true);
    expect(a.endOfSpeech).toBe(false);
    const b = stepGate(a.state, 0, cfg);
    expect(b.send).toBe(true);
    expect(b.endOfSpeech).toBe(true);
    expect(b.state.open).toBe(false);
    state = b.state;
    expect(stepGate(state, 0, cfg).send).toBe(false);
  });

  it('resets the hangover when speech resumes', () => {
    const open = stepGate(initialGate(), 0.5, cfg).state;
    const quiet = stepGate(open, 0, cfg).state;
    expect(stepGate(quiet, 0.5, cfg).state.quiet).toBe(0);
  });

  it('has a sane default', () => {
    expect(DEFAULT_GATE.threshold).toBeGreaterThan(0);
    expect(DEFAULT_GATE.hangoverFrames).toBeGreaterThan(0);
  });
});

describe('sineFrame', () => {
  it('generates the requested number of samples within the amplitude', () => {
    const frame = sineFrame({ samples: 100, freqHz: 440, amplitude: 0.5 });
    expect(frame.length).toBe(100);
    expect(Math.max(...Array.from(frame))).toBeLessThanOrEqual(16384);
  });

  it('continues phase across frames when given a start offset', () => {
    const whole = sineFrame({ samples: 200, freqHz: 440, amplitude: 0.5 });
    const tail = sineFrame({ samples: 100, freqHz: 440, amplitude: 0.5, startSample: 100 });
    expect(Array.from(tail)).toEqual(Array.from(whole.slice(100)));
  });
});
