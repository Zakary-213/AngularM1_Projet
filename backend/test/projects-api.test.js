import test, { mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { MusicalProject } from "../src/models/MusicalProject.js";

/*
 * Tests HTTP des routes /api/projects. MongoDB est remplacé par un stockage en
 * mémoire branché sur les méthodes statiques du modèle : on vérifie les droits,
 * la validation et les conflits de révision, pas le comportement de MongoDB.
 * La validation Mongoose (schéma réel) est bien exécutée.
 */

const store = new Map();

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

test.after(() => {
  mock.restoreAll();
  server.close();
});

test.beforeEach(() => store.clear());

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
  assert.equal(body.formatVersion, 1);
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
  assert.equal(saved.body.formatVersion, 1);
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
  store.get(project.id).set("formatVersion", 2, { strict: false });
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
