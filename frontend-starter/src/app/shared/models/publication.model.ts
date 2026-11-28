/** Morceau publié renvoyé par l'API /api/publications (#80). */
export interface Publication {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly author: { readonly id: string; readonly name: string };
  readonly bpm: number;
  /** Tonalité du projet au moment de la publication (root : 0 = Do … 11 = Si). */
  readonly key: { readonly root: number; readonly scale: 'major' | 'minor' };
  readonly durationSeconds: number;
  readonly mimeType: string;
  readonly size: number;
  readonly createdAt: string;
}

/** Champs saisis dans le formulaire « Publier le son ». */
export interface PublicationDraft {
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
}

/** Limites partagées avec le backend (src/models/Publication.js, src/routes/publications.js). */
export const PUBLICATION_LIMITS = Object.freeze({
  titleMaxLength: 80,
  descriptionMaxLength: 500,
  /** 60 Mo : environ 5 min 56 s de WAV stéréo 16 bits à 44,1 kHz. */
  maxBytes: 60 * 1024 * 1024,
});
