/** Export WAV PCM 16 bits, entrelacé. Sans dépendance : lisible par tous les lecteurs. */

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const PCM_FORMAT = 1;
const INT16_MAX = 0x7fff;
const INT16_MIN_MAGNITUDE = 0x8000;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode des canaux de même longueur (échantillons flottants entre -1 et 1).
 * Les valeurs hors bornes sont écrêtées : l'appelant doit signaler la saturation.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  if (channels.length === 0) {
    throw new RangeError('Au moins un canal est nécessaire');
  }
  const frameCount = channels[0].length;
  if (channels.some(channel => channel.length !== frameCount)) {
    throw new RangeError('Les canaux doivent avoir la même longueur');
  }

  const blockAlign = channels.length * BYTES_PER_SAMPLE;
  const dataBytes = frameCount * blockAlign;
  const view = new DataView(new ArrayBuffer(WAV_HEADER_BYTES + dataBytes));

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame]));
      view.setInt16(offset, sample < 0 ? sample * INT16_MIN_MAGNITUDE : sample * INT16_MAX, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return view.buffer;
}

/** Niveau crête (valeur absolue maximale) : au-delà de 1, l'export est écrêté. */
export function peakLevel(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak;
}

/** Niveau efficace (RMS) d'une trame, entre 0 et 1 : sert à l'indicateur de niveau du micro. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}
