import { saturationCurve } from './drum-synth';
import { InstrumentId, InstrumentParams } from './melodic-pattern';
import { midiToFrequency } from './pitch/musical-scale';

/**
 * Instruments mélodiques synthétisés en Web Audio (aucun sample, donc aucune licence).
 * Comme drum-synth.ts, tout accepte un BaseAudioContext : le même code sert à
 * l'écoute (AudioContext) et à l'export (OfflineAudioContext).
 * Chaque note crée ses propres nœuds : la polyphonie est illimitée et une note
 * n'interrompt jamais une autre.
 *
 * Techniques employées :
 * - oscillateurs filtrés (synthé, nappe, cordes, cuivres) ;
 * - synthèse additive (piano, orgue) ;
 * - corde pincée Karplus-Strong calculée en JavaScript (guitares, basse électrique) ;
 * - modulation de fréquence (cloches) ;
 * - sinus et souffle filtré (flûte).
 */

/** Enveloppe d'amplitude d'une note (secondes ; niveaux relatifs au pic). */
export interface NoteEnvelope {
  readonly attackSeconds: number;
  /** Niveau vers lequel la note retombe tant qu'elle est tenue (0 à 1 du pic). */
  readonly sustainLevel: number;
  /** Constante de temps de la retombée vers le niveau tenu. */
  readonly decaySeconds: number;
  readonly releaseSeconds: number;
  /** Gain de crête à vélocité maximale : laisse de la marge pour les accords. */
  readonly peakGain: number;
}

const BASE_ENVELOPES: Readonly<Record<InstrumentId, Omit<NoteEnvelope, 'releaseSeconds'>>> = {
  // Piano : attaque franche, le son s'éteint même si la touche reste enfoncée.
  piano: { attackSeconds: 0.004, sustainLevel: 0.15, decaySeconds: 0.6, peakGain: 0.3 },
  // Orgue : son tenu tant que la touche est enfoncée.
  organ: { attackSeconds: 0.01, sustainLevel: 1, decaySeconds: 0.1, peakGain: 0.14 },
  // Guitares et basse : la corde pincée porte sa propre décroissance, l'enveloppe ne fait que l'ouvrir et la couper.
  acousticGuitar: { attackSeconds: 0.002, sustainLevel: 1, decaySeconds: 0.1, peakGain: 0.45 },
  electricGuitar: { attackSeconds: 0.002, sustainLevel: 1, decaySeconds: 0.1, peakGain: 0.22 },
  // 808 : sub tenu qui décroît lentement.
  bass808: { attackSeconds: 0.003, sustainLevel: 0.6, decaySeconds: 0.9, peakGain: 0.6 },
  // Gain élevé : l'attaque douce de la corde grave perd beaucoup d'énergie (niveau mesuré proche du piano).
  electricBass: { attackSeconds: 0.002, sustainLevel: 1, decaySeconds: 0.1, peakGain: 1.6 },
  // Cordes : attaque lente d'archet.
  strings: { attackSeconds: 0.25, sustainLevel: 0.9, decaySeconds: 0.4, peakGain: 0.1 },
  // Cuivres : attaque un peu lente, le filtre s'ouvre pendant l'attaque.
  brass: { attackSeconds: 0.05, sustainLevel: 0.8, decaySeconds: 0.3, peakGain: 0.13 },
  flute: { attackSeconds: 0.06, sustainLevel: 0.85, decaySeconds: 0.2, peakGain: 0.25 },
  // Synthé : attaque douce et son tenu (nappe, lead).
  synth: { attackSeconds: 0.02, sustainLevel: 0.7, decaySeconds: 0.25, peakGain: 0.16 },
  pad: { attackSeconds: 0.6, sustainLevel: 0.9, decaySeconds: 0.8, peakGain: 0.1 },
  // Cloches : frappe puis longue résonance qui s'éteint seule.
  bells: { attackSeconds: 0.002, sustainLevel: 0, decaySeconds: 1.2, peakGain: 0.25 },
};

/**
 * Ouverture du filtre passe-bas, en multiples de la fréquence de la note :
 * `min` à brillance nulle, `min + span` à brillance maximale.
 */
