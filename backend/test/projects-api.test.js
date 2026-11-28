import test, { mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { format } from "node:util";
import { createApp } from "../src/app.js";
import { MusicalProject, PROJECT_FORMAT_VERSION } from "../src/models/MusicalProject.js";
import { Track } from "../src/models/Track.js";
import { LyricsQuota } from "../src/models/LyricsQuota.js";
import { estimateLyricSyllables } from "../src/services/lyrics-analysis.js";
import { planRhymeEndings } from "../src/services/lyrics-rhyme-plan.js";

/*
 * Tests HTTP des routes /api/projects. MongoDB est remplacé par un stockage en
 * mémoire branché sur les méthodes statiques du modèle : on vérifie les droits,
 * la validation et les conflits de révision, pas le comportement de MongoDB.
 * La validation Mongoose (schéma réel) est bien exécutée.
 */

const store = new Map();
/** Fichiers audio de la bibliothèque : identifiant → propriétaire. */
const audioFiles = new Map();
const lyricsAttempts = new Map();
/** Fichiers écrits sur disque par les tests d'upload, supprimés à la fin. */
const uploadedNames = [];

function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => String(document.get(key)) === String(value));
}

/** Requête Mongoose minimale : await direct, ou .lean() pour un objet simple. */
function query(result) {
  const chain = {
    sort: () => chain,
    skip: (count) => query(Array.isArray(result) ? result.slice(count) : result),
    limit: (count) => query(Array.isArray(result) ? result.slice(0, count) : result),
    select: () => chain,
    lean: async () => (Array.isArray(result) ? result.map((doc) => doc.toObject()) : (result?.toObject() ?? null)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

const sortedDocs = (filter) =>
  [...store.values()].filter((doc) => matches(doc, filter)).sort((a, b) => b.updatedAt - a.updatedAt);

function installFakeStore() {
  mock.method(MusicalProject, "create", async (data) => {
    const document = new MusicalProject(data);
    await document.validate();
    document.createdAt = document.updatedAt = new Date(Date.now() + store.size);
    store.set(String(document._id), document);
    return document;
  });
  mock.method(MusicalProject, "find", (filter) => query(sortedDocs(filter)));
  mock.method(MusicalProject, "countDocuments", async (filter) => sortedDocs(filter).length);
  mock.method(MusicalProject, "findOne", (filter) => query(sortedDocs(filter)[0] ?? null));
  mock.method(MusicalProject, "findOneAndUpdate", async (filter, update) => {
    const document = sortedDocs(filter)[0];
    if (!document) return null;
    document.set(update.$set);
    document.revision += update.$inc?.revision ?? 0;
    document.updatedAt = new Date();
    return document;
  });
  mock.method(Track, "create", async (data) => {
    const document = new Track(data);
    await document.validate();
    audioFiles.set(String(document._id), String(data.ownerId));
    uploadedNames.push(data.storedName);
    return document;
  });
  mock.method(Track, "countDocuments", async ({ _id, ownerId }) =>
    _id.$in.filter((id) => audioFiles.get(String(id)) === String(ownerId)).length,
  );
  mock.method(MusicalProject, "findOneAndDelete", async (filter) => {
    const document = sortedDocs(filter)[0];
    if (document) store.delete(String(document._id));
    return document ?? null;
  });
  mock.method(LyricsQuota, "updateOne", async ({ _id, attempts }, update, { upsert } = {}) => {
    const count = lyricsAttempts.get(_id);
    if (count !== undefined && count < attempts.$lt) {
      lyricsAttempts.set(_id, count + update.$inc.attempts);
      return { matchedCount: 1, upsertedCount: 0 };
    }
    if (!upsert) return { matchedCount: 0, upsertedCount: 0 };
    if (count !== undefined) throw Object.assign(new Error("Clé du compteur déjà présente"), { code: 11000 });
    lyricsAttempts.set(_id, update.$inc.attempts);
    return { matchedCount: 0, upsertedCount: 1 };
  });
}

let server, base;
const alice = new mongoose.Types.ObjectId().toString();
const bob = new mongoose.Types.ObjectId().toString();
const secret = process.env.JWT_SECRET || "tp1-development-secret";

test.before(async () => {
  installFakeStore();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/projects`;
});

test.after(async () => {
  await Promise.all(uploadedNames.map((name) => fs.rm(path.resolve("data/uploads", name), { force: true })));
  mock.restoreAll();
  server.close();
});

test.beforeEach(() => {
  store.clear();
  audioFiles.clear();
  lyricsAttempts.clear();
});

async function call(user, method, path = "", body) {
  const headers = { "Content-Type": "application/json" };
  if (user) headers.Authorization = `Bearer ${jwt.sign({ sub: user }, secret)}`;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, retryAfter: response.headers.get("retry-after") };
}

const createProject = (user, title = "Minuit", origin = "create") => call(user, "POST", "", { title, origin });

const drumsTrack = {
  id: "drums",
  name: "Batterie",
  type: "drum",
  volumeDb: -3,
  clips: [{ id: "clip-drums", startBeat: 0, durationBeats: 4, patternId: "pattern-1" }],
};
const pattern = { id: "pattern-1", name: "Pattern 01", drumRows: [{ voice: "kick", steps: Array.from({ length: 16 }, (_, i) => i % 4 === 0) }] };

test("401 sans JWT", async () => {
  assert.equal((await call(null, "GET")).status, 401);
  assert.equal((await call(null, "POST", "", { title: "x", origin: "create" })).status, 401);
});

test("création : propriétaire tiré du JWT, ownerId du corps ignoré", async () => {
  const { status, body } = await call(alice, "POST", "", { title: "  Minuit  ", origin: "import", ownerId: bob, revision: 99, bpm: 140 });
  assert.equal(status, 201);
  assert.equal(body.ownerId, alice);
  assert.equal(body.title, "Minuit");
  assert.equal(body.origin, "import");
  assert.equal(body.bpm, 140);
  assert.equal(body.revision, 0);
  assert.equal(body.formatVersion, PROJECT_FORMAT_VERSION);
});

test("création : titre, parcours et BPM validés", async () => {
  assert.equal((await call(alice, "POST", "", { title: "", origin: "create" })).status, 400);
  assert.equal((await call(alice, "POST", "", { title: "x".repeat(81), origin: "create" })).status, 400);
  assert.equal((await call(alice, "POST", "", { title: "Ok", origin: "remix" })).status, 400);
  assert.equal((await call(alice, "POST", "", { title: "Ok", origin: "create", bpm: 500 })).status, 400);
});

test("isolation : un utilisateur ne voit, n'ouvre, ne modifie ni ne supprime les projets d'un autre", async () => {
  const { body: project } = await createProject(alice, "Projet d'Alice");
  await createProject(bob, "Projet de Bob");

  const list = await call(bob, "GET");
  assert.deepEqual(list.body.items.map((item) => item.title), ["Projet de Bob"]);
  assert.equal(list.body.total, 1);

  assert.equal((await call(bob, "GET", `/${project.id}`)).status, 404);
  assert.equal((await call(bob, "PUT", `/${project.id}`, { revision: 0, title: "Volé" })).status, 404);
  assert.equal((await call(bob, "PATCH", `/${project.id}`, { title: "Volé" })).status, 404);
  assert.equal((await call(bob, "DELETE", `/${project.id}`)).status, 404);

  const stillThere = await call(alice, "GET", `/${project.id}`);
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.body.title, "Projet d'Alice");
});

test("liste paginée, résumés sans contenu complet", async () => {
  for (let i = 1; i <= 3; i++) await createProject(alice, `Projet ${i}`);
  const { status, body } = await call(alice, "GET", "?page=2&limit=2");
  assert.equal(status, 200);
  assert.equal(body.page, 2);
  assert.equal(body.limit, 2);
  assert.equal(body.total, 3);
  assert.equal(body.pages, 2);
  assert.equal(body.items.length, 1);
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["bpm", "createdAt", "formatVersion", "id", "key", "origin", "title", "trackCount", "updatedAt"]);
});

test("identifiant mal formé : 404 sans interroger la base", async () => {
  assert.equal((await call(alice, "GET", "/pas-un-id")).status, 404);
});

test("sauvegarde : liste blanche, révision incrémentée, validation du contenu", async () => {
  const { body: project } = await createProject(alice);
  const saved = await call(alice, "PUT", `/${project.id}`, {
    revision: 0,
    bpm: 95,
    key: { root: 2, scale: "harmonicMinor" },
    tracks: [drumsTrack],
    patterns: [pattern],
    ownerId: bob,
    formatVersion: 7,
    origin: "import",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.bpm, 95);
  assert.equal(saved.body.key.scale, "harmonicMinor");
  assert.equal(saved.body.tracks[0].volumeDb, -3);
  assert.equal(saved.body.ownerId, alice);
  assert.equal(saved.body.formatVersion, PROJECT_FORMAT_VERSION);
  assert.equal(saved.body.origin, "create");

  const invalid = await call(alice, "PUT", `/${project.id}`, { revision: 1, tracks: [{ ...drumsTrack, volumeDb: 40 }] });
  assert.equal(invalid.status, 400);
  assert.equal((await call(alice, "PUT", `/${project.id}`, { bpm: 100 })).status, 400, "révision obligatoire");
});

test("sauvegarde concurrente : 409 avec la révision actuelle, rien n'est écrasé", async () => {
  const { body: project } = await createProject(alice);
  assert.equal((await call(alice, "PUT", `/${project.id}`, { revision: 0, bpm: 100 })).status, 200);
  const stale = await call(alice, "PUT", `/${project.id}`, { revision: 0, bpm: 150 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 1);
  assert.equal((await call(alice, "GET", `/${project.id}`)).body.bpm, 100);
});

test("format inconnu : 422 et projet non réécrit", async () => {
  const { body: project } = await createProject(alice);
  // Simule un projet enregistré par une version future du studio.
  store.get(project.id).set("formatVersion", PROJECT_FORMAT_VERSION + 1, { strict: false });
  const response = await call(alice, "PUT", `/${project.id}`, { revision: 0, bpm: 100 });
  assert.equal(response.status, 422);
  assert.equal(store.get(project.id).bpm, 90);
});

test("renommage et suppression", async () => {
  const { body: project } = await createProject(alice);
  const renamed = await call(alice, "PATCH", `/${project.id}`, { title: "Nouveau nom" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.title, "Nouveau nom");
  assert.equal(renamed.body.revision, 1);
  assert.equal((await call(alice, "PATCH", `/${project.id}`, { title: "   " })).status, 400);

  assert.equal((await call(alice, "DELETE", `/${project.id}`)).status, 204);
  assert.equal((await call(alice, "GET", `/${project.id}`)).status, 404);
  assert.equal((await call(alice, "DELETE", `/${project.id}`)).status, 404);
});

test("JSON invalide : 400", async () => {
  const response = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ sub: alice }, secret)}` },
    body: "{pas du json",
  });
  assert.equal(response.status, 400);
});

