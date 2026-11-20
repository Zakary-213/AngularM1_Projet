/**
 * Forme d'onde réduite : pour chaque colonne affichée, l'échantillon minimal et
 * maximal (tous canaux confondus). Calculée une fois par fichier, pas à chaque image.
 */

export interface WaveformPeaks {
  readonly min: Float32Array;
  readonly max: Float32Array;
}

export function computePeaks(channels: readonly Float32Array[], columns: number): WaveformPeaks {
  const count = Math.max(1, Math.floor(columns));
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  const length = channels[0]?.length ?? 0;
  if (length === 0) {
    return { min, max };
  }
  const samplesPerColumn = length / count;
  for (let column = 0; column < count; column++) {
    const start = Math.floor(column * samplesPerColumn);
    const end = Math.max(start + 1, Math.floor((column + 1) * samplesPerColumn));
    let low = 0;
    let high = 0;
    for (const channel of channels) {
      for (let i = start; i < end && i < length; i++) {
        const sample = channel[i];
        if (sample < low) low = sample;
        if (sample > high) high = sample;
      }
    }
    min[column] = low;
    max[column] = high;
  }
  return { min, max };
}
