import { DrumPattern, hitsAtStep } from './drum-pattern';
import { DrumSound } from './drum-synth';
import { playDrumHit } from './drum-synth';
import { playMetronomeClick } from './metronome';
import { AudioClip, scheduleClip } from './mix-graph';
import { STEPS_PER_BEAT, stepDurationSeconds } from './music-time';
import { LoopRange, StepCursor, StepScheduler } from './step-scheduler';
import { EqChain, FLAT_THREE_BAND_EQ, ThreeBandEq, createEqChain } from './three-band-eq';
import { TRACK_IDS, TrackId } from './track-mix';

/** Délai entre le clic et la première frappe : laisse le temps de tout programmer. */
export const START_DELAY_SECONDS = 0.1;
/** Constante de temps des changements de volume : évite les claquements sans retard audible. */
const GAIN_SMOOTHING_SECONDS = 0.015;

/** Fichier audio rattaché à une piste du studio (sa piste porte le volume, le mute et le solo). */
export interface TrackClip {
  readonly track: Exclude<TrackId, 'drums'>;
  readonly clip: AudioClip;
}

export interface PlayOptions {
  readonly clips: readonly TrackClip[];
  /** Gains linéaires effectifs de chaque piste au démarrage. */
  readonly gains: Readonly<Record<TrackId, number>>;
  /** Pas absolu de départ : 0 au début du morceau, sinon reprise après une pause. */
  readonly fromSongStep?: number;
  /** Égaliseur de la piste instrumentale au démarrage (neutre par défaut). */
  readonly instrumentalEq?: ThreeBandEq;
  /** Plage jouée en boucle ; le départ doit se trouver dans la plage. */
  readonly loop?: LoopRange | null;
}

/**
 * Lecture synchronisée d'un pattern en boucle et de fichiers audio.
 * Toutes les sources sont datées sur l'horloge du même AudioContext à partir de
 * la date de démarrage : c'est ce qui les garde alignées, pas les timers de l'interface.
 * Chaque piste passe par son propre gain, réglable pendant la lecture.
 */
