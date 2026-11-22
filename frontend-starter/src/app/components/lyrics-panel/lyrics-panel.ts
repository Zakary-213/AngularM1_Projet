import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BEATS_PER_BAR } from '../../shared/audio/music-time';
import { NOTE_NAMES, SCALE_LABELS } from '../../shared/audio/pitch/musical-scale';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import type { LyricsGeneration, LyricsGenerationOptions } from '../../shared/models/lyrics.model';
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
  private readonly proposingFor = signal<{ projectId: string; result: LyricsGeneration } | null>(null);

  readonly maxThemeLength = 200;
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
  readonly settingsChanged = computed(() => {
    const project = this.studioProject.project();
    const key = this.session.projectKey();
    return !!project && (project.bpm !== this.session.bpm() || project.key.root !== key.root || project.key.scale !== key.scale);
  });
  readonly generationBlocked = computed(() => this.generating() || this.settingsChanged() || this.studioProject.conflict());
  readonly proposal = computed(() => {
    const proposal = this.proposingFor();
    return proposal?.projectId === this.studioProject.project()?.id ? proposal?.result : undefined;
  });
  readonly displayedLines = computed(() => this.proposal()?.lines.map(line => {
    const rhymeWords = new Set(line.rhyme.words);
    const segments = line.text.split(/(\p{L}+(?:['’]\p{L}+)*)/gu)
      .filter(Boolean)
      .map(text => ({ text, rhyme: rhymeWords.has(text.normalize('NFC').toLowerCase()) }));
    return { ...line, segments };
  }) ?? []);

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
    this.generating.set(true);
    this.error.set(null);
    this.projects.generateLyrics(project.id, { theme: theme.trim(), ...options })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.proposingFor.set({ projectId: project.id, result });
          this.generating.set(false);
        },
        error: (error: unknown) => {
          const message = error instanceof HttpErrorResponse ? (error.error as { message?: unknown } | null)?.message : undefined;
          this.error.set(typeof message === 'string' ? message : 'La génération a échoué. Réessayez dans un instant.');
          this.generating.set(false);
        },
      });
  }
}
