import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLyrics } from "../src/services/lyrics-analysis.js";
import { completeRhymeLines, planRhymeEndings } from "../src/services/lyrics-rhyme-plan.js";

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

test("M12 : en ABAB, une seule paire qui rime ne valide pas les deux", () => {
  const result = analyzeLyrics(measures(["Je reste retenu", "J’allume un feu", "Les espoirs perdus", "Je danse sans retenue"]), "fr", "ABAB");
  assert.deepEqual(result.map(({ rhyme }) => [rhyme.group, rhyme.matches]), [["A", true], ["B", false], ["A", true], ["B", false]]);
});

test("M12 : la rime française tient compte du u muet dans tranquille", () => {
  const result = analyzeLyrics(measures(["En ville", "Dans la nuit", "Je reste tranquille", "J’entends du bruit"]), "fr", "ABAB");
  assert.deepEqual(result.map(({ rhyme }) => rhyme.matches), [true, true, true, true]);
});

test("M12 : quatre fins avec le même son ne forment pas deux rimes distinctes", () => {
  const result = analyzeLyrics(measures(["En plein jour", "J’attends mon tour", "Je fais un détour", "Je suis de retour"]), "fr", "ABAB");
  assert.deepEqual(result.map(({ rhyme }) => rhyme.matches), [false, false, false, false]);
});

test("M12 : les rimes internes exposent les mots qui riment", () => {
  const result = analyzeLyrics(measures(["Je rêve d’une trêve dans la nuit", "La foule quitte la ville"]), "fr", "internal");
  assert.deepEqual(result.map(({ rhyme }) => rhyme), [
    { group: null, words: ["rêve", "trêve"], matches: true },
    { group: null, words: [], matches: false },
  ]);
});

test("M12 : les fragments internes français et anglais contiennent tous deux mots qui riment", () => {
  for (const language of ["fr", "en"]) {
    const options = { language, rhymeScheme: "internal", firstMeasure: 1, lastMeasure: 16, targetSyllables: 64 };
    const lines = planRhymeEndings(options);
    const analysis = analyzeLyrics(measures(lines), language, "internal");
    assert.equal(new Set(lines).size, 16);
    for (const line of analysis) {
      assert.ok(line.rhyme.matches, line.text);
      assert.equal(line.rhyme.words.length, 2);
    }
  }
});

test("M12 : une rime interne déjà naturelle et proche de la cible peut être conservée", () => {
  const lines = measures(["Je rêve d’une trêve", "C’est ici que je reste"]);
  const options = { language: "fr", rhymeScheme: "internal", targetSyllables: 5 };
  const completed = completeRhymeLines(lines, ["du bruit dans la nuit", "un jeu près du feu"], options);
  assert.equal(completed[0].text, lines[0].text);
  assert.match(completed[1].text, /un jeu près du feu$/u);
  assert.deepEqual(analyzeLyrics(completed, "fr", "internal")[1].rhyme.words, ["jeu", "feu"]);
});
