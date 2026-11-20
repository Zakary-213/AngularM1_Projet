import { ThreeBandEq, createEqChain, isFlatEq } from './three-band-eq';

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
  /**
   * Égaliseur propre au clip, pour l'export hors ligne. À l'écoute, l'égaliseur
   * est porté par la piste (réglable pendant la lecture) et ce champ reste vide.
   */
  readonly eq?: ThreeBandEq;
}

/**
 * Convertit la position d'un clip en arguments de `AudioBufferSourceNode.start()`.
 * `playStartTime` est la date (horloge audio) à laquelle la lecture démarre et
 * `fromSeconds` la position du morceau à cet instant (0, ou la position de reprise
 * après une pause). Un clip déjà commencé démarre tout de suite, son début étant sauté.
 */
export function clipPlacement(playStartTime: number, clipStartSeconds: number, fromSeconds = 0): { when: number; offset: number } {
  const relative = clipStartSeconds - fromSeconds;
  return relative >= 0 ? { when: playStartTime + relative, offset: 0 } : { when: playStartTime, offset: -relative };
}

export function scheduleClip(
  context: BaseAudioContext,
  output: AudioNode,
  clip: AudioClip,
  playStartTime: number,
  fromSeconds = 0,
): AudioBufferSourceNode | null {
  const { when, offset } = clipPlacement(playStartTime, clip.startSeconds, fromSeconds);
  if (offset >= clip.buffer.duration) {
    // Clip déjà terminé à la position de reprise : rien à jouer.
    return null;
  }
  const source = context.createBufferSource();
  source.buffer = clip.buffer;
  const gain = context.createGain();
  gain.gain.value = clip.gain;
  source.connect(gain);
  if (clip.eq && !isFlatEq(clip.eq)) {
    const chain = createEqChain(context, clip.eq);
    gain.connect(chain.input);
    chain.output.connect(output);
  } else {
    gain.connect(output);
  }
  source.start(when, offset);
  return source;
}

export function gainToDecibels(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}
