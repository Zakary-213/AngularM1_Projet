import { randomInt } from "node:crypto";
import { analyzeLyrics, estimateLyricSyllables, rhymePairForMeasure } from "./lyrics-analysis.js";

const RHYME_PAIRS = {
  fr: [
    ["brume", "plume"], ["soir", "espoir"], ["route", "doute"], ["ville", "tranquille"],
    ["nuit", "bruit"], ["ombre", "sombre"], ["orage", "visage"], ["lumière", "poussière"],
    ["rêve", "trêve"], ["détour", "retour"], ["feu", "jeu"], ["rue", "vue"],
  ],
  en: [
    ["night", "light"], ["day", "way"], ["sound", "ground"], ["street", "meet"],
    ["cold", "bold"], ["dream", "stream"], ["game", "name"], ["song", "strong"],
    ["road", "load"], ["rain", "train"],
  ],
};

const INTERNAL_RHYME_PHRASES = {
  fr: [
    "du bruit dans la nuit", "un détour sans retour", "des doutes sur la route", "un rêve de trêve",
    "une plume dans la brume", "la ville reste tranquille", "un visage dans l’orage", "le soir, un peu d’espoir",
    "l’ombre devient sombre", "de la lumière sur la poussière", "un jeu près du feu", "une histoire en mémoire",
    "à voix basse, sans impasse", "le matin, même refrain", "rien ne freine ma peine", "un sourire, puis un soupir",
  ],
  en: [
    "the night in the light", "one day on my way", "the sound of the ground", "on the street where we meet",
    "the cold makes me bold", "a dream by the stream", "my name in the game", "a strong song",
    "the load on the road", "a train in the rain", "with grace in this place", "the spark in the dark",
    "with pride by your side", "a seat in the heat", "fast at last", "the bell I know well",
  ],
};

function pairedEndings(language, rhymeScheme, firstMeasure, lastMeasure, regenerate) {
  const pairs = RHYME_PAIRS[language];
  const vocabulary = pairs.flat();
  const start = randomInt(pairs.length);
  const outside = index => index < firstMeasure - 1 || index >= lastMeasure;
  const rhymes = (text, word) => analyzeLyrics([{ text }, { text: word }], language, "AABB")[0].rhyme.matches;
  return Array.from({ length: lastMeasure - firstMeasure + 1 }, (_, offset) => {
    const index = firstMeasure + offset - 1;
    const { group, partner } = rhymePairForMeasure(index, rhymeScheme);
    if (regenerate && outside(partner)) {
      return vocabulary.find(word => rhymes(regenerate.lines[partner], word));
    }
    let pair = pairs[(start + group) % pairs.length];
    if (regenerate) {
      const blockStart = Math.floor(index / 4) * 4;
      const kept = [0, 1, 2, 3].map(offset => blockStart + offset).filter(outside);
      const distinct = candidate => kept.every(position => candidate.every(word => !rhymes(regenerate.lines[position], word)));
      if (!distinct(pair)) pair = pairs.find(distinct) ?? pair;
    }
    return pair[index < partner ? 0 : 1];
  });
}

export function planRhymeEndings({ language, rhymeScheme, firstMeasure, lastMeasure, targetSyllables, regenerate }) {
  if (rhymeScheme !== "internal") return pairedEndings(language, rhymeScheme, firstMeasure, lastMeasure, regenerate);

  const phrases = INTERNAL_RHYME_PHRASES[language];
  const fits = phrases.filter(text => estimateLyricSyllables(text, language) <= targetSyllables);
  const pool = fits.length ? fits : phrases;
  const start = randomInt(pool.length);
  return Array.from({ length: lastMeasure - firstMeasure + 1 }, (_, offset) => pool[(start + offset) % pool.length]);
}

export function completeRhymeLines(lines, endings, { language, rhymeScheme, targetSyllables }) {
  const internal = rhymeScheme === "internal" ? analyzeLyrics(lines, language, rhymeScheme) : [];
  return lines.map((line, index) => {
    const ending = endings[index];
    if (!ending) return line;
    const prefix = line.text.replace(/[.!?…,:;]+$/u, "").trimEnd();
    const plannedWords = ending.toLowerCase().match(/\p{L}+/gu);
    const words = [...prefix.matchAll(/\p{L}+/gu)];
    const existing = words.findLastIndex((_, index) => plannedWords.every((word, offset) => word === words[index + offset]?.[0].toLowerCase()));
    let text;
    if (existing >= 0) {
      const lastWord = words[existing + plannedWords.length - 1];
      const end = lastWord.index + lastWord[0].length;
      text = end === prefix.length ? line.text : prefix.slice(0, end);
    } else {
      const separator = /['’]$/u.test(prefix) ? "" : " ";
      text = `${prefix}${separator}${ending}`.trim();
    }
    const original = internal[index];
    if (original?.rhyme.matches &&
        Math.abs(original.syllables - targetSyllables) <= Math.abs(estimateLyricSyllables(text, language) - targetSyllables)) {
      return line;
    }
    return { ...line, text };
  });
}
