import { ScaleName } from '../audio/pitch/musical-scale';

/** Version du format de sauvegarde comprise par ce studio (voir « Contrat d'API »). */
export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_TITLE_MAX_LENGTH = 80;

export type ProjectOrigin = 'create' | 'import';
export type ProjectTrackType = 'drum' | 'instrument' | 'audio' | 'vocal';

export interface ProjectKeySignature {
  /** Fondamentale en demi-tons depuis do (0 à 11). */
  readonly root: number;
  readonly scale: ScaleName;
}

export interface ProjectClip {
  readonly id: string;
  /** Position et durée en temps (beats) : l'arrangement suit les changements de BPM. */
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly offsetSeconds?: number;
  readonly patternId?: string;
  readonly audioFileId?: string;
  /** Nom affiché du clip (ex. nom du fichier importé). */
  readonly label?: string;
}

export interface ProjectTrack {
  readonly id: string;
  readonly name: string;
  readonly type: ProjectTrackType;
  readonly color?: string;
  /** Volume du fader en dB (-36 à +6). */
  readonly volumeDb?: number;
  readonly pan?: number;
  readonly mute?: boolean;
  readonly solo?: boolean;
  /** Égaliseur 3 bandes en dB (graves, médiums, aigus). */
  readonly eq?: { readonly lowDb: number; readonly midDb: number; readonly highDb: number };
  /** Prise jouée parmi les clips de la piste (piste Voix). */
  readonly activeClipId?: string;
  readonly clips: readonly ProjectClip[];
}

export interface ProjectDrumRow {
  readonly voice: string;
  readonly steps: readonly boolean[];
}

export interface ProjectPattern {
  readonly id: string;
  readonly name: string;
  readonly drumRows: readonly ProjectDrumRow[];
}

/** Champs qu'une sauvegarde peut modifier (le serveur ignore tous les autres). */
export interface ProjectContent {
  readonly bpm: number;
  readonly key: ProjectKeySignature;
  readonly tracks: readonly ProjectTrack[];
  readonly patterns: readonly ProjectPattern[];
}

export interface MusicalProject extends ProjectContent {
  readonly id: string;
  readonly ownerId: string;
  readonly formatVersion: number;
  readonly title: string;
  readonly origin: ProjectOrigin;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Élément de la liste « Mes projets » : sans pistes ni patterns complets. */
export interface ProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly origin: ProjectOrigin;
  readonly bpm: number;
  readonly key: ProjectKeySignature;
  readonly trackCount: number;
  readonly formatVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewProject {
  readonly title: string;
  readonly origin: ProjectOrigin;
}
