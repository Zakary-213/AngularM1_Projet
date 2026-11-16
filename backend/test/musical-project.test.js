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
  assert.equal(project.tracks[0].volume, 0.8);
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
