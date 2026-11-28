import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { INSTRUMENTS, MusicalProject, PROJECT_FORMAT_VERSION, PROJECT_LIMITS } from "../src/models/MusicalProject.js";

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
  assert.ok((await errorsOf(validProject({ formatVersion: 3 }))).includes("formatVersion"));
  assert.deepEqual(await errorsOf(validProject({ formatVersion: 1 })), [], "un projet v1 reste valide");
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

test("#65 : chaque instrument de la bibliothèque est accepté", async () => {
  assert.equal(INSTRUMENTS.length, 12);
  for (const instrument of INSTRUMENTS) {
    const patterns = [{ id: "mel-1", name: "M", instrument, bars: 1, drumRows: [], notes: [] }];
    assert.deepEqual(await errorsOf(validProject({ patterns })), [], instrument);
  }
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

test("M7 : pan, égaliseur et envois d'effets par piste, volume Master ; défauts neutres", async () => {
  const project = new MusicalProject(validProject());
  await project.validate();
  assert.deepEqual(project.tracks[0].toObject().fx, { reverb: { enabled: false, amount: 0.3 }, delay: { enabled: false, amount: 0.3 } });
  assert.equal(project.tracks[0].pan, 0);
  assert.equal(project.master.volume, 0.8);

  const mixed = validProject();
  mixed.tracks[1] = {
    ...mixed.tracks[1],
    pan: -0.5,
    eq: { lowDb: 3, midDb: -2, highDb: 6 },
    fx: { reverb: { enabled: true, amount: 0.45 }, delay: { enabled: true, amount: 0.2 } },
  };
  assert.deepEqual(await errorsOf({ ...mixed, master: { volume: 0.6 } }), []);
});

test("M7 : refuse un pan, un envoi d'effet ou un Master hors bornes", async () => {
  const bad = validProject();
  bad.tracks[0] = { ...bad.tracks[0], pan: 2, fx: { reverb: { enabled: true, amount: 1.5 }, delay: { amount: -0.1 } } };
  const errors = await errorsOf({ ...bad, master: { volume: 1.2 } });
  assert.ok(errors.includes("tracks.0.pan"));
  assert.ok(errors.includes("tracks.0.fx.reverb.amount"));
  assert.ok(errors.includes("tracks.0.fx.delay.amount"));
  assert.ok(errors.includes("master.volume"));
});

const voiceSettings = (overrides = {}) => ({
  root: 9,
  scale: "minor",
  allowedPitchClasses: [0, 2, 4, 5, 7, 9, 11],
  strength: 1,
  retuneMs: 5,
  toleranceCents: 0,
  transposeSemitones: 0,
  eq: { lowCutHz: 100, bodyDb: 0, presenceDb: 3, airDb: 4 },
  fx: { reverbMix: 0.15, reverbSeconds: 1.6, delayMix: 0.12, delayMs: 330, feedback: 0.25 },
  ...overrides,
});

test("M9/M10 : réglages de correction vocale et styles personnels du projet", async () => {
  const vocal = {
    styleId: "trap",
    dose: 0.7,
    userStyleName: "Refrain",
    custom: voiceSettings({ strength: 0.8 }),
    userStyles: [{ name: "Refrain", basedOn: "trap", settings: voiceSettings() }],
  };
  assert.deepEqual(await errorsOf(validProject({ vocal })), []);
  const project = new MusicalProject(validProject());
  assert.equal(project.vocal, undefined, "absente d'un projet antérieur");
});

test("M9/M10 : refuse des réglages de correction hors bornes ou incohérents", async () => {
  const errors = await errorsOf(
    validProject({
      vocal: {
        styleId: "autotune",
        dose: 1.5,
        custom: voiceSettings({ retuneMs: 900, transposeSemitones: 13, allowedPitchClasses: [0, 0, 12], fx: { reverbMix: 2, reverbSeconds: 1, delayMix: 0, delayMs: 330, feedback: 0.9 } }),
      },
    }),
  );
  for (const path of ["vocal.styleId", "vocal.dose", "vocal.custom.retuneMs", "vocal.custom.transposeSemitones", "vocal.custom.fx.reverbMix", "vocal.custom.fx.feedback"]) {
    assert.ok(errors.includes(path), path);
  }
  assert.ok(errors.some((path) => path.startsWith("vocal.custom.allowedPitchClasses")));

  const duplicate = { name: "A", basedOn: "rap", settings: voiceSettings() };
  assert.ok((await errorsOf(validProject({ vocal: { userStyles: [duplicate, duplicate] } }))).includes("vocal.userStyles"));
  assert.ok((await errorsOf(validProject({ vocal: { userStyleName: "Inconnu", userStyles: [] } }))).includes("vocal.userStyleName"));
  const tooMany = Array.from({ length: PROJECT_LIMITS.maxUserStyles + 1 }, (_, i) => ({ name: `S${i}`, basedOn: "rap", settings: voiceSettings() }));
  assert.ok((await errorsOf(validProject({ vocal: { userStyles: tooMany } }))).includes("vocal.userStyles"));
});

test("M9/M10 : version corrigée d'une prise, seulement sur un clip audio", async () => {
  const withCorrection = validProject();
  withCorrection.tracks[1].clips[0].correction = { audioFileId: new mongoose.Types.ObjectId(), styleLabel: "Trap", enabled: true };
  assert.deepEqual(await errorsOf(withCorrection), []);

  const onPattern = validProject();
  onPattern.tracks[0].clips[0].correction = { audioFileId: new mongoose.Types.ObjectId() };
  assert.ok((await errorsOf(onPattern)).some((path) => path.endsWith("correction")));
  const withoutFile = validProject();
  withoutFile.tracks[1].clips[0].correction = { styleLabel: "Trap" };
  assert.ok((await errorsOf(withoutFile)).some((path) => path.endsWith("correction.audioFileId")));
});
