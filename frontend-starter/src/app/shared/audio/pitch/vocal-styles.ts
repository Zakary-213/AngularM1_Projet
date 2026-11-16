import { SCALE_NAMES, SEMITONES_PER_OCTAVE, ScaleName, scalePitchClasses } from './musical-scale';
import { MAX_RETUNE_MS, MAX_TOLERANCE_CENTS, MAX_TRANSPOSE_SEMITONES, PitchCorrectionSettings } from './pitch-correction';
import { FLAT_EQ, VoiceEq, sanitizeEq } from './voice-eq';

/**
 * Préréglages de correction vocale par style. Ce sont des données : nom, phrase
 * d'explication et valeurs de départ, à ajuster à l'écoute. Les noms décrivent un
 * rendu, jamais un artiste.
 */

export type VocalStyleId = 'natural' | 'rap' | 'trap' | 'drill' | 'rai' | 'robot';

export interface VocalStyle {
  readonly id: VocalStyleId;
  readonly name: string;
  readonly description: string;
  /** Intensité à 100 % de dose (0 à 1). */
  readonly strength: number;
  /** Vitesse de recalage à 100 % de dose, en ms. */
  readonly retuneMs: number;
  readonly toleranceCents: number;
  /** Gamme imposée par le style, ou `null` pour garder celle du projet. */
  readonly scale: ScaleName | null;
  readonly eq: VoiceEq;
}

export const VOCAL_STYLES: readonly VocalStyle[] = [
  { id: 'natural', name: 'Naturel', description: 'Voix juste, effet inaudible.', strength: 0.5, retuneMs: 100, toleranceCents: 10, scale: null, eq: FLAT_EQ },
  { id: 'rap', name: 'Rap', description: 'Couplets rappés : un simple lissage, la voix reste parlée.', strength: 0.3, retuneMs: 130, toleranceCents: 15, scale: null, eq: { lowCutHz: 100, bodyDb: 0, presenceDb: 2, airDb: 0 } },
  { id: 'trap', name: 'Trap', description: 'Effet marqué et mélodique, notes nettes.', strength: 1, retuneMs: 5, toleranceCents: 0, scale: 'minor', eq: { lowCutHz: 100, bodyDb: 0, presenceDb: 3, airDb: 4 } },
  { id: 'drill', name: 'Drill', description: 'Voix sombre, correction discrète.', strength: 0.4, retuneMs: 50, toleranceCents: 10, scale: 'minor', eq: { lowCutHz: 80, bodyDb: 3, presenceDb: 0, airDb: -3 } },
  { id: 'rai', name: 'Raï', description: 'Chant ornementé : les mélismes sont gardés, gamme orientale.', strength: 0.6, retuneMs: 80, toleranceCents: 15, scale: 'harmonicMinor', eq: { lowCutHz: 90, bodyDb: 2, presenceDb: 1, airDb: 2 } },
  { id: 'robot', name: 'Robot', description: 'Effet extrême : sauts de note instantanés.', strength: 1, retuneMs: 0, toleranceCents: 0, scale: null, eq: FLAT_EQ },
];

export const DEFAULT_STYLE_ID: VocalStyleId = 'natural';
export const DEFAULT_DOSE = 1;
/** Recalage ajouté quand la dose baisse : à 0 %, le glissement est plus lent de cette valeur. */
const DOSE_RETUNE_SPAN_MS = 150;

/** Tous les réglages appliqués à une prise (style choisi ou personnalisé). */
export interface VoiceSettings extends Required<PitchCorrectionSettings> {
  readonly eq: VoiceEq;
}

export interface ProjectKey {
  readonly root: number;
  readonly scale: ScaleName;
}

export function findStyle(id: VocalStyleId): VocalStyle {
  return VOCAL_STYLES.find(style => style.id === id) ?? VOCAL_STYLES[0];
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Réglages complets d'un style pour une dose (0 à 1) : la dose baisse l'intensité
 * et ralentit le recalage ensemble, dans les proportions du style.
 */
export function styleSettings(style: VocalStyle, dose: number, key: ProjectKey): VoiceSettings {
  const safeDose = clamp(dose, 0, 1, DEFAULT_DOSE);
  const scale = style.scale ?? key.scale;
  return {
    root: key.root,
    scale,
    allowedPitchClasses: scalePitchClasses(key.root, scale),
    strength: style.strength * safeDose,
    retuneMs: Math.min(MAX_RETUNE_MS, Math.round(style.retuneMs + (1 - safeDose) * DOSE_RETUNE_SPAN_MS)),
    toleranceCents: style.toleranceCents,
    transposeSemitones: 0,
    eq: style.eq,
  };
}

/**
 * Valide des réglages venant de l'extérieur (stockage, saisie) : bornes, types,
 * notes autorisées. Renvoie `null` si l'objet est inutilisable.
 */
export function sanitizeVoiceSettings(value: unknown): VoiceSettings | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const scale = SCALE_NAMES.find(name => name === raw['scale']);
  const root = Number(raw['root']);
  if (!scale || !Number.isInteger(root) || root < 0 || root >= SEMITONES_PER_OCTAVE) {
    return null;
  }
  const allowedRaw = Array.isArray(raw['allowedPitchClasses']) ? raw['allowedPitchClasses'] : null;
  const allowed = allowedRaw
    ? [...new Set(allowedRaw.map(Number).filter(pc => Number.isInteger(pc) && pc >= 0 && pc < SEMITONES_PER_OCTAVE))].sort((a, b) => a - b)
    : scalePitchClasses(root, scale);
  const eq = typeof raw['eq'] === 'object' && raw['eq'] !== null ? sanitizeEq(raw['eq'] as Partial<VoiceEq>) : FLAT_EQ;
  return {
    root,
    scale,
    allowedPitchClasses: allowed,
    strength: clamp(Number(raw['strength']), 0, 1, 0.5),
    retuneMs: clamp(Number(raw['retuneMs']), 0, MAX_RETUNE_MS, 100),
    toleranceCents: clamp(Number(raw['toleranceCents']), 0, MAX_TOLERANCE_CENTS, 0),
    transposeSemitones: Math.round(clamp(Number(raw['transposeSemitones']), -MAX_TRANSPOSE_SEMITONES, MAX_TRANSPOSE_SEMITONES, 0)),
    eq,
  };
}

/** Deux réglages produisent-ils le même rendu ? (sert à détecter le passage en « Personnalisé »). */
export function sameSettings(a: VoiceSettings, b: VoiceSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Style personnel enregistré par l'utilisateur. */
export interface UserVocalStyle {
  readonly name: string;
  readonly basedOn: VocalStyleId;
  readonly settings: VoiceSettings;
}

export const MAX_USER_STYLES = 12;
export const MAX_STYLE_NAME_LENGTH = 30;

/** Lit une liste de styles personnels stockée, en ignorant les entrées invalides. */
export function parseUserStyles(json: string | null): UserVocalStyle[] {
  if (!json) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    // Donnée corrompue : on repart d'une liste vide plutôt que de bloquer le panneau.
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  const styles: UserVocalStyle[] = [];
  for (const entry of data.slice(0, MAX_USER_STYLES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const name = typeof raw['name'] === 'string' ? raw['name'].trim().slice(0, MAX_STYLE_NAME_LENGTH) : '';
    const basedOn = VOCAL_STYLES.find(style => style.id === raw['basedOn'])?.id;
    const settings = sanitizeVoiceSettings(raw['settings']);
    if (name && basedOn && settings) {
      styles.push({ name, basedOn, settings });
    }
  }
  return styles;
}
