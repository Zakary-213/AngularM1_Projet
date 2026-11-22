import { ProjectVocal } from '../../models/musical-project.model';
import { DEFAULT_DOSE, DEFAULT_STYLE_ID, MAX_STYLE_NAME_LENGTH, MAX_USER_STYLES, UserVocalStyle, VOCAL_STYLES, VocalStyleId, VoiceSettings, parseUserStyles, sanitizeVoiceSettings } from './vocal-styles';

/**
 * Réglages de correction vocale d'une session (M9), sauvegardés avec le projet (M10) :
 * style choisi, dose, réglages personnalisés et styles personnels. Les objets audio
 * (version corrigée) n'y figurent pas : la version corrigée est un fichier de la
 * bibliothèque, référencé par la prise (`TakeCorrectionRef`).
 */
export interface VoiceCorrectionState {
  readonly styleId: VocalStyleId;
  /** Dose d'effet de 0 à 1. */
  readonly dose: number;
  /** Style personnel choisi, sinon `null`. */
  readonly userStyleName: string | null;
  /** Réglages modifiés à la main ; `null` tant qu'on suit le style choisi. */
  readonly custom: VoiceSettings | null;
}

export const DEFAULT_VOICE_CORRECTION: VoiceCorrectionState = { styleId: DEFAULT_STYLE_ID, dose: DEFAULT_DOSE, userStyleName: null, custom: null };

/** Ancienne clé du navigateur (styles personnels avant la M10), lue pour la migration. */
export const LEGACY_USER_STYLES_KEY = 'zakat.vocalStyles.v1';

function isStyleId(value: unknown): value is VocalStyleId {
  return VOCAL_STYLES.some(style => style.id === value);
}

/** Section `vocal` du format de sauvegarde. */
export function toProjectVocal(state: VoiceCorrectionState, userStyles: readonly UserVocalStyle[]): ProjectVocal {
  const userStyleName = state.userStyleName && userStyles.some(style => style.name === state.userStyleName) ? state.userStyleName : null;
  return {
    styleId: state.styleId,
    dose: state.dose,
    ...(userStyleName ? { userStyleName } : {}),
    ...(state.custom ? { custom: state.custom } : {}),
    userStyles: userStyles.map(style => ({ name: style.name, basedOn: style.basedOn, settings: style.settings })),
  };
}

/**
 * Lecture tolérante de la section `vocal` : absente (projet v1) ou abîmée, chaque
 * valeur reprend son défaut ; les styles personnels invalides sont ignorés.
 */
export function readProjectVocal(vocal: ProjectVocal | undefined): { state: VoiceCorrectionState; userStyles: UserVocalStyle[] } {
  if (!vocal) {
    return { state: DEFAULT_VOICE_CORRECTION, userStyles: [] };
  }
  // Même validation que les styles stockés dans le navigateur.
  const userStyles = parseUserStyles(JSON.stringify(vocal.userStyles ?? []));
  const dose = Number(vocal.dose);
  const userStyleName = typeof vocal.userStyleName === 'string' && userStyles.some(style => style.name === vocal.userStyleName) ? vocal.userStyleName : null;
  return {
    state: {
      styleId: isStyleId(vocal.styleId) ? vocal.styleId : DEFAULT_STYLE_ID,
      dose: Number.isFinite(dose) ? Math.min(1, Math.max(0, dose)) : DEFAULT_DOSE,
      userStyleName,
      custom: vocal.custom ? sanitizeVoiceSettings(vocal.custom) : null,
    },
    userStyles,
  };
}

/**
 * Migration des styles personnels du navigateur (avant la M10) : un projet qui n'a
 * encore jamais sauvegardé de styles (section absente) reprend ceux du navigateur ;
 * un projet qui en a déjà (même une liste vide) garde les siens.
 */
export function migrateUserStyles(vocal: ProjectVocal | undefined, saved: readonly UserVocalStyle[], legacyJson: string | null): UserVocalStyle[] {
  if (vocal?.userStyles !== undefined) {
    return [...saved];
  }
  return parseUserStyles(legacyJson).slice(0, MAX_USER_STYLES);
}

/** Ajoute ou remplace (même nom) un style personnel ; `null` si la limite est atteinte ou le nom invalide. */
export function upsertUserStyle(styles: readonly UserVocalStyle[], style: UserVocalStyle): UserVocalStyle[] | null {
  const name = style.name.trim();
  if (!name || name.length > MAX_STYLE_NAME_LENGTH) {
    return null;
  }
  const others = styles.filter(other => other.name !== name);
  return others.length >= MAX_USER_STYLES ? null : [...others, { ...style, name }];
}
