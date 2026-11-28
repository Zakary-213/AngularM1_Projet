import { describe, expect, it } from 'vitest';
import { DRUM_KITS, DRUM_VOICES } from './drum-pattern';
import { INSTRUMENTS, INSTRUMENT_RANGES } from './melodic-pattern';
import { SOUND_LIBRARY, countByCategory, filterSounds, previewPitch } from './sound-library';

describe('Catalogue de la bibliothèque de sons', () => {
  it('liste exactement les sons du studio : chaque frappe de chaque kit et chaque instrument', () => {
    expect(SOUND_LIBRARY).toHaveLength(DRUM_KITS.length * DRUM_VOICES.length + INSTRUMENTS.length);
    expect(countByCategory(SOUND_LIBRARY)).toEqual({ drums: 12, instruments: 3, samples: 0 });
  });

  it('donne un identifiant unique à chaque son', () => {
    const ids = SOUND_LIBRARY.map(sound => sound.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('préécoute chaque instrument sur un do compris dans sa tessiture du Piano Roll', () => {
    for (const instrument of INSTRUMENTS) {
      const pitch = previewPitch(instrument);
      expect(pitch % 12).toBe(0);
      expect(pitch).toBeGreaterThanOrEqual(INSTRUMENT_RANGES[instrument].low);
      expect(pitch).toBeLessThanOrEqual(INSTRUMENT_RANGES[instrument].high);
    }
  });
});

describe('filterSounds', () => {
  it('sans filtre, rend tous les sons', () => {
    expect(filterSounds(SOUND_LIBRARY, null, '')).toHaveLength(SOUND_LIBRARY.length);
  });

  it('filtre par catégorie', () => {
    const instruments = filterSounds(SOUND_LIBRARY, 'instruments', '');
    expect(instruments.map(sound => sound.name)).toEqual(['Piano', 'Synthé', 'Basse 808']);
    expect(filterSounds(SOUND_LIBRARY, 'samples', '')).toEqual([]);
  });

  it('cherche dans le nom et la description, sans tenir compte de la casse ni des accents', () => {
    expect(filterSounds(SOUND_LIBRARY, null, 'KICK').map(sound => sound.id)).toEqual(['drum-boomBap-kick', 'drum-trap-kick']);
    expect(filterSounds(SOUND_LIBRARY, null, 'synthe').map(sound => sound.id)).toEqual(['instrument-synth']);
    expect(filterSounds(SOUND_LIBRARY, null, '  trap ').every(sound => sound.id.startsWith('drum-trap-'))).toBe(true);
  });

  it('combine catégorie et recherche', () => {
    expect(filterSounds(SOUND_LIBRARY, 'instruments', '808').map(sound => sound.id)).toEqual(['instrument-bass808']);
    expect(filterSounds(SOUND_LIBRARY, 'drums', 'piano')).toEqual([]);
  });
});
