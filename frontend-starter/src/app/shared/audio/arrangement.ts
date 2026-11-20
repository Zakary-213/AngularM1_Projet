import { MAX_SONG_BARS } from './timeline-position';

/**
 * Arrangement de la piste Batterie : le pattern d'une mesure joue en boucle à
 * l'intérieur de chaque clip. Positions et longueurs en mesures (4/4), 0-indexées.
 * Données sérialisables : les fonctions renvoient un nouveau tableau.
 */

export interface DrumClip {
  readonly id: string;
  readonly startBar: number;
  readonly lengthBars: number;
}

export const MAX_DRUM_CLIPS = 64;
export const MAX_DRUM_CLIP_BARS = 32;
/** Longueur d'un clip ajouté à la main, en mesures. */
export const NEW_DRUM_CLIP_BARS = 4;
/** Arrangement par défaut : 8 mesures de batterie depuis le début. */
export const DEFAULT_DRUM_CLIPS: readonly DrumClip[] = [{ id: 'drums-1', startBar: 0, lengthBars: 8 }];

export function createDrumClipId(): string {
  return `drums-${crypto.randomUUID()}`;
}

function clampStart(startBar: number, lengthBars: number): number {
  return Math.min(MAX_SONG_BARS - lengthBars, Math.max(0, Math.round(startBar)));
}

function sorted(clips: readonly DrumClip[]): DrumClip[] {
  return [...clips].sort((a, b) => a.startBar - b.startBar || a.id.localeCompare(b.id));
}

/** La batterie joue-t-elle à la mesure `bar` (0-indexée) ? */
export function isDrumBarActive(clips: readonly DrumClip[], bar: number): boolean {
  return clips.some(clip => bar >= clip.startBar && bar < clip.startBar + clip.lengthBars);
}

export function drumClipsEndBar(clips: readonly DrumClip[]): number {
  return clips.reduce((end, clip) => Math.max(end, clip.startBar + clip.lengthBars), 0);
}

export function moveDrumClip(clips: readonly DrumClip[], id: string, deltaBars: number): DrumClip[] {
  return sorted(clips.map(clip => (clip.id === id ? { ...clip, startBar: clampStart(clip.startBar + deltaBars, clip.lengthBars) } : clip)));
}

/** Allonge ou raccourcit un clip par la fin (au moins une mesure). */
export function resizeDrumClip(clips: readonly DrumClip[], id: string, deltaBars: number): DrumClip[] {
  return clips.map(clip => {
    if (clip.id !== id) {
      return clip;
    }
    const maxLength = Math.min(MAX_DRUM_CLIP_BARS, MAX_SONG_BARS - clip.startBar);
    return { ...clip, lengthBars: Math.min(maxLength, Math.max(1, Math.round(clip.lengthBars + deltaBars))) };
  });
}

/** Copie placée juste après l'original ; `null` si la limite de clips ou la fin du morceau est atteinte. */
export function duplicateDrumClip(clips: readonly DrumClip[], id: string, newId: string): DrumClip[] | null {
  const source = clips.find(clip => clip.id === id);
  if (!source || clips.length >= MAX_DRUM_CLIPS || source.startBar + 2 * source.lengthBars > MAX_SONG_BARS) {
    return null;
  }
  return sorted([...clips, { id: newId, startBar: source.startBar + source.lengthBars, lengthBars: source.lengthBars }]);
}

export function addDrumClip(clips: readonly DrumClip[], startBar: number, newId: string): DrumClip[] | null {
  if (clips.length >= MAX_DRUM_CLIPS) {
    return null;
  }
  return sorted([...clips, { id: newId, startBar: clampStart(startBar, NEW_DRUM_CLIP_BARS), lengthBars: NEW_DRUM_CLIP_BARS }]);
}

export function removeDrumClip(clips: readonly DrumClip[], id: string): DrumClip[] {
  return clips.filter(clip => clip.id !== id);
}

/**
 * Historique Annuler / Rétablir d'états sérialisables. `record(avant)` est appelé
 * avant chaque modification ; une nouvelle modification efface les états rétablissables.
 */
export class UndoHistory<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 50) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  record(before: T): void {
    this.past.push(before);
    if (this.past.length > this.limit) {
      this.past.shift();
    }
    this.future = [];
  }

  /** Renvoie l'état à restaurer, ou `null` ; `current` devient rétablissable. */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) {
      return null;
    }
    this.future.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) {
      return null;
    }
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
