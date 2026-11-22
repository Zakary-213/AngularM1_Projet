import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import type { LyricsGeneration } from '../../shared/models/lyrics.model';
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
  const bpm = signal(90);
  const projectKey = signal(key);
  const generateLyrics = vi.fn();

  beforeEach(() => {
    savedProject.set(project);
    loadState.set('loaded');
    conflict.set(false);
    bpm.set(90);
    projectKey.set(key);
    generateLyrics.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StudioProjectService, useValue: { project: savedProject, loadState, conflict } },
        { provide: StudioSessionService, useValue: { bpm, projectKey } },
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

  it('propose de choisir un projet dans le studio libre', () => {
    savedProject.set(null);
    fixture.componentRef.setInput('projectId', null);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('form')).toBeNull();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/projects');
  });
});
