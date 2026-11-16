import { DrumPattern, voicesAtStep } from './drum-pattern';
import { playDrumHit } from './drum-synth';
import { AudioClip, scheduleClip } from './mix-graph';
import { StepCursor, StepScheduler } from './step-scheduler';

/** Délai entre le clic et la première frappe : laisse le temps de tout programmer. */
export const START_DELAY_SECONDS = 0.1;

/**
 * Lecture synchronisée d'un pattern en boucle et de fichiers audio.
 * Toutes les sources sont datées sur l'horloge du même AudioContext à partir de
 * `startTime` : c'est ce qui les garde alignées, pas les timers de l'interface.
 */
export class PatternTransport {
  private readonly scheduler: StepScheduler;
  private bus: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private songStart: number | null = null;
  /** Pas programmés mais pas encore entendus, pour l'affichage de la tête de lecture. */
  private pendingSteps: StepCursor[] = [];
  private shownStep = -1;

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    pattern: () => DrumPattern,
    bpm: () => number,
  ) {
    this.scheduler = new StepScheduler(
      () => context.currentTime,
      bpm,
      ({ step, time }) => {
        this.pendingSteps.push({ step, time });
        if (this.bus) {
          voicesAtStep(pattern(), step).forEach(voice => playDrumHit(context, this.bus!, voice, time));
        }
      },
    );
  }

  /** Date de début du morceau sur l'horloge audio, ou `null` à l'arrêt. */
  get startTime(): number | null {
    return this.songStart;
  }

  /**
   * Pas audible à la date `now` (horloge audio), ou -1 à l'arrêt. Lit la file des
   * pas programmés : l'affichage reste juste même si le BPM change en cours de lecture.
   */
  stepAt(now: number): number {
    while (this.pendingSteps.length > 0 && this.pendingSteps[0].time <= now) {
      this.shownStep = this.pendingSteps.shift()!.step;
    }
    return this.shownStep;
  }

  play(clips: readonly AudioClip[]): number {
    this.stop();
    // Bus dédié à cette lecture : le déconnecter coupe aussi les frappes déjà programmées.
    this.bus = this.context.createGain();
    this.bus.connect(this.output);
    const startTime = this.context.currentTime + START_DELAY_SECONDS;
    this.sources = clips.map(clip => scheduleClip(this.context, this.bus!, clip, startTime));
    this.scheduler.start(startTime);
    this.songStart = startTime;
    return startTime;
  }

  stop(): void {
    this.scheduler.stop();
    this.sources.forEach(source => {
      source.stop();
      source.disconnect();
    });
    this.sources = [];
    this.bus?.disconnect();
    this.bus = null;
    this.songStart = null;
    this.pendingSteps = [];
    this.shownStep = -1;
  }
}
