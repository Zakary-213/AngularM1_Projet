import express from "express";
import mongoose from "mongoose";
import { MusicalProject, PROJECT_FORMAT_VERSION, PROJECT_LIMITS, SUPPORTED_FORMAT_VERSIONS } from "../models/MusicalProject.js";
import { Track } from "../models/Track.js";
import { generateGroqLyrics, LyricsProviderError } from "../services/groq-lyrics.js";

/*
 * Routes /api/projects (M1). Chaque requête est authentifiée et chaque accès
 * filtre sur ownerId = utilisateur du JWT : un projet d'un autre utilisateur
 * répond exactement comme un projet inexistant (404).
 */

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
const MAX_LYRICS_THEME_LENGTH = 200;
const LYRICS_OPTION_VALUES = {
  mood: ["neutral", "dark", "melancholic", "egoTrip", "festive"],
  language: ["fr", "en"],
  structure: ["verse", "chorus", "bridge"],
  measures: [4, 8, 16],
  flow: ["relaxed", "standard", "fast"],
  rhymeScheme: ["AABB", "ABAB", "internal"],
  languageLevel: ["casual", "standard", "formal"],
};
/** Champs qu'un client peut écrire lors d'une sauvegarde (liste blanche). */
const EDITABLE_FIELDS = ["title", "bpm", "key", "tracks", "patterns", "master", "vocal"];
const ORIGINS = ["create", "import"];

class RequestError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      result[field] = source[field];
    }
  }
  return result;
}

function validTitle(value) {
  if (typeof value !== "string") {
    throw new RequestError(400, "Titre requis");
  }
  const title = value.trim();
  if (title.length === 0 || title.length > PROJECT_LIMITS.titleMaxLength) {
    throw new RequestError(400, `Le titre doit contenir entre 1 et ${PROJECT_LIMITS.titleMaxLength} caractères`);
  }
  return title;
}

function validLyricsOptions(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Paramètres de génération requis");
  }
  const theme = typeof body.theme === "string" ? body.theme.trim() : "";
  if (!theme || theme.length > MAX_LYRICS_THEME_LENGTH) {
    throw new RequestError(400, `Le thème doit contenir entre 1 et ${MAX_LYRICS_THEME_LENGTH} caractères`);
  }
  const {
    mood = "neutral", language = "fr", structure = "verse", measures = 8,
    flow = "standard", rhymeScheme = "AABB", languageLevel = "standard",
  } = body;
  const options = { mood, language, structure, measures, flow, rhymeScheme, languageLevel };
  for (const [name, value] of Object.entries(options)) {
    if (!LYRICS_OPTION_VALUES[name].includes(value)) {
      throw new RequestError(400, "Réglage de génération invalide", { field: name });
    }
  }
  return { theme, ...options };
}

/** Résumé affiché dans « Mes projets » : pas de pistes ni de patterns complets. */
function toSummary(project) {
  return {
    id: String(project._id),
    title: project.title,
    origin: project.origin,
    bpm: project.bpm,
    key: project.key,
    trackCount: project.tracks?.length ?? 0,
    formatVersion: project.formatVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** Filtre de propriété : un identifiant invalide ne doit pas atteindre MongoDB. */
function ownedFilter(req) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new RequestError(404, "Projet inconnu");
  }
  return { _id: req.params.id, ownerId: req.auth.sub };
}

/**
 * Un clip audio ne peut référencer qu'un fichier de la bibliothèque de l'utilisateur :
 * sinon un projet pourrait servir à lire le fichier d'un autre compte.
 */
async function assertOwnedAudioFiles(tracks, ownerId) {
  const ids = [
    ...new Set(
      (tracks ?? [])
        // Prise originale et version corrigée : les deux doivent appartenir à l'utilisateur.
        .flatMap((track) => (track.clips ?? []).flatMap((clip) => [clip.audioFileId, clip.correction?.audioFileId]))
        .filter(Boolean)
        .map(String),
    ),
  ];
  if (ids.length === 0) {
    return;
  }
  const owned = await Track.countDocuments({ _id: { $in: ids }, ownerId });
  if (owned !== ids.length) {
    throw new RequestError(400, "Fichier audio inconnu ou non autorisé dans le projet");
  }
}

/** Transforme une erreur connue en réponse JSON, sinon la transmet au gestionnaire central. */
function handle(context, operation) {
  return async (req, res, next) => {
    try {
      await operation(req, res);
    } catch (error) {
      if (error instanceof RequestError) {
        const log = `[projects] ${context} refusé (${error.status})`;
        console.warn(res.locals.lyricsGeneration ? log : `${log} : ${error.message}`);
        return res.status(error.status).json({ message: error.message, ...error.extra });
      }
      // Les erreurs de validation Mongoose sont journalisées et traduites en 400 par le gestionnaire central.
      if (!res.locals.lyricsGeneration && error?.name !== "ValidationError") {
        console.error(`[projects] ${context} : erreur`, error);
      }
      next(error);
    }
  };
}

