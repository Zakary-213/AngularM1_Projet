import test from "node:test";
import assert from "node:assert/strict";
import { LyricsQuota } from "../src/models/LyricsQuota.js";
import { reserveLyricsAttempt } from "../src/services/lyrics-quota.js";

test("M12 : deux créations concurrentes du compteur déclenchent une mise à jour conditionnelle", async (t) => {
  let first = true;
  const updateOne = t.mock.method(LyricsQuota, "updateOne", async () => {
    if (first) {
      first = false;
      throw Object.assign(new Error("Compteur créé en parallèle"), { code: 11000 });
    }
    return { matchedCount: 1, upsertedCount: 0 };
  });

  const now = Date.UTC(2026, 0, 1, 23, 59, 59);
  assert.deepEqual(await reserveLyricsAttempt("user", now), { allowed: true, retryAfterSeconds: 1 });
  const [insert, retry] = updateOne.mock.calls.map(({ arguments: args }) => args);
  assert.deepEqual(insert[0].attempts, { $lt: 5 });
  assert.deepEqual(insert[1].$inc, { attempts: 1 });
  assert.deepEqual(insert[2], { upsert: true });
  assert.deepEqual(retry, insert.slice(0, 2));
});
