import test, { mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { createApp } from "../src/app.js";
import { MusicalProject } from "../src/models/MusicalProject.js";
import { Publication } from "../src/models/Publication.js";
import { User } from "../src/models/User.js";
import { PUBLICATIONS_DIR, wavDurationSeconds } from "../src/routes/publications.js";

/*
 * Tests HTTP des routes /api/publications (#80). MongoDB est remplacé par un
 * stockage en mémoire ; les fichiers sont réellement écrits dans
 * data/publications puis vérifiés (suppression après refus ou retrait).
 */

const publications = new Map();
const alice = new mongoose.Types.ObjectId().toString();
const bob = new mongoose.Types.ObjectId().toString();
const aliceProject = new mongoose.Types.ObjectId().toString();
const names = new Map([[alice, "Alice"], [bob, "Bob"]]);
const secret = process.env.JWT_SECRET || "tp1-development-secret";

function query(result) {
  const chain = {
    sort: () => chain,
    skip: (count) => query(result.slice(count)),
    limit: (count) => query(result.slice(0, count)),
    select: () => chain,
    lean: async () => (Array.isArray(result) ? result.map((doc) => doc.toObject?.() ?? doc) : (result?.toObject?.() ?? result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

const matching = (filter) =>
  [...publications.values()]
    .filter((doc) => Object.entries(filter).every(([key, value]) => String(doc.get(key)) === String(value)))
    .sort((a, b) => b.createdAt - a.createdAt);

let server, base;

test.before(async () => {
  mock.method(Publication, "create", async (data) => {
    const document = new Publication(data);
    await document.validate();
    document.createdAt = document.updatedAt = new Date(Date.now() + publications.size);
    publications.set(String(document._id), document);
    return document;
  });
  mock.method(Publication, "find", (filter) => query(matching(filter)));
  mock.method(Publication, "countDocuments", async (filter) => matching(filter).length);
  mock.method(Publication, "findOne", (filter) => query(matching(filter)[0] ?? null));
  mock.method(Publication, "findOneAndDelete", (filter) => {
    const document = matching(filter)[0] ?? null;
    if (document) publications.delete(String(document._id));
    return query(document);
  });
  mock.method(MusicalProject, "findOne", ({ _id, ownerId }) =>
    query(String(_id) === aliceProject && String(ownerId) === alice ? { bpm: 92, key: { root: 2, scale: "minor" } } : null),
  );
  mock.method(User, "find", ({ _id }) => query(_id.$in.filter((id) => names.has(id)).map((id) => ({ _id: id, name: names.get(id) }))));
  mock.method(User, "findById", (id) => query({ _id: id, name: names.get(String(id)) }));

  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/publications`;
});

test.after(async () => {
  await removeStoredFiles();
  mock.restoreAll();
  server.close();
});

/** Supprime les fichiers des publications créées par un test. */
async function removeStoredFiles() {
  for (const document of publications.values()) {
    await fs.rm(path.join(PUBLICATIONS_DIR, document.storedName), { force: true });
  }
  publications.clear();
}

test.beforeEach(removeStoredFiles);

/** WAV PCM stéréo 16 bits à 44,1 kHz de la durée demandée (silence). */
function wav(seconds) {
  const byteRate = 44100 * 2 * 2;
  const dataBytes = Math.round(seconds * byteRate);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

const bearer = (user) => ({ Authorization: `Bearer ${jwt.sign({ sub: user }, secret)}` });

async function publish(user, fields = {}, audio = wav(0.5), type = "audio/wav") {
  const form = new FormData();
  const values = { projectId: aliceProject, title: "Minuit", description: "Premier son", ...fields };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) form.append(key, value);
  if (audio) form.append("audio", new Blob([audio], { type }), "mix.wav");
  const response = await fetch(base, { method: "POST", headers: user ? bearer(user) : {}, body: form });
  return { status: response.status, body: await response.json() };
}

async function get(pathname, user) {
  const response = await fetch(base + pathname, { headers: user ? bearer(user) : {} });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const storedFiles = async () => (await fs.readdir(PUBLICATIONS_DIR)).filter((name) => name.endsWith(".wav"));

test("publier : 401 sans JWT", async () => {
  assert.equal((await publish(null)).status, 401);
});

test("publier : auteur tiré du JWT, tempo et tonalité copiés du projet, durée lue dans le WAV", async () => {
  const { status, body } = await publish(alice, { authorId: bob, bpm: "999" });
  assert.equal(status, 201);
  assert.equal(body.author.id, alice);
  assert.equal(body.author.name, "Alice");
  assert.equal(body.title, "Minuit");
  assert.equal(body.description, "Premier son");
  assert.equal(body.bpm, 92);
  assert.deepEqual(body.key, { root: 2, scale: "minor" });
  assert.equal(body.durationSeconds, 0.5);
  assert.equal(body.storedName, undefined);
  assert.equal(body.projectId, undefined);
});

test("publier le projet d'un autre utilisateur : 404, fichier supprimé", async () => {
  const before = await storedFiles();
  const { status } = await publish(bob);
  assert.equal(status, 404);
  assert.deepEqual(await storedFiles(), before);
});

test("publier : titre, description, projet et fichier validés, fichier refusé supprimé", async () => {
  const before = await storedFiles();
  assert.equal((await publish(alice, { title: "  " })).status, 400);
  assert.equal((await publish(alice, { title: "x".repeat(81) })).status, 400);
  assert.equal((await publish(alice, { description: "x".repeat(501) })).status, 400);
  assert.equal((await publish(alice, { projectId: "pas-un-id" })).status, 400);
  assert.equal((await publish(alice, {}, null)).status, 400);
  assert.equal((await publish(alice, {}, Buffer.from("pas un wav du tout"))).status, 400);
  assert.equal((await publish(alice, {}, wav(0.1), "audio/mpeg")).status, 400);
  assert.deepEqual(await storedFiles(), before);
  assert.equal(publications.size, 0);
});

test("liste publique paginée, plus récentes d'abord, sans authentification", async () => {
  for (const title of ["Un", "Deux", "Trois"]) await publish(alice, { title });
  const { status, body } = await get("?page=1&limit=2");
  assert.equal(status, 200);
  assert.deepEqual(body.items.map((item) => item.title), ["Trois", "Deux"]);
  assert.equal(body.total, 3);
  assert.equal(body.pages, 2);
  assert.equal((await get("?page=2&limit=2")).body.items.length, 1);
  assert.equal((await get("?limit=500")).body.limit, 50);
});

test("mes publications : authentification requise, filtre sur l'auteur", async () => {
  await publish(alice);
  assert.equal((await get("/mine")).status, 401);
  assert.equal((await get("/mine", alice)).body.total, 1);
  assert.equal((await get("/mine", bob)).body.total, 0);
});

test("écoute publique du mix, avec les requêtes Range", async () => {
  const { body: created } = await publish(alice);
  const full = await fetch(`${base}/${created.id}/audio`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/wav");
  assert.equal((await full.arrayBuffer()).byteLength, wav(0.5).length);
  const partial = await fetch(`${base}/${created.id}/audio`, { headers: { Range: "bytes=0-11" } });
  assert.equal(partial.status, 206);
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString("ascii", 8, 12), "WAVE");
  assert.equal((await fetch(`${base}/pas-un-id/audio`)).status, 404);
});

test("retrait : seul l'auteur retire sa publication, le fichier est supprimé", async () => {
  const { body: created } = await publish(alice);
  const remove = (user) => fetch(`${base}/${created.id}`, { method: "DELETE", headers: user ? bearer(user) : {} });
  assert.equal((await remove(null)).status, 401);
  assert.equal((await remove(bob)).status, 404);
  assert.equal((await get(`/${created.id}`)).status, 200);
  const before = (await storedFiles()).length;
  assert.equal((await remove(alice)).status, 204);
  assert.equal((await get(`/${created.id}`)).status, 404);
  assert.equal((await storedFiles()).length, before - 1);
});

test("durée d'un WAV : en-tête lu, fichier invalide refusé", async () => {
  const file = path.join(PUBLICATIONS_DIR, "test-duree.wav");
  try {
    const buffer = wav(1.25);
    await fs.writeFile(file, buffer);
    assert.equal(await wavDurationSeconds(file, buffer.length), 1.25);
    await fs.writeFile(file, Buffer.from("RIFF----WAVEjunk"));
    assert.equal(await wavDurationSeconds(file, 16), null);
  } finally {
    await fs.rm(file, { force: true });
  }
});
