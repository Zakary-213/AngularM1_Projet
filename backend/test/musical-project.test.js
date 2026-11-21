import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MusicalProject, PROJECT_FORMAT_VERSION, PROJECT_LIMITS } from "../src/models/MusicalProject.js";

// Validation du format de sauvegarde v1, sans connexion MongoDB.

const steps = (active) => Array.from({ length: 16 }, (_, i) => active.includes(i));

function validProject(overrides = {}) {
  return {
    ownerId: new mongoose.Types.ObjectId(),
    title: "  Minuit sur la ville  ",
    origin: "create",
    bpm: 140,
    tracks: [
      {
        id: "trk-drums",
        name: "Drums",
        type: "drum",
        clips: [{ id: "clp-1", startBeat: 0, durationBeats: 16, patternId: "pat-1" }],
      },
      {
        id: "trk-voice",
        name: "Voix",
        type: "vocal",
        clips: [
          {
            id: "clp-2",
            startBeat: 4,
            durationBeats: 8,
            audioFileId: new mongoose.Types.ObjectId(),
            pitchCorrection: { enabled: true, strength: 1, retuneMs: 0 },
          },
        ],
      },
    ],
    patterns: [{ id: "pat-1", name: "Boom bap", drumRows: [{ voice: "kick", steps: steps([0, 7, 10]) }] }],
    ...overrides,
  };
}

async function errorsOf(data) {
  try {
    await new MusicalProject(data).validate();
    return [];
  } catch (error) {
    return Object.keys(error.errors ?? {});
  }
}

test("projet valide : valeurs par défaut et version du format", async () => {
  const project = new MusicalProject(validProject());
  await project.validate();
  assert.equal(project.formatVersion, PROJECT_FORMAT_VERSION);
  assert.equal(project.title, "Minuit sur la ville");
  assert.deepEqual({ ...project.key.toObject() }, { root: 9, scale: "minor" });
  assert.equal(project.revision, 0);
  assert.equal(project.tracks[0].volumeDb, 0);
});

test("toPublic expose id et ownerId en texte, sans _id ni __v", () => {
  const publicProject = new MusicalProject(validProject()).toPublic();
  assert.equal(typeof publicProject.id, "string");
  assert.equal(typeof publicProject.ownerId, "string");
  assert.equal("_id" in publicProject, false);
  assert.equal("__v" in publicProject, false);
});

test("refuse un BPM hors bornes et une version de format inconnue", async () => {
  assert.ok((await errorsOf(validProject({ bpm: 300 }))).includes("bpm"));
  assert.ok((await errorsOf(validProject({ bpm: 59 }))).includes("bpm"));
  assert.ok((await errorsOf(validProject({ formatVersion: 2 }))).includes("formatVersion"));
});

test("refuse trop de pistes", async () => {
  const tracks = Array.from({ length: PROJECT_LIMITS.maxTracks + 1 }, (_, i) => ({ id: `t${i}`, name: `P${i}`, type: "audio" }));
  assert.ok((await errorsOf(validProject({ tracks }))).includes("tracks"));
});

test("refuse une ligne de batterie qui n'a pas 16 pas", async () => {
  const patterns = [{ id: "pat-1", name: "X", drumRows: [{ voice: "snare", steps: [true, false] }] }];
  assert.ok((await errorsOf(validProject({ patterns }))).some((path) => path.endsWith("steps")));
});

test("un clip référence soit un pattern, soit un fichier audio", async () => {
  const both = { id: "c", startBeat: 0, durationBeats: 4, patternId: "p", audioFileId: new mongoose.Types.ObjectId() };
  const none = { id: "c", startBeat: 0, durationBeats: 4 };
  for (const clip of [both, none]) {
    const tracks = [{ id: "t", name: "P", type: "audio", clips: [clip] }];
    assert.ok((await errorsOf(validProject({ tracks }))).some((path) => path.endsWith("patternId")));
  }
});

test("refuse les identifiants non stables et les types inconnus", async () => {
  const tracks = [{ id: "pas un id!", name: "P", type: "guitare" }];
  const errors = await errorsOf(validProject({ tracks }));
  assert.ok(errors.includes("tracks.0.id"));
  assert.ok(errors.includes("tracks.0.type"));
});

test("M3 : vélocités facultatives, 16 valeurs entre 0 et 1", async () => {
  const row = (velocities) => [{ id: "pat-1", name: "X", drumRows: [{ voice: "kick", steps: steps([0]), ...(velocities ? { velocities } : {}) }] }];
  const valid = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0.7 : 0));
  assert.deepEqual(await errorsOf(validProject({ patterns: row(valid) })), []);
  assert.deepEqual(await errorsOf(validProject({ patterns: row() })), [], "projet antérieur sans vélocités");
  assert.ok((await errorsOf(validProject({ patterns: row([1, 0.5]) }))).some((path) => path.endsWith("velocities")));
  assert.ok((await errorsOf(validProject({ patterns: row(valid.map((v, i) => (i === 3 ? 2 : v))) }))).some((path) => path.endsWith("velocities")));
});

