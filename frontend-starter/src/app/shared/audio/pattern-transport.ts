import { DrumPattern, hitsAtStep } from './drum-pattern';
import { DrumSound } from './drum-synth';
import { playDrumHit } from './drum-synth';
import { playInstrumentNote } from './instrument-synth';
import { playMetronomeClick } from './metronome';
import { TrackClip, scheduleClip } from './mix-graph';
import { MixLevels, MixerGraph } from './mixer-graph';
import { STEPS_PER_BEAT, stepDurationSeconds } from './music-time';
import { ScheduledNote } from './note-scheduling';
import { LoopRange, StepCursor, StepScheduler } from './step-scheduler';
import { MixerState } from './track-mix';

/** Délai entre le clic et la première frappe : laisse le temps de tout programmer. */
export const START_DELAY_SECONDS = 0.1;

export type { TrackClip } from './mix-graph';

export interface PlayOptions {
  readonly clips: readonly TrackClip[];
  /** Réglages du mixeur au démarrage (modifiables ensuite avec `applyMix`). */
  readonly mixer: MixerState;
  /** Volume Master linéaire (0 à 1). */
  readonly masterVolume: number;
  /** Pas absolu de départ : 0 au début du morceau, sinon reprise après une pause. */
  readonly fromSongStep?: number;
  /** Plage jouée en boucle ; le départ doit se trouver dans la plage. */
  readonly loop?: LoopRange | null;
}

/**
 * Lecture synchronisée des patterns (batterie et instruments du Piano Roll) et de fichiers audio.
 * Toutes les sources sont datées sur l'horloge du même AudioContext à partir de
 * la date de démarrage : c'est ce qui les garde alignées, pas les timers de l'interface.
 * Chaque piste passe par sa tranche du mixeur (`MixerGraph`), réglable pendant la lecture ;
 * le métronome, lui, contourne le mixeur et sort par `output` (préécoutes).
 */
export class PatternTransport {
  private readonly scheduler: StepScheduler;
  /** Bus du métronome pour cette lecture : le déconnecter coupe aussi les clics déjà programmés. */
  private bus: GainNode | null = null;
  /** Mixeur de la lecture en cours (recréé à chaque lecture, comme les sources). */
  private graph: MixerGraph | null = null;
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
    /** Notes des pistes Mélodie et Basse qui commencent à ce pas absolu (M4). */
    notesAt: (songStep: number) => readonly ScheduledNote[] = () => [],
  ) {
    this.scheduler = new StepScheduler(
      () => context.currentTime,
      bpm,
      cursor => {
        this.pendingSteps.push(cursor);
        if (cursor.wrapped && this.loop) {
          this.scheduleLoopPass(cursor.time);
        }
        const drums = this.graph?.trackInputs.drums;
        const playing = drums ? drumsAt(cursor.songStep) : null;
        if (drums && playing) {
          hitsAtStep(playing.pattern, cursor.step).forEach(hit => playDrumHit(context, drums, hit.voice, cursor.time, hit.velocity, playing.sound));
        }
        const stepSeconds = stepDurationSeconds(bpm());
        for (const note of notesAt(cursor.songStep)) {
          const output = this.graph?.trackInputs[note.track];
          if (output) {
            playInstrumentNote(context, output, note.instrument, note.pitch, cursor.time, note.durationSteps * stepSeconds, note.velocity, note.params);
          }
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

  play({ clips, mixer, masterVolume, fromSongStep = 0, loop = null }: PlayOptions, bpm: number): number {
    this.stop();
    this.bus = this.context.createGain();
    this.bus.connect(this.output);
    // Même graphe que l'export ; sa déconnexion à l'arrêt coupe les frappes déjà programmées.
    this.graph = new MixerGraph(this.context, this.context.destination, { mixer, masterVolume, bpm }, true);
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

  /** Applique de nouveaux réglages du mixeur pendant la lecture, sans la relancer. */
  applyMix(mixer: MixerState, masterVolume: number): void {
    this.graph?.apply(mixer, masterVolume);
  }

  /** Recale le delay du mixeur après un changement de BPM. */
  setTempo(bpm: number): void {
    this.graph?.setTempo(bpm);
  }

  /** Crêtes des pistes et du Master pour les vumètres, ou `null` à l'arrêt. */
  readLevels(): MixLevels | null {
    return this.graph?.readLevels() ?? null;
  }

  /**
   * Programme les fichiers audio à partir de la position `fromSeconds` du morceau,
   * joués à la date `when`. En boucle, chaque source s'arrête à la fin de la plage.
   */
  private scheduleClips(when: number, fromSeconds: number): AudioBufferSourceNode[] {
    const loopEndSeconds = this.loop ? this.loop.endStep * stepDurationSeconds(this.playBpm) : null;
    return this.playingClips
      .map(({ track, clip }) => {
        const source = scheduleClip(this.context, this.graph!.trackInputs[track], clip, when, fromSeconds);
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
    this.graph?.disconnect();
    this.graph = null;
    this.songStart = null;
    this.pendingSteps = [];
    this.shownSongStep = -1;
  }
}

