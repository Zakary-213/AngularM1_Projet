import mongoose from "mongoose";

export const MAX_LYRICS_THEME_LENGTH = 200;
export const MAX_LYRICS_LINE_LENGTH = 240;
export const MAX_LYRICS_HISTORY = 5;
export const LYRICS_OPTION_VALUES = {
  mood: ["neutral", "dark", "melancholic", "egoTrip", "festive"],
  language: ["fr", "en"],
  structure: ["verse", "chorus", "bridge"],
  measures: [4, 8, 16],
  flow: ["relaxed", "standard", "fast"],
  rhymeScheme: ["AABB", "ABAB", "internal"],
  languageLevel: ["casual", "standard", "formal"],
};

const optionsSchema = new mongoose.Schema({
  theme: { type: String, required: true, trim: true, maxlength: MAX_LYRICS_THEME_LENGTH },
  ...Object.fromEntries(Object.entries(LYRICS_OPTION_VALUES).map(([name, values]) => [
    name, { type: name === "measures" ? Number : String, required: true, enum: values },
  ])),
}, { _id: false });

const verseSchema = new mongoose.Schema({
  options: { type: optionsSchema, required: true },
  bpm: { type: Number, required: true, min: 60, max: 200 },
  targetSyllables: { type: Number, required: true, min: 1, max: 64, validate: Number.isInteger },
  lines: {
    type: [{ type: String, maxlength: MAX_LYRICS_LINE_LENGTH }],
    validate: function (lines) {
      return lines.length === this.options?.measures && lines.every(line => typeof line === "string" && !/[\r\n]/u.test(line));
    },
  },
}, { _id: false });

export const projectLyricsSchema = new mongoose.Schema({
  current: { type: verseSchema, required: true },
  history: { type: [verseSchema], default: [], validate: history => history.length <= MAX_LYRICS_HISTORY },
}, { _id: false });
