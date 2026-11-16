import { ScaleName, frequencyToMidi, nearestAllowedMidi, scalePitchClasses } from './musical-scale';
import { detectPitch } from './pitch-detection';

/**
 * Correction de hauteur hors temps réel, appliquée après la prise :
 * 1. analyse : hauteur détectée toutes les ANALYSIS_HOP_SECONDS (YIN sur un signal sous-échantillonné) ;
 * 2. cible : note de la gamme la plus proche, rapprochée selon l'intensité et la vitesse ;
 * 3. synthèse : TD-PSOLA, qui recopie des grains de deux périodes à un nouvel espacement.
 *    La durée est conservée, contrairement à un simple changement de vitesse.
 * Limites connues : marques de période approximatives (pas de détection des
 * fermetures glottiques), formants non préservés pour les grands écarts : le
 * timbre ne peut donc pas être réglé indépendamment de la note avec ce moteur.
 */

export interface PitchCorrectionSettings {
  /** Fondamentale de la tonalité en demi-tons depuis do (0 à 11). */
  readonly root: number;
  readonly scale: ScaleName;
  /** Part de l'écart corrigée : 0 = aucune, 1 = note exacte. */
  readonly strength: number;
  /** Temps de glissement vers la note cible, en millisecondes (0 = effet robotique). */
  readonly retuneMs: number;
  /**
   * Classes de hauteur autorisées (0 = do … 11 = si). Par défaut, les notes de la gamme.
   * Permet de retirer une note de la gamme pour que la voix ne s'y pose jamais.
   */
  readonly allowedPitchClasses?: readonly number[];
  /** Écart toléré avant correction, en cents (0 = tout est corrigé) : garde le vibrato et les nuances. */
  readonly toleranceCents?: number;
  /** Transposition volontaire ajoutée après la correction, en demi-tons. */
  readonly transposeSemitones?: number;
}

/** Bornes des réglages, partagées par l'interface, les préréglages et la validation. */
export const MAX_RETUNE_MS = 300;
export const MAX_TOLERANCE_CENTS = 50;
export const MAX_TRANSPOSE_SEMITONES = 12;

/** Notes vers lesquelles la voix est recalée. */
export function targetPitchClasses(settings: Pick<PitchCorrectionSettings, 'root' | 'scale' | 'allowedPitchClasses'>): readonly number[] {
  return settings.allowedPitchClasses ?? scalePitchClasses(settings.root, settings.scale);
}

export type PitchPreset = 'natural' | 'hard';

export const PITCH_PRESETS: Readonly<Record<PitchPreset, Pick<PitchCorrectionSettings, 'strength' | 'retuneMs'>>> = {
  natural: { strength: 0.6, retuneMs: 80 },
  hard: { strength: 1, retuneMs: 0 },
};

/** Durée maximale traitée dans le navigateur, en secondes (calcul dans un Web Worker). */
export const MAX_CORRECTION_SECONDS = 60;
export const ANALYSIS_HOP_SECONDS = 0.005;
const ANALYSIS_WINDOW_SECONDS = 0.04;
/** Fréquence d'analyse visée : suffisante jusqu'à 1 kHz, et quatre fois moins de calcul qu'à 44,1 kHz. */
const ANALYSIS_TARGET_RATE = 11025;
/** En dessous de ce niveau RMS, la trame est traitée comme un silence. */
const SILENCE_RMS = 0.01;
/** Espacement des grains hors des zones voisées, en secondes. */
const UNVOICED_PERIOD_SECONDS = 0.01;

export interface PitchFrame {
  /** Fréquence détectée en hertz, ou `null` si la trame n'est pas voisée. */
  readonly detectedHz: number | null;
  /** Écart appliqué en cents (100 cents = un demi-ton). */
  readonly correctionCents: number;
}

function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor === 1) {
    return samples;
  }
  // Moyenne de `factor` échantillons : filtre passe-bas grossier, suffisant pour la voix.
  const output = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < output.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) {
      sum += samples[i * factor + j];
    }
    output[i] = sum / factor;
  }
  return output;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Écart en cents entre une hauteur et la note autorisée la plus proche. */
export function deviationCents(hz: number, allowedPitchClasses: readonly number[]): number {
  const midi = frequencyToMidi(hz);
  return (nearestAllowedMidi(midi, allowedPitchClasses) - midi) * 100;
}

/** Écart en cents entre une hauteur et la note la plus proche de la gamme. */
export function scaleDeviationCents(hz: number, root: number, scale: ScaleName): number {
  return deviationCents(hz, scalePitchClasses(root, scale));
}

/**
 * Correction visée pour un écart donné : rien sous la tolérance (humanisation),
 * sinon la part `strength` de l'écart.
 */
export function targetCorrectionCents(deviation: number, strength: number, toleranceCents = 0): number {
  return Math.abs(deviation) <= toleranceCents ? 0 : deviation * strength;
}

