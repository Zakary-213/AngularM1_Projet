/// <reference lib="webworker" />
import { PitchFrame, analyzePitch, correctPitch } from './pitch-correction';
import { PitchJobRequest, PitchJobResponse } from './pitch-job';

/**
 * Calcul de la correction hors du thread de l'interface : une prise d'une minute
 * prend plusieurs centaines de millisecondes, l'interface reste fluide et le
 * calcul peut être annulé en terminant le worker.
 */
addEventListener('message', ({ data }: MessageEvent<PitchJobRequest>) => {
  const { id, samples, sampleRate, settings } = data;
  try {
    const started = performance.now();
    const { output, frames } = correctPitch(samples, sampleRate, settings);
    const processingMs = performance.now() - started;
    // Ré-analyse de la sortie, sans correction ni transposition, pour mesurer l'écart restant.
    const afterFrames: PitchFrame[] = analyzePitch(output, sampleRate, { ...settings, strength: 0, transposeSemitones: 0 });
    const response: PitchJobResponse = { id, ok: true, output, frames, afterFrames, processingMs };
    postMessage(response, [output.buffer]);
  } catch (error) {
    const message = error instanceof RangeError ? error.message : 'La correction a échoué.';
    const response: PitchJobResponse = { id, ok: false, message };
    postMessage(response);
  }
});
