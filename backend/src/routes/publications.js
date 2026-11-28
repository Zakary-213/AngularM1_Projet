import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { MusicalProject } from "../models/MusicalProject.js";
import { Publication, PUBLICATION_LIMITS, publicationToPublic } from "../models/Publication.js";
import { User } from "../models/User.js";

/*
 * Routes /api/publications (#80).
 * - Lecture publique : liste paginée, détail et écoute du mix publié.
 * - Écriture authentifiée : publier le mix d'un projet dont on est propriétaire,
 *   retirer une de ses publications.
 * Flux d'un envoi : multipart/form-data -> Multer (taille, type, nom généré)
 * -> signature et durée du WAV -> champs texte -> droits sur le projet
 * -> métadonnées MongoDB. Toute étape refusée supprime le fichier reçu.
 */

/** Dossier des mix publiés, séparé des fichiers privés (data/uploads). */
export const PUBLICATIONS_DIR = path.resolve("data/publications");

/**
 * 60 Mo : environ 5 min 56 s de WAV stéréo 16 bits à 44,1 kHz, le format
 * produit par l'export du studio. Le frontend vérifie la même limite avant l'envoi.
 */
export const MAX_PUBLICATION_SIZE = 60 * 1024 * 1024;
const WAV_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave"]);
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
/** Taille lue pour trouver les blocs « fmt » et « data » de l'en-tête WAV. */
const WAV_HEADER_BYTES = 4096;

fs.mkdirSync(PUBLICATIONS_DIR, { recursive: true });

class PublicationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, PUBLICATIONS_DIR),
    // Le nom vient du serveur, jamais du nom de fichier envoyé.
    filename: (_request, _file, callback) => callback(null, `${crypto.randomUUID()}.wav`),
  }),
  limits: { fileSize: MAX_PUBLICATION_SIZE, files: 1, fields: 5 },
  fileFilter: (_request, file, callback) => {
    if (WAV_TYPES.has(file.mimetype)) return callback(null, true);
    console.warn(`[publications] Type refusé : ${file.mimetype}`);
    return callback(new PublicationError(400, "Fichier WAV requis"));
  },
});

/** Reçoit le champ « audio » et transforme les erreurs Multer en réponses claires. */
function receiveAudio(req, res, next) {
  upload.single("audio")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      console.warn("[publications] Fichier trop lourd");
      return res.status(413).json({ message: `Morceau trop lourd (${MAX_PUBLICATION_SIZE / 1024 / 1024} Mo maximum)` });
    }
    if (error instanceof PublicationError) return res.status(error.status).json({ message: error.message });
    if (error instanceof multer.MulterError) return res.status(400).json({ message: "Envoi du formulaire invalide" });
    return next(error);
  });
}

/**
 * Lit l'en-tête RIFF/WAVE et renvoie la durée en secondes, ou null si le
 * fichier n'est pas un WAV PCM lisible. Le type annoncé par le navigateur ne suffit pas.
 */
export async function wavDurationSeconds(filePath, fileSize) {
  const handle = await fsPromises.open(filePath, "r");
  try {
    const header = Buffer.alloc(Math.min(WAV_HEADER_BYTES, fileSize));
    await handle.read(header, 0, header.length, 0);
    if (header.length < 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      return null;
    }
    let byteRate = 0;
    let offset = 12;
    while (offset + 8 <= header.length) {
      const id = header.toString("ascii", offset, offset + 4);
      const size = header.readUInt32LE(offset + 4);
      const body = offset + 8;
      if (id === "fmt " && body + 12 <= header.length) {
        byteRate = header.readUInt32LE(body + 8);
      } else if (id === "data") {
        if (byteRate <= 0) return null;
        // Taille réelle si l'en-tête annonce plus que le fichier (rendu interrompu).
        const dataBytes = Math.min(size, fileSize - body);
        return dataBytes > 0 ? dataBytes / byteRate : null;
      }
      offset = body + size + (size % 2);
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function removeFile(filePath) {
  try {
    await fsPromises.unlink(filePath);
    console.log(`[publications] Fichier supprimé : ${path.basename(filePath)}`);
  } catch (error) {
    // Pas de catch vide : un fichier orphelin doit rester visible dans les logs.
    console.error(`[publications] Fichier non supprimé : ${path.basename(filePath)}`, error);
  }
}

function textField(value, { name, max, required }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && text.length === 0) throw new PublicationError(400, `${name} requis`);
  if (text.length > max) throw new PublicationError(400, `${name} : ${max} caractères maximum`);
  return text;
}

function pagination(query) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.limit)) || DEFAULT_PAGE_SIZE));
  return { page, limit };
}

