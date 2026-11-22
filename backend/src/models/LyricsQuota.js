import mongoose from "mongoose";

const schema = new mongoose.Schema({
  // L’identifiant réunit le compte et le jour UTC, avec l’unicité native de MongoDB.
  _id: { type: String },
  attempts: { type: Number, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { versionKey: false });

export const LyricsQuota = mongoose.model("LyricsQuota", schema);
