const frenchVowels = /eaux?|au|ai|ei|ou|œu|eu|oi|ui|ie|[aeiouyàâäéèêëîïôöùûüœæ]/gu;
const englishVowels = /[aeiouy]+/g;
const rhymePatterns = { AABB: [0, 0, 1, 1], ABAB: [0, 1, 0, 1] };

export function rhymePairForMeasure(index, rhymeScheme) {
  const pattern = rhymePatterns[rhymeScheme];
  const position = index % pattern.length;
  const group = pattern[position];
  const blockStart = index - position;
  const otherPosition = pattern.findIndex((value, candidate) => value === group && candidate !== position);
  return { group: blockStart / 2 + group, partner: blockStart + otherPosition };
}

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

function countSyllables(words, language) {
  return words.reduce((total, word) => total + estimateWord(word, language), 0);
}

export function estimateLyricSyllables(text, language) {
  return countSyllables(wordsIn(text), language);
}

function rhymeEnding(word, language) {
  if (!word) return "";
  if (language === "fr" && /^[cmnst]['’]est$/u.test(word)) return "è";
  let letters = word.split(/['’]/u).at(-1);
  if (language === "fr") {
    letters = letters
      .replace(/qu/gu, "q")
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
    if (word.length < 3) continue;
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
    return rhymePairForMeasure(index, rhymeScheme);
  });

  return lines.map((line, index) => {
    const syllables = countSyllables(words[index], language);
    const pair = groups[index];
    if (pair === null) {
      const internal = internalRhyme(words[index], language);
      return { ...line, syllables, rhyme: { group: null, words: internal, matches: internal.length === 2 } };
    }

    const { group, partner } = pair;
    const lastWord = words[index].at(-1);
    const firstInBlock = Math.floor(index / 4) * 4;
    const blockEndings = endings.slice(firstInBlock, firstInBlock + 4);
    const sameSoundThroughout = blockEndings.length === 4 && blockEndings.every(ending => ending === endings[index]);
    const matches = Boolean(endings[index] && endings[index] === endings[partner] && lastWord !== words[partner]?.at(-1) && !sameSoundThroughout);
    return { ...line, syllables, rhyme: { group: String.fromCharCode(65 + group), words: lastWord ? [lastWord] : [], matches } };
  });
}
