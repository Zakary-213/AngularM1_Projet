import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLyrics } from "../src/services/lyrics-analysis.js";

const measures = (texts) => texts.map((text, index) => ({ measure: index + 1, text }));

test("M12 : estimation française avec élisions, e finaux muets et voyelles distinctes", () => {
  const [line] = analyzeLyrics(measures(["Sous les néons je marche, l’ombre s’étire comme un rêve"]), "fr", "internal");
  assert.equal(line.syllables, 12);
});

test("M12 : les rimes AABB signalent une paire qui ne rime pas", () => {
  const result = analyzeLyrics(measures(["Je rêve", "Une trêve", "Je regarde la foule", "Je marche dans la ville"]), "fr", "AABB");
  assert.deepEqual(result.map(({ rhyme }) => rhyme), [
    { group: "A", words: ["rêve"], matches: true },
    { group: "A", words: ["trêve"], matches: true },
    { group: "B", words: ["foule"], matches: false },
    { group: "B", words: ["ville"], matches: false },
  ]);
});

test("M12 : les rimes croisées anglaises suivent ABAB", () => {
  const result = analyzeLyrics(measures(["I walk through the night", "I find my way", "The sky is bright", "I wait for the day"]), "en", "ABAB");
  assert.deepEqual(result.map(({ syllables }) => syllables), [5, 4, 4, 5]);
  assert.deepEqual(result.map(({ rhyme }) => [rhyme.group, rhyme.matches]), [["A", true], ["B", true], ["A", true], ["B", true]]);
});

test("M12 : les rimes internes exposent les mots qui riment", () => {
  const result = analyzeLyrics(measures(["Je rêve d’une trêve dans la nuit", "La foule quitte la ville"]), "fr", "internal");
  assert.deepEqual(result.map(({ rhyme }) => rhyme), [
    { group: null, words: ["rêve", "trêve"], matches: true },
    { group: null, words: [], matches: false },
  ]);
});
