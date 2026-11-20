/**
 * Placement d'un clip dans la fenêtre visible de la timeline, en % de sa largeur.
 * La fenêtre commence au début du morceau et dure `visibleSeconds`.
 */
export interface ClipBox {
  readonly left: number;
  readonly width: number;
}

/** Largeur minimale affichée, pour qu'un clip très court reste cliquable. */
const MIN_CLIP_WIDTH_PERCENT = 1;

/** `null` si le clip est entièrement hors de la fenêtre (avant le début ou après la fin). */
export function layoutClip(startSeconds: number, durationSeconds: number, visibleSeconds: number): ClipBox | null {
  const visibleStart = Math.max(0, startSeconds);
  const end = startSeconds + durationSeconds;
  if (visibleSeconds <= 0 || end <= 0 || visibleStart >= visibleSeconds) {
    return null;
  }
  const left = (100 * visibleStart) / visibleSeconds;
  const width = (100 * (Math.min(end, visibleSeconds) - visibleStart)) / visibleSeconds;
  return { left, width: Math.min(100 - left, Math.max(MIN_CLIP_WIDTH_PERCENT, width)) };
}

/** Nombre d'unités (mesures ou temps) parcourues par un glissement de `deltaPx` sur une piste de `laneWidthPx`. */
export function dragUnits(deltaPx: number, laneWidthPx: number, unitsInWindow: number): number {
  if (laneWidthPx <= 0) {
    return 0;
  }
  return Math.round((deltaPx / laneWidthPx) * unitsInWindow);
}
