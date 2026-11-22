import mongoose from "mongoose";

/*
 * Format de sauvegarde d'un projet musical, défini en M0 et utilisé par les
 * routes /api/projects de M1. Version 2 (M10) : ajoute la section `vocal`
 * (réglages de correction vocale et styles personnels, M9) et la version
 * corrigée d'une prise (`clips[].correction`). Un projet v1 reste lisible tel
 * quel (ces champs y sont absents) et passe en v2 à sa prochaine sauvegarde.
 *
 * Unités : positions et durées des clips en temps (beats), pour qu'un
 * changement de BPM conserve l'arrangement ; décalage dans un fichier audio
 * en secondes ; volume de piste en dB (fader du studio, -36 à +6) ; volume
 * Master linéaire de 0 à 1 ; panoramique de -1 (gauche) à 1 ; quantité d'envoi
 * vers un effet de 0 à 1.
 * Les octets audio ne sont jamais stockés ici : un clip audio référence un
 * document Track (audioFileId) dont le fichier reste sur le disque.
 */

export const PROJECT_FORMAT_VERSION = 2;
/** Versions que ce serveur sait relire (et réécrire dans la version courante). */
export const SUPPORTED_FORMAT_VERSIONS = Object.freeze([1, 2]);
export const PROJECT_LIMITS = Object.freeze({
  titleMaxLength: 80,
  minBpm: 60,
  maxBpm: 200,
  maxTracks: 16,
  maxClipsPerTrack: 256,
  maxPatterns: 64,
  stepsPerPattern: 16,
  maxNotesPerPattern: 512,
  // Patterns mélodiques (M4) : 1, 2 ou 4 mesures de 16 pas ; relâchement en secondes.
  melodicBarChoices: [1, 2, 4],
  minReleaseSeconds: 0.02,
  maxReleaseSeconds: 2,
  minTrackDb: -36,
  maxTrackDb: 6,
  maxEqDb: 12,
  clipLabelMaxLength: 120,
  // Correction vocale (M9) : mêmes bornes que le studio (pitch-correction.ts, voice-eq.ts, voice-fx.ts).
  maxUserStyles: 12,
  styleNameMaxLength: 30,
  styleLabelMaxLength: 60,
  maxRetuneMs: 300,
  maxToleranceCents: 50,
  maxTransposeSemitones: 12,
  maxLowCutHz: 300,
  minReverbSeconds: 0.3,
  maxReverbSeconds: 5,
  minDelayMs: 50,
  maxDelayMs: 1000,
  maxFeedback: 0.8,
});

export const TRACK_TYPES = ["drum", "instrument", "audio", "vocal"];
// Instruments du Drum Rack (sons synthétisés) ; clap, percussion et 808 depuis la M3.
export const DRUM_VOICES = ["kick", "snare", "clap", "hihat", "perc", "bass808"];
export const DRUM_KITS = ["boomBap", "trap"];
// Instruments du Piano Roll (synthétisés en Web Audio, M4).
export const INSTRUMENTS = ["piano", "synth", "bass808"];
// Mêmes gammes que la correction vocale du studio (musical-scale.ts).
export const SCALES = ["major", "minor", "harmonicMinor", "phrygianDominant"];
// Styles de correction vocale du studio (vocal-styles.ts).
export const VOCAL_STYLE_IDS = ["natural", "rap", "trap", "drill", "rai", "robot"];

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

// Égaliseur 3 bandes d'une piste, en dB (graves, médiums, aigus) ; 0 = neutre.
const eqBand = { type: Number, default: 0, min: -L.maxEqDb, max: L.maxEqDb };
const eqSchema = new mongoose.Schema({ lowDb: eqBand, midDb: eqBand, highDb: eqBand }, { _id: false });

// Envoi d'une piste vers la réverbération ou le delay partagés du mixeur (M7).
// La quantité est conservée quand l'effet est désactivé, pour le retrouver tel quel.
const fxSendSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    amount: { type: Number, default: 0.3, min: 0, max: 1 },
  },
  { _id: false },
);
const fxSchema = new mongoose.Schema(
  {
    reverb: { type: fxSendSchema, default: () => ({}) },
    delay: { type: fxSendSchema, default: () => ({}) },
  },
  { _id: false },
);

