import { DrumClip } from './arrangement';
import { PatternEntry } from './drum-pattern';
import { InstrumentTrackId, MelodicPattern, isInstrumentTrackId } from './melodic-pattern';
import { InstrumentClips } from './note-scheduling';

/** Pistes du studio qui peuvent porter du son dans le morceau rendu. */
export type ContentTrack = 'drums' | InstrumentTrackId | 'instrumental' | 'voice';

export const CONTENT_TRACK_LABELS: Readonly<Record<'drums' | 'instrumental' | 'voice', string>> = {
  drums: 'Batterie',
  instrumental: 'Instrumentale',
  voice: 'Voix',
};

export interface SongTracks {
  readonly drumClips: readonly DrumClip[];
  readonly drumPatterns: readonly PatternEntry[];
  readonly instrumentClips: InstrumentClips;
  readonly melodicPatterns: readonly MelodicPattern[];
  readonly hasInstrumental: boolean;
  readonly hasTake: boolean;
}

/**
 * Pistes qui contiennent vraiment quelque chose (#80) : un clip de batterie dont le pattern
 * a au moins une frappe, un clip Mélodie ou Basse dont la partie a au moins une note,
 * une instrumentale importée ou une prise de voix. Une seule suffit pour publier ;
 * un clip vide ne compte pas (il ne produirait que du silence).
 */
export function tracksWithContent(song: SongTracks): ContentTrack[] {
  const tracks: ContentTrack[] = [];
  const drumPatternHasHits = (patternId: string) => {
    const pattern = song.drumPatterns.find(entry => entry.id === patternId);
    return pattern !== undefined && Object.values(pattern.steps).some(row => row.some(velocity => velocity > 0));
  };
  if (song.drumClips.some(clip => drumPatternHasHits(clip.patternId))) {
    tracks.push('drums');
  }
  const melodicHasNotes = (patternId: string) => (song.melodicPatterns.find(pattern => pattern.id === patternId)?.notes.length ?? 0) > 0;
  for (const [track, clips] of Object.entries(song.instrumentClips)) {
    if (isInstrumentTrackId(track) && clips.some(clip => melodicHasNotes(clip.patternId))) {
      tracks.push(track);
    }
  }
  if (song.hasInstrumental) {
    tracks.push('instrumental');
  }
  if (song.hasTake) {
    tracks.push('voice');
  }
  return tracks;
}
