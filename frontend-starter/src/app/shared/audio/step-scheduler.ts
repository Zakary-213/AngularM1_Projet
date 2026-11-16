import { STEPS_PER_BAR, stepDurationSeconds } from './music-time';

/**
 * Programmation « lookahead » : un timer JavaScript réveille régulièrement le
 * scheduler, mais chaque frappe est datée sur l'horloge AudioContext. Le timer
 * peut donc avoir du retard (onglet chargé) sans décaler le rythme, tant que le
 * retard reste inférieur à la fenêtre d'anticipation.
 */
export const SCHEDULE_AHEAD_SECONDS = 0.1;
export const SCHEDULER_WAKE_MS = 25;

export interface StepCursor {
  /** Index du pas dans la mesure (0 à 15). */
  readonly step: number;
  /** Index absolu du pas depuis le début du morceau (0, 1, … 16 = mesure 2). */
  readonly songStep: number;
  /** Date du pas sur l'horloge audio, en secondes. */
  readonly time: number;
}

/**
 * Liste les pas qui tombent avant `until` et renvoie le curseur suivant.
 * Le BPM est relu à chaque appel : un changement de tempo s'applique au pas suivant.
 */
export function collectDueSteps(
  cursor: StepCursor,
  until: number,
  bpm: number,
): { due: StepCursor[]; next: StepCursor } {
  const due: StepCursor[] = [];
  let next = cursor;
  while (next.time < until) {
    due.push(next);
    next = { step: (next.songStep + 1) % STEPS_PER_BAR, songStep: next.songStep + 1, time: next.time + stepDurationSeconds(bpm) };
  }
  return { due, next };
}

export class StepScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor: StepCursor = { step: 0, songStep: 0, time: 0 };

  constructor(
    private readonly clock: () => number,
    private readonly bpm: () => number,
    private readonly onStep: (cursor: StepCursor) => void,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  /** Démarre au pas absolu `fromSongStep` (0 = début du morceau, sinon reprise après une pause). */
  start(startTime: number, fromSongStep = 0): void {
    this.stop();
    this.cursor = { step: fromSongStep % STEPS_PER_BAR, songStep: fromSongStep, time: startTime };
    this.tick();
    this.timer = setInterval(() => this.tick(), SCHEDULER_WAKE_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const { due, next } = collectDueSteps(this.cursor, this.clock() + SCHEDULE_AHEAD_SECONDS, this.bpm());
    this.cursor = next;
    due.forEach(cursor => this.onStep(cursor));
  }
}