// Version corrigée d'une prise (M9/M10) : fichier dérivé dans la bibliothèque ; l'original n'est jamais modifié.
const correctionSchema = new mongoose.Schema(
  {
    audioFileId: { type: mongoose.Schema.Types.ObjectId, ref: "Track", required: true },
    // Style appliqué, pour l'affichage (« Trap », « Personnalisé (basé sur Raï) »).
    styleLabel: { type: String, trim: true, maxlength: L.styleLabelMaxLength, default: "" },
    // Version corrigée jouée sur la piste Voix (écoute et export) au lieu de l'originale.
    enabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const clipSchema = new mongoose.Schema(
  {
    id: stableId,
    // Nom affiché du clip (ex. nom du fichier importé) ; jamais utilisé comme nom de stockage.
    label: { type: String, trim: true, maxlength: L.clipLabelMaxLength },
    startBeat: { type: Number, required: true, min: 0 },
    durationBeats: { type: Number, required: true, min: 0.25 },
    offsetSeconds: { type: Number, default: 0, min: 0 },
    patternId: { type: String, match: stableId.match },
    audioFileId: { type: mongoose.Schema.Types.ObjectId, ref: "Track" },
    pitchCorrection: { type: pitchCorrectionSchema, default: undefined },
    correction: { type: correctionSchema, default: undefined },
  },
  { _id: false },
);

// Un clip joue soit un pattern, soit un fichier audio, jamais les deux.
clipSchema.pre("validate", function () {
  if (Boolean(this.patternId) === Boolean(this.audioFileId)) {
    this.invalidate("patternId", "Un clip référence soit un pattern, soit un fichier audio");
  }
  if (this.correction && !this.audioFileId) {
    this.invalidate("correction", "Seule une prise audio peut avoir une version corrigée");
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
    eq: { type: eqSchema, default: () => ({}) },
    // Absents des projets antérieurs à la M7 : effets désactivés.
    fx: { type: fxSchema, default: () => ({}) },
    // Prise jouée sur une piste qui en contient plusieurs (piste Voix) ; doit désigner un de ses clips.
    activeClipId: { type: String, match: stableId.match },
    clips: { type: [clipSchema], default: [], validate: maxItems(L.maxClipsPerTrack) },
  },
  { _id: false },
);

trackSchema.pre("validate", function () {
  if (this.activeClipId && !this.clips.some((clip) => clip.id === this.activeClipId)) {
    this.invalidate("activeClipId", "La prise active doit être un clip de la piste");
  }
});

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
    // Vélocité de chaque pas, de 0 (silence) à 1 (frappe forte) ; facultative (projets antérieurs à la M3).
    velocities: {
      type: [Number],
      default: undefined,
      validate: {
        validator: (values) =>
          values === undefined ||
          (values.length === L.stepsPerPattern && values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)),
        message: `La vélocité comporte ${L.stepsPerPattern} valeurs entre 0 et 1`,
      },
    },
  },
  { _id: false },
);

// Note de type MIDI : hauteur (0 à 127, 60 = do4), début et durée en pas (doubles-croches) depuis le début du pattern.
const noteSchema = new mongoose.Schema(
  {
    pitch: { type: Number, required: true, min: 0, max: 127, validate: Number.isInteger },
    startStep: { type: Number, required: true, min: 0, validate: Number.isInteger },
    durationSteps: { type: Number, required: true, min: 1, validate: Number.isInteger },
    velocity: { type: Number, default: 0.8, min: 0, max: 1 },
  },
  { _id: false },
);

// Réglages d'un instrument : brillance de 0 à 1, relâchement en secondes.
const instrumentParamsSchema = new mongoose.Schema(
  {
    tone: { type: Number, required: true, min: 0, max: 1 },
    releaseSeconds: { type: Number, required: true, min: L.minReleaseSeconds, max: L.maxReleaseSeconds },
  },
  { _id: false },
);

const patternSchema = new mongoose.Schema(
  {
    id: stableId,
    name: { type: String, required: true, trim: true, maxlength: 40 },
    // Kit de sons du pattern ; absent dans les projets antérieurs à la M3 (boom bap).
    kit: { type: String, enum: DRUM_KITS },
    drumRows: { type: [drumRowSchema], default: [] },
    // Pattern mélodique (M4) : instrument, réglages et longueur ; absents pour un pattern de batterie.
    instrument: { type: String, enum: INSTRUMENTS },
    params: { type: instrumentParamsSchema, default: undefined },
    bars: { type: Number, enum: L.melodicBarChoices },
    notes: { type: [noteSchema], default: [], validate: maxItems(L.maxNotesPerPattern) },
  },
  { _id: false },
);

