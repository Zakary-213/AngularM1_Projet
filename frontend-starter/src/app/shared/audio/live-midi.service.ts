import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { LiveInstrumentService } from './live-instrument.service';

const MAX_MIDI_VELOCITY = 127;

/** Accès au périphérique MIDI actif pour la durée d'ouverture du panneau. */
@Injectable()
export class LiveMidiService implements OnDestroy {
  private readonly live = inject(LiveInstrumentService);
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private destroyed = false;

  readonly supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  readonly requesting = signal(false);
  readonly connected = signal(false);
  readonly inputs = signal<readonly MIDIInput[]>([]);
  readonly inputId = signal('');
  readonly error = signal<string | null>(null);

  async connect(): Promise<void> {
    if (!this.supported || this.requesting() || this.connected()) return;
    this.requesting.set(true);
    this.error.set(null);
    // Une touche MIDI peut arriver sans geste reconnu par les règles d'autoplay.
    void this.live.prepare();
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (this.destroyed) return;
      this.access = access;
      this.connected.set(true);
      access.addEventListener('statechange', this.refreshInputs);
      this.refreshInputs();
      if (this.inputs()[0]) this.select(this.inputs()[0].id);
    } catch {
      if (!this.destroyed) this.error.set('Accès MIDI indisponible. Vérifiez l’autorisation du navigateur et réessayez.');
    } finally {
      this.requesting.set(false);
    }
  }

  select(id: string): void {
    if (this.input?.id === id) return;
    this.detachInput();
    const input = this.inputs().find(candidate => candidate.id === id);
    if (!input) return;
    this.input = input;
    this.inputId.set(input.id);
    this.error.set(null);
    input.addEventListener('midimessage', this.onMessage);
    void input.open().catch(() => {
      if (this.input !== input) return;
      this.detachInput();
      this.error.set('Impossible d’ouvrir cette entrée MIDI. Vérifiez le branchement et réessayez.');
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.access?.removeEventListener('statechange', this.refreshInputs);
    this.detachInput();
  }

  private readonly refreshInputs = (): void => {
    const inputs = [...(this.access?.inputs.values() ?? [])].filter(input => input.state === 'connected');
    this.inputs.set(inputs);
    if (this.input && !inputs.includes(this.input)) this.detachInput();
  };

  private readonly onMessage = ({ data }: MIDIMessageEvent): void => {
    if (!data || data.length < 3 || document.visibilityState === 'hidden' || !document.hasFocus()) return;
    const [status, pitch, velocity] = data;
    const command = status & 0xf0;
    const channel = status & 0x0f;
    const id = `midi:${channel}:${pitch}`;
    if (command === 0x90 && velocity > 0) {
      void this.live.press(id, pitch, velocity / MAX_MIDI_VELOCITY);
    } else if (command === 0x80 || command === 0x90) {
      this.live.release(id);
    } else if (command === 0xb0 && (pitch === 120 || pitch === 123)) {
      this.live.stopAll(`midi:${channel}:`);
    }
  };

  private detachInput(): void {
    if (!this.input) return;
    const input = this.input;
    this.input = null;
    input.removeEventListener('midimessage', this.onMessage);
    void input.close().catch(error => console.warn('[studio-midi] fermeture de l’entrée MIDI impossible', error));
    this.inputId.set('');
    this.live.stopAll('midi:');
  }
}
