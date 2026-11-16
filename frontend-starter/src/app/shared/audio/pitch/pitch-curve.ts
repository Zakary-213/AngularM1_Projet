import { frequencyToMidi } from './musical-scale';
import { PitchFrame } from './pitch-correction';

/** Nombre maximal de points tracés : au-delà, la courbe est sous-échantillonnée. */
const MAX_POINTS = 600;

export interface PitchCurvePaths {
  /** Tracés SVG (attribut `d`) dans un repère 0–width × 0–height. */
  readonly detected: string;
  readonly corrected: string;
  /** Numéros MIDI des bords bas et haut du graphique. */
  readonly minMidi: number;
  readonly maxMidi: number;
}

/**
 * Courbes de hauteur détectée et corrigée sur la durée de la prise. Les trames
 * non voisées interrompent le tracé ; `null` s'il n'y a aucune trame voisée.
 */
export function pitchCurvePaths(frames: readonly PitchFrame[], width: number, height: number): PitchCurvePaths | null {
  const step = Math.max(1, Math.ceil(frames.length / MAX_POINTS));
  const points: { x: number; detected: number; corrected: number }[] = [];
  const gaps = new Set<number>();
  for (let index = 0; index < frames.length; index += step) {
    const frame = frames[index];
    if (frame.detectedHz === null) {
      gaps.add(points.length);
      continue;
    }
    const detected = frequencyToMidi(frame.detectedHz);
    points.push({ x: (index / Math.max(1, frames.length - 1)) * width, detected, corrected: detected + frame.correctionCents / 100 });
  }
  if (points.length === 0) {
    return null;
  }
  const values = points.flatMap(point => [point.detected, point.corrected]);
  const minMidi = Math.floor(Math.min(...values)) - 1;
  const maxMidi = Math.ceil(Math.max(...values)) + 1;
  const y = (midi: number) => height - ((midi - minMidi) / (maxMidi - minMidi)) * height;
  const path = (key: 'detected' | 'corrected') =>
    points
      .map((point, i) => `${i === 0 || gaps.has(i) ? 'M' : 'L'}${point.x.toFixed(1)} ${y(point[key]).toFixed(1)}`)
      .join(' ');
  return { detected: path('detected'), corrected: path('corrected'), minMidi, maxMidi };
}
