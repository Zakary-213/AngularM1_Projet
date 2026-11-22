import { describe, expect, it } from 'vitest';
import { MusicalProject } from '../models/musical-project.model';
import { barsToSeconds } from './music-time';
import { findStyle, styleSettings } from './pitch/vocal-styles';
import { DEFAULT_VOICE_CORRECTION, migrateUserStyles, readProjectVocal, toProjectVocal, upsertUserStyle } from './pitch/voice-correction-state';
import { fromProject, toProjectContent } from './project-mapping';
import { EXPORT_TAIL_SECONDS, MAX_EXPORT_SECONDS, exportLength, songEndSeconds } from './song-length';
import { safeFileName } from './studio-session.service';

const KEY = { root: 9, scale: 'minor' as const };
const trap = styleSettings(findStyle('trap'), 1, KEY, 90);

function v1Project(overrides: Partial<MusicalProject> = {}): MusicalProject {
  return {
    id: 'p1',
    ownerId: 'u1',
    formatVersion: 1,
    title: 'Minuit',
    origin: 'create',
    revision: 3,
    bpm: 90,
    key: KEY,
    tracks: [],
    patterns: [],
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('M10 : durée du morceau exporté', () => {
  it('suit le dernier clip de pattern et la durée réelle des fichiers', () => {
    // 8 mesures à 120 BPM = 16 s ; instrumentale de 20 s placée à 2 s → fin à 22 s.
    expect(songEndSeconds({ bpm: 120, patternEndBar: 8, audio: [] })).toBeCloseTo(16, 9);
    expect(songEndSeconds({ bpm: 120, patternEndBar: 8, audio: [{ startSeconds: 2, durationSeconds: 20 }] })).toBeCloseTo(22, 9);
    // Prise qui commence avant le morceau (compensation de latence).
    expect(songEndSeconds({ bpm: 120, patternEndBar: 0, audio: [{ startSeconds: -0.09, durationSeconds: 3 }] })).toBeCloseTo(2.91, 9);
  });

  it('pas seulement N mesures : un arrangement de 40 mesures est exporté en entier', () => {
    const length = exportLength({ bpm: 90, patternEndBar: 40, audio: [], effectsActive: false });
    expect(length).toEqual({ ok: true, seconds: barsToSeconds(40, 90), contentSeconds: barsToSeconds(40, 90), truncated: false });
  });

  it('ajoute la traîne des effets seulement si une réverbération ou un delay est actif', () => {
    const dry = exportLength({ bpm: 120, patternEndBar: 4, audio: [], effectsActive: false });
    const wet = exportLength({ bpm: 120, patternEndBar: 4, audio: [], effectsActive: true });
    expect(dry.ok && dry.seconds).toBeCloseTo(8, 9);
    expect(wet.ok && wet.seconds).toBeCloseTo(8 + EXPORT_TAIL_SECONDS, 9);
  });

  it('morceau vide : rien à exporter ; morceau trop long : coupé à la limite et signalé', () => {
    expect(exportLength({ bpm: 90, patternEndBar: 0, audio: [], effectsActive: true })).toEqual({ ok: false, reason: 'empty' });
    const long = exportLength({ bpm: 90, patternEndBar: 0, audio: [{ startSeconds: 0, durationSeconds: 1500 }], effectsActive: false });
    expect(long).toMatchObject({ ok: true, seconds: MAX_EXPORT_SECONDS, truncated: true });
  });

  it('nom de fichier sûr tiré du titre du projet', () => {
    expect(safeFileName('Minuit sur la Ville — Été 2026 !')).toBe('minuit-sur-la-ville-ete-2026');
    expect(safeFileName('../../???')).toBe('zakat-record');
  });
});

describe('M9/M10 : réglages de correction vocale sauvegardés', () => {
  it('aller-retour : style, dose, personnalisé et styles personnels', () => {
    const state = { styleId: 'trap' as const, dose: 0.6, userStyleName: 'Refrain', custom: trap };
    const styles = [{ name: 'Refrain', basedOn: 'trap' as const, settings: trap }];
    const saved = toProjectVocal(state, styles);
    expect(readProjectVocal(JSON.parse(JSON.stringify(saved)))).toEqual({ state, userStyles: styles });
  });

  it('projet v1 (section absente) : réglages par défaut', () => {
    expect(readProjectVocal(undefined)).toEqual({ state: DEFAULT_VOICE_CORRECTION, userStyles: [] });
    const loaded = fromProject(v1Project());
    expect(loaded.vocal).toEqual(DEFAULT_VOICE_CORRECTION);
    expect(loaded.correction).toBeNull();
    expect(toProjectContent(loaded).vocal).toEqual({ styleId: 'natural', dose: 1, userStyles: [] });
  });

  it('valeurs abîmées ramenées dans les bornes, style personnel inconnu oublié', () => {
    const { state, userStyles } = readProjectVocal({
      styleId: 'autotune',
      dose: 4,
      userStyleName: 'Absent',
      custom: { ...trap, retuneMs: 9000 },
      userStyles: [{ name: '', basedOn: 'trap', settings: trap }],
    });
    expect(state.styleId).toBe('natural');
    expect(state.dose).toBe(1);
    expect(state.userStyleName).toBeNull();
    expect(state.custom?.retuneMs).toBe(300);
    expect(userStyles).toEqual([]);
  });

  it('migration : un projet sans styles sauvegardés reprend ceux du navigateur, sinon il garde les siens', () => {
    const legacy = JSON.stringify([{ name: 'Ancien', basedOn: 'rap', settings: trap }]);
    expect(migrateUserStyles(undefined, [], legacy).map(style => style.name)).toEqual(['Ancien']);
    expect(migrateUserStyles({ styleId: 'natural', dose: 1 }, [], legacy).map(style => style.name)).toEqual(['Ancien']);
    expect(migrateUserStyles({ styleId: 'natural', dose: 1, userStyles: [] }, [], legacy)).toEqual([]);
    expect(migrateUserStyles(undefined, [], '{abîmé')).toEqual([]);
  });

  it('un style personnel du même nom est remplacé ; 12 styles maximum', () => {
    const one = upsertUserStyle([], { name: ' A ', basedOn: 'rap', settings: trap })!;
    expect(one.map(style => style.name)).toEqual(['A']);
    expect(upsertUserStyle(one, { name: 'A', basedOn: 'trap', settings: trap })!.map(style => style.basedOn)).toEqual(['trap']);
    const full = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, basedOn: 'rap' as const, settings: trap }));
    expect(upsertUserStyle(full, { name: 'Nouveau', basedOn: 'rap', settings: trap })).toBeNull();
    expect(upsertUserStyle(full, { name: 'S3', basedOn: 'trap', settings: trap })).toHaveLength(12);
  });
});

describe('M10 : version corrigée de la prise', () => {
  const voice = {
    id: 'voice',
    name: 'Voix principale',
    type: 'vocal' as const,
    activeClipId: 'take-2',
    clips: [
      { id: 'take-1', startBeat: 0, durationBeats: 8, audioFileId: 'f1', correction: { audioFileId: 'c1', styleLabel: 'Rap', enabled: true } },
      { id: 'take-2', startBeat: 4, durationBeats: 8, audioFileId: 'f2', correction: { audioFileId: 'c2', styleLabel: 'Trap', enabled: false } },
    ],
  };

  it('relit la version corrigée de la prise active et son choix « corrigée sur la piste Voix »', () => {
    const loaded = fromProject(v1Project({ formatVersion: 2, tracks: [voice] }));
    expect(loaded.correction).toEqual({ takeId: 'take-2', fileId: 'c2', styleLabel: 'Trap', enabled: false });
    // Seule la prise active la garde : le studio ne joue qu'une version corrigée.
    const clips = toProjectContent(loaded).tracks.find(track => track.id === 'voice')!.clips;
    expect(clips.map(clip => clip.correction?.audioFileId)).toEqual([undefined, 'c2']);
    expect(clips[1].audioFileId).toBe('f2');
  });
});
