import { TrackId, VocalTrackId } from './track-mix';
import { DEFAULT_VOICE_CORRECTION, VoiceCorrectionState } from './pitch/voice-correction-state';
import type { InstrumentTrackId } from './melodic-pattern';

/** Présentation fixe des pistes du studio (nom, type, couleur), partagée par la timeline et le mixeur. */
export interface StudioTrackInfo {
  readonly id: TrackId;
  readonly name: string;
  readonly type: string;
  readonly color: string;
  readonly className: string;
}

export interface InstrumentTrack {
  readonly id: InstrumentTrackId;
  readonly name: string;
  readonly color: string;
}

export const DEFAULT_INSTRUMENT_TRACKS: readonly InstrumentTrack[] = [
  { id: 'melody', name: 'Mélodie', color: '#f0a07a' },
  { id: 'bass', name: 'Basse', color: '#e58fb0' },
];

export const MAX_STUDIO_TRACKS = 16;
export const INSTRUMENT_TRACK_NAME_MAX_LENGTH = 40;
export const MAX_VOCAL_TRACKS = 8;
export const VOCAL_TRACK_NAME_MAX_LENGTH = 40;

export interface VocalTrack {
  readonly id: VocalTrackId;
  readonly name: string;
  readonly color: string;
  readonly activeTakeId: string | null;
  readonly settings: VoiceCorrectionState;
}

export const DEFAULT_VOCAL_TRACK: VocalTrack = {
  id: 'voice',
  name: 'Voix principale',
  color: '#8bc8dd',
  activeTakeId: null,
  settings: DEFAULT_VOICE_CORRECTION,
};

export function studioTracks(vocalTracks: readonly VocalTrack[], instrumentTracks = DEFAULT_INSTRUMENT_TRACKS): StudioTrackInfo[] {
  return [
    { id: 'drums', name: 'Batterie', type: 'Drum Rack', color: '#c1ed75', className: 'clip-lime' },
    ...instrumentTracks.map(({ id, name, color }) => ({ id, name, color, type: id === 'bass' ? 'Piano Roll · 808' : 'Piano Roll', className: id === 'bass' ? 'clip-rose' : 'clip-peach' })),
    { id: 'instrumental', name: 'Instrumentale', type: 'Audio importé', color: '#bda4fa', className: 'clip-purple' },
    ...vocalTracks.map(({ id, name, color }) => ({ id, name, color, type: 'Prise micro', className: 'clip-blue' })),
  ];
}
