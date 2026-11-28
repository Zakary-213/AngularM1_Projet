import mongoose from "mongoose";

/*
 * Morceau publié (#80) : le mix final d'un projet, séparé du projet éditable.
 * Le fichier audio reste sur le disque du serveur (data/publications) ;
 * storedName est son nom technique, jamais exposé par toPublic().
 * Le projet source reste privé : seul ce mix devient public.
 */

export const PUBLICATION_LIMITS = Object.freeze({
  titleMaxLength: 80,
  descriptionMaxLength: 500,
  /** Durée maximale acceptée, alignée sur l'export du studio (10 minutes). */
  maxDurationSeconds: 600,
});

const keySchema = new mongoose.Schema(
  {
    root: { type: Number, min: 0, max: 11, required: true },
    scale: { type: String, enum: ["major", "minor"], required: true },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "MusicalProject", required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: PUBLICATION_LIMITS.titleMaxLength },
    description: { type: String, trim: true, default: "", maxlength: PUBLICATION_LIMITS.descriptionMaxLength },
    // Tempo et tonalité sont copiés du projet au moment de la publication.
    bpm: { type: Number, required: true, min: 1 },
    key: { type: keySchema, required: true },
    durationSeconds: { type: Number, required: true, min: 0, max: PUBLICATION_LIMITS.maxDurationSeconds },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

// Liste publique (plus récentes d'abord) et liste « Mes publications ».
schema.index({ createdAt: -1 });
schema.index({ authorId: 1, createdAt: -1 });

/**
 * Forme publique d'une publication. `authorName` est fourni par la route
 * (lecture séparée des utilisateurs) pour ne jamais exposer leurs autres champs.
 */
export function publicationToPublic(publication, authorName) {
  return {
    id: String(publication._id),
    title: publication.title,
    description: publication.description ?? "",
    author: { id: String(publication.authorId), name: authorName ?? "Artiste inconnu" },
    bpm: publication.bpm,
    key: { root: publication.key.root, scale: publication.key.scale },
    durationSeconds: publication.durationSeconds,
    mimeType: publication.mimeType,
    size: publication.size,
    createdAt: publication.createdAt,
  };
}

export const Publication = mongoose.model("Publication", schema);