const FILTER_FACTORS: Readonly<Record<InstrumentId, { readonly min: number; readonly span: number }>> = {
  piano: { min: 2, span: 10 },
  organ: { min: 3, span: 12 },
  acousticGuitar: { min: 3, span: 14 },
  electricGuitar: { min: 2, span: 10 },
  bass808: { min: 2, span: 10 },
  electricBass: { min: 2, span: 8 },
  strings: { min: 2, span: 10 },
  brass: { min: 2, span: 12 },
  flute: { min: 3, span: 10 },
  synth: { min: 1.5, span: 14 },
  pad: { min: 1.2, span: 6 },
  bells: { min: 4, span: 14 },
};

/** Les setTargetAtTime approchent leur cible sans l'atteindre : la source s'arrête après ~5 constantes de temps. */
const RELEASE_TIME_CONSTANTS = 5;
const MAX_FILTER_HZ = 16000;
/** Écart des deux oscillateurs du synthé, en cents : épaissit le son. */
const SYNTH_DETUNE_CENTS = 8;
/** Glissement d'attaque de la 808 : départ une quarte au-dessus, 40 ms pour rejoindre la note. */
const BASS_GLIDE_RATIO = 1.33;
const BASS_GLIDE_SECONDS = 0.04;
/** Partiels du piano (rang harmonique et amplitude relative). */
const PIANO_PARTIALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 0.45],
  [3, 0.2],
  [4, 0.1],
];
/** Tirettes de l'orgue (rapport de fréquence et niveau) : 16', 8', 4', 2 2/3', 2'. */
const ORGAN_DRAWBARS: readonly (readonly [number, number])[] = [
  [0.5, 0.5],
  [1, 1],
  [2, 0.6],
  [3, 0.35],
  [4, 0.25],
];
/** Ensemble des cordes et de la nappe : désaccords en cents. */
const ENSEMBLE_DETUNES_CENTS = [-12, 0, 12];
/** Vibrato (cordes, flûte) : fréquence en Hz, profondeur en cents, délai avant le vibrato en s. */
const VIBRATO_HZ = 5;
const VIBRATO_DEPTH_CENTS = 7;
const VIBRATO_DELAY_SECONDS = 0.3;
/** Cuivres : durée d'ouverture du filtre pendant l'attaque. */
const BRASS_FILTER_SWEEP_SECONDS = 0.08;
/** Cloches : rapport modulateur / porteuse (inharmonique) et indice de modulation initial. */
const BELL_MODULATOR_RATIO = 3.5;
const BELL_MODULATION_INDEX = 2;
/** Flûte : niveau du souffle par rapport au son. */
const FLUTE_BREATH_LEVEL = 0.12;
/** Saturation de la guitare électrique (gain avant la courbe). */
const ELECTRIC_GUITAR_DRIVE = 3;

export function noteEnvelope(instrument: InstrumentId, params: InstrumentParams): NoteEnvelope {
  return { ...BASE_ENVELOPES[instrument], releaseSeconds: params.releaseSeconds };
}

/** Date d'arrêt des sources d'une note : fin de la note puis relâchement complet. */
export function noteStopTime(time: number, durationSeconds: number, envelope: NoteEnvelope): number {
  const releaseStart = time + Math.max(durationSeconds, envelope.attackSeconds);
  return releaseStart + envelope.releaseSeconds;
}

/**
 * Fréquence de coupure du filtre passe-bas : suit la hauteur de la note (les aigus
 * gardent leur timbre) et s'ouvre avec la brillance `tone` (0 à 1).
 */
export function filterCutoffHz(instrument: InstrumentId, frequencyHz: number, tone: number): number {
  const { min, span } = FILTER_FACTORS[instrument];
  return Math.min(MAX_FILTER_HZ, frequencyHz * (min + tone * span));
}

function attackNote(gain: AudioParam, time: number, envelope: NoteEnvelope, peak: number): void {
  const attackEnd = time + envelope.attackSeconds;
  gain.setValueAtTime(0, time);
  gain.linearRampToValueAtTime(peak, attackEnd);
  gain.setTargetAtTime(peak * envelope.sustainLevel, attackEnd, envelope.decaySeconds);
}

/* ---------- Corde pincée (Karplus-Strong) ---------- */

/** Réglages d'une corde : durée calculée, amortissement par période et douceur de l'attaque. */
interface StringModel {
  readonly seconds: number;
  /** Facteur appliqué à chaque passage dans la boucle (< 1 : la corde s'éteint). */
  readonly damping: number;
  /** Lissage du bruit initial (0 : attaque brillante, proche de 1 : attaque douce). */
  readonly pluckSoftness: number;
}