/** Ajoute le nom des auteurs (seul champ utilisateur exposé). */
async function withAuthors(publications) {
  const ids = [...new Set(publications.map((publication) => String(publication.authorId)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("name").lean() : [];
  const names = new Map(users.map((user) => [String(user._id), user.name]));
  return publications.map((publication) => publicationToPublic(publication, names.get(String(publication.authorId))));
}

async function page(filter, query) {
  const { page: current, limit } = pagination(query);
  const [items, total] = await Promise.all([
    Publication.find(filter).sort({ createdAt: -1 }).skip((current - 1) * limit).limit(limit).lean(),
    Publication.countDocuments(filter),
  ]);
  return { items: await withAuthors(items), page: current, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function createPublicationRouter(auth) {
  const router = express.Router();

  /** Liste publique des morceaux publiés par tous les utilisateurs. */
  router.get("/", async (req, res, next) => {
    try {
      const result = await page({}, req.query);
      console.log(`[publications] Liste publique : ${result.items.length} sur ${result.total}`);
      res.json(result);
    } catch (error) {
      console.error("[publications] Erreur de lecture de la liste", error);
      next(error);
    }
  });

  /** Publications de l'utilisateur connecté (déclarée avant /:id). */
  router.get("/mine", auth, async (req, res, next) => {
    try {
      const result = await page({ authorId: req.auth.sub }, req.query);
      console.log(`[publications] ${result.total} publication(s) de ${req.auth.sub}`);
      res.json(result);
    } catch (error) {
      console.error("[publications] Erreur de lecture de mes publications", error);
      next(error);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Publication inconnue" });
      const publication = await Publication.findOne({ _id: req.params.id }).lean();
      if (!publication) return res.status(404).json({ message: "Publication inconnue" });
      const [item] = await withAuthors([publication]);
      res.json(item);
    } catch (error) {
      console.error("[publications] Erreur de lecture d'une publication", error);
      next(error);
    }
  });

  /** Écoute publique du mix publié ; sendFile gère les requêtes Range (avance rapide). */
  router.get("/:id/audio", async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Publication inconnue" });
      const publication = await Publication.findOne({ _id: req.params.id }).select("+storedName");
      if (!publication) return res.status(404).json({ message: "Publication inconnue" });
      res.type(publication.mimeType);
      res.set("X-Content-Type-Options", "nosniff");
      res.sendFile(path.join(PUBLICATIONS_DIR, publication.storedName), (error) => {
        if (error) {
          console.error(`[publications] Erreur d'envoi audio ${publication.id}`, error);
          if (!res.headersSent) next(error);
        }
      });
    } catch (error) {
      console.error("[publications] Erreur de préparation de l'écoute", error);
      next(error);
    }
  });

  /** Publie le mix (champ audio, WAV) d'un projet de l'utilisateur connecté. */
  router.post("/", auth, receiveAudio, async (req, res, next) => {
    if (!req.file) {
      console.warn(`[publications] Envoi sans fichier par ${req.auth.sub}`);
      return res.status(400).json({ message: "Fichier audio requis" });
    }
    const storedPath = path.join(PUBLICATIONS_DIR, req.file.filename);
    try {
      const title = textField(req.body?.title, { name: "Titre", max: PUBLICATION_LIMITS.titleMaxLength, required: true });
      const description = textField(req.body?.description, { name: "Description", max: PUBLICATION_LIMITS.descriptionMaxLength, required: false });
      const projectId = req.body?.projectId;
      if (!mongoose.isValidObjectId(projectId)) throw new PublicationError(400, "Projet requis");

      const durationSeconds = await wavDurationSeconds(storedPath, req.file.size);
      if (durationSeconds === null) throw new PublicationError(400, "Le fichier n'est pas un WAV valide");
      if (durationSeconds > PUBLICATION_LIMITS.maxDurationSeconds) {
        throw new PublicationError(400, `Morceau trop long (${PUBLICATION_LIMITS.maxDurationSeconds / 60} minutes maximum)`);
      }

      // Le projet d'un autre utilisateur répond comme un projet inexistant.
      const project = await MusicalProject.findOne({ _id: projectId, ownerId: req.auth.sub }).select("bpm key").lean();
      if (!project) throw new PublicationError(404, "Projet inconnu");

      const publication = await Publication.create({
        authorId: req.auth.sub,
        projectId,
        title,
        description,
        bpm: project.bpm,
        key: { root: project.key?.root ?? 9, scale: project.key?.scale ?? "minor" },
        durationSeconds: Math.round(durationSeconds * 100) / 100,
        storedName: req.file.filename,
        mimeType: "audio/wav",
        size: req.file.size,
      });
      const author = await User.findById(req.auth.sub).select("name").lean();
      console.log(`[publications] Publication créée : ${publication.id} (${Math.round(durationSeconds)} s)`);
      res.status(201).json(publicationToPublic(publication, author?.name));
    } catch (error) {
      await removeFile(storedPath);
      if (error instanceof PublicationError) {
        console.warn(`[publications] Publication refusée : ${error.message}`);
        return res.status(error.status).json({ message: error.message });
      }
      console.error("[publications] Erreur pendant la publication", error);
      next(error);
    }
  });

  /** Retire une publication de l'utilisateur connecté et supprime son fichier. */
  router.delete("/:id", auth, async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Publication inconnue" });
      const publication = await Publication.findOneAndDelete({ _id: req.params.id, authorId: req.auth.sub }).select("+storedName");
      if (!publication) {
        console.warn(`[publications] Retrait impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Publication inconnue" });
      }
      await removeFile(path.join(PUBLICATIONS_DIR, publication.storedName));
      console.log(`[publications] Publication retirée : ${publication.id}`);
      res.status(204).end();
    } catch (error) {
      console.error("[publications] Erreur pendant le retrait", error);
      next(error);
    }
  });

  return router;
}
