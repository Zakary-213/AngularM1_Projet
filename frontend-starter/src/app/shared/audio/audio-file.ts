/** Même limite que l'upload de pistes côté serveur (voir « Contrat d'API »). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const ACCEPTED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'];
const ACCEPTED_EXTENSIONS = ['.mp3', '.wav'];

/** Valeur de l'attribut `accept` du champ fichier. */
export const AUDIO_FILE_ACCEPT = [...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(',');

/** Renvoie un message d'erreur en français, ou `null` si le fichier est acceptable. */
export function validateAudioFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size === 0) {
    return 'Le fichier est vide.';
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return 'Le fichier dépasse 25 Mo.';
  }
  const name = file.name.toLowerCase();
  // Certains systèmes ne renseignent pas le type MIME : l'extension sert alors de repli.
  const typeAccepted = file.type ? ACCEPTED_TYPES.includes(file.type) : false;
  if (!typeAccepted && !ACCEPTED_EXTENSIONS.some(extension => name.endsWith(extension))) {
    return 'Format non pris en charge : choisissez un fichier MP3 ou WAV.';
  }
  return null;
}
