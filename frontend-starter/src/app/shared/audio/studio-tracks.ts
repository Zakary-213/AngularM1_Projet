import { TrackId } from './track-mix';

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
  { id: 'instrumental', name: 'Instrumentale', type: 'Audio importé', color: '#bda4fa', className: 'clip-purple' },
  { id: 'voice', name: 'Voix principale', type: 'Prise micro', color: '#8bc8dd', className: 'clip-blue' },
];
