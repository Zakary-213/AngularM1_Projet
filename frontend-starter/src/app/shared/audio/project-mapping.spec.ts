import { describe, expect, it } from 'vitest';
import { createDemoPattern, cycleStep, toggleStep } from './drum-pattern';
import { StudioState, contentFingerprint, createEmptyPattern, fromProject, secondsToBeats, takeClipPosition, takeStartFromClip, toProjectContent } from './project-mapping';
import { MelodicPattern, createDefaultMelodicPatterns } from './melodic-pattern';
import { FLAT_THREE_BAND_EQ } from './three-band-eq';
import { createDefaultMixer, updateTrack } from './track-mix';
import { MusicalProject } from '../models/musical-project.model';
import { findStyle, styleSettings } from './pitch/vocal-styles';

function project(overrides: Partial<MusicalProject> = {}): MusicalProject {
  return {
    id: 'p1',
    ownerId: 'u1',
    formatVersion: 1,
    title: 'Minuit',
    origin: 'create',
    revision: 0,
    bpm: 90,
    key: { root: 9, scale: 'minor' },
    tracks: [],
    patterns: [],
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

const state: StudioState = {
  bpm: 140,
  key: { root: 2, scale: 'harmonicMinor' },
  patterns: [
    { id: 'pattern-1', name: 'Couplet', steps: toggleStep(createDemoPattern(), 'snare', 0), kit: 'boomBap' },
    { id: 'pattern-refrain', name: 'Refrain', steps: cycleStep(cycleStep(createDemoPattern(), 'bass808', 2), 'bass808', 2), kit: 'trap' },
  ],
  mixer: updateTrack(
    updateTrack(
      updateTrack(createDefaultMixer(), 'drums', { volumeDb: -6, solo: true, pan: -0.25 }),
      'voice',
      { muted: true, reverb: { enabled: true, amount: 0.4 }, delay: { enabled: true, amount: 0.2 } },
    ),
    'instrumental',
    { eq: { lowDb: 3, midDb: -2, highDb: 1 } },
  ),
  masterVolume: 0.7,
  instrumental: { fileId: '64b0000000000000000000aa', label: 'beat.mp3', durationBeats: 186.67 },
  takes: [
    // Début négatif : la compensation de latence fait commencer la prise juste avant le morceau.
    { id: 'take-a', fileId: '64b0000000000000000000b1', label: 'Prise 1', startSeconds: -0.09, durationSeconds: 12 },
    { id: 'take-b', fileId: '64b0000000000000000000b2', label: 'Refrain', startSeconds: 6, durationSeconds: 30 },
  ],
  activeTakeId: 'take-b',
  drumClips: [
    { id: 'drums-intro', startBar: 0, lengthBars: 4, patternId: 'pattern-1' },
    { id: 'drums-refrain', startBar: 8, lengthBars: 8, patternId: 'pattern-refrain' },
  ],
  instrumentalStartBeat: 4,
  melodicPatterns: [
    {
      id: 'melody-1',
      name: 'Accords',
      instrument: 'piano',
      params: { tone: 0.7, releaseSeconds: 0.5 },
      bars: 2,
      notes: [
        { id: 'a', pitch: 57, startStep: 0, durationSteps: 8, velocity: 0.8 },
        { id: 'b', pitch: 60, startStep: 0, durationSteps: 8, velocity: 0.6 },
        { id: 'c', pitch: 64, startStep: 16, durationSteps: 16, velocity: 1 },
      ],
    },
    { id: 'bass-1', name: 'Basse', instrument: 'bass808', params: { tone: 0.2, releaseSeconds: 0.1 }, bars: 1, notes: [{ id: 'd', pitch: 33, startStep: 0, durationSteps: 6, velocity: 0.9 }] },
  ],
  instrumentClips: {
    melody: [{ id: 'melody-a', startBar: 4, lengthBars: 8, patternId: 'melody-1' }],
    bass: [{ id: 'bass-a', startBar: 0, lengthBars: 4, patternId: 'bass-1' }],
  },
  // M9/M10 : réglages de correction, style personnel et version corrigée de la prise active.
  vocal: { styleId: 'rai', dose: 0.8, userStyleName: 'Mon raï', custom: styleSettings(findStyle('rai'), 0.8, { root: 2, scale: 'harmonicMinor' }, 140) },
  userStyles: [{ name: 'Mon raï', basedOn: 'rai', settings: styleSettings(findStyle('rai'), 0.8, { root: 2, scale: 'harmonicMinor' }, 140) }],
  correction: { takeId: 'take-b', fileId: '64b0000000000000000000c9', styleLabel: 'Personnalisé (basé sur Mon raï)', enabled: true },
};

/** Les identifiants de notes sont recréés à l'ouverture : on compare tout le reste. */
function withoutNoteIds(patterns: readonly MelodicPattern[]) {
  return patterns.map(pattern => ({ ...pattern, notes: pattern.notes.map(({ id: _id, ...note }) => note) }));
}

describe('conversion studio ↔ format de sauvegarde (v1 et v2)', () => {
  it('retrouve exactement l’état du studio après un aller-retour', () => {
    const content = toProjectContent(state);
    const restored = fromProject(project({ ...content }));
    expect({ ...restored, melodicPatterns: withoutNoteIds(restored.melodicPatterns) }).toEqual({ ...state, melodicPatterns: withoutNoteIds(state.melodicPatterns) });
    expect(toProjectContent(restored)).toEqual(content);
  });

  it('produit les pistes du studio et un clip de batterie qui référence le pattern', () => {
    const content = toProjectContent(state);
    expect(content.tracks.map(track => [track.id, track.type])).toEqual([
      ['drums', 'drum'],
      ['melody', 'instrument'],
      ['bass', 'instrument'],
      ['instrumental', 'audio'],
      ['voice', 'vocal'],
    ]);
    expect(content.tracks[0].clips).toEqual([
      { id: 'drums-intro', startBeat: 0, durationBeats: 16, patternId: 'pattern-1' },
      { id: 'drums-refrain', startBeat: 32, durationBeats: 32, patternId: 'pattern-refrain' },
    ]);
    expect(content.tracks[0].volumeDb).toBe(-6);
    expect(content.tracks.find(track => track.id === 'voice')!.mute).toBe(true);
    expect(content.patterns.map(pattern => pattern.name)).toEqual(['Couplet', 'Refrain', 'Accords', 'Basse']);
    expect(content.patterns[0].drumRows.every(row => row.steps.length === 16 && row.velocities?.length === 16)).toBe(true);
    // Kick du refrain, pas 3 : vélocité moyenne (deux clics), lisible aussi comme simple frappe.
    const bass = content.patterns[1].drumRows.find(row => row.voice === 'bass808')!;
    expect(bass.velocities![2]).toBe(0.7);
    expect(bass.steps[2]).toBe(true);
    expect(content.patterns.map(pattern => pattern.kit)).toEqual(['boomBap', 'trap', undefined, undefined]);
  });

  it('M4 : sauvegarde les notes MIDI, l’instrument et ses réglages, et les clips des pistes Mélodie et Basse', () => {
    const content = toProjectContent(state);
    const accords = content.patterns.find(pattern => pattern.id === 'melody-1')!;
    expect(accords).toMatchObject({ instrument: 'piano', params: { tone: 0.7, releaseSeconds: 0.5 }, bars: 2, drumRows: [] });
    expect(accords.notes![0]).toEqual({ pitch: 57, startStep: 0, durationSteps: 8, velocity: 0.8 });
    expect(content.tracks.find(track => track.id === 'melody')!.clips).toEqual([{ id: 'melody-a', startBeat: 16, durationBeats: 32, patternId: 'melody-1' }]);
    expect(content.tracks.find(track => track.id === 'bass')!.clips[0].patternId).toBe('bass-1');
  });

  it('M4 : un projet antérieur reçoit des patterns mélodiques vides et des pistes d’instruments vides', () => {
    const loaded = fromProject(project());
    expect(withoutNoteIds(loaded.melodicPatterns)).toEqual(withoutNoteIds(createDefaultMelodicPatterns()));
    expect(loaded.instrumentClips).toEqual({ melody: [], bass: [] });
    expect(loaded.patterns).toHaveLength(1);
  });

  it('M4 : ignore les notes invalides et remplace un instrument ou un pattern inconnus', () => {
    const loaded = fromProject(
      project({
        patterns: [
          {
            id: 'm',
            name: 'M',
            instrument: 'theremin',
            bars: 3,
            params: { tone: 9, releaseSeconds: 0.2 },
            drumRows: [],
            notes: [
              { pitch: 60, startStep: 0, durationSteps: 4, velocity: 0.5 },
              { pitch: 60, startStep: 2, durationSteps: 4, velocity: 0.5 },
              { pitch: 200, startStep: 0, durationSteps: 4, velocity: 0.5 },
              { pitch: 62, startStep: 40, durationSteps: 4, velocity: 0.5 },
            ],
          },
        ],
        tracks: [{ id: 'melody', name: 'Mélodie', type: 'instrument', clips: [{ id: 'c', startBeat: 4, durationBeats: 8, patternId: 'absent' }] }],
      }),
    );
    const pattern = loaded.melodicPatterns[0];
    expect(pattern).toMatchObject({ instrument: 'piano', bars: 1, params: { tone: 1, releaseSeconds: 0.2 } });
    expect(pattern.notes.map(note => [note.pitch, note.startStep])).toEqual([[60, 0]]);
    expect(loaded.instrumentClips.melody).toEqual([{ id: 'c', startBar: 1, lengthBars: 2, patternId: 'm' }]);
    // Le pattern mélodique n'est pas pris pour un pattern de batterie.
    expect(loaded.patterns.map(entry => entry.id)).toEqual(['pattern-1']);
  });

  it('référence l’instrumentale par son fichier et porte son égaliseur, sans octets audio', () => {
    const instrumental = toProjectContent(state).tracks.find(track => track.id === 'instrumental')!;
    expect(instrumental.eq).toEqual({ lowDb: 3, midDb: -2, highDb: 1 });
    expect(instrumental.clips).toEqual([
      { id: 'clip-instrumental', startBeat: 4, durationBeats: 186.67, offsetSeconds: 0, audioFileId: '64b0000000000000000000aa', label: 'beat.mp3' },
    ]);
    const noInstrumental = toProjectContent({ ...state, instrumental: null }).tracks.find(track => track.id === 'instrumental')!;
    expect(noInstrumental.clips).toEqual([]);
  });

  it('sauvegarde les prises envoyées comme clips de la piste Voix, avec la prise active', () => {
    const voice = toProjectContent(state).tracks.find(track => track.id === 'voice')!;
    expect(voice.activeClipId).toBe('take-b');
    expect(voice.clips).toEqual([
      { id: 'take-a', startBeat: 0, offsetSeconds: 0.09, durationBeats: 28, audioFileId: '64b0000000000000000000b1', label: 'Prise 1' },
      {
        id: 'take-b',
        startBeat: 14,
        offsetSeconds: 0,
        durationBeats: 70,
        audioFileId: '64b0000000000000000000b2',
        label: 'Refrain',
        // M10 : la version corrigée (fichier dérivé) accompagne la prise active, l'original reste référencé.
        correction: { audioFileId: '64b0000000000000000000c9', styleLabel: 'Personnalisé (basé sur Mon raï)', enabled: true },
      },
    ]);
    const none = toProjectContent({ ...state, takes: [], activeTakeId: null }).tracks.find(track => track.id === 'voice')!;
    expect(none.clips).toEqual([]);
    expect(none.activeClipId).toBeUndefined();
  });

  it('position d’une prise : secondes ↔ temps, y compris un début négatif', () => {
    expect(takeClipPosition(6, 140)).toEqual({ startBeat: 14, offsetSeconds: 0 });
    expect(takeClipPosition(-0.25, 140)).toEqual({ startBeat: 0, offsetSeconds: 0.25 });
    expect(takeStartFromClip(14, 0, 140)).toBeCloseTo(6, 9);
    expect(takeStartFromClip(0, 0.25, 140)).toBe(-0.25);
  });

  it('prise active absente ou inconnue : la dernière prise devient active', () => {
    const content = toProjectContent(state);
    const voice = content.tracks.find(track => track.id === 'voice')!;
    const loaded = fromProject(project({ ...content, tracks: content.tracks.map(track => (track.id === 'voice' ? { ...voice, activeClipId: 'inconnue' } : track)) }));
    expect(loaded.activeTakeId).toBe('take-b');
  });

  it('M3 : un projet antérieur sans vélocités lit ses frappes comme fortes ; un pattern inconnu revient au premier', () => {
    const steps = Array.from({ length: 16 }, (_, i) => i === 0);
    const loaded = fromProject(
      project({
        patterns: [{ id: 'p-old', name: 'Ancien', drumRows: [{ voice: 'kick', steps }] }],
        tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', clips: [{ id: 'c1', startBeat: 0, durationBeats: 8, patternId: 'disparu' }] }],
      }),
    );
    expect(loaded.patterns[0].steps.kick[0]).toBe(1);
    expect(loaded.patterns[0].steps.kick[1]).toBe(0);
    // Instruments ajoutés en M3 : lignes vides ; kit absent : boom bap.
    expect(loaded.patterns[0].steps.bass808.every(velocity => velocity === 0)).toBe(true);
    expect(loaded.patterns[0].kit).toBe('boomBap');
    expect(loaded.drumClips[0].patternId).toBe('p-old');
  });

  it('M5 : un ancien projet (pattern en boucle sans fin) reçoit l’arrangement par défaut', () => {
    const legacy = fromProject(project({ tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', clips: [{ id: 'clip-drums', startBeat: 0, durationBeats: 4, patternId: 'pattern-1' }] }] }));
    expect(legacy.drumClips).toEqual([{ id: 'drums-1', startBar: 0, lengthBars: 8, patternId: 'pattern-1' }]);
    expect(fromProject(project()).drumClips).toEqual([{ id: 'drums-1', startBar: 0, lengthBars: 8, patternId: 'pattern-1' }]);
    const emptied = fromProject(project({ tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', clips: [] }] }));
    expect(emptied.drumClips).toEqual([]);
  });

  it('convertit une durée en temps au tempo du projet', () => {
    expect(secondsToBeats(60, 90)).toBe(90);
    expect(secondsToBeats(10, 140)).toBe(23.33);
    expect(secondsToBeats(0, 120)).toBe(0.25);
  });

  it('nouveau projet : rythme de départ pour « Créer », grille vide pour « Importer »', () => {
    expect(fromProject(project({ origin: 'create' })).patterns).toEqual([{ id: 'pattern-1', name: 'Pattern 01', steps: createDemoPattern(), kit: 'boomBap' }]);
    expect(fromProject(project({ origin: 'import' })).patterns[0].steps).toEqual(createEmptyPattern());
  });

  it('remplace les valeurs invalides par les valeurs par défaut', () => {
    const loaded = fromProject(
      project({
        bpm: 999,
        key: { root: 14, scale: 'inconnue' as never },
        tracks: [{ id: 'drums', name: 'Batterie', type: 'drum', volumeDb: 40, clips: [] }],
        patterns: [{ id: 'pattern-1', name: 'P', drumRows: [{ voice: 'cowbell', steps: [true] }, { voice: 'kick', steps: [true, false] }] }],
      }),
    );
    expect(loaded.bpm).toBe(200);
    expect(loaded.key).toEqual({ root: 9, scale: 'minor' });
    expect(loaded.mixer.drums.volumeDb).toBe(6);
    expect(loaded.patterns[0].steps).toEqual(createEmptyPattern());
    expect(loaded.instrumental).toBeNull();
    expect(loaded.mixer.drums.eq).toEqual(FLAT_THREE_BAND_EQ);
    expect(loaded.masterVolume).toBe(0.8);
    expect(loaded.takes).toEqual([]);
    expect(loaded.activeTakeId).toBeNull();
  });

  it('M7 : sauvegarde pan, égaliseur et effets de chaque piste, et le volume Master', () => {
    const content = toProjectContent(state);
    const voice = content.tracks.find(track => track.id === 'voice')!;
    expect(voice.fx).toEqual({ reverb: { enabled: true, amount: 0.4 }, delay: { enabled: true, amount: 0.2 } });
    expect(content.tracks.find(track => track.id === 'drums')!.pan).toBe(-0.25);
    expect(content.tracks.every(track => track.eq !== undefined)).toBe(true);
    expect(content.master).toEqual({ volume: 0.7 });
  });

  it('M7 : un projet antérieur (sans pan, effets ni Master) s’ouvre avec un mix neutre', () => {
    const loaded = fromProject(
      project({
        tracks: [{ id: 'voice', name: 'Voix', type: 'vocal', volumeDb: -3, mute: true, clips: [] }],
      }),
    );
    expect(loaded.mixer.voice).toEqual({ ...createDefaultMixer().voice, volumeDb: -3, muted: true });
    expect(loaded.masterVolume).toBe(0.8);
  });

  it('M7 : borne les réglages de mixage abîmés à la lecture', () => {
    const loaded = fromProject(
      project({
        tracks: [
          {
            id: 'bass',
            name: 'Basse',
            type: 'instrument',
            pan: 7,
            eq: { lowDb: 40, midDb: Number.NaN, highDb: -3 },
            fx: { reverb: { enabled: 'oui' as never, amount: 4 }, delay: { enabled: true, amount: Number.NaN } },
            clips: [],
          },
        ],
        master: { volume: 3 },
      }),
    );
    expect(loaded.mixer.bass.pan).toBe(1);
    expect(loaded.mixer.bass.eq).toEqual({ lowDb: 12, midDb: 0, highDb: -3 });
    expect(loaded.mixer.bass.reverb).toEqual({ enabled: false, amount: 1 });
    expect(loaded.mixer.bass.delay).toEqual({ enabled: true, amount: 0.3 });
    expect(loaded.masterVolume).toBe(1);
  });

  it('l’empreinte change avec une modification et revient à l’identique après annulation', () => {
    const before = contentFingerprint(state);
    const withKick = (steps: StudioState['patterns'][number]['steps']) => [{ ...state.patterns[0], steps }, state.patterns[1]];
    const changed = { ...state, patterns: withKick(toggleStep(state.patterns[0].steps, 'kick', 3)) };
    expect(contentFingerprint(changed)).not.toBe(before);
    expect(contentFingerprint({ ...changed, patterns: withKick(toggleStep(changed.patterns[0].steps, 'kick', 3)) })).toBe(before);
  });
});