function instrumentalTrack(audioFileId, extra = {}) {
  return {
    id: "instrumental",
    name: "Instrumentale",
    type: "audio",
    eq: { lowDb: 4, midDb: -2, highDb: 0 },
    clips: [{ id: "clip-instrumental", startBeat: 0, durationBeats: 96, audioFileId, label: "beat.mp3" }],
    ...extra,
  };
}

test("M6 : un clip audio référence un fichier de la bibliothèque de l'utilisateur, avec son égaliseur", async () => {
  const { body: project } = await createProject(alice, "Prod importée", "import");
  const aliceFile = new mongoose.Types.ObjectId().toString();
  audioFiles.set(aliceFile, alice);
  const saved = await call(alice, "PUT", `/${project.id}`, { revision: 0, tracks: [instrumentalTrack(aliceFile)] });
  assert.equal(saved.status, 200);
  const clip = saved.body.tracks[0].clips[0];
  assert.equal(String(clip.audioFileId), aliceFile);
  assert.equal(clip.label, "beat.mp3");
  assert.deepEqual({ ...saved.body.tracks[0].eq }, { lowDb: 4, midDb: -2, highDb: 0 });
});

test("M6 : refuse le fichier audio d'un autre utilisateur ou un fichier inexistant", async () => {
  const { body: project } = await createProject(alice, "Prod", "import");
  const bobFile = new mongoose.Types.ObjectId().toString();
  audioFiles.set(bobFile, bob);
  for (const fileId of [bobFile, new mongoose.Types.ObjectId().toString()]) {
    const response = await call(alice, "PUT", `/${project.id}`, { revision: 0, tracks: [instrumentalTrack(fileId)] });
    assert.equal(response.status, 400);
    assert.match(response.body.message, /Fichier audio/);
  }
  assert.equal((await call(alice, "GET", `/${project.id}`)).body.revision, 0, "rien n'est écrit");
});

