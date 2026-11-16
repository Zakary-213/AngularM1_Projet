import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULER_WAKE_MS, StepCursor, StepScheduler, collectDueSteps } from './step-scheduler';

describe('collectDueSteps', () => {
  it('programme les pas de la fenêtre à 120 BPM (un pas = 0,125 s)', () => {
    const { due, next } = collectDueSteps({ step: 0, songStep: 0, time: 1 }, 1.3, 120);
    expect(due).toEqual([
      { step: 0, songStep: 0, time: 1 },
      { step: 1, songStep: 1, time: 1.125 },
      { step: 2, songStep: 2, time: 1.25 },
    ]);
    expect(next).toEqual({ step: 3, songStep: 3, time: 1.375 });
  });

  it('revient au pas 0 après le 16e pas (boucle d’une mesure)', () => {
    const { due, next } = collectDueSteps({ step: 15, songStep: 15, time: 0 }, 0.01, 120);
    expect(due.map(cursor => cursor.step)).toEqual([15]);
    expect(next.step).toBe(0);
    // Le compteur absolu continue : c'est le premier pas de la mesure 2.
    expect(next.songStep).toBe(16);
  });

  it('ne programme rien si le prochain pas est hors de la fenêtre', () => {
    const cursor = { step: 4, songStep: 4, time: 2 };
    expect(collectDueSteps(cursor, 2, 120)).toEqual({ due: [], next: cursor });
  });

  it('ne cumule pas de dérive sur une longue lecture', () => {
    const { next } = collectDueSteps({ step: 0, songStep: 0, time: 0 }, 60, 120);
    // 60 s à 8 pas par seconde : 480 pas exactement, soit 30 mesures.
    expect(next.time).toBeCloseTo(60, 9);
    expect(next.step).toBe(0);
  });
});

describe('StepScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('date les pas sur l’horloge fournie et applique un changement de BPM au pas suivant', () => {
    vi.useFakeTimers();
    let now = 0.05;
    let bpm = 120;
    const played: StepCursor[] = [];
    const scheduler = new StepScheduler(() => now, () => bpm, cursor => played.push(cursor));

    scheduler.start(0.1);
    expect(played).toEqual([{ step: 0, songStep: 0, time: 0.1 }]);

    bpm = 60;
    now = 0.15;
    vi.advanceTimersByTime(SCHEDULER_WAKE_MS);
    expect(played[1]).toEqual({ step: 1, songStep: 1, time: 0.225 });

    scheduler.stop();
    expect(scheduler.running).toBe(false);
    now = 10;
    vi.advanceTimersByTime(SCHEDULER_WAKE_MS * 4);
    expect(played).toHaveLength(2);
  });

  it('reprend au pas absolu demandé après une pause', () => {
    vi.useFakeTimers();
    const played: StepCursor[] = [];
    const scheduler = new StepScheduler(() => 0.05, () => 120, cursor => played.push(cursor));
    scheduler.start(0.1, 18);
    scheduler.stop();
    expect(played[0]).toEqual({ step: 2, songStep: 18, time: 0.1 });
  });
});
