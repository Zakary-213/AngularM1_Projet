import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import type { LyricsGeneration, ProjectLyrics } from '../../shared/models/lyrics.model';
import type { MusicalProject, ProjectKeySignature } from '../../shared/models/musical-project.model';
import { ProjectService } from '../../shared/services/project.service';
import { StudioProjectService, type ProjectLoadState } from '../../shared/services/studio-project.service';
import { LyricsPanelComponent } from './lyrics-panel';

const key: ProjectKeySignature = { root: 9, scale: 'minor' };
const project: MusicalProject = {
  id: 'p1', ownerId: 'u1', title: 'Minuit', origin: 'create', formatVersion: 2, revision: 1,
  createdAt: '', updatedAt: '', tracks: [], patterns: [], bpm: 90, key, timeSignature: { beatsPerBar: 4, beatUnit: 4 },
};
const result: LyricsGeneration = {
  bpm: 90, key, timeSignature: { beatsPerBar: 4, beatUnit: 4 }, targetSyllables: 10,
  lines: [{ measure: 1, text: 'Je marche dans la nuit', syllables: 5, rhyme: { group: 'A', words: ['nuit'], matches: true } }],
};

describe('Paroles dans le studio', () => {
  let fixture: ComponentFixture<LyricsPanelComponent>;
  let component: LyricsPanelComponent;
  const savedProject = signal<MusicalProject | null>(project);
  const loadState = signal<ProjectLoadState>('loaded');
  const conflict = signal(false);
  const lyrics = signal<ProjectLyrics | undefined>(undefined);
  const projectLoadVersion = signal(0);
  const bpm = signal(90);
  const projectKey = signal(key);
  const songStep = signal(0);
  const transportState = signal<'stopped' | 'paused' | 'playing'>('stopped');
  const generateLyrics = vi.fn();

  beforeEach(() => {
    savedProject.set(project);
    loadState.set('loaded');
    conflict.set(false);
    lyrics.set(undefined);
    projectLoadVersion.set(0);
    bpm.set(90);
    projectKey.set(key);
    songStep.set(0);
    transportState.set('stopped');
    generateLyrics.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StudioProjectService, useValue: { project: savedProject, loadState, conflict, lyrics, projectLoadVersion } },
        { provide: StudioSessionService, useValue: { bpm, projectKey, songStep, transportState } },
        { provide: ProjectService, useValue: { generateLyrics } },
      ],
    });
    fixture = TestBed.createComponent(LyricsPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.detectChanges();
  });

  it('affiche le contexte du projet et les choix de génération', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.project-context')?.textContent).toContain('90 BPM');
    expect(element.querySelector('.project-context')?.textContent).toContain('4/4');
    expect(element.querySelector('.project-context')?.textContent).toContain('La mineur');
    expect(element.querySelectorAll('select')).toHaveLength(7);
    expect(element.querySelector('#lyrics-measures')?.textContent).toContain('16 mesures');
  });

  it('refuse un thème vide et attend la sauvegarde du tempo', () => {
    component.form.controls.theme.setValue('   ');
    component.generate();
    expect(component.form.controls.theme.touched).toBe(true);
    component.form.controls.theme.setValue('La nuit');
    bpm.set(140);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sauvegardez le projet');
    component.generate();
    expect(generateLyrics).not.toHaveBeenCalled();
    savedProject.set({ ...project, bpm: 140 });
    generateLyrics.mockReturnValue(of({ ...result, bpm: 140 }));
    component.generate();
    expect(generateLyrics).toHaveBeenCalledTimes(1);
  });

  it('envoie tous les réglages, bloque un double clic et affiche la mesure et sa rime', () => {
    const pending = new Subject<LyricsGeneration>();
    generateLyrics.mockReturnValue(pending);
    const options = { theme: 'La nuit', mood: 'dark', language: 'en', structure: 'chorus', measures: 16,
      flow: 'fast', rhymeScheme: 'ABAB', languageLevel: 'casual' } as const;
    component.form.setValue({ ...options, theme: '  La nuit  ' });
    component.generate();
    component.generate();
    expect(generateLyrics).toHaveBeenCalledExactlyOnceWith('p1', options);
    expect(component.generating()).toBe(true);
    pending.next(result);
    pending.complete();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Proposition générée par IA');
    expect(element.querySelector('li')?.textContent).toContain('Mesure 1');
    expect(element.querySelector('li')?.textContent).toContain('5 syllabes estimées');
    expect(element.querySelector('li mark')?.textContent).toBe('nuit');
    expect(component.generating()).toBe(false);
  });

  it('garde la proposition si la génération suivante échoue', () => {
    generateLyrics.mockReturnValueOnce(of(result)).mockReturnValueOnce(throwError(() =>
      new HttpErrorResponse({ status: 429, error: { message: 'Le quota est atteint.' } }),
    ));
    component.form.controls.theme.setValue('La nuit');
    component.generate();
    component.generate();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Le quota est atteint.');
    expect(element.querySelector('li mark')?.textContent).toBe('nuit');
  });

  it('annonce les paires de rimes repérées et surligne seulement celles qui correspondent', () => {
    const lines = ['retenu', 'feu', 'perdus', 'retenue'].map((text, index) => ({
      measure: index + 1, text, syllables: 2,
      rhyme: { group: index % 2 === 0 ? 'A' : 'B', words: [text], matches: index % 2 === 0 },
    }));
    generateLyrics.mockReturnValue(of({ ...result, lines }));
    component.form.patchValue({ theme: 'La nuit', measures: 4, rhymeScheme: 'ABAB' });
    component.generate();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Schéma demandé ABAB · Paires de rimes repérées 1/2');
    expect(Array.from(element.querySelectorAll('li mark'), mark => mark.textContent)).toEqual(['retenu', 'perdus']);
  });

  it('compte les mesures avec une rime interne et surligne les deux mots', () => {
    generateLyrics.mockReturnValue(of({
      ...result, lines: [
        { measure: 1, text: 'Un jeu près du feu', syllables: 5, rhyme: { group: null, words: ['jeu', 'feu'], matches: true } },
        { measure: 2, text: 'Je marche dans la ville', syllables: 6, rhyme: { group: null, words: [], matches: false } },
      ],
    }));
    component.form.patchValue({ theme: 'La nuit', rhymeScheme: 'internal' });
    component.generate();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Rimes internes · Mesures avec une rime 1/2');
    expect(Array.from(element.querySelectorAll('li mark'), mark => mark.textContent)).toEqual(['jeu', 'feu']);
  });

  it('propose de choisir un projet dans le studio libre', () => {
    savedProject.set(null);
    fixture.componentRef.setInput('projectId', null);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('form')).toBeNull();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/projects');
  });

  it('modifie une ligne, conserve la version précédente et peut annuler', () => {
    generateLyrics.mockReturnValue(of(result));
    component.form.controls.theme.setValue('La nuit');
    component.generate();
    const original = lyrics()?.current;
    component.edit(1);
    component.editField.setValue('Je trace ma route');
    component.applyEdit();
    expect(lyrics()?.current.lines).toEqual(['Je trace ma route']);
    expect(lyrics()?.history).toEqual([original]);
    component.undo();
    expect(lyrics()?.current).toEqual(original);
    expect(lyrics()?.history).toEqual([]);
  });

  it('régénère la mesure demandée avec les réglages et le texte de la version courante', () => {
    generateLyrics.mockReturnValueOnce(of(result)).mockReturnValueOnce(of({ ...result, lines: [{ ...result.lines[0], text: 'En suivant la lune' }] }));
    component.form.controls.theme.setValue('La nuit');
    component.generate();
    const current = lyrics()!.current;
    component.form.controls.theme.setValue('Un autre thème');
    component.regenerate(1, 1);
    expect(generateLyrics).toHaveBeenLastCalledWith('p1', current.options, { from: 1, to: 1, lines: current.lines });
    expect(lyrics()?.current.lines).toEqual(['En suivant la lune']);
    expect(lyrics()?.history).toEqual([current]);
  });

  it('suit la position du transport lors de la lecture, de la pause, d’un retour et de l’arrêt', () => {
    const next = { ...result.lines[0], measure: 2, text: 'Deuxième mesure' };
    generateLyrics.mockReturnValue(of({ ...result, lines: [...result.lines, next] }));
    component.form.controls.theme.setValue('La nuit');
    component.generate();
    component.prompterVisible.set(true);
    const element = fixture.nativeElement as HTMLElement;
    transportState.set('playing');
    songStep.set(15);
    fixture.detectChanges();
    expect(element.querySelector('.prompter-line')?.textContent).toBe(result.lines[0].text);
    songStep.set(16);
    transportState.set('paused');
    fixture.detectChanges();
    expect(element.querySelector('.prompter-line')?.textContent).toBe(next.text);
    expect(element.querySelector('li[aria-current="step"]')?.textContent).toContain('Mesure 2');
    songStep.set(0);
    fixture.detectChanges();
    expect(element.querySelector('.prompter-line')?.textContent).toBe(result.lines[0].text);
    transportState.set('stopped');
    fixture.detectChanges();
    expect(element.querySelector('.prompter-line')).toBeNull();
  });
});