test("M6 : égaliseur borné à ±12 dB", async () => {
  const { body: project } = await createProject(alice);
  const response = await call(alice, "PUT", `/${project.id}`, {
    revision: 0,
    tracks: [{ id: "instrumental", name: "Instrumentale", type: "audio", eq: { lowDb: 30 }, clips: [] }],
  });
  assert.equal(response.status, 400);
});

const voiceTrack = (clips, activeClipId) => ({ id: "voice", name: "Voix principale", type: "vocal", clips, ...(activeClipId ? { activeClipId } : {}) });

test("M8 : plusieurs prises sur la piste Voix, la prise active doit être l'une d'elles", async () => {
  const { body: project } = await createProject(alice);
  const files = [new mongoose.Types.ObjectId().toString(), new mongoose.Types.ObjectId().toString()];
  files.forEach((id) => audioFiles.set(id, alice));
  const clips = files.map((audioFileId, i) => ({ id: `take-${i}`, startBeat: i * 4, durationBeats: 8, offsetSeconds: i === 0 ? 0.09 : 0, audioFileId, label: `Prise ${i + 1}` }));

  const saved = await call(alice, "PUT", `/${project.id}`, { revision: 0, tracks: [voiceTrack(clips, "take-1")] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.tracks[0].activeClipId, "take-1");
  assert.equal(saved.body.tracks[0].clips.length, 2);
  assert.equal(saved.body.tracks[0].clips[0].offsetSeconds, 0.09);

  const invalid = await call(alice, "PUT", `/${project.id}`, { revision: 1, tracks: [voiceTrack(clips, "take-inconnue")] });
  assert.equal(invalid.status, 400);
});

async function uploadTrack(user, bytes, type, name) {
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type }), name);
  form.append("title", "Prise 1 · Projet");
  const response = await fetch(base.replace("/projects", "/tracks"), {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt.sign({ sub: user }, secret)}` },
    body: form,
  });
  return response.status;
}

test("M8 : une prise WebM (MediaRecorder) est acceptée par l'upload, un fichier texte est refusé", async () => {
  assert.equal(await uploadTrack(alice, Buffer.from("webm"), "audio/webm", "Prise 1.webm"), 201);
  assert.equal(await uploadTrack(alice, Buffer.from("texte"), "text/plain", "notes.txt"), 400);
});

const vocalSettings = {
  root: 2,
  scale: "harmonicMinor",
  allowedPitchClasses: [1, 2, 4, 5, 7, 9, 10],
  strength: 0.9,
  retuneMs: 20,
  toleranceCents: 0,
  transposeSemitones: 0,
  eq: { lowCutHz: 150, bodyDb: -3, presenceDb: 6, airDb: 7 },
  fx: { reverbMix: 0.45, reverbSeconds: 3.2, delayMix: 0.38, delayMs: 330, feedback: 0.5 },
};

test("M10 : la correction vocale et la version corrigée de la prise sont sauvegardées et relues", async () => {
  const { body: project } = await createProject(alice);
  const [take, corrected] = [new mongoose.Types.ObjectId().toString(), new mongoose.Types.ObjectId().toString()];
  audioFiles.set(take, alice);
  audioFiles.set(corrected, alice);
  const clip = { id: "take-1", startBeat: 0, durationBeats: 8, audioFileId: take, label: "Prise 1", correction: { audioFileId: corrected, styleLabel: "Raï", enabled: true } };
  const vocal = { styleId: "rai", dose: 0.8, userStyleName: "Mon raï", userStyles: [{ name: "Mon raï", basedOn: "rai", settings: vocalSettings }] };

  const saved = await call(alice, "PUT", `/${project.id}`, { revision: 0, tracks: [voiceTrack([clip], "take-1")], vocal });
  assert.equal(saved.status, 200);
  const reopened = (await call(alice, "GET", `/${project.id}`)).body;
  const savedClip = reopened.tracks[0].clips[0];
  assert.equal(String(savedClip.correction.audioFileId), corrected);
  assert.equal(savedClip.correction.enabled, true);
  assert.equal(String(savedClip.audioFileId), take, "l'original reste référencé");
  assert.equal(reopened.vocal.styleId, "rai");
  assert.equal(reopened.vocal.userStyles[0].settings.fx.reverbSeconds, 3.2);

  const invalid = await call(alice, "PUT", `/${project.id}`, { revision: 1, vocal: { ...vocal, dose: 3 } });
  assert.equal(invalid.status, 400);
});

test("M10 : refuse une version corrigée qui désigne le fichier d'un autre compte", async () => {
  const { body: project } = await createProject(alice);
  const take = new mongoose.Types.ObjectId().toString();
  const bobFile = new mongoose.Types.ObjectId().toString();
  audioFiles.set(take, alice);
  audioFiles.set(bobFile, bob);
  const clip = { id: "take-1", startBeat: 0, durationBeats: 8, audioFileId: take, correction: { audioFileId: bobFile, enabled: true } };
  const response = await call(alice, "PUT", `/${project.id}`, { revision: 0, tracks: [voiceTrack([clip], "take-1")] });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /Fichier audio/);
});

test("M10 : un projet au format v1 s'ouvre tel quel et passe en v3 à la sauvegarde", async () => {
  const { body: project } = await createProject(alice);
  store.get(project.id).set("formatVersion", 1);
  assert.equal((await call(alice, "GET", `/${project.id}`)).body.formatVersion, 1);
  const saved = await call(alice, "PUT", `/${project.id}`, { revision: 0, bpm: 100 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.formatVersion, PROJECT_FORMAT_VERSION);
  assert.equal(saved.body.bpm, 100);
});

test("#64 : trois pistes vocales gardent leurs prises, leur mix, leur correction et la piste armée", async () => {
  const { body: project } = await createProject(alice);
  const route = `/${project.id}`;
  const tracks = ["Voix principale", "Backs", "Ad-libs"].map((name, index) => {
    const fileId = new mongoose.Types.ObjectId().toString();
    const correctedId = new mongoose.Types.ObjectId().toString();
    audioFiles.set(fileId, alice);
    audioFiles.set(correctedId, alice);
    return {
      ...voiceTrack([{ id: `take-${index}`, startBeat: index * 4, durationBeats: 4, audioFileId: fileId,
        correction: { audioFileId: correctedId, styleLabel: "Trap", enabled: index === 1 } }], `take-${index}`),
      id: index === 0 ? "voice" : `voice-${index}`, name, volumeDb: -index * 3, pan: index / 3,
      solo: index === 0, mute: index === 2, fx: { reverb: { enabled: index === 1, amount: 0.3 } },
      vocal: { styleId: ["natural", "trap", "drill"][index], dose: 0.3 + index * 0.2 },
    };
  });
  const saved = await call(alice, "PUT", route, { revision: 0, tracks, armedVocalTrackId: "voice-1" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.formatVersion, PROJECT_FORMAT_VERSION);
  const reopened = (await call(alice, "GET", route)).body;
  assert.deepEqual(reopened.tracks, saved.body.tracks);
  assert.equal(reopened.armedVocalTrackId, "voice-1");
  assert.deepEqual(reopened.tracks.map(track => track.vocal.styleId), ["natural", "trap", "drill"]);
  assert.deepEqual(reopened.tracks.map(track => track.clips[0].correction.enabled), [false, true, false]);

  const duplicate = { ...tracks[1], activeClipId: tracks[0].activeClipId, clips: tracks[0].clips };
  assert.equal((await call(alice, "PUT", route, { revision: 1, tracks: [tracks[0], duplicate, tracks[2]] })).status, 400);
  assert.equal((await call(alice, "PUT", route, { revision: 1, armedVocalTrackId: "bass" })).status, 400);
  assert.equal((await call(alice, "PUT", route, { revision: 1, tracks: [{ ...tracks[0], activeClipId: "take-1" }, ...tracks.slice(1)] })).status, 400);
  assert.equal((await call(alice, "PUT", route, { revision: 1, tracks: [tracks[0], tracks[0], ...tracks.slice(1)] })).status, 400);
  const foreign = new mongoose.Types.ObjectId().toString();
  audioFiles.set(foreign, bob);
  const unsafe = { ...tracks[1], clips: [{ ...tracks[1].clips[0], audioFileId: foreign }] };
  assert.equal((await call(alice, "PUT", route, { revision: 1, tracks: [tracks[0], unsafe, tracks[2]] })).status, 400);
  assert.equal((await call(alice, "GET", route)).body.revision, 1);
});

test("M2 : deux pistes d'instruments sont sauvegardées séparément et leurs clips sont validés", async () => {
  const { body: project } = await createProject(alice);
  const route = `/${project.id}`;
  const patterns = [{ id: "part-piano", name: "Piano", instrument: "piano" },
    { id: "part-guitar", name: "Guitare", instrument: "acousticGuitar" }];
  const tracks = patterns.map((part, index) => ({
    id: `inst-${index}`, type: "instrument", name: part.name, pan: index / 2,
    clips: [{ id: `clip-${index}`, startBeat: 0, durationBeats: 16, patternId: part.id }],
  }));
  const saved = await call(alice, "PUT", route, { revision: 0, patterns, tracks });
  assert.equal(saved.status, 200);
  const before = (await call(alice, "GET", route)).body;
  assert.deepEqual(before.tracks.map(track => [track.name, track.pan, track.clips[0].patternId]), [
    ["Piano", 0, "part-piano"], ["Guitare", 0.5, "part-guitar"],
  ]);

  const invalid = { ...tracks[1], clips: [{ ...tracks[1].clips[0], patternId: "part-absente" }] };
  assert.equal((await call(alice, "PUT", route, { revision: 1, tracks: [tracks[0], invalid] })).status, 400);
  const reduced = await call(alice, "PUT", route, { revision: 1, tracks: [tracks[0]] });
  assert.equal(reduced.status, 200);
  assert.deepEqual(reduced.body.tracks, [before.tracks[0]]);
});

const makeLyricLines = (count) => Array.from({ length: count }, (_, index) => ({
  measure: index + 1,
  text: `Texte fictif ${index + 1}`,
  syllables: 10,
}));
const lyricLines = makeLyricLines(8);
const groqLyricsReply = (lines, refused = false) => Response.json({
  choices: [{ message: { content: JSON.stringify({ refused, lines }) } }],
});

function stubGroq(t, key, reply) {
  const previousKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = key;
  t.after(() => {
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  });
  const realFetch = globalThis.fetch;
  const groq = t.mock.fn(reply);
  t.mock.method(globalThis, "fetch", (url, options) =>
    String(url).startsWith(base) ? realFetch(url, options) : groq(url, options),
  );
  return groq;
}

test("M12 : la génération exige un JWT et un projet appartenant au compte", async (t) => {
  const groq = stubGroq(t, "test-key", () => assert.fail("Appel Groq interdit"));
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  assert.equal((await call(null, "POST", route, { theme: "La nuit" })).status, 401);
  assert.equal((await call(bob, "POST", route, { theme: "La nuit", ownerId: alice })).status, 404);
  assert.equal((await call(alice, "POST", "/invalide/lyrics/generate", { theme: "La nuit" })).status, 404);
  assert.equal(groq.mock.callCount(), 0);
});

test("M12 : la régénération remplace seulement la ligne ou le bloc demandé", async (t) => {
  const texts = lyricLines.map(line => line.text);
  const groq = stubGroq(t, "test-key", (_url, request) => {
    const { regenerate } = JSON.parse(JSON.parse(request.body).messages[1].content);
    assert.deepEqual(regenerate.context.map(line => line.measure), lyricLines
      .filter(line => line.measure < regenerate.from || line.measure > regenerate.to)
      .map(line => line.measure));
    return groqLyricsReply(lyricLines.slice(regenerate.from - 1, regenerate.to).map(line =>
      ({ measure: line.measure, text: "Je repense aux amis et je marche", compactText: "Je marche sur le sol" }),
    ));
  });
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  for (const [from, to] of [[2, 2], [5, 8]]) {
    const response = await call(alice, "POST", route, { theme: "La nuit", regenerate: { from, to, lines: texts } });
    assert.equal(response.status, 200);
    response.body.lines.forEach(({ measure, text }) => {
      if (measure >= from && measure <= to) assert.match(text, /^(?:Je repense|Je marche)/u);
      else assert.equal(text, texts[measure - 1]);
    });
  }
  assert.equal((await call(alice, "POST", route, { theme: "La nuit", regenerate: { from: 2, to: 9, lines: texts } })).status, 400);
  assert.equal(groq.mock.callCount(), 2);
  assert.deepEqual([...lyricsAttempts.values()], [2]);
});

test("M12 : le projet conserve le texte et son historique sans consommer le quota", async () => {
  const { body: project } = await createProject(alice);
  const route = `/${project.id}`;
  const options = { theme: "La nuit", mood: "neutral", language: "fr", structure: "verse", measures: 4, flow: "standard", rhymeScheme: "AABB", languageLevel: "standard" };
  const before = { options, bpm: 90, targetSyllables: 10, lines: ["Mon route", "Un doute", "", "Les étoiles"] };
  const lyrics = { current: { ...before, lines: ["Ma route", ...before.lines.slice(1)] }, history: [before] };
  assert.equal((await call(alice, "GET", route)).body.lyrics, undefined);
  assert.equal((await call(bob, "PUT", route, { revision: 0, lyrics })).status, 404);
  assert.equal((await call(alice, "PUT", route, { revision: 0, lyrics: { ...lyrics, history: Array(6).fill(before) } })).status, 400);
  assert.equal((await call(alice, "PUT", route, { revision: 0, lyrics: { ...lyrics, current: { ...before, lines: ["Une ligne"] } } })).status, 400);
  const saved = await call(alice, "PUT", route, { revision: 0, lyrics, lyricsAnalysis: [{ measure: 1, syllables: 99 }] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.lyrics, lyrics);
  assert.equal(saved.body.lyricsAnalysis[0].text, "Ma route");
  assert.equal(saved.body.lyricsAnalysis[2].syllables, 0);
  const reloaded = await call(alice, "GET", route);
  assert.deepEqual(reloaded.body.lyrics, lyrics);
  assert.deepEqual(reloaded.body.lyricsAnalysis, saved.body.lyricsAnalysis);
  assert.equal((await call(alice, "PUT", route, { revision: 0, lyrics })).status, 409);
  assert.equal((await call(alice, "PUT", route, { revision: 1, bpm: 140 })).status, 200);
  assert.deepEqual((await call(alice, "GET", route)).body.lyrics, lyrics);
  assert.equal(lyricsAttempts.size, 0);
});

test("M12 : la route utilise la clé du serveur et les paramètres du projet", async (t) => {
  const groq = stubGroq(t, "test-key", () => groqLyricsReply(lyricLines));
  const { body: project } = await call(alice, "POST", "", { title: "Projet privé", origin: "create", bpm: 140 });
  const response = await call(alice, "POST", `/${project.id}/lyrics/generate`, { theme: "  La nuit  ", bpm: 90, apiKey: "clé-client" });
  const context = { bpm: 140, timeSignature: { beatsPerBar: 4, beatUnit: 4 }, key: { root: 9, scale: "minor" } };
  assert.equal(response.status, 200);
  assert.equal(response.body.targetSyllables, 6);
  assert.deepEqual({ bpm: response.body.bpm, timeSignature: response.body.timeSignature, key: response.body.key }, context);
  assert.ok(response.body.lines.every((line, index) => line.text.startsWith(lyricLines[index].text) && line.syllables >= 3));
  assert.deepEqual(response.body.lines.map(line => line.rhyme.group), ["A", "A", "B", "B", "C", "C", "D", "D"]);
  assert.ok(response.body.lines.every(line => line.rhyme.matches));
  assert.equal(groq.mock.callCount(), 1);
  const [url, options] = groq.mock.calls[0].arguments;
  assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(JSON.parse(options.body).messages[1].content), {
    theme: "La nuit", mood: "neutral", language: "fr", structure: "verse", measures: 8,
    flow: "standard", rhymeScheme: "AABB", languageLevel: "standard", targetSyllables: 6, ...context,
  });
});

test("M12 : les réglages valides sont transmis avec le bon nombre de mesures et la densité demandée", async (t) => {
  const groq = stubGroq(t, "test-key", (_url, options) => {
    const request = JSON.parse(options.body);
    const { measures } = JSON.parse(request.messages[1].content);
    return groqLyricsReply(makeLyricLines(measures));
  });
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  const options = { theme: "x".repeat(200), mood: "dark", language: "en", structure: "bridge", rhymeScheme: "ABAB", languageLevel: "casual" };

  for (const [measures, flow, targetSyllables] of [[4, "relaxed", 7], [16, "fast", 14]]) {
    const response = await call(alice, "POST", route, { ...options, measures, flow });
    assert.equal(response.status, 200);
    assert.equal(response.body.targetSyllables, targetSyllables);
    assert.deepEqual(response.body.lines.map(({ measure }) => measure), makeLyricLines(measures).map(({ measure }) => measure));
    const request = JSON.parse(groq.mock.calls.at(-1).arguments[1].body);
    assert.deepEqual(JSON.parse(request.messages[1].content), {
      ...options, measures, flow, targetSyllables, bpm: 90,
      timeSignature: { beatsPerBar: 4, beatUnit: 4 }, key: { root: 9, scale: "minor" },
    });
    const linesSchema = request.response_format.json_schema.schema.properties.lines;
    assert.equal(linesSchema.minItems, 0);
    assert.equal(linesSchema.maxItems, measures);
  }
  assert.equal(groq.mock.callCount(), 2);
});

test("M12 : AABB, ABAB et internes complètent les rimes prévues en un seul appel", async (t) => {
  let endings;
  const groq = stubGroq(t, "test-key", (_url, options) => {
    const { messages } = JSON.parse(options.body);
    const plan = messages[0].content.split("Fins par numéro de mesure : ")[1].split(".")[0];
    endings = plan.split(" | ").map(entry => entry.split("=")[1]);
    assert.equal(endings.length, 8);
    return groqLyricsReply(endings.map((ending, index) => ({
      measure: index + 1,
      text: index === 0 ? `Dans ${ending}.` : "Je pense à",
    })));
  });
  for (const [user, rhymeScheme] of [[alice, "AABB"], [alice, "ABAB"], [bob, "internal"]]) {
    const { body: target } = await createProject(user);
    for (const language of ["fr", "en"]) {
      const response = await call(user, "POST", `/${target.id}/lyrics/generate`, { theme: "La nuit", rhymeScheme, language });
      assert.equal(response.status, 200);
      assert.equal(response.body.lines[0].text, `Dans ${endings[0]}.`);
      assert.ok(response.body.lines.every((line, index) => line.text.replace(/\.$/u, "").endsWith(endings[index]) && line.rhyme.matches));
    }
  }
  assert.equal(groq.mock.callCount(), 6);
});

test("M12 : régénérer la mesure 4 en ABAB utilise la rime de la mesure 2 conservée", async (t) => {
  const lines = ["Je reste retenu", "Les ombres font un grand feu", "Nos espoirs perdus", "On danse sans retenue"];
  const groq = stubGroq(t, "test-key", (_url, options) => {
    const { messages } = JSON.parse(options.body);
    assert.match(messages[0].content, /Fins par numéro de mesure : 1=jeu\./u);
    return groqLyricsReply([{ measure: 1, text: "On connaît les règles du jeu, malgré tout" }]);
  });
  const { body: project } = await createProject(alice);
  const response = await call(alice, "POST", `/${project.id}/lyrics/generate`, {
    theme: "La nuit", rhymeScheme: "ABAB", measures: 4, regenerate: { from: 4, to: 4, lines },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lines.map(line => line.text), [...lines.slice(0, 3), "On connaît les règles du jeu"]);
  assert.ok(response.body.lines.every(line => line.rhyme.matches));
  assert.equal(groq.mock.callCount(), 1);
});

test("M12 : la régénération utilise la variante courte dans les trois schémas, langues, densités et formats", async (t) => {
  const groq = stubGroq(t, "test-key", (_url, request) => {
    const { messages, response_format } = JSON.parse(request.body);
    const { regenerate, measures, targetSyllables, language } = JSON.parse(messages[1].content);
    assert.equal(response_format.type, "json_object");
    assert.equal(measures, regenerate.to - regenerate.from + 1);
    assert.match(messages[0].content, /compactText/u);
    const plan = messages[0].content.split("Fins par numéro de mesure : ")[1].split(".")[0];
    const endings = new Map(plan.split(" | ").map(entry => entry.split("=")));
    const beat = language === "fr" ? "là" : "go";
    return groqLyricsReply(Array.from({ length: regenerate.to - regenerate.from + 1 }, (_, index) => {
      const ending = endings.get(String(index + 1));
      const prefixBudget = Math.max(1, targetSyllables - estimateLyricSyllables(ending, language));
      return { measure: index + 1, text: (beat + " ").repeat(35).trim(), compactText: (beat + " ").repeat(prefixBudget).trim() };
    }));
  });

  let cases = 0;
  for (const bpm of [90, 140]) {
    const { body: project } = await call(alice, "POST", "", { title: "Rimes", origin: "create", bpm });
    const route = `/${project.id}/lyrics/generate`;
    for (const language of ["fr", "en"]) {
      for (const rhymeScheme of ["AABB", "ABAB", "internal"]) {
        for (const flow of ["relaxed", "standard", "fast"]) {
          for (const measures of [4, 8, 16]) {
            const lines = planRhymeEndings({ language, rhymeScheme, firstMeasure: 1, lastMeasure: measures, targetSyllables: 7 });
            for (const [from, to] of [[2, 2], [2, measures]]) {
              lyricsAttempts.clear();
              const body = { theme: "Fête", language, rhymeScheme, flow, measures, regenerate: { from, to, lines } };
              const response = await call(alice, "POST", route, body);
              const settings = [bpm, language, rhymeScheme, flow, measures, from, to].join("/");
              assert.equal(response.status, 200, settings);
              assert.equal(response.body.lines.length, measures, settings);
              for (const line of response.body.lines) {
                assert.ok(line.rhyme.matches, settings);
                if (line.measure < from || line.measure > to) {
                  assert.equal(line.text, lines[line.measure - 1], settings);
                } else {
                  assert.ok(Math.abs(line.syllables - response.body.targetSyllables) <= 2, settings);
                }
              }
              assert.deepEqual([...lyricsAttempts.values()], [1]);
              cases++;
            }
          }
        }
      }
    }
  }
  assert.equal(cases, 216);
  assert.equal(groq.mock.callCount(), cases);
});

test("M12 : une régénération hors cadence est rejetée sans écraser le texte", async (t) => {
  const groq = stubGroq(t, "test-key", () => groqLyricsReply([
    { measure: 1, text: "On avance vers la fête et on chante encore avec tous les amis", compactText: "On chante encore avec tous les amis" },
  ]));
  const { body: project } = await call(alice, "POST", "", { title: "Rimes", origin: "create", bpm: 140 });
  const lines = ["Un dernier détour", "Bientôt de retour", "Un rêve dans la nuit", "Écoutez le bruit"];
  const response = await call(alice, "POST", `/${project.id}/lyrics/generate`, {
    theme: "Fête", flow: "relaxed", measures: 4, regenerate: { from: 1, to: 1, lines },
  });
  assert.equal(response.status, 502);
  assert.match(response.body.message, /La mesure 1 régénérée.*5 syllabes/u);
  assert.equal(groq.mock.callCount(), 1);
  assert.equal((await call(alice, "GET", `/${project.id}`)).body.revision, 0);
});

test("M12 : une mesure interne trop longue reprend la partie courte séparée par une virgule", async (t) => {
  let ending;
  const groq = stubGroq(t, "test-key", (_url, options) => {
    const { messages } = JSON.parse(options.body);
    ending = messages[0].content.split("Fins par numéro de mesure : 1=")[1].split(".")[0];
    return groqLyricsReply([
      { measure: 1, text: `Avec tous nos amis on danse et on chante, Voici ${ending}` },
      { measure: 2, text: "Une ligne hors de la sélection" },
    ]);
  });
  const { body: project } = await createProject(alice);
  const lines = ["On se voit ce soir", "Du bruit dans la nuit", "Un détour sans retour", "Des doutes sur la route"];
  const response = await call(alice, "POST", `/${project.id}/lyrics/generate`, {
    theme: "Fête", rhymeScheme: "internal", flow: "relaxed", measures: 4, regenerate: { from: 1, to: 1, lines },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lines.map(line => line.text), [`Voici ${ending}`, ...lines.slice(1)]);
  assert.ok(Math.abs(response.body.lines[0].syllables - 7) <= 2);
  assert.ok(response.body.lines[0].rhyme.matches);
  assert.equal(groq.mock.callCount(), 1);
});

test("M12 : une valeur hors contrat est rejetée avant tout appel à Groq", async (t) => {
  const groq = stubGroq(t, "test-key", () => assert.fail("Appel Groq interdit"));
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  const rejected = [
    ["mood", "surprise"], ["language", "es"], ["structure", "solo"], ["measures", "8"],
    ["measures", 9], ["flow", null], ["rhymeScheme", "AAAA"], ["languageLevel", []],
  ];
  for (const [field, value] of rejected) {
    const response = await call(alice, "POST", route, { theme: "La nuit", [field]: value });
    assert.equal(response.status, 400);
    assert.equal(response.body.field, field);
  }
  assert.equal((await call(alice, "POST", route, [])).status, 400);
  assert.equal((await call(alice, "POST", route, { theme: 42 })).status, 400);
  assert.equal(groq.mock.callCount(), 0);
});

test("M12 : thème invalide ou clé factice, aucune demande à Groq", async (t) => {
  const groq = stubGroq(t, "YOUR_GROQ_API_KEY", () => assert.fail("Appel Groq interdit"));
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  assert.equal((await call(alice, "POST", route, { theme: " " })).status, 400);
  assert.equal((await call(alice, "POST", route, { theme: "x".repeat(201) })).status, 400);
  assert.equal((await call(alice, "POST", route, { theme: "La nuit" })).status, 503);
  assert.equal(groq.mock.callCount(), 0);
  assert.equal(lyricsAttempts.size, 0);
});

test("M12 : les erreurs et réponses incomplètes de Groq donnent des messages sans contenu privé", async (t) => {
  const responses = [
    () => Response.json({ error: "contenu privé" }, { status: 429 }),
    () => groqLyricsReply(lyricLines.slice(0, 7)),
    () => groqLyricsReply([lyricLines[1], ...lyricLines.slice(1)]),
    () => groqLyricsReply([{ measure: 1, text: "123 !" }, ...lyricLines.slice(1)]),
    () => { throw new DOMException("contenu privé", "TimeoutError"); },
  ];
  stubGroq(t, "test-key", () => responses.shift()());
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  for (const expectedStatus of [429, 502, 502, 502, 504]) {
    const { status, body } = await call(alice, "POST", route, { theme: "La nuit" });
    assert.equal(status, expectedStatus);
    assert.equal(typeof body.message, "string");
    assert.doesNotMatch(body.message, /contenu privé/);
  }
});

test("M12 : cinq tentatives par compte entre plusieurs projets, même en parallèle, puis remise à zéro à minuit UTC", async (t) => {
  let now = Date.UTC(2026, 0, 1, 23, 55);
  t.mock.method(Date, "now", () => now);
  const groq = stubGroq(t, "test-key", () => groqLyricsReply(lyricLines));
  const projectsOfAlice = [(await createProject(alice)).body, (await createProject(alice)).body];
  const bobsProject = (await createProject(bob)).body;
  const generate = (user, project) => call(user, "POST", `/${project.id}/lyrics/generate`, { theme: "La nuit" });

  const results = await Promise.all(Array.from({ length: 7 }, (_, index) => generate(alice, projectsOfAlice[index % 2])));
  assert.equal(results.filter(({ status }) => status === 200).length, 5);
  const refused = results.filter(({ status }) => status === 429);
  assert.equal(refused.length, 2);
  assert.equal(groq.mock.callCount(), 5);
  for (const response of refused) {
    assert.equal(response.retryAfter, "300");
    assert.equal(response.body.retryAfterSeconds, 300);
  }
  assert.equal((await generate(bob, bobsProject)).status, 200);
  now += 300_000;
  assert.equal((await generate(alice, projectsOfAlice[0])).status, 200);
  assert.equal(groq.mock.callCount(), 7);
});

test("M12 : le délai Retry-After de Groq suspend les appels pour tous les comptes", async (t) => {
  let now = Date.UTC(2026, 0, 1, 12);
  t.mock.method(Date, "now", () => now);
  let throttled = true;
  const groq = stubGroq(t, "test-key", () => throttled
    ? Response.json({ error: "contenu privé" }, { status: 429, headers: { "Retry-After": "30" } })
    : groqLyricsReply(lyricLines),
  );
  const alicesProject = (await createProject(alice)).body;
  const bobsProject = (await createProject(bob)).body;
  const generate = (user, project) => call(user, "POST", `/${project.id}/lyrics/generate`, { theme: "La nuit" });
  const initial = await generate(alice, alicesProject);
  assert.equal(initial.status, 429);
  assert.equal(initial.retryAfter, "30");
  now += 5_000;
  const suspended = await generate(bob, bobsProject);
  assert.equal(suspended.status, 429);
  assert.equal(suspended.retryAfter, "25");
  assert.equal(suspended.body.retryAfterSeconds, 25);
  assert.equal(groq.mock.callCount(), 1);
  assert.deepEqual([...lyricsAttempts.values()], [1]);
  now += 25_000;
  throttled = false;
  assert.equal((await generate(bob, bobsProject)).status, 200);
  assert.equal(groq.mock.callCount(), 2);
});

test("M12 : les demandes explicites d’imitation et de copie sont refusées avant Groq et le quota", async (t) => {
  const groq = stubGroq(t, "test-key", () => assert.fail("Appel Groq interdit"));
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  for (const theme of ["Imite la voix de Ninho", "Récite mot pour mot les paroles du refrain", "Copy the lyrics of the song", "Imitate the style of the singer"]) {
    const response = await call(alice, "POST", route, { theme });
    assert.equal(response.status, 422);
    assert.match(response.body.message, /paroles originales/);
  }
  assert.equal(groq.mock.callCount(), 0);
  assert.equal(lyricsAttempts.size, 0);
});

test("M12 : un thème original à propos d’un artiste et un genre de rap restent acceptés", async (t) => {
  const groq = stubGroq(t, "test-key", () => groqLyricsReply(lyricLines));
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  const theme = "Le souvenir d’un concert de Ninho à Paris, dans un univers boom bap";
  assert.equal((await call(alice, "POST", route, { theme })).status, 200);
  const request = JSON.parse(groq.mock.calls[0].arguments[1].body);
  assert.match(request.messages[0].content, /haineuses ou harcelantes/);
  assert.equal(JSON.parse(request.messages[1].content).theme, theme);
});

test("M12 : l’API relaie un refus de Groq et écarte un refus accompagné de paroles", async (t) => {
  const responses = [groqLyricsReply([], true), groqLyricsReply(lyricLines, true), groqLyricsReply([])];
  stubGroq(t, "test-key", () => responses.shift());
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate`;
  const response = await call(alice, "POST", route, { theme: "À la manière de Ninho" });
  assert.equal(response.status, 422);
  assert.deepEqual(response.body, { message: "Cette demande est refusée. Choisissez un thème pour des paroles originales" });
  const malformed = await call(alice, "POST", route, { theme: "À la manière de Ninho" });
  assert.equal(malformed.status, 502);
  assert.deepEqual(malformed.body, { message: "Groq a renvoyé une réponse de génération invalide" });
  const emptyGeneration = await call(alice, "POST", route, { theme: "La nuit" });
  assert.equal(emptyGeneration.status, 502);
  assert.deepEqual(emptyGeneration.body, { message: "Groq a renvoyé un nombre de mesures incorrect" });
});

