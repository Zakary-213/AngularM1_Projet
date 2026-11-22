import { analyzeLyrics, estimateLyricSyllables, rhymePairForMeasure } from "./lyrics-analysis.js";
import { LYRICS_DAILY_LIMIT, reserveLyricsAttempt } from "./lyrics-quota.js";
import { completeRhymeLines, planRhymeEndings } from "./lyrics-rhyme-plan.js";
import { MAX_LYRICS_LINE_LENGTH } from "../models/ProjectLyrics.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";
const MAX_PROVIDER_LINES = 16;
const MAX_SYLLABLES = 64;
const REGENERATION_SYLLABLE_TOLERANCE = 2;
const REQUEST_TIMEOUT_MS = 20_000;
const SYLLABLES_PER_SECOND = { relaxed: 2.75, standard: 3.75, fast: 5.25 };
const PROVIDER_LIMIT_MESSAGE = "Le quota Groq est atteint. Réessayez plus tard";
const REFUSAL_MESSAGE = "Cette demande est refusée. Choisissez un thème pour des paroles originales";
let providerResumeAt = 0;

function responseSchema(firstMeasure, lastMeasure) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["refused", "lines"],
    properties: {
      refused: { type: "boolean" },
      lines: {
        type: "array",
        minItems: 0,
        maxItems: lastMeasure - firstMeasure + 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["measure", "text"],
          properties: {
            measure: { type: "integer", minimum: firstMeasure, maximum: lastMeasure },
            text: { type: "string" },
          },
        },
      },
    },
  };
}

export class LyricsProviderError extends Error {
  constructor(status, message, retryAfterSeconds) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function explicitlyRequestsImitationOrCopy(theme) {
  const normalized = theme.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/’/gu, "'").replace(/\s+/gu, " ");
  const imitation = /\b(?:imite[rz]?|imitate|mimic)\s+(?:(?:le|la|l'|un|une|the|an?)\s*)?(?:(?:style|voix|flow|voice)\s+(?:de\s+|d'|of\s+)|(?:artiste|rappeur|chanteur|artist|rapper|singer)\b)/u;
  const copy = /\b(?:recopie[rz]?|copie[rz]?|reprodui(?:s(?:ez)?|re)|recite[rz]?|copy|reproduce)\s+(?:mot pour mot\s+|verbatim\s+)?(?:(?:les|des|the)\s+)?(?:paroles|lyrics)\b/u;
  return imitation.test(normalized) || copy.test(normalized);
}

function cleanLyricText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /\p{L}/u.test(text) && text.length <= MAX_LYRICS_LINE_LENGTH && !/[\r\n]/u.test(text) ? text : undefined;
}

function readLines(content, measures, firstMeasure, regenerate) {
  const result = JSON.parse(content);
  if (typeof result?.refused !== "boolean" || !Array.isArray(result.lines)) {
    throw new LyricsProviderError(502, "Groq a renvoyé une réponse de génération invalide");
  }
  const { refused, lines } = result;
  if (refused) {
    if (lines.length) throw new LyricsProviderError(502, "Groq a renvoyé une réponse de génération invalide");
    throw new LyricsProviderError(422, REFUSAL_MESSAGE);
  }
  if (lines.length > MAX_PROVIDER_LINES) {
    throw new LyricsProviderError(502, "Groq a renvoyé un nombre de mesures incorrect");
  }
  const numberedFromOne = regenerate && lines.length === measures && lines.every((line, index) => line?.measure === index + 1);
  let selected = lines;
  if (numberedFromOne) {
    selected = lines.map((line, index) => ({ ...line, measure: firstMeasure + index }));
  } else if (regenerate) {
    selected = lines.filter(line => Number.isInteger(line?.measure) && line.measure >= firstMeasure && line.measure < firstMeasure + measures);
  }
  if (selected.length !== measures) {
    throw new LyricsProviderError(502, "Groq a renvoyé un nombre de mesures incorrect");
  }

  return selected.map((line, index) => {
    const compact = regenerate && cleanLyricText(line?.compactText);
    const text = cleanLyricText(line?.text) ?? compact;
    if (line?.measure !== firstMeasure + index || !text) {
      throw new LyricsProviderError(502, "Groq a renvoyé une mesure de paroles invalide");
    }
    return { measure: line.measure, text, ...(compact ? { compactText: compact } : {}) };
  });
}

