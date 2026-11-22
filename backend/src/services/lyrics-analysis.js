const frenchVowels = /eaux?|au|ai|ei|ou|œu|eu|oi|ui|ie|[aeiouyàâäéèêëîïôöùûüœæ]/gu;
const englishVowels = /[aeiouy]+/g;
const rhymePatterns = { AABB: [0, 0, 1, 1], ABAB: [0, 1, 0, 1] };

function wordsIn(text) {
  return text.normalize("NFC").toLowerCase().match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
}

function estimateWord(word, language) {
  if (language === "fr") {
    // Les groupes graphiques donnent une estimation en omettant les e finaux muets.
    return word.split(/['’]/u).reduce((total, part) => {
      const letters = part.replace(/qu/gu, "q");
      const spoken = letters.replace(/(?:ent|es|e)$/u, "");
      return total + ((spoken.match(frenchVowels) ?? letters.match(frenchVowels))?.length ?? 0);
    }, 0);
  }

  const letters = word.replace(/['’]/gu, "");
  const spoken = /[^aeiouy]le$/u.test(letters) ? letters : letters.replace(/e$/u, "");
  return (spoken.match(englishVowels) ?? letters.match(englishVowels))?.length ?? 0;
}

function rhymeEnding(word, language) {
  if (!word) return "";
  let letters = word.split(/['’]/u).at(-1);
  if (language === "fr") {
    letters = letters
      .replace(/(?:es|e|s|x)$/u, "")
      .replace(/ll$/u, "l")
      .replace(/(?:ain|ein)$/u, "in");
  } else if (!/[^aeiouy]le$/u.test(letters)) {
    letters = letters.replace(/e$/u, "");
  }

  const lastVowel = [...letters.matchAll(language === "fr" ? frenchVowels : englishVowels)].at(-1);
  return lastVowel ? letters.slice(lastVowel.index) : "";
}

function internalRhyme(words, language) {
  const endings = new Map();
  for (const word of words) {
    if (word.length < 4) continue;
    const ending = rhymeEnding(word, language);
    if (ending.length < 2) continue;
    const first = endings.get(ending);
    if (first && first !== word) return [first, word];
    endings.set(ending, word);
  }
  return [];
}

export function analyzeLyrics(lines, language, rhymeScheme) {
  const words = lines.map((line) => wordsIn(line.text));
  const endings = words.map((line) => rhymeEnding(line.at(-1), language));
  const groups = lines.map((_, index) => {
    if (rhymeScheme === "internal") return null;
    const group = Math.floor(index / 4) * 2 + rhymePatterns[rhymeScheme][index % 4];
    return String.fromCharCode(65 + group);
  });

  return lines.map((line, index) => {
    const syllables = words[index].reduce((total, word) => total + estimateWord(word, language), 0);
    const group = groups[index];
    if (group === null) {
      const pair = internalRhyme(words[index], language);
      return { ...line, syllables, rhyme: { group, words: pair, matches: pair.length === 2 } };
    }

    const partner = groups.findIndex((label, position) => label === group && position !== index);
    const lastWord = words[index].at(-1);
    const matches = Boolean(endings[index] && endings[index] === endings[partner] && lastWord !== words[partner]?.at(-1));
    return { ...line, syllables, rhyme: { group, words: lastWord ? [lastWord] : [], matches } };
  });
}