export function analyzePitch(samples: Float32Array, sampleRate: number, settings: PitchCorrectionSettings): PitchFrame[] {
  const factor = Math.max(1, Math.floor(sampleRate / ANALYSIS_TARGET_RATE));
  const analysisRate = sampleRate / factor;
  const signal = decimate(samples, factor);
  const hop = Math.round(ANALYSIS_HOP_SECONDS * analysisRate);
  const windowLength = Math.round(ANALYSIS_WINDOW_SECONDS * analysisRate);
  const frameCount = Math.ceil(samples.length / (ANALYSIS_HOP_SECONDS * sampleRate));
  // Lissage exponentiel du glissement : coefficient par trame selon retuneMs.
  const smoothing = settings.retuneMs <= 0 ? 1 : 1 - Math.exp(-(ANALYSIS_HOP_SECONDS * 1000) / settings.retuneMs);
  const allowed = targetPitchClasses(settings);
  const transposeCents = (settings.transposeSemitones ?? 0) * 100;

  const frames: PitchFrame[] = [];
  let currentCents = 0;
  for (let index = 0; index < frameCount; index++) {
    const center = index * hop;
    const start = Math.max(0, Math.min(signal.length - windowLength, center - Math.floor(windowLength / 2)));
    const window = signal.subarray(Math.max(0, start), Math.max(0, start) + windowLength);
    const detectedHz = window.length === windowLength && rms(window) >= SILENCE_RMS ? detectPitch(window, analysisRate) : null;
    const targetCents = detectedHz ? targetCorrectionCents(deviationCents(detectedHz, allowed), settings.strength, settings.toleranceCents) : 0;
    currentCents += smoothing * (targetCents - currentCents);
    // La transposition s'ajoute sans lissage : elle déplace toute la voix, voisée ou non.
    frames.push({ detectedHz, correctionCents: currentCents + transposeCents });
  }
  return frames;
}

/**
 * Synthèse TD-PSOLA. `frames` donne pour chaque pas d'analyse la période de la
 * voix et le rapport de transposition ; la durée de sortie égale celle d'entrée.
 */
export function resynthesize(samples: Float32Array, sampleRate: number, frames: readonly PitchFrame[]): Float32Array<ArrayBuffer> {
  const frameSamples = ANALYSIS_HOP_SECONDS * sampleRate;
  const unvoicedPeriod = UNVOICED_PERIOD_SECONDS * sampleRate;
  const frameAt = (position: number) => frames[Math.min(frames.length - 1, Math.max(0, Math.floor(position / frameSamples)))];
  const periodAt = (position: number) => {
    const hz = frameAt(position)?.detectedHz;
    return hz ? sampleRate / hz : unvoicedPeriod;
  };
  const ratioAt = (position: number) => 2 ** ((frameAt(position)?.correctionCents ?? 0) / 1200);

  // Marques d'analyse espacées d'une période de la voix originale.
  const marks: number[] = [];
  for (let position = 0; position < samples.length; position += periodAt(position)) {
    marks.push(Math.round(position));
  }

  const output = new Float32Array(samples.length);
  const weights = new Float32Array(samples.length);
  let markIndex = 0;
  for (let position = 0; position < samples.length; ) {
    while (markIndex + 1 < marks.length && Math.abs(marks[markIndex + 1] - position) <= Math.abs(marks[markIndex] - position)) {
      markIndex++;
    }
    const source = marks[markIndex];
    const halfLength = Math.max(1, Math.round(periodAt(source)));
    const target = Math.round(position);
    for (let k = -halfLength; k <= halfLength; k++) {
      const from = source + k;
      const to = target + k;
      if (from < 0 || from >= samples.length || to < 0 || to >= samples.length) {
        continue;
      }
      const weight = 0.5 + 0.5 * Math.cos((Math.PI * k) / halfLength); // fenêtre de Hann
      output[to] += samples[from] * weight;
      weights[to] += weight;
    }
    // Les grains se rapprochent quand la note monte : nouvel espacement = période / rapport.
    position += periodAt(position) / ratioAt(position);
  }
  for (let i = 0; i < output.length; i++) {
    if (weights[i] > 1e-3) {
      output[i] /= weights[i];
    }
  }
  return output;
}

export interface PitchCorrectionResult {
  readonly output: Float32Array<ArrayBuffer>;
  readonly frames: PitchFrame[];
}

export function correctPitch(samples: Float32Array, sampleRate: number, settings: PitchCorrectionSettings): PitchCorrectionResult {
  if (samples.length > MAX_CORRECTION_SECONDS * sampleRate) {
    throw new RangeError(`Extrait trop long : ${MAX_CORRECTION_SECONDS} s maximum.`);
  }
  const frames = analyzePitch(samples, sampleRate, settings);
  return { output: resynthesize(samples, sampleRate, frames), frames };
}

/** Moyenne de |écart aux notes autorisées| en cents sur les trames voisées, ou `null` sans trame voisée. */
export function meanDeviation(frames: readonly PitchFrame[], allowedPitchClasses: readonly number[]): number | null {
  const voiced = frames.filter(frame => frame.detectedHz !== null);
  if (voiced.length === 0) {
    return null;
  }
  const total = voiced.reduce((sum, frame) => sum + Math.abs(deviationCents(frame.detectedHz!, allowedPitchClasses)), 0);
  return total / voiced.length;
}

/** Moyenne de |écart à la gamme| en cents sur les trames voisées, ou `null` sans trame voisée. */
export function meanScaleDeviation(frames: readonly PitchFrame[], root: number, scale: ScaleName): number | null {
  return meanDeviation(frames, scalePitchClasses(root, scale));
}
