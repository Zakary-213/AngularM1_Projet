import type { ProjectKeySignature, ProjectTimeSignature } from './musical-project.model';

export interface LyricsGenerationOptions {
  readonly theme: string;
  readonly mood: 'neutral' | 'dark' | 'melancholic' | 'egoTrip' | 'festive';
  readonly language: 'fr' | 'en';
  readonly structure: 'verse' | 'chorus' | 'bridge';
  readonly measures: 4 | 8 | 16;
  readonly flow: 'standard' | 'relaxed' | 'fast';
  readonly rhymeScheme: 'AABB' | 'ABAB' | 'internal';
  readonly languageLevel: 'standard' | 'casual' | 'formal';
}

export interface LyricsLine {
  readonly measure: number;
  readonly text: string;
  readonly syllables: number;
  readonly rhyme: {
    readonly group: string | null;
    readonly words: readonly string[];
    readonly matches: boolean;
  };
}

export interface LyricsGeneration {
  readonly bpm: number;
  readonly timeSignature: ProjectTimeSignature;
  readonly key: ProjectKeySignature;
  readonly targetSyllables: number;
  readonly lines: readonly LyricsLine[];
}