export class PatternTransport {
  private readonly scheduler: StepScheduler;
  private bus: GainNode | null = null;
  private trackGains: Partial<Record<TrackId, GainNode>> = {};
  /** Entrée de chaque piste : son gain, ou l'égaliseur placé avant lui (instrumentale). */
  private trackInputs: Partial<Record<TrackId, AudioNode>> = {};
  private instrumentalEq: EqChain | null = null;
  private sources: AudioBufferSourceNode[] = [];
  /** Clips et boucle de la lecture en cours, pour reprogrammer les fichiers à chaque tour. */
  private playingClips: readonly TrackClip[] = [];
  private loop: LoopRange | null = null;
  private playBpm = 0;
  private songStart: number | null = null;
  /** Pas programmés mais pas encore entendus, pour l'affichage de la tête de lecture. */
  private pendingSteps: StepCursor[] = [];
  private shownSongStep = -1;

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    /** Pattern et son joués à ce pas absolu (clips de la piste Batterie), ou `null` : batterie silencieuse. */
    drumsAt: (songStep: number) => { readonly pattern: DrumPattern; readonly sound: DrumSound } | null,
    bpm: () => number,
    metronome: () => boolean,
  ) {
    this.scheduler = new StepScheduler(
      () => context.currentTime,
      bpm,
      cursor => {
        this.pendingSteps.push(cursor);
        if (cursor.wrapped && this.loop) {
          this.scheduleLoopPass(cursor.time);
        }
        const drums = this.trackGains.drums;
        const playing = drums ? drumsAt(cursor.songStep) : null;
        if (drums && playing) {
          hitsAtStep(playing.pattern, cursor.step).forEach(hit => playDrumHit(context, drums, hit.voice, cursor.time, hit.velocity, playing.sound));
        }
        // Le métronome contourne les pistes : il n'est ni mixé, ni exporté.
        if (this.bus && metronome() && cursor.step % STEPS_PER_BEAT === 0) {
          playMetronomeClick(context, this.bus, cursor.time, cursor.step === 0);
        }
      },
      () => this.loop,
    );
  }

  /**
   * Date (horloge audio) qui correspond au pas absolu 0 du morceau, ou `null` à l'arrêt.
   * Après une reprise, elle est antérieure au clic sur Lecture.
   */
  get startTime(): number | null {
    return this.songStart;
  }

  /**
   * Pas absolu audible à la date `now` (horloge audio), ou -1 avant le premier pas.
   * Lit la file des pas programmés : l'affichage reste juste même si le BPM change.
   */
  songStepAt(now: number): number {
    while (this.pendingSteps.length > 0 && this.pendingSteps[0].time <= now) {
      this.shownSongStep = this.pendingSteps.shift()!.songStep;
    }
    return this.shownSongStep;
  }

  play({ clips, gains, fromSongStep = 0, instrumentalEq = FLAT_THREE_BAND_EQ, loop = null }: PlayOptions, bpm: number): number {
    this.stop();
    // Bus dédié à cette lecture : le déconnecter coupe aussi les frappes déjà programmées.
    this.bus = this.context.createGain();
    this.bus.connect(this.output);
    for (const id of TRACK_IDS) {
      const gain = this.context.createGain();
      gain.gain.value = gains[id];
      gain.connect(this.bus);
      this.trackGains[id] = gain;
      this.trackInputs[id] = gain;
    }
    this.instrumentalEq = createEqChain(this.context, instrumentalEq);
    this.instrumentalEq.output.connect(this.trackGains.instrumental!);
    this.trackInputs.instrumental = this.instrumentalEq.input;
    const startTime = this.context.currentTime + START_DELAY_SECONDS;
    // Les clips sont placés en secondes : la position de reprise est convertie au tempo courant.
    const fromSeconds = fromSongStep * stepDurationSeconds(bpm);
    this.playingClips = clips;
    this.loop = loop;
    this.playBpm = bpm;
    this.sources = this.scheduleClips(startTime, fromSeconds);
    this.scheduler.start(startTime, fromSongStep);
    this.songStart = startTime - fromSeconds;
    this.shownSongStep = fromSongStep - 1;
    return startTime;
  }

  /** Applique de nouveaux gains de piste pendant la lecture, avec un lissage court. */
  setTrackGains(gains: Readonly<Record<TrackId, number>>): void {
    for (const id of TRACK_IDS) {
      this.trackGains[id]?.gain.setTargetAtTime(gains[id], this.context.currentTime, GAIN_SMOOTHING_SECONDS);
    }
  }

  /** Applique un nouvel égaliseur à l'instrumentale pendant la lecture. */
  setInstrumentalEq(eq: ThreeBandEq): void {
    this.instrumentalEq?.apply(eq);
  }

  /**
   * Programme les fichiers audio à partir de la position `fromSeconds` du morceau,
   * joués à la date `when`. En boucle, chaque source s'arrête à la fin de la plage.
   */
  private scheduleClips(when: number, fromSeconds: number): AudioBufferSourceNode[] {
    const loopEndSeconds = this.loop ? this.loop.endStep * stepDurationSeconds(this.playBpm) : null;
    return this.playingClips
      .map(({ track, clip }) => {
        const source = scheduleClip(this.context, this.trackInputs[track]!, clip, when, fromSeconds);
        if (source && loopEndSeconds !== null) {
          source.stop(when + Math.max(0, loopEndSeconds - fromSeconds));
        }
        if (source) {
          // Libère la référence quand la source a fini de jouer (un tour de boucle en crée de nouvelles).
          source.onended = () => {
            this.sources = this.sources.filter(candidate => candidate !== source);
          };
        }
        return source;
      })
      .filter((source): source is AudioBufferSourceNode => source !== null);
  }

  /** Nouveau tour de boucle : les fichiers repartent du début de la plage, à la date du pas. */
  private scheduleLoopPass(when: number): void {
    const loopStartSeconds = this.loop!.startStep * stepDurationSeconds(this.playBpm);
    this.sources.push(...this.scheduleClips(when, loopStartSeconds));
  }

  stop(): void {
    this.scheduler.stop();
    this.sources.forEach(source => {
      source.stop();
      source.disconnect();
    });
    this.sources = [];
    this.playingClips = [];
    this.loop = null;
    this.bus?.disconnect();
    this.bus = null;
    this.trackGains = {};
    this.trackInputs = {};
    this.instrumentalEq = null;
    this.songStart = null;
    this.pendingSteps = [];
    this.shownSongStep = -1;
  }
}

