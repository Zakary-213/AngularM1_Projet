import test, { mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { createApp } from "../src/app.js";
import { MusicalProject } from "../src/models/MusicalProject.js";
import { Track } from "../src/models/Track.js";

/*
 * Tests HTTP des routes /api/projects. MongoDB est remplacé par un stockage en
 * mémoire branché sur les méthodes statiques du modèle : on vérifie les droits,
 * la validation et les conflits de révision, pas le comportement de MongoDB.
 * La validation Mongoose (schéma réel) est bien exécutée.
 */

const store = new Map();
/** Fichiers audio de la bibliothèque : identifiant → propriétaire. */
const audioFiles = new Map();
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
});

async function call(user, method, path = "", body) {
  const headers = { "Content-Type": "application/json" };
  if (user) headers.Authorization = `Bearer ${jwt.sign({ sub: user }, secret)}`;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
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
  assert.equal(body.formatVersion, 2);
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
  assert.equal(saved.body.formatVersion, 2);
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
  store.get(project.id).set("formatVersion", 3, { strict: false });
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

test("M10 : un projet au format v1 s'ouvre tel quel et passe en v2 à la sauvegarde", async () => {
  const { body: project } = await createProject(alice);
  store.get(project.id).set("formatVersion", 1);
  assert.equal((await call(alice, "GET", `/${project.id}`)).body.formatVersion, 1);
  const saved = await call(alice, "PUT", `/${project.id}`, { revision: 0, bpm: 100 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.formatVersion, 2);
  assert.equal(saved.body.bpm, 100);
});
