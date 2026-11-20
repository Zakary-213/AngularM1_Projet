import express from "express";
import mongoose from "mongoose";
import { MusicalProject, PROJECT_FORMAT_VERSION, PROJECT_LIMITS } from "../models/MusicalProject.js";
import { Track } from "../models/Track.js";

/*
 * Routes /api/projects (M1). Chaque requête est authentifiée et chaque accès
 * filtre sur ownerId = utilisateur du JWT : un projet d'un autre utilisateur
 * répond exactement comme un projet inexistant (404).
 */

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
/** Champs qu'un client peut écrire lors d'une sauvegarde (liste blanche). */
const EDITABLE_FIELDS = ["title", "bpm", "key", "tracks", "patterns", "master"];
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
      (tracks ?? []).flatMap((track) => (track.clips ?? []).map((clip) => clip.audioFileId).filter(Boolean)).map(String),
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
        console.warn(`[projects] ${context} refusé (${error.status}) : ${error.message}`);
        return res.status(error.status).json({ message: error.message, ...error.extra });
      }
      // Les erreurs de validation Mongoose sont journalisées et traduites en 400 par le gestionnaire central.
      if (error?.name !== "ValidationError") {
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
      if (existing.formatVersion !== PROJECT_FORMAT_VERSION) {
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
