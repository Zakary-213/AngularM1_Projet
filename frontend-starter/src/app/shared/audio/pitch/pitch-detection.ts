/**
 * Détection de la fréquence fondamentale par l'algorithme YIN
 * (de Cheveigné et Kawahara, 2002). Renvoie des hertz, ou `null` pour une
 * trame non voisée (souffle, consonne, silence).
 */

/** Tessiture recherchée : voix parlée grave à voix chantée aiguë. */
export const MIN_VOICE_HZ = 70;
export const MAX_VOICE_HZ = 1000;
/** Seuil de YIN : plus il est bas, plus la détection est stricte. */
const YIN_THRESHOLD = 0.15;

export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  minHz = MIN_VOICE_HZ,
  maxHz = MAX_VOICE_HZ,
): number | null {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2));
  if (tauMax <= tauMin) {
    return null;
  }
  const window = frame.length - tauMax;

  // Différence cumulée normalisée d'(tau).
  const normalized = new Float32Array(tauMax + 1);
  normalized[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let difference = 0;
    for (let i = 0; i < window; i++) {
      const delta = frame[i] - frame[i + tau];
      difference += delta * delta;
    }
    runningSum += difference;
    normalized[tau] = runningSum > 0 ? (difference * tau) / runningSum : 1;
  }

  for (let tau = tauMin; tau < tauMax; tau++) {
    if (normalized[tau] < YIN_THRESHOLD) {
      while (tau + 1 < tauMax && normalized[tau + 1] < normalized[tau]) {
        tau++;
      }
      // Interpolation parabolique autour du minimum pour une précision sous l'échantillon.
      const previous = normalized[tau - 1];
      const next = normalized[tau + 1];
      const denominator = previous + next - 2 * normalized[tau];
      const refinedTau = denominator !== 0 ? tau + (previous - next) / (2 * denominator) : tau;
      return sampleRate / refinedTau;
    }
  }
  return null;
}
