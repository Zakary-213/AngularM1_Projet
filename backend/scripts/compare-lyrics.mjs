const measureCount = 8;
const targetSyllables = 10;
const tempos = [90, 140];
const maxOutputTokens = 1024;

const lyricsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      minItems: measureCount,
      maxItems: measureCount,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["measure", "text", "syllables"],
        properties: {
          measure: { type: "integer", minimum: 1, maximum: measureCount },
          text: { type: "string" },
          syllables: { type: "integer", minimum: 1 },
        },
      },
    },
  },
};

function buildPrompt(bpm) {
  return [
    `Écris un couplet original de rap en français sur « la nuit en ville » à ${bpm} BPM, en 4/4.`,
    `Écris ${measureCount} lignes, une par mesure, avec des rimes AABBCCDD et environ ${targetSyllables} syllabes prononcées par ligne.`,
    "Renvoie le numéro de chaque mesure, son texte et une estimation des syllabes prononcées.",
  ].join(" ");
}

async function postJson(url, headers, requestBody) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error("Délai de 20 secondes dépassé.");
    }
    throw new Error("Connexion à l’API impossible.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) {
      throw new Error("Réponse HTTP illisible ou délai dépassé.");
    }
  }
  if (!response.ok) {
    const code = payload?.error?.code;
    const detail = typeof code === "string" && /^[a-z_]{1,48}$/.test(code) ? ` (${code})` : "";
    throw new Error(`L’API a répondu HTTP ${response.status}${detail}.`);
  }
  return payload;
}

const providers = {
  gemini: {
    keyName: "GEMINI_API_KEY",
    model: "gemini-3.1-flash-lite",
    async generate(apiKey, prompt) {
      const payload = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens,
            responseMimeType: "application/json",
            responseJsonSchema: lyricsSchema,
            thinkingConfig: { thinkingLevel: "MINIMAL" },
          },
        },
      );
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      return {
        text: parts.filter((part) => !part.thought).map((part) => part.text).join(""),
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
        thinkingTokens: payload.usageMetadata?.thoughtsTokenCount,
      };
    },
  },
  groq: {
    keyName: "GROQ_API_KEY",
    model: "openai/gpt-oss-20b",
    async generate(apiKey, prompt) {
      const payload = await postJson(
        "https://api.groq.com/openai/v1/chat/completions",
        { Authorization: `Bearer ${apiKey}` },
        {
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: maxOutputTokens,
          reasoning_effort: "low",
          response_format: {
            type: "json_schema",
            json_schema: { name: "lyrics", schema: lyricsSchema, strict: true },
          },
        },
      );
      return {
        text: payload.choices?.[0]?.message?.content,
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      };
    },
  },
};

function parseLyrics(text) {
  let lyrics;
  try {
    lyrics = JSON.parse(text)?.lines;
  } catch {
    throw new Error("Le modèle n’a pas renvoyé un JSON lisible.");
  }
  if (!Array.isArray(lyrics) || lyrics.length !== measureCount) {
    throw new Error(`La réponse doit contenir ${measureCount} mesures.`);
  }
  for (const [index, line] of lyrics.entries()) {
    if (line?.measure !== index + 1 || typeof line.text !== "string" || !line.text.trim()
      || !Number.isInteger(line.syllables) || line.syllables < 1) {
      throw new Error(`Mesure ${index + 1} invalide (numéro, texte ou syllabes).`);
    }
  }
  return lyrics;
}

const [, , providerName, tempoArg, ...extraArgs] = process.argv;
const selectedTempos = tempoArg === undefined ? tempos : tempos.filter((bpm) => String(bpm) === tempoArg);
if (!Object.hasOwn(providers, providerName) || selectedTempos.length === 0 || extraArgs.length > 0) {
  console.error("Depuis la racine du dépôt : node --env-file=backend/.env backend/scripts/compare-lyrics.mjs <gemini|groq> [90|140]");
  process.exitCode = 1;
} else {
  const provider = providers[providerName];
  const apiKey = process.env[provider.keyName]?.trim();
  if (!apiKey || apiKey === `YOUR_${provider.keyName}`) {
    console.error(`Renseigner ${provider.keyName} dans backend/.env.`);
    process.exitCode = 1;
  } else {
    for (const bpm of selectedTempos) {
      const start = performance.now();
      try {
        const result = await provider.generate(apiKey, buildPrompt(bpm));
        const elapsedMs = Math.round(performance.now() - start);
        console.log(`${providerName} (${provider.model}) · ${bpm} BPM · ${elapsedMs} ms`);
        console.log(`Tokens en entrée : ${result.inputTokens ?? "indisponibles"} · en sortie : ${result.outputTokens ?? "indisponibles"}`);
        if (result.thinkingTokens) {
          console.log(`Tokens de raisonnement : ${result.thinkingTokens}`);
        }
        console.table(parseLyrics(result.text).map((line) => ({
          Mesure: line.measure,
          Texte: line.text,
          "Syllabes annoncées": line.syllables,
          "Écart annoncé": Math.abs(line.syllables - targetSyllables),
        })));
      } catch (error) {
        console.error(`${providerName} · ${bpm} BPM · ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}
