import { midiToFrequency } from './musical-scale';

/**
 * « Voix » de test synthétique, pour essayer la correction sans micro :
 * une mélodie en la mineur volontairement fausse (de -40 à +45 cents), avec
 * vibrato et harmoniques. Ce n'est pas une vraie voix : la qualité perçue sur
 * une prise réelle doit être vérifiée à l'oreille.
 */
const MELODY: readonly { midi: number; detuneCents: number }[] = [
  { midi: 57, detuneCents: 35 }, // la
  { midi: 60, detuneCents: -40 }, // do
  { midi: 62, detuneCents: 45 }, // ré
  { midi: 64, detuneCents: -30 }, // mi
  { midi: 62, detuneCents: 25 }, // ré
  { midi: 60, detuneCents: -35 }, // do
];
const NOTE_SECONDS = 0.5;
const HARMONICS = 8;
const VIBRATO_HZ = 5;
const VIBRATO_CENTS = 15;
const PEAK = 0.4;

export const TEST_VOICE_SECONDS = MELODY.length * NOTE_SECONDS;

export function createTestVoice(sampleRate: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.round(TEST_VOICE_SECONDS * sampleRate));
  const noteLength = Math.round(NOTE_SECONDS * sampleRate);
  const attack = Math.round(0.03 * sampleRate);
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const note = MELODY[Math.min(MELODY.length - 1, Math.floor(i / noteLength))];
    const positionInNote = i % noteLength;
    const vibrato = VIBRATO_CENTS * Math.sin((2 * Math.PI * VIBRATO_HZ * i) / sampleRate);
    phase += (2 * Math.PI * midiToFrequency(note.midi + (note.detuneCents + vibrato) / 100)) / sampleRate;
    let value = 0;
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic++) {
      value += Math.sin(harmonic * phase) / harmonic;
    }
    const envelope = Math.min(1, positionInNote / attack, (noteLength - positionInNote) / attack);
    samples[i] = (PEAK / 2) * value * envelope;
  }
  return samples;
}