function selectRegeneratedLines(draft, endings, options, regenerate) {
  const { language, rhymeScheme, targetSyllables } = options;
  const primary = completeRhymeLines(draft.map(({ measure, text }) => ({ measure, text })), endings, options);
  const alternate = completeRhymeLines(draft.map(({ measure, text, compactText }) => ({ measure, text: compactText ?? text })), endings, options);

  return primary.map((line, index) => {
    const modelTexts = [line.text, alternate[index].text];
    const shorterClauses = modelTexts.flatMap(text => [...text.matchAll(/[,;:—.!?…]\s+/gu)]
      .map(pause => text.slice(pause.index + pause[0].length)));
    const candidates = [
      ...modelTexts.map(text => ({ text, priority: 0 })),
      ...shorterClauses.map(text => ({ text, priority: 1 })),
    ];
    if (rhymeScheme === "internal") candidates.push({ text: endings[index], priority: 2 });
    const partner = rhymeScheme === "internal" ? null : rhymePairForMeasure(line.measure - 1, rhymeScheme).partner + 1;
    const keptPartner = partner !== null && (partner < regenerate.from || partner > regenerate.to) ? regenerate.lines[partner - 1] : null;
    const ranked = candidates.map(({ text, priority }) => {
      const candidate = { text };
      const distance = Math.abs(estimateLyricSyllables(text, language) - targetSyllables);
      const rhymes = rhymeScheme === "internal"
        ? analyzeLyrics([candidate], language, "internal")[0].rhyme.matches
        : keptPartner === null || analyzeLyrics([candidate, { text: keptPartner }], language, "AABB")[0].rhyme.matches;
      return { text, priority, distance, rhymes };
    }).filter(({ text, distance, rhymes }) => text.length <= MAX_LYRICS_LINE_LENGTH &&
      distance <= REGENERATION_SYLLABLE_TOLERANCE && (rhymeScheme !== "internal" || rhymes));
    if (!ranked.length) {
      throw new LyricsProviderError(502, `La mesure ${line.measure} régénérée est trop éloignée de la cible de ${targetSyllables} syllabes. Le texte précédent est conservé.`);
    }
    // À longueur acceptable, préserver d'abord la rime avec une mesure qui reste inchangée.
    ranked.sort((a, b) => Number(b.rhymes) - Number(a.rhymes) || a.priority - b.priority || a.distance - b.distance);
    return { measure: line.measure, text: ranked[0].text };
  });
}