const STRING_MODELS: Readonly<Partial<Record<InstrumentId, StringModel>>> = {
  acousticGuitar: { seconds: 2.5, damping: 0.996, pluckSoftness: 0.3 },
  electricGuitar: { seconds: 3, damping: 0.998, pluckSoftness: 0.5 },
  electricBass: { seconds: 2, damping: 0.995, pluckSoftness: 0.7 },
};

/**
 * Nombre d'échantillons d'une période et vitesse de lecture qui corrige l'arrondi :
 * la boucle a une longueur entière, `playbackRate` rattrape la fraction pour que
 * la note soit juste même dans les aigus.
 */
export function stringPeriod(sampleRate: number, frequencyHz: number): { samples: number; playbackRate: number } {
  const samples = Math.max(2, Math.floor(sampleRate / frequencyHz));
  return { samples, playbackRate: (samples * frequencyHz) / sampleRate };
}

/**
 * Calcule le signal d'une corde pincée : un bruit (l'attaque) circule dans une
 * boucle d'une période, moyenné à chaque tour, ce qui adoucit et éteint le son.
 * `random` est injectable pour les tests.
 */
export function pluckedString(length: number, period: number, model: StringModel, random: () => number = Math.random): Float32Array {
  const output = new Float32Array(length);
  let previous = 0;
  for (let i = 0; i < Math.min(period, length); i++) {
    const noise = random() * 2 - 1;
    previous = model.pluckSoftness * previous + (1 - model.pluckSoftness) * noise;
    output[i] = previous;
  }
  for (let i = period; i < length; i++) {
    const before = i - period - 1 >= 0 ? output[i - period - 1] : 0;
    output[i] = model.damping * 0.5 * (output[i - period] + before);
  }
  return output;
}

/** Cache des cordes déjà calculées, par contexte (écoute et export) puis par instrument et période. */
const stringCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function stringBuffer(context: BaseAudioContext, instrument: InstrumentId, model: StringModel, period: number): AudioBuffer {
  let cache = stringCache.get(context);
  if (!cache) {
    cache = new Map();
    stringCache.set(context, cache);
  }
  const key = `${instrument}:${period}`;
  let buffer = cache.get(key);
  if (!buffer) {
    const length = Math.ceil(model.seconds * context.sampleRate);
    buffer = context.createBuffer(1, length, context.sampleRate);
    buffer.copyToChannel(pluckedString(length, period, model) as Float32Array<ArrayBuffer>, 0);
    cache.set(key, buffer);
  }
  return buffer;
}

/* ---------- Souffle (flûte) ---------- */

const NOISE_SECONDS = 1;
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  let buffer = noiseCache.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * NOISE_SECONDS), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.random() * 2 - 1;
    }
    noiseCache.set(context, buffer);
  }
  return buffer;
}

/* ---------- Construction des voix ---------- */

/** Sources d'une note : démarrées et arrêtées ensemble. */
type Source = AudioScheduledSourceNode;

interface VoiceContext {
  readonly context: BaseAudioContext;
  readonly instrument: InstrumentId;
  readonly frequency: number;
  readonly time: number;
  readonly params: InstrumentParams;
  /** Entrée de l'enveloppe d'amplitude de la note. */
  readonly amp: GainNode;
}

function lowpass(voice: VoiceContext): BiquadFilterNode {
  const filter = voice.context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterCutoffHz(voice.instrument, voice.frequency, voice.params.tone);
  filter.connect(voice.amp);
  return filter;
}

function oscillator(context: BaseAudioContext, type: OscillatorType, frequency: number, detuneCents = 0): OscillatorNode {
  const node = context.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  node.detune.value = detuneCents;
  return node;
}

/** Vibrato : un oscillateur lent module le désaccord des sources, après un court délai. */
function addVibrato(voice: VoiceContext, targets: readonly OscillatorNode[]): Source {
  const lfo = oscillator(voice.context, 'sine', VIBRATO_HZ);
  const depth = voice.context.createGain();
  depth.gain.setValueAtTime(0, voice.time);
  depth.gain.linearRampToValueAtTime(VIBRATO_DEPTH_CENTS, voice.time + VIBRATO_DELAY_SECONDS);
  lfo.connect(depth);
  targets.forEach(target => depth.connect(target.detune));
  return lfo;
}

