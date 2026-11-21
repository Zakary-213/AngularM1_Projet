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

/** Envoi d'une piste vers un effet partagé : activé ou non, quantité de 0 à 1. */
export interface ProjectFxSend {
  readonly enabled: boolean;
  readonly amount: number;
}

export interface ProjectTrack {
  readonly id: string;
  readonly name: string;
  readonly type: ProjectTrackType;
  readonly color?: string;
  /** Volume du fader en dB (-36 à +6). */
  readonly volumeDb?: number;
  /** Panoramique de -1 (gauche) à 1 (droite). */
  readonly pan?: number;
  readonly mute?: boolean;
  readonly solo?: boolean;
  /** Égaliseur 3 bandes en dB (graves, médiums, aigus). */
  readonly eq?: { readonly lowDb: number; readonly midDb: number; readonly highDb: number };
  /** Envois vers la réverbération et le delay partagés du mixeur (M7) ; absents avant la M7. */
  readonly fx?: { readonly reverb?: ProjectFxSend; readonly delay?: ProjectFxSend };
  /** Prise jouée parmi les clips de la piste (piste Voix). */
  readonly activeClipId?: string;
  readonly clips: readonly ProjectClip[];
}

export interface ProjectDrumRow {
  readonly voice: string;
  readonly steps: readonly boolean[];
  /** Vélocité de chaque pas (0 à 1), depuis la M3 ; absente dans les projets plus anciens. */
  readonly velocities?: readonly number[];
}

/** Note de type MIDI d'un pattern mélodique (M4). */
export interface ProjectNote {
  /** Numéro MIDI (0 à 127 ; 60 = do4). */
  readonly pitch: number;
  /** Début et durée en pas (doubles-croches) depuis le début du pattern. */
  readonly startStep: number;
  readonly durationSteps: number;
  /** De 0 à 1. */
  readonly velocity: number;
}

export interface ProjectPattern {
  readonly id: string;
  readonly name: string;
  /** Kit de sons (`boomBap` ou `trap`), depuis la M3 ; absent dans les projets plus anciens. */
  readonly kit?: string;
  readonly drumRows: readonly ProjectDrumRow[];
  /** Instrument d'un pattern mélodique (`piano`, `synth`, `bass808`, M4) ; absent pour un pattern de batterie. */
  readonly instrument?: string;
  /** Réglages de l'instrument : brillance (0 à 1) et relâchement (0,02 à 2 s). */
  readonly params?: { readonly tone: number; readonly releaseSeconds: number };
  /** Longueur du pattern mélodique en mesures (1, 2 ou 4). */
  readonly bars?: number;
  readonly notes?: readonly ProjectNote[];
}

/** Champs qu'une sauvegarde peut modifier (le serveur ignore tous les autres). */
export interface ProjectContent {
  readonly bpm: number;
  readonly key: ProjectKeySignature;
  readonly tracks: readonly ProjectTrack[];
  readonly patterns: readonly ProjectPattern[];
  /** Volume Master linéaire (0 à 1, 0,8 par défaut). */
  readonly master?: { readonly volume: number };
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