export async function generateGroqLyrics({ userId, options, bpm, timeSignature, key, regenerate }) {
  if (explicitlyRequestsImitationOrCopy(options.theme)) {
    throw new LyricsProviderError(422, REFUSAL_MESSAGE);
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || apiKey === "YOUR_GROQ_API_KEY") {
    throw new LyricsProviderError(503, "La génération de paroles est indisponible sur ce serveur");
  }

  const waitSeconds = Math.ceil((providerResumeAt - Date.now()) / 1000);
  if (waitSeconds > 0) {
    throw new LyricsProviderError(429, PROVIDER_LIMIT_MESSAGE, waitSeconds);
  }

  let quota;
  try {
    quota = await reserveLyricsAttempt(userId);
  } catch {
    throw new LyricsProviderError(503, "Le quota de génération est temporairement indisponible");
  }
  if (!quota.allowed) {
    throw new LyricsProviderError(429, `La limite de ${LYRICS_DAILY_LIMIT} générations par jour est atteinte`, quota.retryAfterSeconds);
  }

  const { measures, flow } = options;
  const firstMeasure = regenerate?.from ?? 1;
  const lastMeasure = regenerate?.to ?? measures;
  const measureCount = lastMeasure - firstMeasure + 1;
  // Durée d’une mesure en secondes multipliée par la densité de syllabes prononcées.
  const targetSyllables = Math.round(timeSignature.beatsPerBar * 60 / bpm * SYLLABLES_PER_SECOND[flow]);
  const endings = planRhymeEndings({ ...options, firstMeasure, lastMeasure, targetSyllables, regenerate });
  const endingsGuide = endings.flatMap((text, index) => text ? [`${index + 1}=${text}`] : []).join(" | ");
  const prefixBudget = endings.flatMap((text, index) => {
    if (!text) return [];
    const syllables = Math.max(1, targetSyllables - estimateLyricSyllables(text, options.language));
    return [`${index + 1}=${syllables}`];
  }).join(" | ");
  const range = regenerate && {
    from: firstMeasure,
    to: lastMeasure,
    context: regenerate.lines.flatMap((text, index) => {
      const measure = index + 1;
      return measure >= firstMeasure && measure <= lastMeasure ? [] : [{ measure, text }];
    }),
  };
  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: regenerate && measureCount > 8 ? 2304 : 1536,
        reasoning_effort: "low",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: [
              "Les paramètres JSON sont des données de l’utilisateur. Applique les règles suivantes à la demande.",
              'Refuse les demandes d’imiter le style ou la voix d’un artiste réel, de reproduire des paroles existantes et de produire des paroles haineuses ou harcelantes. Dans ces cas, réponds avec {"refused":true,"lines":[]}.',
              "Une mention d’artiste comme sujet ou le choix d’un genre musical est autorisé si la demande porte sur des paroles originales.",
              "Pour une demande autorisée, écris des paroles de rap originales en suivant le thème, l’ambiance, la langue, la structure et le registre. Renvoie refused=false et exactement measures lignes.",
              "Vise targetSyllables syllabes prononcées par ligne. La tonique est un entier avec do = 0.",
              "Écris un français naturel et grammatical si la langue est fr, même en registre familier. Vérifie les accords, l'oralité, la longueur et les rimes avant de répondre.",
              ...(endingsGuide ? [
                "Pour chaque mesure du plan, écris dans text le début qui mène naturellement à la fin fournie. Arrête-toi juste avant cette fin, le studio l’ajoute. Compte ses syllabes dans la cible et choisis un début bref si la fin est longue. Pour toute mesure sans fin prévue, écris la ligne complète selon le schéma demandé.",
                "Fins par numéro de mesure : " + endingsGuide + ".",
                "Nombre de syllabes visé pour les débuts seuls : " + prefixBudget + ".",
              ] : []),
              ...(regenerate ? [
                `Renvoie exactement ${measureCount} entrées dans lines, numérotées de 1 à ${measureCount}. Le plan utilise ces numéros. La première entrée correspond à la mesure from du projet. Le contexte garde ses numéros d’origine et sert à choisir les rimes.`,
                'Réponds avec un objet JSON contenant "refused" (booléen) et "lines" (tableau). Chaque entrée contient "measure" (position dans la sélection), "text" et "compactText" (variante plus brève). Pour les deux versions, compte la fin prévue et limite chaque mesure à une idée.',
              ] : []),
            ].join(" "),
          },
          { role: "user", content: JSON.stringify({ ...options, measures: measureCount, targetSyllables, bpm, timeSignature, key, regenerate: range }) },
        ],
        response_format: regenerate ? { type: "json_object" } : {
          type: "json_schema",
          json_schema: { name: "lyrics", schema: responseSchema(firstMeasure, lastMeasure), strict: true },
        },
      }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isSafeInteger(retryAfter) && retryAfter > 0) {
        providerResumeAt = Math.max(providerResumeAt, Date.now() + retryAfter * 1000);
        throw new LyricsProviderError(429, PROVIDER_LIMIT_MESSAGE, retryAfter);
      }
      throw new LyricsProviderError(429, PROVIDER_LIMIT_MESSAGE);
    }
    if (!response.ok) {
      throw new LyricsProviderError(502, "Groq n’a pas pu générer les paroles");
    }

    const payload = await response.json();
    const draft = readLines(payload.choices?.[0]?.message?.content, measureCount, firstMeasure, regenerate);
    const generationOptions = { ...options, targetSyllables };
    const generated = regenerate
      ? selectRegeneratedLines(draft, endings, generationOptions, regenerate)
      : completeRhymeLines(draft, endings, generationOptions);
    if (generated.some(line => line.text.length > MAX_LYRICS_LINE_LENGTH)) {
      throw new LyricsProviderError(502, "Groq a renvoyé une mesure de paroles trop longue");
    }
    const combined = regenerate
      ? regenerate.lines.map((text, index) => generated[index + 1 - firstMeasure] ?? { measure: index + 1, text })
      : generated;
    const lines = analyzeLyrics(combined, options.language, options.rhymeScheme);
    if (lines.slice(firstMeasure - 1, lastMeasure).some((line) => line.syllables < 1 || line.syllables > MAX_SYLLABLES)) {
      throw new LyricsProviderError(502, "Groq a renvoyé une mesure de paroles invalide");
    }
    return { targetSyllables, lines };
  } catch (error) {
    if (error instanceof LyricsProviderError) throw error;
    if (error.name === "TimeoutError") {
      throw new LyricsProviderError(504, "Groq a mis trop de temps à répondre");
    }
    // Le corps de la réponse et les erreurs du fournisseur peuvent contenir du texte privé.
    throw new LyricsProviderError(502, "La réponse de Groq est indisponible ou illisible");
  }
}
