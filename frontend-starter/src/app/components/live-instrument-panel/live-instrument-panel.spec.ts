import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngineService } from '../../shared/audio/audio-engine.service';
import { noteEnvelope } from '../../shared/audio/instrument-synth';
import { DEFAULT_INSTRUMENT_PARAMS } from '../../shared/audio/melodic-pattern';
import { midiToFrequency } from '../../shared/audio/pitch/musical-scale';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { LiveInstrumentPanelComponent } from './live-instrument-panel';

class AudioParameter {
  value = 0;
  setValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class AudioTestNode extends EventTarget {
  gain = new AudioParameter();
  frequency = new AudioParameter();
  detune = new AudioParameter();
  connect = <T>(target: T): T => target;
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MidiPort extends EventTarget {
  name = 'Clavier de test';
  state: MIDIPortDeviceState = 'connected';
  open = vi.fn(async () => this);
  close = vi.fn(async () => this);

  constructor(readonly id: string) { super(); }

  send(data: number[]): void {
    this.dispatchEvent(Object.assign(new Event('midimessage'), { data: new Uint8Array(data) }));
  }
}

describe('Jeu d’instrument en direct', () => {
  let fixture: ComponentFixture<LiveInstrumentPanelComponent>;
  let root: HTMLElement;
  let gains: AudioTestNode[];
  let oscillators: AudioTestNode[];
  const context = {
    createGain: () => gains[gains.push(new AudioTestNode()) - 1],
    createOscillator: () => oscillators[oscillators.push(new AudioTestNode()) - 1],
    createBiquadFilter: () => new AudioTestNode(),
    currentTime: 2,
  };
  const audioContext = context as unknown as AudioContext;
  const master = {} as GainNode;
  const start = vi.fn<() => Promise<{ context: AudioContext; master: GainNode }>>();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'requestMIDIAccess');

  const key = (type: 'keydown' | 'keyup', code: string, target: EventTarget = window, repeat = false) => {
    const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, repeat });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    gains = [];
    oscillators = [];
    start.mockReset().mockResolvedValue({ context: audioContext, master });
    TestBed.configureTestingModule({
      imports: [LiveInstrumentPanelComponent],
      providers: [
        { provide: AudioEngineService, useValue: { start, currentTime: () => 2, outputLatencySeconds: () => 0.012 } },
        { provide: StudioSessionService, useValue: { editedMelodicPattern: () => ({ instrument: 'piano' }) } },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    if (descriptor) Object.defineProperty(navigator, 'requestMIDIAccess', descriptor);
    else Reflect.deleteProperty(navigator, 'requestMIDIAccess');
  });

  async function openPanel(): Promise<void> {
    fixture = TestBed.createComponent(LiveInstrumentPanelComponent);
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  it('joue un accord depuis les deux rangées du clavier, ignore la répétition et libère chaque note séparément', async () => {
    await openPanel();
    expect(root.querySelectorAll('.piano-key')).toHaveLength(24);
    for (const code of ['KeyA', 'KeyE', 'KeyG']) key('keydown', code);
    key('keydown', 'KeyE', window, true);
    await fixture.whenStable();

    expect([oscillators[0], oscillators[4], oscillators[8]].map(node => node.frequency.value)).toEqual([48, 51, 55].map(midiToFrequency));
    expect(oscillators).toHaveLength(12);
    expect(root.querySelectorAll('.piano-key[aria-pressed="true"]')).toHaveLength(3);
    key('keyup', 'KeyE');
    await fixture.whenStable();
    expect(oscillators[4].stop).toHaveBeenCalledOnce();
    expect(oscillators[0].stop).not.toHaveBeenCalled();
    expect(root.querySelectorAll('.piano-key[aria-pressed="true"]')).toHaveLength(2);

    window.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(oscillators[0].stop).toHaveBeenCalledWith(2.02);
    expect(oscillators[8].stop).toHaveBeenCalledWith(2.02);
    expect(root.querySelectorAll('.piano-key[aria-pressed="true"]')).toHaveLength(0);
  });

  it('change d’octave, laisse les champs de saisie tranquilles et coupe les notes au changement d’instrument', async () => {
    await openPanel();
    key('keydown', 'PageUp');
    const select = root.querySelector('select')!;
    expect(key('keydown', 'KeyA', select).defaultPrevented).toBe(false);
    key('keydown', 'KeyA');
    await fixture.whenStable();
    expect(oscillators).toHaveLength(4);
    expect(oscillators[0].frequency.value).toBe(midiToFrequency(60));

    root.querySelector('summary')!.click();
    const organ = [...root.querySelectorAll<HTMLButtonElement>('.instrument-options button')].find(button => button.textContent?.trim() === 'Orgue')!;
    organ.click();
    await fixture.whenStable();
    expect(oscillators[0].stop).toHaveBeenCalledWith(2.02);
    key('keydown', 'KeyA');
    await fixture.whenStable();
    expect(oscillators).toHaveLength(9);
    expect(oscillators[4].frequency.value).toBe(midiToFrequency(48) * 0.5);
    const volume = root.querySelector<HTMLInputElement>('input[type="range"]')!;
    volume.value = '30';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gains[0].gain.setTargetAtTime).toHaveBeenCalledWith(0.3, 2, 0.01);
  });

  it('joue dès la frappe suivante après avoir choisi le piano déjà sélectionné', async () => {
    await openPanel();
    const picker = root.querySelector<HTMLDetailsElement>('.instrument-picker')!;
    const piano = root.querySelector<HTMLElement>('.live-piano')!;
    picker.querySelector('summary')!.click();
    const current = picker.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!;
    current.focus();
    expect(key('keydown', 'KeyA', current).defaultPrevented).toBe(false);
    expect(oscillators).toHaveLength(0);
    current.click();
    expect(picker.open).toBe(false);
    expect(document.activeElement).toBe(piano);
    expect(key('keydown', 'KeyA', document.activeElement!).defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(oscillators[0].frequency.value).toBe(midiToFrequency(48));
  });

  it('change d’octave avec les flèches seulement lorsque le piano a le focus', async () => {
    await openPanel();
    const piano = root.querySelector<HTMLElement>('.live-piano')!;
    const firstKey = piano.querySelector<HTMLButtonElement>('.piano-key')!;
    const range = root.querySelector('[aria-label="Plage de notes"]')!;

    expect(key('keydown', 'ArrowUp').defaultPrevented).toBe(false);
    expect(range.textContent?.trim()).toBe('Do3 à Si4');
    firstKey.focus();
    expect(key('keydown', 'ArrowUp', firstKey).defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(range.textContent?.trim()).toBe('Do4 à Si5');
    expect(document.activeElement).toBe(piano);

    expect(key('keydown', 'ArrowDown', piano).defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(range.textContent?.trim()).toBe('Do3 à Si4');
  });

  it('gère plusieurs doigts et traite une annulation tactile comme un relâchement', async () => {
    await openPanel();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.piano-key')].slice(0, 2);
    for (const [index, button] of buttons.entries()) {
      button.setPointerCapture = vi.fn();
      button.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: index + 1, pointerType: 'touch' }));
    }
    await fixture.whenStable();
    expect([oscillators[0], oscillators[4]].map(node => node.frequency.value)).toEqual([48, 49].map(midiToFrequency));
    buttons[0].dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    await fixture.whenStable();
    expect(oscillators[0].stop).toHaveBeenCalledOnce();
    expect(oscillators[4].stop).not.toHaveBeenCalled();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('n’allume pas de voix relâchée pendant le démarrage audio', async () => {
    await openPanel();
    let resume!: (audio: { context: AudioContext; master: GainNode }) => void;
    const pending = new Promise<{ context: AudioContext; master: GainNode }>(resolve => { resume = resolve; });
    start.mockReturnValueOnce(pending);
    key('keydown', 'KeyA');
    key('keyup', 'KeyA');
    resume({ context: audioContext, master });
    await fixture.whenStable();
    expect(oscillators).toHaveLength(0);
  });

  it('coupe les sources et débranche le gain quand le panneau ferme', async () => {
    await openPanel();
    key('keydown', 'KeyA');
    await fixture.whenStable();
    fixture.destroy();
    expect(oscillators[0].stop).toHaveBeenCalledWith(2.02);
    expect(gains[0].disconnect).toHaveBeenCalledOnce();
    key('keydown', 'KeyS');
    expect(start).toHaveBeenCalledOnce();
  });

  it('garde le piano utilisable quand le navigateur ne fournit pas le MIDI', async () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    await openPanel();
    expect(root.querySelector('.midi-controls')?.textContent).toContain('Le MIDI est indisponible');
    expect(root.querySelector('.midi-controls button')).toBeNull();
    key('keydown', 'KeyA');
    await fixture.whenStable();
    expect(oscillators[0].frequency.value).toBe(midiToFrequency(48));
  });

  it('demande le MIDI au clic, applique la vélocité et coupe les notes au débranchement', async () => {
    const first = new MidiPort('one');
    const second = new MidiPort('two');
    const access = Object.assign(new EventTarget(), { inputs: new Map([[first.id, first], [second.id, second]]) });
    const request = vi.fn(async () => access);
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: request });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await openPanel();
    expect(request).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.midi-controls button')!.click();
    await fixture.whenStable();
    expect(request).toHaveBeenCalledExactlyOnceWith({ sysex: false });

    const select = root.querySelector<HTMLSelectElement>('.midi-controls select')!;
    select.value = second.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    first.send([0x90, 59, 127]);
    second.send([0x90, 60, 96]);
    second.send([0x91, 64, 32]);
    await fixture.whenStable();
    expect([oscillators[0], oscillators[4]].map(node => node.frequency.value)).toEqual([60, 64].map(midiToFrequency));
    const attacks = gains.flatMap(node => node.gain.linearRampToValueAtTime.mock.calls.slice(0, 1));
    const peak = noteEnvelope('piano', DEFAULT_INSTRUMENT_PARAMS.piano).peakGain;
    expect(attacks).toEqual([[peak * (96 / 127), 2.004], [peak * (32 / 127), 2.004]]);
    second.send([0x90, 60, 0]);
    expect(oscillators[0].stop).toHaveBeenCalledOnce();
    expect(oscillators[4].stop).not.toHaveBeenCalled();

    second.state = 'disconnected';
    access.dispatchEvent(new Event('statechange'));
    await fixture.whenStable();
    expect(oscillators[4].stop).toHaveBeenCalledWith(2.02);
    expect(root.querySelectorAll('.piano-key[aria-pressed="true"]')).toHaveLength(0);
  });
});
