import { ScaleName } from '../audio/pitch/musical-scale';
import type { LyricsLine, ProjectLyrics } from './lyrics.model';

/**
 * Version du format de sauvegarde comprise par ce studio (voir « Contrat d'API »).
 * v3 (#64) : prises et réglages vocaux par piste, piste armée. Les projets v1/v2
 * restent lisibles et passent en v3 à leur prochaine sauvegarde.
 */
export const PROJECT_FORMAT_VERSION = 3;
export const PROJECT_TITLE_MAX_LENGTH = 80;

export type ProjectOrigin = 'create' | 'import';
export type ProjectTrackType = 'drum' | 'instrument' | 'audio' | 'vocal';

export interface ProjectKeySignature {
  /** Fondamentale en demi-tons depuis do (0 à 11). */
  readonly root: number;
  readonly scale: ScaleName;
}

export interface ProjectTimeSignature {
  readonly beatsPerBar: number;
  readonly beatUnit: number;
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
  /** Version corrigée d'une prise (fichier dérivé de la bibliothèque, M9/M10). */
  readonly correction?: ProjectTakeCorrection;
}

export interface ProjectTakeCorrection {
  readonly audioFileId: string;
  /** Style appliqué, pour l'affichage. */
  readonly styleLabel?: string;
  /** Version corrigée jouée sur la piste Voix (écoute et export) au lieu de l'originale. */
  readonly enabled?: boolean;
}

/** Réglages complets d'une correction vocale, tels que sauvegardés (VoiceSettings). */
export interface ProjectVoiceSettings {
  readonly root: number;
  readonly scale: ScaleName;
  readonly allowedPitchClasses: readonly number[];
  readonly strength: number;
  readonly retuneMs: number;
  readonly toleranceCents: number;
  readonly transposeSemitones: number;
  readonly eq: { readonly lowCutHz: number; readonly bodyDb: number; readonly presenceDb: number; readonly airDb: number };
  readonly fx: { readonly reverbMix: number; readonly reverbSeconds: number; readonly delayMix: number; readonly delayMs: number; readonly feedback: number };
}

/** Correction vocale du projet (M9) : style choisi, dose, réglages personnalisés et styles personnels. */
export interface ProjectVocal {
  readonly styleId: string;
  /** Dose d'effet de 0 à 1. */
  readonly dose: number;
  readonly userStyleName?: string;
  readonly custom?: ProjectVoiceSettings;
  readonly userStyles?: readonly { readonly name: string; readonly basedOn: string; readonly settings: ProjectVoiceSettings }[];
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
  readonly vocal?: ProjectVocal;
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
  readonly armedVocalTrackId?: string;
  readonly bpm: number;
  readonly key: ProjectKeySignature;
  readonly tracks: readonly ProjectTrack[];
  readonly patterns: readonly ProjectPattern[];
  /** Volume Master linéaire (0 à 1, 0,8 par défaut). */
  readonly master?: { readonly volume: number };
  /** Absente des projets v1. */
  readonly vocal?: ProjectVocal;
  readonly lyrics?: ProjectLyrics;
}

export interface MusicalProject extends ProjectContent {
  readonly id: string;
  readonly ownerId: string;
  readonly formatVersion: number;
  readonly title: string;
  readonly timeSignature?: ProjectTimeSignature;
  readonly lyricsAnalysis?: readonly LyricsLine[];
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
