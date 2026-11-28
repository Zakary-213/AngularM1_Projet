import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { AudioEngineService } from './audio-engine.service';
import { HeldInstrumentNote, playInstrumentNote, startHeldInstrumentNote } from './instrument-synth';
import { DEFAULT_INSTRUMENT_PARAMS, INSTRUMENT_RANGES, InstrumentId } from './melodic-pattern';

const MAX_HELD_NOTES = 48;
const VOLUME_SMOOTHING_SECONDS = 0.01;
const PREVIEW_SECONDS = 0.2;

interface HeldNote {
  readonly pitch: number;
  voice?: HeldInstrumentNote;
}

/** Toutes les entrées du jeu en direct utilisent la même horloge et le même timbre. */
@Injectable()
export class LiveInstrumentService implements OnDestroy {
  private readonly engine = inject(AudioEngineService);
  private readonly held = new Map<string, HeldNote>();
  private output: GainNode | null = null;
  private destroyed = false;

  readonly instrument = signal<InstrumentId>('piano');
  readonly volume = signal(0.65);
  readonly activePitches = signal<ReadonlySet<number>>(new Set());
  readonly error = signal<string | null>(null);
  readonly timing = signal<{ schedulingMs: number; outputMs: number } | null>(null);

  setInstrument(instrument: InstrumentId): void {
    if (instrument === this.instrument()) return;
    this.stopAll();
    this.instrument.set(instrument);
  }

  setVolume(value: number): void {
    this.volume.set(Math.min(1, Math.max(0, value)));
    this.output?.gain.setTargetAtTime(this.volume(), this.engine.currentTime(), VOLUME_SMOOTHING_SECONDS);
  }

  async prepare(): Promise<void> {
    try {
      await this.engine.start();
      if (!this.destroyed) this.error.set(null);
    } catch {
      this.reportAudioError();
    }
  }

  async press(id: string, pitch: number, velocity: number): Promise<void> {
    const instrument = this.instrument();
    const range = INSTRUMENT_RANGES[instrument];
    if (this.destroyed || this.held.has(id) || this.held.size >= MAX_HELD_NOTES || pitch < range.low || pitch > range.high) return;

    const started = performance.now();
    const note: HeldNote = { pitch };
    this.held.set(id, note);
    try {
      const { context, master } = await this.engine.start();
      // Le relâchement, un changement d'instrument ou la fermeture peuvent précéder la reprise audio.
      if (this.held.get(id) !== note) return;
      note.voice = startHeldInstrumentNote(context, this.outputFor(context, master), instrument, pitch, velocity, DEFAULT_INSTRUMENT_PARAMS[instrument]);
      this.updatePitches();
      this.timing.set({
        schedulingMs: Math.max(0, performance.now() - started),
        outputMs: this.engine.outputLatencySeconds() * 1000,
      });
      this.error.set(null);
    } catch {
      if (this.held.get(id) !== note) return;
      this.held.delete(id);
      this.updatePitches();
      this.reportAudioError();
    }
  }

  release(id: string): void {
    const note = this.held.get(id);
    if (!note) return;
    this.held.delete(id);
    note.voice?.release();
    this.updatePitches();
  }

  stopAll(prefix = ''): void {
    for (const [id, note] of this.held) {
      if (!id.startsWith(prefix)) continue;
      this.held.delete(id);
      note.voice?.release(true);
    }
    this.updatePitches();
  }

  /** Activation native d'une touche du panneau (Entrée, Espace ou lecteur d'écran). */
  async preview(pitch: number): Promise<void> {
    const instrument = this.instrument();
    try {
      const { context, master } = await this.engine.start();
      if (this.destroyed || instrument !== this.instrument()) return;
      playInstrumentNote(context, this.outputFor(context, master), instrument, pitch, context.currentTime, PREVIEW_SECONDS, 0.8, DEFAULT_INSTRUMENT_PARAMS[instrument]);
      this.error.set(null);
    } catch {
      this.reportAudioError();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopAll();
    this.output?.disconnect();
    this.output = null;
  }

  private outputFor(context: AudioContext, master: GainNode): GainNode {
    if (!this.output) {
      this.output = context.createGain();
      this.output.gain.value = this.volume();
      this.output.connect(master);
    }
    return this.output;
  }

  private updatePitches(): void {
    this.activePitches.set(new Set([...this.held.values()].filter(note => note.voice).map(note => note.pitch)));
  }

  private reportAudioError(): void {
    if (!this.destroyed) this.error.set('Le son ne peut pas démarrer. Cliquez sur une touche pour réessayer.');
  }
}
