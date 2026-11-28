import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { LiveInstrumentService } from '../../shared/audio/live-instrument.service';
import { LiveMidiService } from '../../shared/audio/live-midi.service';
import {
  INSTRUMENT_FAMILIES, INSTRUMENT_FAMILY_LABELS, INSTRUMENT_LABELS, INSTRUMENT_RANGES,
  InstrumentId, instrumentsOfFamily,
} from '../../shared/audio/melodic-pattern';
import { NOTE_NAMES, SEMITONES_PER_OCTAVE, pitchClass } from '../../shared/audio/pitch/musical-scale';
import { StudioSessionService } from '../../shared/audio/studio-session.service';

const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11];
const WHITE_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ'];
// Chaque touche noire se trouve entre deux touches blanches.
const BLACK_CODES = ['KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI'];
const DEFAULT_VELOCITY = 0.8;
const EDITABLE_SELECTOR = 'input, textarea, select, [role="textbox"]';
type KeyboardLayout = 'AZERTY' | 'QWERTY';

function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitchClass(pitch)]}${Math.floor(pitch / SEMITONES_PER_OCTAVE) - 1}`;
}

function editableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest(EDITABLE_SELECTOR));
}

@Component({
  selector: 'app-live-instrument-panel',
  templateUrl: './live-instrument-panel.html',
  styleUrl: './live-instrument-panel.css',
  providers: [LiveInstrumentService, LiveMidiService],
  host: {
    '(window:keydown)': 'onKeyDown($event)',
    '(window:keyup)': 'onKeyUp($event)',
    '(window:blur)': 'live.stopAll()',
    '(document:focusin)': 'onFocusIn($event)',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class LiveInstrumentPanelComponent {
  readonly live = inject(LiveInstrumentService);
  readonly midi = inject(LiveMidiService);
  private readonly instrumentPicker = viewChild.required<ElementRef<HTMLDetailsElement>>('instrumentPicker');
  private readonly piano = viewChild.required<ElementRef<HTMLElement>>('piano');
  readonly instrumentName = computed(() => INSTRUMENT_LABELS[this.live.instrument()]);
  readonly instrumentGroups = INSTRUMENT_FAMILIES.map(family => ({
    label: INSTRUMENT_FAMILY_LABELS[family],
    instruments: instrumentsOfFamily(family).map(id => ({ id, label: INSTRUMENT_LABELS[id] })),
  }));

  readonly layout = signal<KeyboardLayout>('AZERTY');
  readonly volumePercent = computed(() => Math.round(this.live.volume() * 100));
  private readonly octaveShift = signal(0);
  private readonly range = computed(() => INSTRUMENT_RANGES[this.live.instrument()]);
  private readonly firstPitch = computed(() => this.range().low + this.octaveShift() * SEMITONES_PER_OCTAVE);
  readonly canLower = computed(() => this.octaveShift() > 0);
  readonly canRaise = computed(() => this.firstPitch() + SEMITONES_PER_OCTAVE <= this.range().high);
  readonly noteRange = computed(() => {
    const lastPitch = Math.min(this.range().high, this.firstPitch() + 2 * SEMITONES_PER_OCTAVE - 1);
    return `${noteName(this.firstPitch())} à ${noteName(lastPitch)}`;
  });

  readonly octaves = computed(() => [0, 1].map(octave => {
    const start = this.firstPitch() + octave * SEMITONES_PER_OCTAVE;
    let whites = 0;
    return Array.from({ length: SEMITONES_PER_OCTAVE }, (_, semitone) => {
      const pitch = start + semitone;
      const white = WHITE_PITCH_CLASSES.includes(pitchClass(pitch));
      const code = octave === 0 ? (white ? WHITE_CODES[whites] : BLACK_CODES[whites - 1]) : undefined;
      const left = whites / WHITE_CODES.length * 100;
      if (white) whites++;
      return { pitch, name: noteName(pitch), white, left, code, label: this.keyLabel(code), enabled: pitch <= this.range().high };
    });
  }));

  constructor() {
    this.live.setInstrument(inject(StudioSessionService).editedMelodicPattern().instrument);
  }

  selectInstrument(instrument: InstrumentId): void {
    this.live.setInstrument(instrument);
    this.octaveShift.set(0);
    this.instrumentPicker().nativeElement.open = false;
    this.piano().nativeElement.focus({ preventScroll: true });
    void this.live.prepare();
  }

  onInstrumentPickerFocusOut(event: FocusEvent): void {
    const picker = this.instrumentPicker().nativeElement;
    if (event.relatedTarget instanceof Node && !picker.contains(event.relatedTarget)) picker.open = false;
  }

  selectLayout(value: string): void {
    if (value === 'AZERTY' || value === 'QWERTY') this.layout.set(value);
  }

  changeOctave(delta: -1 | 1): void {
    if (delta < 0 ? !this.canLower() : !this.canRaise()) return;
    this.live.stopAll('key:');
    this.live.stopAll('pointer:');
    this.octaveShift.update(octave => octave + delta);
  }

  pointerDown(event: PointerEvent, pitch: number): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
    void this.live.press(`pointer:${event.pointerId}`, pitch, DEFAULT_VELOCITY);
  }

  pointerUp(event: PointerEvent): void {
    this.live.release(`pointer:${event.pointerId}`);
  }

  activateKey(event: MouseEvent, pitch: number): void {
    if (event.detail === 0) void this.live.preview(pitch);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || editableTarget(event.target)) return;
    if (this.instrumentPicker().nativeElement.open) return;
    const piano = this.piano().nativeElement;
    const pianoFocused = event.target instanceof Node && piano.contains(event.target);
    const lowerOctave = event.code === 'PageDown' || (pianoFocused && event.code === 'ArrowDown');
    const raiseOctave = event.code === 'PageUp' || (pianoFocused && event.code === 'ArrowUp');
    if (lowerOctave || raiseOctave) {
      event.preventDefault();
      if (!event.repeat) {
        // Le changement d'octave peut retirer du DOM la touche qui avait le focus.
        if (pianoFocused) piano.focus({ preventScroll: true });
        this.changeOctave(lowerOctave ? -1 : 1);
      }
      return;
    }
    const note = this.octaves()[0].find(key => key.enabled && key.code === event.code);
    if (!note) return;
    event.preventDefault();
    if (!event.repeat) void this.live.press(`key:${event.code}`, note.pitch, DEFAULT_VELOCITY);
  }

  onKeyUp(event: KeyboardEvent): void {
    this.live.release(`key:${event.code}`);
  }

  onFocusIn(event: FocusEvent): void {
    if (editableTarget(event.target)) this.live.stopAll('key:');
  }

  onVisibilityChange(): void {
    if (document.hidden) this.live.stopAll();
  }

  private keyLabel(code: string | undefined): string {
    if (!code) return '';
    if (this.layout() === 'AZERTY') {
      if (code === 'KeyA') return 'Q';
      if (code === 'KeyW') return 'Z';
    }
    return code.slice(-1);
  }
}
