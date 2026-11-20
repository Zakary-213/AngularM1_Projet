import mongoose from "mongoose";

/*
 * Format de sauvegarde d'un projet musical (version 1), défini en M0 et
 * utilisé par les routes /api/projects de M1.
 *
 * Unités : positions et durées des clips en temps (beats), pour qu'un
 * changement de BPM conserve l'arrangement ; décalage dans un fichier audio
 * en secondes ; volume de piste en dB (fader du studio, -36 à +6) ; volume
 * Master linéaire de 0 à 1 ; panoramique de -1 (gauche) à 1.
 * Les octets audio ne sont jamais stockés ici : un clip audio référence un
 * document Track (audioFileId) dont le fichier reste sur le disque.
 */

export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_LIMITS = Object.freeze({
  titleMaxLength: 80,
  minBpm: 60,
  maxBpm: 200,
  maxTracks: 16,
  maxClipsPerTrack: 256,
  maxPatterns: 64,
  stepsPerPattern: 16,
  maxNotesPerPattern: 512,
  minTrackDb: -36,
  maxTrackDb: 6,
});

export const TRACK_TYPES = ["drum", "instrument", "audio", "vocal"];
export const DRUM_VOICES = ["kick", "snare", "hihat"];
// Mêmes gammes que la correction vocale du studio (musical-scale.ts).
export const SCALES = ["major", "minor", "harmonicMinor", "phrygianDominant"];

const L = PROJECT_LIMITS;
// Identifiants générés par le client (UUID) : stables entre sauvegardes et reconnexions.
const stableId = { type: String, required: true, match: /^[A-Za-z0-9_-]{1,64}$/ };
const maxItems = (max) => ({
  validator: (items) => items.length <= max,
  message: `${max} éléments maximum`,
});

const keySchema = new mongoose.Schema(
  {
    // Note fondamentale en demi-tons depuis do (0 = do, 9 = la).
    root: { type: Number, required: true, min: 0, max: 11, validate: Number.isInteger },
    scale: { type: String, required: true, enum: SCALES },
  },
  { _id: false },
);

const pitchCorrectionSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    // Part de l'écart corrigée (0 = aucune, 1 = note exacte).
    strength: { type: Number, default: 0.6, min: 0, max: 1 },
    // Temps de glissement vers la note cible, en millisecondes.
    retuneMs: { type: Number, default: 80, min: 0, max: 500 },
  },
  { _id: false },
);

const clipSchema = new mongoose.Schema(
  {
    id: stableId,
    startBeat: { type: Number, required: true, min: 0 },
    durationBeats: { type: Number, required: true, min: 0.25 },
    offsetSeconds: { type: Number, default: 0, min: 0 },
    patternId: { type: String, match: stableId.match },
    audioFileId: { type: mongoose.Schema.Types.ObjectId, ref: "Track" },
    pitchCorrection: { type: pitchCorrectionSchema, default: undefined },
  },
  { _id: false },
);

// Un clip joue soit un pattern, soit un fichier audio, jamais les deux.
clipSchema.pre("validate", function () {
  if (Boolean(this.patternId) === Boolean(this.audioFileId)) {
    this.invalidate("patternId", "Un clip référence soit un pattern, soit un fichier audio");
  }
});

const trackSchema = new mongoose.Schema(
  {
    id: stableId,
    name: { type: String, required: true, trim: true, maxlength: 40 },
    type: { type: String, required: true, enum: TRACK_TYPES },
    color: { type: String, default: "#f5a623", match: /^#[0-9a-fA-F]{6}$/ },
    volumeDb: { type: Number, default: 0, min: L.minTrackDb, max: L.maxTrackDb },
    pan: { type: Number, default: 0, min: -1, max: 1 },
    mute: { type: Boolean, default: false },
    solo: { type: Boolean, default: false },
    clips: { type: [clipSchema], default: [], validate: maxItems(L.maxClipsPerTrack) },
  },
  { _id: false },
);

const drumRowSchema = new mongoose.Schema(
  {
    voice: { type: String, required: true, enum: DRUM_VOICES },
    steps: {
      type: [Boolean],
      validate: {
        validator: (steps) => steps.length === L.stepsPerPattern,
        message: `Une ligne de batterie contient exactement ${L.stepsPerPattern} pas`,
      },
    },
  },
  { _id: false },
);

const noteSchema = new mongoose.Schema(
  {
    pitch: { type: Number, required: true, min: 0, max: 127, validate: Number.isInteger }, // numéro MIDI
    startStep: { type: Number, required: true, min: 0 },
    durationSteps: { type: Number, required: true, min: 1 },
    velocity: { type: Number, default: 0.8, min: 0, max: 1 },
  },
  { _id: false },
);

const patternSchema = new mongoose.Schema(
  {
    id: stableId,
    name: { type: String, required: true, trim: true, maxlength: 40 },
    drumRows: { type: [drumRowSchema], default: [] },
    notes: { type: [noteSchema], default: [], validate: maxItems(L.maxNotesPerPattern) },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    formatVersion: { type: Number, required: true, default: PROJECT_FORMAT_VERSION, enum: [PROJECT_FORMAT_VERSION] },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: L.titleMaxLength },
    // Parcours de départ : « Créer une prod » ou « Importer une prod ».
    origin: { type: String, required: true, enum: ["create", "import"] },
    bpm: { type: Number, required: true, default: 90, min: L.minBpm, max: L.maxBpm },
    // Le studio ne gère que le 4/4 en V1 ; le champ prépare d'autres mesures.
    timeSignature: {
      beatsPerBar: { type: Number, default: 4, enum: [4] },
      beatUnit: { type: Number, default: 4, enum: [4] },
    },
    key: { type: keySchema, default: () => ({ root: 9, scale: "minor" }) },
    tracks: { type: [trackSchema], default: [], validate: maxItems(L.maxTracks) },
    patterns: { type: [patternSchema], default: [], validate: maxItems(L.maxPatterns) },
    master: {
      volume: { type: Number, default: 0.8, min: 0, max: 1 },
    },
    // Incrémentée à chaque sauvegarde : une sauvegarde basée sur une révision
    // dépassée est refusée (409) au lieu d'écraser le travail d'un autre onglet.
    revision: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

schema.index({ ownerId: 1, updatedAt: -1 });

schema.methods.toPublic = function () {
  const { _id, __v, ownerId, ...project } = this.toObject();
  return { id: String(_id), ownerId: String(ownerId), ...project };
};

export const MusicalProject = mongoose.model("MusicalProject", schema);
