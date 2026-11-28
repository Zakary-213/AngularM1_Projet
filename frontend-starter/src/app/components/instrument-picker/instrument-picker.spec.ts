import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstrumentPickerComponent } from './instrument-picker';
import { SoundPreviewService } from '../../shared/audio/sound-preview.service';
import { INSTRUMENTS, InstrumentId } from '../../shared/audio/melodic-pattern';

describe('InstrumentPickerComponent', () => {
  const preview = vi.fn(() => Promise.resolve());
  const stop = vi.fn();

  beforeEach(() => {
    preview.mockClear();
    stop.mockClear();
    TestBed.configureTestingModule({
      imports: [InstrumentPickerComponent],
      providers: [{ provide: SoundPreviewService, useValue: { preview, stop, playingId: signal<string | null>(null), error: signal<string | null>(null) } }],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(InstrumentPickerComponent);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('affiche les 12 instruments groupés par famille, avec leur piste', () => {
    const { root } = render();
    expect(root.querySelectorAll('.card')).toHaveLength(INSTRUMENTS.length);
    expect(Array.from(root.querySelectorAll('h4')).map(node => node.textContent?.trim())).toEqual(['Claviers', 'Guitares', 'Basses', 'Cordes et vents', 'Synthés', 'Cloches']);
    expect(root.textContent).toContain('Sub grave du rap · piste Basse');
  });

  it('émet l’instrument choisi au clic sur « Ajouter »', () => {
    const { fixture, root } = render();
    const picked: InstrumentId[] = [];
    fixture.componentInstance.picked.subscribe(instrument => picked.push(instrument));
    root.querySelector<HTMLButtonElement>('[aria-label="Ajouter Guitare électrique"]')!.click();
    expect(picked).toEqual(['electricGuitar']);
  });

  it('préécoute un instrument et coupe le son à la fermeture', () => {
    const { fixture, root } = render();
    root.querySelector<HTMLButtonElement>('[aria-label="Écouter Cordes"]')!.click();
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ id: 'instrument-strings' }));
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    root.querySelector<HTMLButtonElement>('.close')!.click();
    expect(closed).toBe(true);
    fixture.destroy();
    expect(stop).toHaveBeenCalled();
  });
});