test("M3 : nouveaux instruments et kit du pattern", async () => {
  const pattern = (extra) => [{ id: "pat-1", name: "X", drumRows: [{ voice: "bass808", steps: steps([0]) }, { voice: "clap", steps: steps([4]) }], ...extra }];
  assert.deepEqual(await errorsOf(validProject({ patterns: pattern({ kit: "trap" }) })), []);
  assert.deepEqual(await errorsOf(validProject({ patterns: pattern({}) })), [], "kit facultatif");
  assert.ok((await errorsOf(validProject({ patterns: pattern({ kit: "dubstep" }) }))).some((path) => path.endsWith("kit")));
  const unknownVoice = [{ id: "pat-1", name: "X", drumRows: [{ voice: "cowbell", steps: steps([0]) }] }];
  assert.ok((await errorsOf(validProject({ patterns: unknownVoice }))).some((path) => path.endsWith("voice")));
});

test("M4 : pattern mélodique avec instrument, réglages, longueur et notes MIDI", async () => {
  const melodic = (extra = {}, notes = [{ pitch: 60, startStep: 0, durationSteps: 8, velocity: 0.8 }]) => [
    { id: "mel-1", name: "Accords", instrument: "piano", params: { tone: 0.6, releaseSeconds: 0.3 }, bars: 2, drumRows: [], notes, ...extra },
  ];
  assert.deepEqual(await errorsOf(validProject({ patterns: melodic() })), []);
  assert.ok((await errorsOf(validProject({ patterns: melodic({ instrument: "theremin" }) }))).some((path) => path.endsWith("instrument")));
  assert.ok((await errorsOf(validProject({ patterns: melodic({ bars: 3 }) }))).some((path) => path.endsWith("bars")));
  assert.ok((await errorsOf(validProject({ patterns: melodic({ params: { tone: 2, releaseSeconds: 0.3 } }) }))).some((path) => path.endsWith("tone")));
  assert.ok((await errorsOf(validProject({ patterns: melodic({ params: { tone: 0.5, releaseSeconds: 5 } }) }))).some((path) => path.endsWith("releaseSeconds")));
});

test("M4 : refuse les notes invalides, hors du pattern ou sans instrument", async () => {
  const withNotes = (notes, extra = {}) => [{ id: "mel-1", name: "M", instrument: "bass808", bars: 1, drumRows: [], notes, ...extra }];
  const note = (overrides) => ({ pitch: 33, startStep: 0, durationSteps: 4, velocity: 0.9, ...overrides });
  for (const bad of [note({ pitch: 128 }), note({ pitch: 33.5 }), note({ startStep: 1.5 }), note({ durationSteps: 0 }), note({ velocity: 1.2 })]) {
    assert.ok((await errorsOf(validProject({ patterns: withNotes([bad]) }))).length > 0, JSON.stringify(bad));
  }
  assert.ok((await errorsOf(validProject({ patterns: withNotes([note({ startStep: 14, durationSteps: 4 })]) }))).includes("patterns.0.notes"));
  assert.deepEqual(await errorsOf(validProject({ patterns: withNotes([note({ startStep: 14, durationSteps: 4 })], { bars: 2 }) })), []);
  assert.ok((await errorsOf(validProject({ patterns: withNotes([note({})], { instrument: undefined }) }))).includes("patterns.0.notes"));
  const tooMany = Array.from({ length: PROJECT_LIMITS.maxNotesPerPattern + 1 }, (_, i) => note({ pitch: i % 128, startStep: Math.floor(i / 128) * 4, durationSteps: 1 }));
  assert.ok((await errorsOf(validProject({ patterns: withNotes(tooMany, { bars: 4 }) }))).includes("patterns.0.notes"));
});

test("M4 : pistes d'instruments dont les clips jouent un pattern", async () => {
  const tracks = [
    { id: "melody", name: "Mélodie", type: "instrument", clips: [{ id: "melody-a", startBeat: 16, durationBeats: 32, patternId: "mel-1" }] },
    { id: "bass", name: "Basse", type: "instrument", clips: [{ id: "bass-a", startBeat: 0, durationBeats: 16, patternId: "bass-1" }] },
  ];
  assert.deepEqual(await errorsOf(validProject({ tracks })), []);
});