function additive(voice: VoiceContext, partials: readonly (readonly [number, number])[], firstType: OscillatorType): Source[] {
  const filter = lowpass(voice);
  return partials.map(([ratio, level], index) => {
    const node = oscillator(voice.context, index === 0 ? firstType : 'sine', voice.frequency * ratio);
    const partial = voice.context.createGain();
    partial.gain.value = level;
    node.connect(partial).connect(filter);
    return node;
  });
}

function ensemble(voice: VoiceContext, types: readonly OscillatorType[], withVibrato: boolean): Source[] {
  const filter = lowpass(voice);
  const nodes = ENSEMBLE_DETUNES_CENTS.map((detune, index) => {
    const node = oscillator(voice.context, types[index % types.length], voice.frequency, detune);
    node.connect(filter);
    return node;
  });
  return withVibrato ? [...nodes, addVibrato(voice, nodes)] : nodes;
}

function plucked(voice: VoiceContext, model: StringModel): Source[] {
  const { context } = voice;
  const { samples, playbackRate } = stringPeriod(context.sampleRate, voice.frequency);
  const source = context.createBufferSource();
  source.buffer = stringBuffer(context, voice.instrument, model, samples);
  source.playbackRate.value = playbackRate;
  const filter = lowpass(voice);
  if (voice.instrument === 'electricGuitar') {
    // Saturation légère, dosée par la brillance : son d'ampli crunch.
    const drive = context.createGain();
    drive.gain.value = 1 + voice.params.tone * ELECTRIC_GUITAR_DRIVE;
    const shaper = context.createWaveShaper();
    shaper.curve = saturationCurve(context);
    source.connect(drive).connect(shaper).connect(filter);
  } else {
    source.connect(filter);
  }
  return [source];
}

function bass808(voice: VoiceContext): Source[] {
  const { context, frequency, time } = voice;
  const node = context.createOscillator();
  node.frequency.setValueAtTime(frequency * BASS_GLIDE_RATIO, time);
  node.frequency.exponentialRampToValueAtTime(frequency, time + BASS_GLIDE_SECONDS);
  // La brillance pousse la saturation : plus d'harmoniques, audibles sur de petites enceintes.
  const drive = context.createGain();
  drive.gain.value = 1 + voice.params.tone * 3;
  const shaper = context.createWaveShaper();
  shaper.curve = saturationCurve(context);
  node.connect(drive).connect(shaper).connect(voice.amp);
  return [node];
}

function brass(voice: VoiceContext): Source[] {
  const { context, frequency, time } = voice;
  const filter = lowpass(voice);
  // Le filtre part presque fermé et s'ouvre pendant l'attaque : « souffle » des cuivres.
  const open = filter.frequency.value;
  filter.frequency.setValueAtTime(Math.min(open, frequency * 1.2), time);
  filter.frequency.exponentialRampToValueAtTime(open, time + BRASS_FILTER_SWEEP_SECONDS);
  return [-6, 6].map(detune => {
    const node = oscillator(context, 'sawtooth', frequency, detune);
    node.connect(filter);
    return node;
  });
}

function flute(voice: VoiceContext): Source[] {
  const { context, frequency } = voice;
  const filter = lowpass(voice);
  const tone = oscillator(context, 'sine', frequency);
  const overtone = oscillator(context, 'sine', frequency * 2);
  const overtoneLevel = context.createGain();
  overtoneLevel.gain.value = 0.15;
  tone.connect(filter);
  overtone.connect(overtoneLevel).connect(filter);
  // Souffle : bruit filtré autour de la note.
  const breath = context.createBufferSource();
  breath.buffer = noiseBuffer(context);
  breath.loop = true;
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = Math.min(MAX_FILTER_HZ, frequency * 2);
  band.Q.value = 2;
  const breathLevel = context.createGain();
  breathLevel.gain.value = FLUTE_BREATH_LEVEL;
  breath.connect(band).connect(breathLevel).connect(voice.amp);
  return [tone, overtone, breath, addVibrato(voice, [tone, overtone])];
}

function bells(voice: VoiceContext): Source[] {
  const { context, frequency, time } = voice;
  const filter = lowpass(voice);
  const carrier = oscillator(context, 'sine', frequency);
  const modulator = oscillator(context, 'sine', frequency * BELL_MODULATOR_RATIO);
  // L'indice de modulation décroît : l'attaque métallique laisse place à un son plus pur.
  const index = context.createGain();
  index.gain.setValueAtTime(frequency * BELL_MODULATION_INDEX * (0.5 + voice.params.tone), time);
  index.gain.setTargetAtTime(frequency * 0.2, time, 0.4);
  modulator.connect(index).connect(carrier.frequency);
  carrier.connect(filter);
  return [carrier, modulator];
}

