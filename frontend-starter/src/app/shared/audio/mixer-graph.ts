import { createLimiter } from './mix-graph';
import { StereoMeter } from './stereo-meter';
import { createEchoLoop, createReverbConvolver, tempoDelayMs } from './pitch/voice-fx';
import { EqChain, createEqChain } from './three-band-eq';
import { MixerState, TRACK_IDS, TrackId, clampMasterVolume, clampPan, effectiveTrackGains, sendGain } from './track-mix';

/**
 * Graphe du mixeur (M7), construit à l'identique pour l'écoute (AudioContext) et
 * l'export (OfflineAudioContext) : c'est ce qui fait correspondre le WAV au mix entendu.
 *
 *   piste : entrée → égaliseur 3 bandes → fader (volume, mute, solo) → panoramique ─┬→ Master
 *                                                                ├→ envoi réverbération ─┐
 *                                                                └→ envoi delay ─────────┤
 *   effets partagés : réverbération synthétique, delay calé sur le tempo ────────────────┘→ Master
 *   Master : volume → limiteur de sécurité → sortie
 *
 * Les envois sont pris après le fader : une piste muette n'alimente plus les effets.
 * Une seule réverbération et un seul delay pour toutes les pistes : 2 effets au lieu de 10.
 */

/** Durée de la réverbération partagée (décroissance de 60 dB), en secondes : une « pièce » moyenne. */
export const MIXER_REVERB_SECONDS = 1.8;
/** Delay en croche pointée (3/4 de temps), l'écho classique du rap ; suit le BPM. */
export const MIXER_DELAY_DIVISION = 0.75;
/** Part réinjectée à chaque répétition du delay : trois ou quatre échos audibles. */
export const MIXER_DELAY_FEEDBACK = 0.35;
/** Constante de temps des réglages modifiés pendant la lecture : sans claquement, sans retard audible. */
const PARAM_SMOOTHING_SECONDS = 0.015;

export interface MixerGraphSettings {
  readonly mixer: MixerState;
  /** Volume Master linéaire (0 à 1). */
  readonly masterVolume: number;
  readonly bpm: number;
}

/** Crêtes mesurées (amplitude linéaire, 1 = 0 dBFS) ; Master mesuré avant le limiteur. */
export interface MixLevels {
  readonly tracks: Readonly<Record<TrackId, number>>;
  readonly master: number;
}

interface TrackStrip {
  readonly eq: EqChain;
  readonly fader: GainNode;
  readonly panner: StereoPannerNode;
  readonly reverbSend: GainNode;
  readonly delaySend: GainNode;
}

export class MixerGraph {
  /** Entrée de chaque piste, où brancher sources, frappes et notes. */
  readonly trackInputs: Readonly<Record<TrackId, AudioNode>>;
  private readonly strips: Record<TrackId, TrackStrip>;
  private readonly master: GainNode;
  private readonly delay: DelayNode;
  private readonly trackMeters: Partial<Record<TrackId, StereoMeter>> = {};
  private readonly masterMeter: StereoMeter | null = null;
  /** Tous les nœuds créés, pour tout déconnecter à l'arrêt (y compris la boucle du delay). */
  private readonly nodes: AudioNode[] = [];

  constructor(
    private readonly context: BaseAudioContext,
    destination: AudioNode,
    settings: MixerGraphSettings,
    /** Vumètres seulement à l'écoute : inutiles pendant un export. */
    withMeters: boolean,
  ) {
    this.master = context.createGain();
    this.master.gain.value = clampMasterVolume(settings.masterVolume);
    const limiter = createLimiter(context);
    this.master.connect(limiter).connect(destination);

    const reverb = createReverbConvolver(context, MIXER_REVERB_SECONDS);
    reverb.connect(this.master);
    const echo = createEchoLoop(context, tempoDelayMs(settings.bpm, MIXER_DELAY_DIVISION), MIXER_DELAY_FEEDBACK);
    echo.output.connect(this.master);
    this.delay = echo.delay;
    this.nodes.push(this.master, limiter, reverb, echo.delay, echo.output, echo.feedback);

    const gains = effectiveTrackGains(settings.mixer);
    const strips = {} as Record<TrackId, TrackStrip>;
    const inputs = {} as Record<TrackId, AudioNode>;
    for (const id of TRACK_IDS) {
      const mix = settings.mixer[id];
      const eq = createEqChain(context, mix.eq);
      const fader = context.createGain();
      fader.gain.value = gains[id];
      const panner = context.createStereoPanner();
      panner.pan.value = clampPan(mix.pan);
      const reverbSend = context.createGain();
      reverbSend.gain.value = sendGain(mix.reverb);
      const delaySend = context.createGain();
      delaySend.gain.value = sendGain(mix.delay);
      eq.output.connect(fader).connect(panner).connect(this.master);
      panner.connect(reverbSend).connect(reverb);
      panner.connect(delaySend).connect(echo.input);
      this.nodes.push(...eq.nodes, fader, panner, reverbSend, delaySend);
      if (withMeters) {
        this.trackMeters[id] = new StereoMeter(context, panner, this.nodes);
      }
      strips[id] = { eq, fader, panner, reverbSend, delaySend };
      inputs[id] = eq.input;
    }
    this.strips = strips;
    this.trackInputs = inputs;
    if (withMeters) {
      this.masterMeter = new StereoMeter(context, this.master, this.nodes);
    }
  }

  /** Applique de nouveaux réglages pendant la lecture, lissés pour éviter les claquements. */
  apply(mixer: MixerState, masterVolume: number): void {
    const now = this.context.currentTime;
    const gains = effectiveTrackGains(mixer);
    for (const id of TRACK_IDS) {
      const strip = this.strips[id];
      const mix = mixer[id];
      strip.eq.apply(mix.eq);
      strip.fader.gain.setTargetAtTime(gains[id], now, PARAM_SMOOTHING_SECONDS);
      strip.panner.pan.setTargetAtTime(clampPan(mix.pan), now, PARAM_SMOOTHING_SECONDS);
      strip.reverbSend.gain.setTargetAtTime(sendGain(mix.reverb), now, PARAM_SMOOTHING_SECONDS);
      strip.delaySend.gain.setTargetAtTime(sendGain(mix.delay), now, PARAM_SMOOTHING_SECONDS);
    }
    this.master.gain.setTargetAtTime(clampMasterVolume(masterVolume), now, PARAM_SMOOTHING_SECONDS);
  }

  /** Recale le delay sur un nouveau tempo. */
  setTempo(bpm: number): void {
    this.delay.delayTime.setTargetAtTime(tempoDelayMs(bpm, MIXER_DELAY_DIVISION) / 1000, this.context.currentTime, PARAM_SMOOTHING_SECONDS);
  }

  /** Crêtes du dernier bloc analysé, ou `null` si le graphe n'a pas de vumètres. */
  readLevels(): MixLevels | null {
    if (!this.masterMeter) {
      return null;
    }
    const tracks = {} as Record<TrackId, number>;
    for (const id of TRACK_IDS) {
      tracks[id] = this.trackMeters[id]?.peak() ?? 0;
    }
    return { tracks, master: this.masterMeter.peak() };
  }

  /** Coupe le graphe : les sources et frappes déjà programmées n'atteignent plus la sortie. */
  disconnect(): void {
    this.nodes.forEach(node => node.disconnect());
  }
}
