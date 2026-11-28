import { describe, expect, it } from 'vitest';
import { filterCutoffHz, noteEnvelope, noteStopTime, playInstrumentNote, pluckedString, startHeldInstrumentNote, stringPeriod } from './instrument-synth';
import {
  DEFAULT_INSTRUMENT_PARAMS,
  INSTRUMENTS,
  INSTRUMENT_FAMILIES,
  INSTRUMENT_RANGES,
  defaultTrackFor,
  instrumentsOfFamily,
  isInstrumentId,
} from './melodic-pattern';

/** Double minimal de Web Audio : enregistre les sources démarrées et leur arrêt. */
class FakeParam {
  value = 0;
  setValueAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(): void {}
  cancelScheduledValues(): void {}
}

class FakeNode extends EventTarget {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  playbackRate = new FakeParam();
  Q = new FakeParam();
  type = '';
  curve: unknown = null;
  buffer: unknown = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  constructor(private readonly sources?: FakeNode[]) { super(); }
  connect<T>(target: T): T { return target; }
  disconnect(): void {}
  start(time: number): void { this.startedAt = time; this.sources?.push(this); }
  stop(time: number): void { this.stoppedAt = time; }
}

class FakeContext {
  sampleRate = 44100;
  currentTime = 0;
  started: FakeNode[] = [];
  buffers = 0;
  createGain(): FakeNode { return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createWaveShaper(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { return new FakeNode(this.started); }
  createBufferSource(): FakeNode { return new FakeNode(this.started); }
  createBuffer(_channels: number, length: number) {
    this.buffers++;
    const data = new Float32Array(length);
    return { length, getChannelData: () => data, copyToChannel: (source: Float32Array) => data.set(source) };
  }
}

describe('Bibliothèque d’instruments', () => {
  it('propose au moins 10 instruments, chacun rangé dans une seule famille', () => {
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(10);
    const grouped = INSTRUMENT_FAMILIES.flatMap(family => instrumentsOfFamily(family));
    expect([...grouped].sort()).toEqual([...INSTRUMENTS].sort());
  });

  it('range les basses sur la piste Basse et le reste sur Mélodie', () => {
    expect(instrumentsOfFamily('basses').map(defaultTrackFor)).toEqual(['bass', 'bass']);
    expect(defaultTrackFor('acousticGuitar')).toBe('melody');
  });

  it('reconnaît les identifiants valides seulement', () => {
    expect(isInstrumentId('electricGuitar')).toBe(true);
    expect(isInstrumentId('theremin')).toBe(false);
    expect(isInstrumentId(42)).toBe(false);
  });

  it('a pour chaque instrument une tessiture d’au moins deux octaves et des réglages valides', () => {
    for (const instrument of INSTRUMENTS) {
      const range = INSTRUMENT_RANGES[instrument];
      expect(range.high - range.low + 1, instrument).toBeGreaterThanOrEqual(24);
      expect(DEFAULT_INSTRUMENT_PARAMS[instrument].tone).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_INSTRUMENT_PARAMS[instrument].tone).toBeLessThanOrEqual(1);
    }
  });
});

describe('Synthèse des instruments', () => {
  it('joue chaque instrument : les sources démarrent à la note et s’arrêtent après le relâchement', () => {
    for (const instrument of INSTRUMENTS) {
      const context = new FakeContext();
      const params = DEFAULT_INSTRUMENT_PARAMS[instrument];
      const pitch = INSTRUMENT_RANGES[instrument].low + 12;
      playInstrumentNote(context as unknown as BaseAudioContext, new FakeNode() as unknown as AudioNode, instrument, pitch, 1, 0.5, 0.8, params);
      const stopAt = noteStopTime(1, 0.5, noteEnvelope(instrument, params));
      expect(context.started.length, instrument).toBeGreaterThan(0);
      expect(context.started.every(source => source.startedAt === 1 && source.stoppedAt === stopAt), instrument).toBe(true);
    }
  });

  it('tient deux notes et ne programme la fin de chaque voix qu’au relâchement', () => {
    const fakeContext = new FakeContext();
    const context = fakeContext as unknown as BaseAudioContext;
    const output = new FakeNode() as unknown as AudioNode;
    const params = DEFAULT_INSTRUMENT_PARAMS.organ;
    fakeContext.currentTime = 2;
    const first = startHeldInstrumentNote(context, output, 'organ', 60, 0.8, params);
    const firstVoice = [...fakeContext.started];
    const second = startHeldInstrumentNote(context, output, 'organ', 64, 0.8, params);
    const secondVoice = fakeContext.started.slice(firstVoice.length);

    expect(firstVoice.length).toBeGreaterThan(0);
    expect(secondVoice.length).toBeGreaterThan(0);
    expect(fakeContext.started.every(source => source.startedAt === 2 && source.stoppedAt === null)).toBe(true);
    fakeContext.currentTime = 2.005;
    first.release();
    expect(firstVoice.every(source => source.stoppedAt === 2.005 + params.releaseSeconds)).toBe(true);
    expect(secondVoice.every(source => source.stoppedAt === null)).toBe(true);
    fakeContext.currentTime = 4;
    second.release(true);
    expect(secondVoice.every(source => source.stoppedAt === 4.02)).toBe(true);
  });

  it('ouvre le filtre avec la brillance pour chaque instrument, sans dépasser 16 kHz', () => {
    for (const instrument of INSTRUMENTS) {
      expect(filterCutoffHz(instrument, 220, 1), instrument).toBeGreaterThan(filterCutoffHz(instrument, 220, 0));
      expect(filterCutoffHz(instrument, 8000, 1), instrument).toBeLessThanOrEqual(16000);
    }
  });

  it('ne recalcule pas une corde déjà calculée pour la même note', () => {
    const context = new FakeContext();
    const play = () => playInstrumentNote(context as unknown as BaseAudioContext, new FakeNode() as unknown as AudioNode, 'acousticGuitar', 52, 0, 0.5, 0.8, DEFAULT_INSTRUMENT_PARAMS.acousticGuitar);
    play();
    play();
    expect(context.buffers).toBe(1);
  });
});

describe('Corde pincée (Karplus-Strong)', () => {
  it('corrige l’arrondi de la période : la note jouée est juste, même dans les aigus', () => {
    for (const frequency of [82.41, 440, 1046.5]) {
      const { samples, playbackRate } = stringPeriod(44100, frequency);
      expect(Number.isInteger(samples)).toBe(true);
      const playedFrequency = (44100 / samples) * playbackRate;
      expect(playedFrequency).toBeCloseTo(frequency, 6);
    }
  });

  it('produit un son qui s’éteint et reste dans [-1, 1]', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const samples = pluckedString(44100, 100, { seconds: 1, damping: 0.996, pluckSoftness: 0.3 }, random);
    const energy = (from: number, to: number) => samples.slice(from, to).reduce((sum, value) => sum + value * value, 0);
    expect(energy(0, 4410)).toBeGreaterThan(energy(39690, 44100) * 10);
    expect(samples.every(value => Math.abs(value) <= 1)).toBe(true);
  });
});
