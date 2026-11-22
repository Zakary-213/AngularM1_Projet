import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BEATS_PER_BAR, STEPS_PER_BAR } from '../../shared/audio/music-time';
import { NOTE_NAMES, SCALE_LABELS } from '../../shared/audio/pitch/musical-scale';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { MAX_LYRICS_HISTORY, MAX_LYRICS_LINE_LENGTH } from '../../shared/models/lyrics.model';
import type { LyricsGenerationOptions, LyricsLine, LyricsRegeneration, LyricsVersion } from '../../shared/models/lyrics.model';
import type { ProjectKeySignature } from '../../shared/models/musical-project.model';
import { ProjectService } from '../../shared/services/project.service';
import { StudioProjectService } from '../../shared/services/studio-project.service';

@Component({
  selector: 'app-lyrics-panel',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './lyrics-panel.html',
  styleUrl: './lyrics-panel.css',
})
export class LyricsPanelComponent {
  readonly projectId = input<string | null>(null);
  readonly studioProject = inject(StudioProjectService);
  private readonly session = inject(StudioSessionService);
  private readonly projects = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly generatedAnalysis = signal<{ version: LyricsVersion; lines: readonly LyricsLine[] } | null>(null);

  readonly maxThemeLength = 200;
  readonly maxLineLength = MAX_LYRICS_LINE_LENGTH;
  readonly beatsPerBar = BEATS_PER_BAR;
  readonly form = inject(FormBuilder).nonNullable.group({
    theme: ['', [Validators.required, Validators.maxLength(this.maxThemeLength), Validators.pattern(/\S/u)]],
    mood: 'neutral' as LyricsGenerationOptions['mood'],
    language: 'fr' as LyricsGenerationOptions['language'],
    structure: 'verse' as LyricsGenerationOptions['structure'],
    measures: 8 as LyricsGenerationOptions['measures'],
    flow: 'standard' as LyricsGenerationOptions['flow'],
    rhymeScheme: 'AABB' as LyricsGenerationOptions['rhymeScheme'],
    languageLevel: 'standard' as LyricsGenerationOptions['languageLevel'],
  });
  readonly selectFields = [
    { name: 'mood', label: 'Ambiance', options: [['neutral', 'Neutre'], ['dark', 'Sombre'], ['melancholic', 'Mélancolique'], ['egoTrip', 'Ego-trip'], ['festive', 'Festive']] },
    { name: 'language', label: 'Langue', options: [['fr', 'Français'], ['en', 'Anglais']] },
    { name: 'structure', label: 'Structure', options: [['verse', 'Couplet'], ['chorus', 'Refrain'], ['bridge', 'Pont']] },
    { name: 'measures', label: 'Nombre de mesures', options: [[4, '4 mesures'], [8, '8 mesures'], [16, '16 mesures']] },
    { name: 'flow', label: 'Densité du flow', options: [['relaxed', 'Posé'], ['standard', 'Standard'], ['fast', 'Rapide']] },
    { name: 'rhymeScheme', label: 'Schéma de rimes', options: [['AABB', 'Par paires (AABB)'], ['ABAB', 'Croisées (ABAB)'], ['internal', 'Internes']] },
    { name: 'languageLevel', label: 'Niveau de langage', options: [['standard', 'Standard'], ['casual', 'Familier'], ['formal', 'Soutenu']] },
  ] as const;

