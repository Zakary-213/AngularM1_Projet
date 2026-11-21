import { saturationCurve } from './drum-synth';
import { InstrumentId, InstrumentParams } from './melodic-pattern';
import { midiToFrequency } from './pitch/musical-scale';

/**
 * Instruments mélodiques synthétisés en Web Audio (aucun sample, donc aucune licence).
 * Comme drum-synth.ts, tout accepte un BaseAudioContext : le même code sert à
 * l'écoute (AudioContext) et à l'export (OfflineAudioContext).
 * Chaque note crée ses propres nœuds : la polyphonie est illimitée et une note
 * n'interrompt jamais une autre.
 */

/** Enveloppe d'amplitude d'une note (secondes ; niveaux relatifs au pic). */
export interface NoteEnvelope {
  readonly attackSeconds: number;
  /** Niveau vers lequel la note retombe tant qu'elle est tenue (0 à 1 du pic). */
  readonly sustainLevel: number;
  /** Constante de temps de la retombée vers le niveau tenu. */
  readonly decaySeconds: number;
  readonly releaseSeconds: number;
  /** Gain de crête à vélocité maximale : laisse de la marge pour les accords. */
  readonly peakGain: number;
}

const BASE_ENVELOPES: Readonly<Record<InstrumentId, Omit<NoteEnvelope, 'releaseSeconds'>>> = {
  // Piano : attaque franche, le son s'éteint même si la touche reste enfoncée.
  piano: { attackSeconds: 0.004, sustainLevel: 0.15, decaySeconds: 0.6, peakGain: 0.3 },
  // Synthé : attaque douce et son tenu (nappe, lead).
  synth: { attackSeconds: 0.02, sustainLevel: 0.7, decaySeconds: 0.25, peakGain: 0.16 },
  // 808 : sub tenu qui décroît lentement.
  bass808: { attackSeconds: 0.003, sustainLevel: 0.6, decaySeconds: 0.9, peakGain: 0.6 },
};

/** Les setTargetAtTime approchent leur cible sans l'atteindre : la source s'arrête après ~5 constantes de temps. */
const RELEASE_TIME_CONSTANTS = 5;
const MAX_FILTER_HZ = 16000;
/** Écart des deux oscillateurs du synthé, en cents : épaissit le son. */
const SYNTH_DETUNE_CENTS = 8;
/** Glissement d'attaque de la 808 : départ une quarte au-dessus, 40 ms pour rejoindre la note. */
const BASS_GLIDE_RATIO = 1.33;
const BASS_GLIDE_SECONDS = 0.04;
/** Partiels du piano (rang harmonique et amplitude relative). */
const PIANO_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.45],
  [3, 0.2],
  [4, 0.1],
];

export function noteEnvelope(instrument: InstrumentId, params: InstrumentParams): NoteEnvelope {
  return { ...BASE_ENVELOPES[instrument], releaseSeconds: params.releaseSeconds };
}

/** Date d'arrêt des sources d'une note : fin de la note puis relâchement complet. */
export function noteStopTime(time: number, durationSeconds: number, envelope: NoteEnvelope): number {
  const releaseStart = time + Math.max(durationSeconds, envelope.attackSeconds);
  return releaseStart + envelope.releaseSeconds;
}

/**
 * Fréquence de coupure du filtre passe-bas : suit la hauteur de la note (les aigus
 * gardent leur timbre) et s'ouvre avec la brillance `tone` (0 à 1).
 */
export function filterCutoffHz(instrument: InstrumentId, frequencyHz: number, tone: number): number {
  const factor = instrument === 'synth' ? 1.5 + tone * 14 : 2 + tone * 10;
  return Math.min(MAX_FILTER_HZ, frequencyHz * factor);
}

function applyEnvelope(gain: AudioParam, time: number, durationSeconds: number, envelope: NoteEnvelope, peak: number): void {
  const attackEnd = time + envelope.attackSeconds;
  const releaseStart = time + Math.max(durationSeconds, envelope.attackSeconds);
  gain.setValueAtTime(0, time);
  gain.linearRampToValueAtTime(peak, attackEnd);
  gain.setTargetAtTime(peak * envelope.sustainLevel, attackEnd, envelope.decaySeconds);
  gain.setTargetAtTime(0, releaseStart, envelope.releaseSeconds / RELEASE_TIME_CONSTANTS);
}

/**
 * Joue la note MIDI `pitch` à la date `time` (horloge du contexte), pendant
 * `durationSeconds`, puis la relâche. `velocity` (0 à 1) règle le gain linéaire.
 */
export function playInstrumentNote(
  context: BaseAudioContext,
  output: AudioNode,
  instrument: InstrumentId,
  pitch: number,
  time: number,
  durationSeconds: number,
  velocity: number,
  params: InstrumentParams,
): void {
  const frequency = midiToFrequency(pitch);
  const envelope = noteEnvelope(instrument, params);
  const stopAt = noteStopTime(time, durationSeconds, envelope);
  const amp = context.createGain();
  applyEnvelope(amp.gain, time, durationSeconds, envelope, envelope.peakGain * Math.min(1, Math.max(0, velocity)));
  amp.connect(output);

  const oscillators: OscillatorNode[] = [];
  if (instrument === 'bass808') {
    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(frequency * BASS_GLIDE_RATIO, time);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, time + BASS_GLIDE_SECONDS);
    // La brillance pousse la saturation : plus d'harmoniques, audibles sur de petites enceintes.
    const drive = context.createGain();
    drive.gain.value = 1 + params.tone * 3;
    const shaper = context.createWaveShaper();
    shaper.curve = saturationCurve(context);
    oscillator.connect(drive).connect(shaper).connect(amp);
    oscillators.push(oscillator);
  } else {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterCutoffHz(instrument, frequency, params.tone);
    filter.connect(amp);
    if (instrument === 'piano') {
      for (const [rank, level] of PIANO_PARTIALS) {
        const oscillator = context.createOscillator();
        oscillator.type = rank === 1 ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency * rank;
        const partial = context.createGain();
        partial.gain.value = level;
        oscillator.connect(partial).connect(filter);
        oscillators.push(oscillator);
      }
    } else {
      for (const detune of [-SYNTH_DETUNE_CENTS, SYNTH_DETUNE_CENTS]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;
        oscillator.connect(filter);
        oscillators.push(oscillator);
      }
    }
  }
  oscillators.forEach(oscillator => {
    oscillator.start(time);
    oscillator.stop(stopAt);
  });
}
