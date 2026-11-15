import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schémas Mongoose et relation", () => {
  const u = new User({
    name: "Test",
    email: "TEST@example.com",
    password: "12345678",
  });

  assert.equal(u.email, "test@example.com");
  const t = new Track({
    ownerId: new mongoose.Types.ObjectId(),
    title: "Blues",
    originalName: "b.mp3",
    storedName: "x.mp3",
    mimeType: "audio/mpeg",
    size: 42,
  });
  
  assert.equal(t.title, "Blues");
  assert.equal(Track.schema.path("ownerId").options.ref, "User");
});

// Les tests de la photo de profil s'arrêtent avant tout accès à MongoDB :
// ils vérifient l'authentification et la validation des fichiers.
const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ sub: new mongoose.Types.ObjectId().toString() }, process.env.JWT_SECRET || "tp1-development-secret")}`,
});

function avatarForm(bytes, type, name = "photo.png") {
  const form = new FormData();
  form.append("avatar", new Blob([bytes], { type }), name);
  return form;
}

test("avatar : 401 sans JWT", async () => {
  const r = await fetch(base + "/api/users/me/avatar", { method: "PUT", body: avatarForm(Buffer.from("x"), "image/png") });
  assert.equal(r.status, 401);
});

test("avatar : 400 sans fichier", async () => {
  const r = await fetch(base + "/api/users/me/avatar", { method: "PUT", headers: authHeader(), body: new FormData() });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Image requise");
});

test("avatar : 400 pour un type non image", async () => {
  const r = await fetch(base + "/api/users/me/avatar", {
    method: "PUT", headers: authHeader(), body: avatarForm(Buffer.from("hello"), "text/plain", "a.txt"),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /JPEG, PNG ou WebP/);
});

test("avatar : 400 si le contenu ne correspond pas au type annoncé", async () => {
  const r = await fetch(base + "/api/users/me/avatar", {
    method: "PUT", headers: authHeader(), body: avatarForm(Buffer.from("pas une image"), "image/png"),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, "Le fichier n'est pas une image valide");
});

test("avatar : 413 au-delà de 2 Mo", async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 1);
  const r = await fetch(base + "/api/users/me/avatar", { method: "PUT", headers: authHeader(), body: avatarForm(big, "image/png") });
  assert.equal(r.status, 413);
});

test("profil public : hasAvatar sans exposer le nom de stockage", () => {
  const u = new User({ name: "Test", email: "a@b.c", password: "12345678", avatarStoredName: "secret.png", avatarMimeType: "image/png" });
  const pub = u.toPublic();
  assert.equal(pub.hasAvatar, true);
  assert.equal("avatarStoredName" in pub, false);
});
