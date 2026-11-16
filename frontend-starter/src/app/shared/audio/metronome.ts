/**
 * Clic de métronome synthétisé : un bip court sur chaque temps, plus aigu sur le
 * premier temps de la mesure. Il n'est jamais rendu dans l'export.
 */
const ACCENT_HZ = 1760;
const BEAT_HZ = 1320;
const CLICK_PEAK_GAIN = 0.35;
const CLICK_SECONDS = 0.03;
/** Plancher de l'enveloppe : une rampe exponentielle ne peut pas atteindre 0. */
const SILENCE_GAIN = 0.001;

/** Déclenche un clic à la date `time` (secondes, horloge du contexte). */
export function playMetronomeClick(context: BaseAudioContext, output: AudioNode, time: number, accent: boolean): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
  const gain = context.createGain();
  gain.gain.setValueAtTime(CLICK_PEAK_GAIN, time);
  gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, time + CLICK_SECONDS);
  oscillator.connect(gain).connect(output);
  oscillator.start(time);
  oscillator.stop(time + CLICK_SECONDS + 0.01);
}
