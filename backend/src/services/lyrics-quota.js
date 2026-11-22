import { LyricsQuota } from "../models/LyricsQuota.js";

export const LYRICS_DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function reserveLyricsAttempt(userId, now = Date.now()) {
  const day = Math.floor(now / DAY_MS);
  const resetAt = (day + 1) * DAY_MS;
  const filter = { _id: `${userId}:${day}`, attempts: { $lt: LYRICS_DAILY_LIMIT } };
  const update = {
    $inc: { attempts: 1 },
    // Le compteur du lendemain a son propre identifiant. Le TTL ne sert qu’au nettoyage.
    $setOnInsert: { expiresAt: new Date(resetAt + DAY_MS) },
  };

  let result;
  try {
    result = await LyricsQuota.updateOne(filter, update, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // Le compteur a déjà été créé par une autre demande ou il est plein.
    result = await LyricsQuota.updateOne(filter, update);
  }

  return {
    allowed: result.matchedCount === 1 || result.upsertedCount === 1,
    retryAfterSeconds: Math.ceil((resetAt - now) / 1000),
  };
}
