import { UserVocalStyle, parseUserStyles } from './vocal-styles';
import { LEGACY_USER_STYLES_KEY } from './voice-correction-state';

/**
 * Styles personnels gardés dans le navigateur : seulement pour la session libre
 * (`/studio`, sans projet) et comme source de migration à l'ouverture d'un projet
 * (avant la M10, les styles n'étaient pas sauvegardés avec le projet).
 */

/** Contenu brut stocké, ou `null` (absent, navigation privée, stockage bloqué). */
export function readStoredUserStylesJson(): string | null {
  try {
    return localStorage.getItem(LEGACY_USER_STYLES_KEY);
  } catch (error) {
    console.warn('[vocal-styles] styles du navigateur illisibles', error);
    return null;
  }
}

export function readStoredUserStyles(): UserVocalStyle[] {
  return parseUserStyles(readStoredUserStylesJson());
}

/** Renvoie `false` si le navigateur refuse l'écriture. */
export function storeUserStyles(styles: readonly UserVocalStyle[]): boolean {
  try {
    localStorage.setItem(LEGACY_USER_STYLES_KEY, JSON.stringify(styles));
    return true;
  } catch (error) {
    console.warn('[vocal-styles] enregistrement dans le navigateur impossible', error);
    return false;
  }
}