function buildVoice(voice: VoiceContext): Source[] {
  const model = STRING_MODELS[voice.instrument];
  if (model) {
    return plucked(voice, model);
  }
  switch (voice.instrument) {
    case 'piano':
      return additive(voice, PIANO_PARTIALS, 'triangle');
    case 'organ':
      return additive(voice, ORGAN_DRAWBARS, 'sine');
    case 'bass808':
      return bass808(voice);
    case 'strings':
      return ensemble(voice, ['sawtooth'], true);
    case 'pad':
      return ensemble(voice, ['sawtooth', 'triangle'], false);
    case 'brass':
      return brass(voice);
    case 'flute':
      return flute(voice);
    case 'bells':
      return bells(voice);
    default: {
      // Synthé : deux dents de scie désaccordées.
      const filter = lowpass(voice);
      return [-SYNTH_DETUNE_CENTS, SYNTH_DETUNE_CENTS].map(detune => {
        const node = oscillator(voice.context, 'sawtooth', voice.frequency, detune);
        node.connect(filter);
        return node;
      });
    }
  }
}

function startNoteVoice(
  context: BaseAudioContext,
  output: AudioNode,
  instrument: InstrumentId,
  pitch: number,
  time: number,
  velocity: number,
  params: InstrumentParams,
) {
  const frequency = midiToFrequency(pitch);
  const envelope = noteEnvelope(instrument, params);
  const peak = envelope.peakGain * Math.min(1, Math.max(0, velocity));
  const amp = context.createGain();
  attackNote(amp.gain, time, envelope, peak);
  amp.connect(output);

  const sources = buildVoice({ context, instrument, frequency, time, params, amp });
  sources.forEach(source => source.start(time));
  return { amp, sources, peak, envelope };
}

/** Joue une note programmée pour la lecture, la préécoute ou l'export. */
export function playInstrumentNote(
  context: BaseAudioContext, output: AudioNode, instrument: InstrumentId, pitch: number,
  time: number, durationSeconds: number, velocity: number, params: InstrumentParams,
): void {
  const { amp, sources, envelope } = startNoteVoice(context, output, instrument, pitch, time, velocity, params);
  const releaseStart = time + Math.max(durationSeconds, envelope.attackSeconds);
  amp.gain.setTargetAtTime(0, releaseStart, envelope.releaseSeconds / RELEASE_TIME_CONSTANTS);
  const stopAt = noteStopTime(time, durationSeconds, envelope);
  sources.forEach(source => source.stop(stopAt));
}

export interface HeldInstrumentNote {
  release(fast?: boolean): void;
}

/** Joue la même voix avec une durée déterminée au relâchement de la touche. */
export function startHeldInstrumentNote(
  context: BaseAudioContext, output: AudioNode, instrument: InstrumentId, pitch: number,
  velocity: number, params: InstrumentParams,
): HeldInstrumentNote {
  const start = context.currentTime;
  const { amp, sources, peak, envelope } = startNoteVoice(context, output, instrument, pitch, start, velocity, params);
  let remaining = sources.length;
  for (const source of sources) {
    source.addEventListener('ended', () => {
      source.disconnect();
      remaining--;
      if (remaining === 0) amp.disconnect();
    }, { once: true });
  }

  let released = false;
  const release = (fast = false): void => {
    if (released || remaining === 0) return;
    released = true;
    const now = context.currentTime;
    const heldSeconds = now - start;
    const sustain = peak * envelope.sustainLevel;
    amp.gain.cancelScheduledValues(now);
    // Un appui bref peut se terminer avant le pic, notamment avec les nappes.
    if (heldSeconds < envelope.attackSeconds) {
      amp.gain.linearRampToValueAtTime(peak * heldSeconds / envelope.attackSeconds, now);
    } else {
      const level = sustain + (peak - sustain) * Math.exp((envelope.attackSeconds - heldSeconds) / envelope.decaySeconds);
      amp.gain.setValueAtTime(level, now);
    }
    const releaseSeconds = fast ? 0.02 : envelope.releaseSeconds;
    amp.gain.setTargetAtTime(0, now, releaseSeconds / RELEASE_TIME_CONSTANTS);
    sources.forEach(source => source.stop(now + releaseSeconds));
  };
  return { release };
}
