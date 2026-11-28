import { Injectable, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { DEFAULT_BASS_HZ, playDrumHit } from './drum-synth';
import { DEFAULT_INSTRUMENT_PARAMS } from './melodic-pattern';
import { playInstrumentNote } from './instrument-synth';
import { SoundEntry } from './sound-library';

/** Petit délai pour que la première note ne soit pas programmée dans le passé. */
const PREVIEW_DELAY_SECONDS = 0.01;
const NOTE_PREVIEW_SECONDS = 0.6;
/** Durée pendant laquelle le son est marqué « en lecture » (traîne comprise), en millisecondes. */
const PLAYING_STATE_MS = 1200;
/** Fondu de sortie du son précédent, pour éviter un clic à l'arrêt. */
const STOP_FADE_SECONDS = 0.03;

/**
 * Préécoute des sons de la bibliothèque, avec le même code de synthèse que le
 * studio. Une nouvelle préécoute coupe la précédente : un seul son à la fois.
 */
@Injectable({ providedIn: 'root' })
export class SoundPreviewService {
  private readonly engine = inject(AudioEngineService);
  private current: GainNode | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  /** Identifiant du son en cours de préécoute, ou `null`. */
  readonly playingId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  /** À appeler depuis un clic : le contexte audio ne peut démarrer qu'après un geste. */
  async preview(entry: SoundEntry): Promise<void> {
    try {
      const { context, master } = await this.engine.start();
      this.stopCurrent(context.currentTime);
      const output = context.createGain();
      output.connect(master);
      this.current = output;
      const time = context.currentTime + PREVIEW_DELAY_SECONDS;
      const { source } = entry;
      if (source.kind === 'drum') {
        playDrumHit(context, output, source.voice, time, 1, { kit: source.kit, bassHz: DEFAULT_BASS_HZ });
      } else {
        playInstrumentNote(context, output, source.instrument, source.pitch, time, NOTE_PREVIEW_SECONDS, 0.8, DEFAULT_INSTRUMENT_PARAMS[source.instrument]);
      }
      this.error.set(null);
      this.markPlaying(entry.id);
    } catch (error) {
      console.error('[library] préécoute impossible', error);
      this.playingId.set(null);
      this.error.set("La préécoute n'a pas pu démarrer : le moteur audio est indisponible dans ce navigateur.");
    }
  }

  /** Coupe la préécoute en cours (en quittant la page). */
  stop(): void {
    this.stopCurrent(this.engine.currentTime());
    this.clearTimer();
    this.playingId.set(null);
  }

  private stopCurrent(now: number): void {
    const previous = this.current;
    if (!previous) {
      return;
    }
    this.current = null;
    previous.gain.setTargetAtTime(0, now, STOP_FADE_SECONDS / 3);
    setTimeout(() => previous.disconnect(), STOP_FADE_SECONDS * 1000 * 2);
  }

  private markPlaying(id: string): void {
    this.clearTimer();
    this.playingId.set(id);
    this.resetTimer = setTimeout(() => {
      this.resetTimer = null;
      this.playingId.set(null);
    }, PLAYING_STATE_MS);
  }

  private clearTimer(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