  readonly generating = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingMeasure = signal<number | null>(null);
  readonly editField = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MAX_LYRICS_LINE_LENGTH), Validators.pattern(/^[^\r\n]*$/u)] });
  readonly blockStart = new FormControl(1, { nonNullable: true });
  readonly blockEnd = new FormControl(2, { nonNullable: true });
  readonly prompterVisible = signal(false);
  readonly settingsChanged = computed(() => {
    const project = this.studioProject.project();
    const key = this.session.projectKey();
    return !!project && (project.bpm !== this.session.bpm() || project.key.root !== key.root || project.key.scale !== key.scale);
  });
  readonly generationBlocked = computed(() => this.generating() || this.settingsChanged() || this.studioProject.conflict() || this.editingMeasure() !== null);
  readonly proposal = computed(() => this.studioProject.lyrics()?.current);
  readonly canUndo = computed(() => Boolean(this.studioProject.lyrics()?.history.length) && !this.generating() && this.editingMeasure() === null);
  readonly currentMeasure = computed(() => {
    if (this.session.transportState() === 'stopped') return null;
    return Math.floor(this.session.songStep() / STEPS_PER_BAR) + 1;
  });
  private readonly analysis = computed(() => {
    const draft = this.proposal();
    const preview = this.generatedAnalysis();
    if (preview?.version === draft) return preview?.lines;
    const project = this.studioProject.project();
    const saved = project?.lyrics?.current;
    if (draft && saved && draft.options.language === saved.options.language && draft.options.rhymeScheme === saved.options.rhymeScheme &&
        draft.lines.length === saved.lines.length && draft.lines.every((text, index) => text === saved.lines[index])) {
      return project?.lyricsAnalysis;
    }
    return undefined;
  });
  readonly rhymeSummary = computed(() => {
    const lines = this.analysis();
    if (!lines) return undefined;
    const matched = lines.filter(line => line.rhyme.matches);
    if (this.proposal()?.options.rhymeScheme === 'internal') return { matched: matched.length, total: lines.length };
    const pairs = new Set(matched.map(line => line.rhyme.group));
    return { matched: pairs.size, total: Math.floor(lines.length / 2) };
  });
  readonly displayedLines = computed(() => this.proposal()?.lines.map((text, index) => {
    const line = this.analysis()?.[index];
    const rhymeWords = new Set(line?.rhyme.matches ? line.rhyme.words : []);
    const segments = text.split(/(\p{L}+(?:['’]\p{L}+)*)/gu)
      .filter(Boolean)
      .map(text => ({ text, rhyme: rhymeWords.has(text.normalize('NFC').toLowerCase()) }));
    return { measure: index + 1, analysis: line, segments };
  }) ?? []);

  constructor() {
    effect(() => {
      if (this.studioProject.loadState() !== 'loaded') return;
      this.studioProject.projectLoadVersion();
      const saved = untracked(this.studioProject.lyrics)?.current;
      if (saved) this.form.setValue(saved.options);
      this.generatedAnalysis.set(null);
      this.editingMeasure.set(null);
      this.error.set(null);
      this.prompterVisible.set(false);
      this.blockStart.setValue(1);
      this.blockEnd.setValue(2);
    });
  }

  keyLabel(key: ProjectKeySignature): string {
    return `${NOTE_NAMES[key.root]} ${SCALE_LABELS[key.scale]}`;
  }

  generate(): void {
    const project = this.studioProject.project();
    if (!project || this.studioProject.loadState() !== 'loaded' || this.generationBlocked()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { theme, ...options } = this.form.getRawValue();
    this.requestGeneration(project.id, { theme: theme.trim(), ...options });
  }

  regenerateBlock(): void {
    const from = this.blockStart.value;
    const to = this.blockEnd.value;
    if (from > to) {
      this.error.set('La dernière mesure doit suivre la première ou être identique.');
      return;
    }
    this.regenerate(from, to);
  }

  regenerate(from: number, to: number): void {
    const draft = this.proposal();
    const project = this.studioProject.project();
    if (!draft || !project || this.studioProject.loadState() !== 'loaded' || this.generationBlocked() || from < 1 || to > draft.lines.length || from > to) return;
    this.requestGeneration(project.id, draft.options, { from, to, lines: draft.lines });
  }

  edit(measure: number): void {
    const text = this.proposal()?.lines[measure - 1];
    if (text === undefined || this.generating() || this.editingMeasure() !== null) return;
    this.editField.reset(text);
    this.editingMeasure.set(measure);
  }

  applyEdit(): void {
    const measure = this.editingMeasure();
    const draft = this.proposal();
    if (measure === null || !draft || this.editField.invalid) return;
    const text = this.editField.value.trim();
    if (text !== draft.lines[measure - 1]) {
      this.keepVersion({ ...draft, lines: draft.lines.map((line, index) => index === measure - 1 ? text : line) });
    }
    this.editingMeasure.set(null);
  }

  undo(): void {
    const lyrics = this.studioProject.lyrics();
    const previous = lyrics?.history.at(-1);
    if (!lyrics || !previous || !this.canUndo()) return;
    this.studioProject.lyrics.set({ current: previous, history: lyrics.history.slice(0, -1) });
    this.resetRangeIfNeeded(previous.lines.length);
  }

  private keepVersion(current: LyricsVersion): void {
    const previous = this.studioProject.lyrics();
    const history = previous ? [...previous.history, previous.current].slice(-MAX_LYRICS_HISTORY) : [];
    this.studioProject.lyrics.set({ current, history });
    this.resetRangeIfNeeded(current.lines.length);
  }

  private resetRangeIfNeeded(length: number): void {
    if (this.blockStart.value > length || this.blockEnd.value > length) {
      this.blockStart.setValue(1);
      this.blockEnd.setValue(Math.min(2, length));
    }
  }

  private requestGeneration(projectId: string, options: LyricsGenerationOptions, regenerate?: LyricsRegeneration): void {
    const loadVersion = this.studioProject.projectLoadVersion();
    this.generating.set(true);
    this.error.set(null);
    const generation = regenerate ? this.projects.generateLyrics(projectId, options, regenerate) : this.projects.generateLyrics(projectId, options);
    generation
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.generating.set(false);
          if (loadVersion !== this.studioProject.projectLoadVersion()) return;
          const version = { options, bpm: result.bpm, targetSyllables: result.targetSyllables, lines: result.lines.map(line => line.text) };
          this.generatedAnalysis.set({ version, lines: result.lines });
          this.keepVersion(version);
        },
        error: (error: unknown) => {
          this.generating.set(false);
          if (loadVersion !== this.studioProject.projectLoadVersion()) return;
          const message = error instanceof HttpErrorResponse ? (error.error as { message?: unknown } | null)?.message : undefined;
          this.error.set(typeof message === 'string' ? message : 'La génération a échoué. Réessayez dans un instant.');
        },
      });
  }
}
