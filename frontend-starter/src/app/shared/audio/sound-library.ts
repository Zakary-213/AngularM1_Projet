import { DRUM_KITS, DRUM_KIT_LABELS, DRUM_VOICES, DRUM_VOICE_LABELS, DrumKit, DrumVoice } from './drum-pattern';
import { INSTRUMENTS, INSTRUMENT_LABELS, INSTRUMENT_RANGES, InstrumentId } from './melodic-pattern';

/**
 * Catalogue de la page Bibliothèque, construit à partir des sons réellement
 * joués par le studio (drum-synth.ts et instrument-synth.ts) : la page ne peut
 * pas annoncer un son qui n'existe pas dans le Drum Rack ou le Piano Roll.
 */

export type SoundCategory = 'drums' | 'instruments' | 'samples';
export const SOUND_CATEGORIES: readonly SoundCategory[] = ['drums', 'instruments', 'samples'];

export interface SoundCategoryInfo {
  readonly label: string;
  readonly tagline: string;
  readonly icon: string;
  /** Classe de couleur de la carte (styles.css). */
  readonly color: 'lime' | 'purple' | 'peach';
  /** Où retrouver ces sons dans le studio. */
  readonly whereInStudio: string;
}

export const SOUND_CATEGORY_INFO: Readonly<Record<SoundCategory, SoundCategoryInfo>> = {
  drums: { label: 'Drums & percussions', tagline: 'Le rythme avant tout', icon: '▦', color: 'lime', whereInStudio: 'Studio › onglet Batterie' },
  instruments: { label: 'Instruments', tagline: 'Donnez vie à vos mélodies', icon: '♬', color: 'purple', whereInStudio: 'Studio › onglet Piano Roll' },
  samples: { label: 'Samples & textures', tagline: 'La couleur de votre son', icon: '≋', color: 'peach', whereInStudio: 'Studio › Importer une instrumentale' },
};

/** Ce que la préécoute doit jouer : une frappe de batterie ou une note d'instrument. */
export type SoundSource =
  | { readonly kind: 'drum'; readonly voice: DrumVoice; readonly kit: DrumKit }
  | { readonly kind: 'instrument'; readonly instrument: InstrumentId; readonly pitch: number };

export interface SoundEntry {
  readonly id: string;
  readonly name: string;
  readonly category: SoundCategory;
  readonly description: string;
  readonly source: SoundSource;
}

const INSTRUMENT_DESCRIPTIONS: Readonly<Record<InstrumentId, string>> = {
  piano: 'Instrument · Accords et mélodies',
  synth: 'Instrument · Nappes et leads',
  bass808: 'Instrument · Basse jouable par notes',
};

/** Note de préécoute d'un instrument : un do au milieu de sa tessiture du Piano Roll. */
export function previewPitch(instrument: InstrumentId): number {
  const range = INSTRUMENT_RANGES[instrument];
  const middle = Math.round((range.low + range.high) / 2);
  return middle - (middle % 12);
}

export const SOUND_LIBRARY: readonly SoundEntry[] = [
  ...DRUM_KITS.flatMap(kit =>
    DRUM_VOICES.map(voice => ({
      id: `drum-${kit}-${voice}`,
      name: `${DRUM_VOICE_LABELS[voice]} ${DRUM_KIT_LABELS[kit]}`,
      category: 'drums' as const,
      description: `Kit ${DRUM_KIT_LABELS[kit]} · Batterie`,
      source: { kind: 'drum' as const, voice, kit },
    })),
  ),
  ...INSTRUMENTS.map(instrument => ({
    id: `instrument-${instrument}`,
    name: INSTRUMENT_LABELS[instrument],
    category: 'instruments' as const,
    description: INSTRUMENT_DESCRIPTIONS[instrument],
    source: { kind: 'instrument' as const, instrument, pitch: previewPitch(instrument) },
  })),
];

/** Mise en forme pour une recherche insensible à la casse et aux accents. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Sons d'une catégorie (ou de toutes si `null`) dont le nom ou la description contient la recherche. */
export function filterSounds(entries: readonly SoundEntry[], category: SoundCategory | null, query: string): SoundEntry[] {
  const needle = normalize(query);
  return entries.filter(
    entry =>
      (category === null || entry.category === category) &&
      (needle === '' || normalize(`${entry.name} ${entry.description}`).includes(needle)),
  );
}

export function countByCategory(entries: readonly SoundEntry[]): Record<SoundCategory, number> {
  const counts: Record<SoundCategory, number> = { drums: 0, instruments: 0, samples: 0 };
  for (const entry of entries) {
    counts[entry.category]++;
  }
  return counts;
}
