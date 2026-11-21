/**
 * Vumètres du mixeur (M7) : conversion d'une crête mesurée en position d'affichage
 * et maintien de l'alerte de saturation. Crêtes en amplitude linéaire (1 = 0 dBFS).
 */

/** Bas de l'échelle affichée : en dessous, la barre est vide. */
export const METER_FLOOR_DB = -48;
/**
 * Crête considérée comme une saturation manifeste : 0 dBFS. Sur le Master, elle est
 * mesurée avant le limiteur de sécurité, qui masquerait sinon le dépassement.
 */
export const CLIP_LEVEL = 1;
/** Durée d'affichage de l'alerte après le dernier dépassement : lisible, pas clignotante. */
export const CLIP_HOLD_MS = 1500;

/** Crête absolue d'un bloc d'échantillons. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    const level = Math.abs(sample);
    if (level > peak) {
      peak = level;
    }
  }
  return peak;
}

/** Position de la barre (0 à 1) : échelle en dB entre METER_FLOOR_DB et 0 dBFS. */
export function meterFraction(peak: number): number {
  if (!(peak > 0)) {
    return 0;
  }
  const decibels = 20 * Math.log10(peak);
  return Math.min(1, Math.max(0, (decibels - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

/** Date du dernier dépassement, mise à jour si `peak` sature à la date `now` (ms). */
export function nextClipTime(lastClipAt: number | null, peak: number, now: number): number | null {
  return peak >= CLIP_LEVEL ? now : lastClipAt;
}

export function isClipHeld(lastClipAt: number | null, now: number): boolean {
  return lastClipAt !== null && now - lastClipAt < CLIP_HOLD_MS;
}