export function createProjectRouter(auth) {
  const router = express.Router();
  router.use(auth);

  router.get(
    "/",
    handle("liste", async (req, res) => {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
      const filter = { ownerId: req.auth.sub };
      const [items, total] = await Promise.all([
        MusicalProject.find(filter)
          .sort({ updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select("title origin bpm key formatVersion createdAt updatedAt tracks.id")
          .lean(),
        MusicalProject.countDocuments(filter),
      ]);
      console.log(`[projects] ${items.length} projet(s) sur ${total} pour ${req.auth.sub}`);
      res.json({ items: items.map(toSummary), page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
    }),
  );

  router.post(
    "/",
    handle("création", async (req, res) => {
      const body = req.body ?? {};
      if (!ORIGINS.includes(body.origin)) {
        throw new RequestError(400, "Parcours requis : « create » ou « import »");
      }
      const project = await MusicalProject.create({
        ...pick(body, ["bpm", "key"]),
        title: validTitle(body.title),
        origin: body.origin,
        // Jamais lu depuis le corps : le propriétaire est l'utilisateur authentifié.
        ownerId: req.auth.sub,
      });
      console.log(`[projects] Projet créé : ${project.id}`);
      res.status(201).json(project.toPublic());
    }),
  );

  router.get(
    "/:id",
    handle("ouverture", async (req, res) => {
      const project = await MusicalProject.findOne(ownedFilter(req));
      if (!project) {
        throw new RequestError(404, "Projet inconnu");
      }
      res.json(project.toPublic());
    }),
  );

  router.post(
    "/:id/lyrics/generate",
    handle("génération de paroles", async (req, res) => {
      const project = await MusicalProject.findOne(ownedFilter(req)).select("bpm timeSignature key formatVersion");
      if (!project) {
        throw new RequestError(404, "Projet inconnu");
      }
      if (!SUPPORTED_FORMAT_VERSIONS.includes(project.formatVersion)) {
        throw new RequestError(422, "Format de projet non pris en charge par cette version du studio");
      }

      const options = validLyricsOptions(req.body);

      try {
        const { bpm } = project;
        const { beatsPerBar, beatUnit } = project.timeSignature;
        const { root, scale } = project.key;
        const timeSignature = { beatsPerBar, beatUnit };
        const key = { root, scale };
        const { targetSyllables, lines } = await generateGroqLyrics({ userId: req.auth.sub, options, bpm, timeSignature, key });
        res.json({ bpm, timeSignature, key, targetSyllables, lines });
      } catch (error) {
        if (error instanceof LyricsProviderError) {
          const { status, message, retryAfterSeconds } = error;
          if (retryAfterSeconds === undefined) throw new RequestError(status, message);
          res.set("Retry-After", String(retryAfterSeconds));
          throw new RequestError(status, message, { retryAfterSeconds });
        }
        throw error;
      }
    }),
  );

  router.put(
    "/:id",
    handle("sauvegarde", async (req, res) => {
      const filter = ownedFilter(req);
      const body = req.body ?? {};
      if (!Number.isInteger(body.revision) || body.revision < 0) {
        throw new RequestError(400, "Révision requise");
      }
      const existing = await MusicalProject.findOne(filter).lean();
      if (!existing) {
        throw new RequestError(404, "Projet inconnu");
      }
      if (!SUPPORTED_FORMAT_VERSIONS.includes(existing.formatVersion)) {
        // Projet d'une version future : on refuse plutôt que de le réécrire et perdre des données.
        throw new RequestError(422, "Format de projet non pris en charge par cette version du studio");
      }
      if (existing.revision !== body.revision) {
        throw new RequestError(409, "Le projet a été modifié ailleurs depuis son ouverture", { revision: existing.revision });
      }

      // Validation complète (bornes, sous-documents, règle pattern ou audio) avant écriture.
      const fields = pick(body, EDITABLE_FIELDS);
      if (fields.title !== undefined) {
        fields.title = validTitle(fields.title);
      }
      const candidate = new MusicalProject({ ...existing, ...fields });
      await candidate.validate();
      const validated = pick(candidate.toObject(), Object.keys(fields));
      if (validated.tracks) {
        await assertOwnedAudioFiles(validated.tracks, req.auth.sub);
      }

      // Un projet d'une version antérieure est réécrit dans la version courante (les nouveaux champs sont facultatifs).
      validated.formatVersion = PROJECT_FORMAT_VERSION;

      // La condition sur la révision rend l'écriture atomique face à une autre sauvegarde.
      const updated = await MusicalProject.findOneAndUpdate(
        { ...filter, revision: body.revision },
        { $set: validated, $inc: { revision: 1 } },
        { returnDocument: "after" },
      );
      if (!updated) {
        throw new RequestError(409, "Le projet a été modifié ailleurs depuis son ouverture");
      }
      console.log(`[projects] Projet ${updated.id} sauvegardé (révision ${updated.revision})`);
      res.json(updated.toPublic());
    }),
  );

  router.patch(
    "/:id",
    handle("renommage", async (req, res) => {
      const filter = ownedFilter(req);
      const title = validTitle(req.body?.title);
      const updated = await MusicalProject.findOneAndUpdate(
        filter,
        { $set: { title }, $inc: { revision: 1 } },
        { returnDocument: "after" },
      );
      if (!updated) {
        throw new RequestError(404, "Projet inconnu");
      }
      console.log(`[projects] Projet ${updated.id} renommé`);
      res.json(updated.toPublic());
    }),
  );

  router.delete(
    "/:id",
    handle("suppression", async (req, res) => {
      const deleted = await MusicalProject.findOneAndDelete(ownedFilter(req));
      if (!deleted) {
        throw new RequestError(404, "Projet inconnu");
      }
      // Les fichiers audio référencés (Track) appartiennent à la bibliothèque : ils ne sont pas supprimés.
      console.log(`[projects] Projet ${deleted.id} supprimé`);
      res.status(204).end();
    }),
  );

  return router;
}
