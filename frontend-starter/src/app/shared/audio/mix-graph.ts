/**
 * Éléments du graphe de mixage partagés par l'écoute et l'export.
 * Gains linéaires (0 à 1) sauf mention contraire ; niveaux affichés en dBFS.
 */

/** Marge sous 0 dBFS pour que plusieurs sources additionnées saturent moins. */
export const MASTER_GAIN = 0.8;
/** Limiteur de sécurité du Master : évite l'écrêtage franc, ne remplace pas un vrai mixage. */
const LIMITER_THRESHOLD_DB = -3;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SECONDS = 0.003;
const LIMITER_RELEASE_SECONDS = 0.1;

/** Crée l'entrée du Master (gain puis limiteur) reliée à la sortie du contexte. */
export function createMasterChain(context: BaseAudioContext): GainNode {
  const input = context.createGain();
  input.gain.value = MASTER_GAIN;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.knee.value = 0;
  limiter.attack.value = LIMITER_ATTACK_SECONDS;
  limiter.release.value = LIMITER_RELEASE_SECONDS;
  input.connect(limiter).connect(context.destination);
  return input;
}

/** Fichier audio placé sur la timeline, relativement au début de la lecture. */
export interface AudioClip {
  readonly buffer: AudioBuffer;
  /** Position du début du fichier par rapport au début du morceau, en secondes (peut être négative). */
  readonly startSeconds: number;
  readonly gain: number;
}

/**
 * Convertit la position d'un clip en arguments de `AudioBufferSourceNode.start()`.
 * Un clip qui commence avant le morceau démarre avec le morceau, son début étant sauté.
 */
export function clipPlacement(songStartTime: number, clipStartSeconds: number): { when: number; offset: number } {
  return clipStartSeconds >= 0
    ? { when: songStartTime + clipStartSeconds, offset: 0 }
    : { when: songStartTime, offset: -clipStartSeconds };
}

export function scheduleClip(
  context: BaseAudioContext,
  output: AudioNode,
  clip: AudioClip,
  songStartTime: number,
): AudioBufferSourceNode {
  const { when, offset } = clipPlacement(songStartTime, clip.startSeconds);
  const source = context.createBufferSource();
  source.buffer = clip.buffer;
  const gain = context.createGain();
  gain.gain.value = clip.gain;
  source.connect(gain).connect(output);
  source.start(when, Math.min(offset, clip.buffer.duration));
  return source;
}

export function gainToDecibels(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}