// Les notes tiennent dans le pattern et ne sont portées que par un pattern mélodique.
patternSchema.pre("validate", function () {
  if (this.notes.length > 0 && !this.instrument) {
    this.invalidate("notes", "Seul un pattern mélodique (avec instrument) contient des notes");
    return;
  }
  const length = (this.bars ?? 1) * L.stepsPerPattern;
  if (this.notes.some((note) => note.startStep + note.durationSteps > length)) {
    this.invalidate("notes", `Une note dépasse la fin du pattern (${length} pas)`);
  }
});

// Réglages complets d'une correction vocale (VoiceSettings du studio).
const pitchClass = { type: Number, min: 0, max: 11, validate: Number.isInteger };
const voiceEqSchema = new mongoose.Schema(
  {
    // Coupe-bas en Hz (0 = désactivé), gains en dB.
    lowCutHz: { type: Number, required: true, min: 0, max: L.maxLowCutHz },
    bodyDb: { type: Number, required: true, min: -L.maxEqDb, max: L.maxEqDb },
    presenceDb: { type: Number, required: true, min: -L.maxEqDb, max: L.maxEqDb },
    airDb: { type: Number, required: true, min: -L.maxEqDb, max: L.maxEqDb },
  },
  { _id: false },
);
const voiceFxSchema = new mongoose.Schema(
  {
    // Niveaux de 0 à 1, réverbération en secondes, écho en millisecondes.
    reverbMix: { type: Number, required: true, min: 0, max: 1 },
    reverbSeconds: { type: Number, required: true, min: L.minReverbSeconds, max: L.maxReverbSeconds },
    delayMix: { type: Number, required: true, min: 0, max: 1 },
    delayMs: { type: Number, required: true, min: L.minDelayMs, max: L.maxDelayMs },
    feedback: { type: Number, required: true, min: 0, max: L.maxFeedback },
  },
  { _id: false },
);
const voiceSettingsSchema = new mongoose.Schema(
  {
    root: { ...pitchClass, required: true },
    scale: { type: String, required: true, enum: SCALES },
    // Notes autorisées (0 = do … 11 = si), sans doublon.
    allowedPitchClasses: {
      type: [pitchClass],
      validate: { validator: (values) => new Set(values).size === values.length, message: "Notes autorisées en double" },
    },
    strength: { type: Number, required: true, min: 0, max: 1 },
    retuneMs: { type: Number, required: true, min: 0, max: L.maxRetuneMs },
    toleranceCents: { type: Number, required: true, min: 0, max: L.maxToleranceCents },
    transposeSemitones: { type: Number, required: true, min: -L.maxTransposeSemitones, max: L.maxTransposeSemitones, validate: Number.isInteger },
    eq: { type: voiceEqSchema, required: true },
    fx: { type: voiceFxSchema, required: true },
  },
  { _id: false },
);

const userStyleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: L.styleNameMaxLength },
    basedOn: { type: String, required: true, enum: VOCAL_STYLE_IDS },
    settings: { type: voiceSettingsSchema, required: true },
  },
  { _id: false },
);

// Correction vocale du projet (M9) : style choisi, dose, réglages personnalisés et styles personnels.
const vocalSchema = new mongoose.Schema(
  {
    styleId: { type: String, enum: VOCAL_STYLE_IDS, default: "natural" },
    dose: { type: Number, default: 1, min: 0, max: 1 },
    // Style personnel choisi (l'un de `userStyles`), sinon absent.
    userStyleName: { type: String, trim: true, maxlength: L.styleNameMaxLength },
    // Réglages modifiés à la main (« Personnalisé ») ; absents tant qu'on suit le style.
    custom: { type: voiceSettingsSchema, default: undefined },
    userStyles: { type: [userStyleSchema], default: [], validate: maxItems(L.maxUserStyles) },
  },
  { _id: false },
);

vocalSchema.pre("validate", function () {
  const names = this.userStyles.map((style) => style.name);
  if (new Set(names).size !== names.length) {
    this.invalidate("userStyles", "Deux styles personnels portent le même nom");
  }
  if (this.userStyleName && !names.includes(this.userStyleName)) {
    this.invalidate("userStyleName", "Le style personnel choisi doit faire partie des styles du projet");
  }
});

const schema = new mongoose.Schema(
  {
    formatVersion: { type: Number, required: true, default: PROJECT_FORMAT_VERSION, enum: SUPPORTED_FORMAT_VERSIONS },
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
    // Absente des projets v1 : le studio reprend alors ses réglages par défaut.
    vocal: { type: vocalSchema, default: undefined },
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