test("M12 : thème, paroles et détails des erreurs restent hors des logs", async (t) => {
  const theme = "theme-prive-m12";
  const lyric = "Paroles confidentielles du refrain Mdouze";
  const providerError = "erreur-brute-confidentielle-groq";
  const databaseError = "erreur-interne-confidentielle-mongo";
  const apiKey = "cle-privee-test-m12";
  const invalidId = "identifiant-prive-test-m12";
  const replies = [
    groqLyricsReply([{ measure: 1, text: lyric }, ...lyricLines.slice(1)]),
    Response.json({ error: { message: providerError } }, { status: 500 }),
  ];
  stubGroq(t, apiKey, () => replies.shift());
  const { body: project } = await createProject(alice);
  const route = `/${project.id}/lyrics/generate?theme=${theme}`;
  const logs = [];
  for (const level of ["log", "warn", "error"]) {
    t.mock.method(console, level, (...args) => logs.push(format(...args)));
  }

  const generated = await call(alice, "POST", route, { theme });
  assert.equal(generated.status, 200);
  assert.ok(generated.body.lines[0].text.startsWith(lyric));

  const malformed = await fetch(base + route, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: `{"theme":"${theme}",`,
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { message: "JSON invalide" });
  const tooLarge = await call(alice, "POST", route, { theme: theme + "x".repeat(1024 * 1024) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await call(alice, "POST", route, { theme })).status, 502);
  assert.equal((await call(null, "POST", `/${invalidId}/lyrics/generate`, { theme })).status, 401);

  t.mock.method(MusicalProject, "findOne", () => { throw new Error(databaseError); });
  const unexpected = await call(alice, "POST", route, { theme });
  assert.equal(unexpected.status, 500);
  assert.deepEqual(unexpected.body, { message: "Une erreur interne empêche la génération des paroles" });

  const captured = logs.join("\n");
  for (const marker of [theme, lyric, providerError, databaseError, apiKey, invalidId]) {
    assert.equal(captured.includes(marker), false);
  }
  for (const status of [200, 400, 401, 413, 500, 502]) {
    assert.ok(captured.includes(`POST /api/projects/:id/lyrics/generate -> ${status}`));
  }
});
