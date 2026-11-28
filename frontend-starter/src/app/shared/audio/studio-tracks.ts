import { TrackId, VocalTrackId } from './track-mix';
import { DEFAULT_VOICE_CORRECTION, VoiceCorrectionState } from './pitch/voice-correction-state';

/** Présentation fixe des pistes du studio (nom, type, couleur), partagée par la timeline et le mixeur. */
export interface StudioTrackInfo {
  readonly id: TrackId;
  readonly name: string;
  readonly type: string;
  readonly color: string;
  readonly className: string;
}

export const STUDIO_TRACKS: readonly StudioTrackInfo[] = [
  { id: 'drums', name: 'Batterie', type: 'Drum Rack', color: '#c1ed75', className: 'clip-lime' },
  { id: 'melody', name: 'Mélodie', type: 'Piano Roll', color: '#f0a07a', className: 'clip-peach' },
  { id: 'bass', name: 'Basse', type: 'Piano Roll · 808', color: '#e58fb0', className: 'clip-rose' },
  { id: 'instrumental', name: 'Instrumentale', type: 'Audio importé', color: '#bda4fa', className: 'clip-purple' },
  { id: 'voice', name: 'Voix principale', type: 'Prise micro', color: '#8bc8dd', className: 'clip-blue' },
];

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

export function studioTracks(vocalTracks: readonly VocalTrack[]): StudioTrackInfo[] {
  return [
    ...STUDIO_TRACKS.filter(track => track.id !== 'voice'),
    ...vocalTracks.map(({ id, name, color }) => ({ id, name, color, type: 'Prise micro', className: 'clip-blue' })),
  ];
}
