/**
 * Web Audio graph:
 *   <audio> → MediaElementSource → Preamp(Gain) → 10× Biquad (ISO octave bands) → Analyser → Destination
 *
 * EQ design notes (kept "scientific"):
 *  - ISO 266 octave centre frequencies: 31.5 … 16k Hz.
 *  - Outer bands use shelving filters (so the extremes act on everything below/above),
 *    inner bands use peaking filters with Q = √2 ≈ 1.41 (one-octave bandwidth).
 *  - Range ±12 dB; optional auto preamp compensation = −max(positive gain) to avoid clipping.
 */

export const EQ_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MIN = -12;
export const EQ_MAX = 12;
const OCTAVE_Q = Math.SQRT2;

export type PresetKey =
  | "flat"
  | "bass"
  | "treble"
  | "vocal"
  | "rock"
  | "pop"
  | "jazz"
  | "classical"
  | "electronic"
  | "acoustic"
  | "loudness";

export const EQ_PRESETS: Record<PresetKey, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 4],
  pop: [-1, 0, 2, 4, 4, 2, 0, -1, -1, -1],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 3],
  electronic: [5, 4, 1, 0, -2, 1, 1, 2, 4, 5],
  acoustic: [4, 3, 2, 1, 1, 1, 2, 3, 3, 2],
  // Approximates the low-level equal-loudness (Fletcher–Munson) correction
  loudness: [7, 5, 3, 1, 0, 0, 0, 1, 3, 5],
};

export function computeAutoPreamp(gains: number[]): number {
  const maxBoost = Math.max(0, ...gains);
  return -maxBoost;
}

export class AudioEngine {
  readonly audio: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private preamp: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private gains: number[] = EQ_PRESETS.flat.slice();
  private preampDb = 0;
  private enabled = true;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
  }

  /** Must be called on a user gesture. Idempotent. */
  ensureContext(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: "playback" });
    this.ctx = ctx;
    this.source = ctx.createMediaElementSource(this.audio);
    this.preamp = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    this.filters = EQ_BANDS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      if (i === 0) {
        f.type = "lowshelf";
      } else if (i === EQ_BANDS.length - 1) {
        f.type = "highshelf";
      } else {
        f.type = "peaking";
        f.Q.value = OCTAVE_Q;
      }
      f.frequency.value = freq;
      f.gain.value = 0;
      return f;
    });

    let node: AudioNode = this.source;
    node.connect(this.preamp);
    node = this.preamp;
    for (const f of this.filters) {
      node.connect(f);
      node = f;
    }
    node.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.applyGains();
    this.applyPreamp();
    return ctx;
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    this.applyGains();
    this.applyPreamp();
  }

  setGains(gains: number[]) {
    this.gains = gains.slice();
    this.applyGains();
  }

  setBand(i: number, db: number) {
    this.gains[i] = db;
    this.applyGains();
  }

  setPreamp(db: number) {
    this.preampDb = db;
    this.applyPreamp();
  }

  private applyGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filters.forEach((f, i) => {
      const target = this.enabled ? this.gains[i] ?? 0 : 0;
      f.gain.cancelScheduledValues(t);
      f.gain.setTargetAtTime(target, t, 0.02);
    });
  }

  private applyPreamp() {
    if (!this.ctx || !this.preamp) return;
    const t = this.ctx.currentTime;
    const db = this.enabled ? this.preampDb : 0;
    const lin = Math.pow(10, db / 20);
    this.preamp.gain.cancelScheduledValues(t);
    this.preamp.gain.setTargetAtTime(lin, t, 0.02);
  }
}
