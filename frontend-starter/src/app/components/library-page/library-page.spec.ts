import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryPageComponent } from './library-page';
import { SoundPreviewService } from '../../shared/audio/sound-preview.service';
import { SoundEntry } from '../../shared/audio/sound-library';

describe('LibraryPageComponent', () => {
  const preview = vi.fn<(entry: SoundEntry) => Promise<void>>(() => Promise.resolve());
  const stop = vi.fn();

  beforeEach(() => {
    preview.mockClear();
    stop.mockClear();
    TestBed.configureTestingModule({
      imports: [LibraryPageComponent],
      providers: [
        provideRouter([]),
        { provide: SoundPreviewService, useValue: { preview, stop, playingId: signal<string | null>(null), error: signal<string | null>(null) } },
      ],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(LibraryPageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const names = () => Array.from(root.querySelectorAll('.file-row h3')).map(node => node.textContent?.trim());
    const card = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.sound-category')).find(node => node.textContent?.includes(label))!;
    return { fixture, root, names, card };
  }

  it('affiche les vrais sons du studio', () => {
    const { names } = render();
    expect(names()).toHaveLength(15);
    expect(names()).toContain('Kick Boom bap');
    expect(names()).toContain('Basse 808');
  });

  it('filtre par catégorie au clic, et un second clic retire le filtre', () => {
    const { fixture, names, card } = render();
    card('Instruments').click();
    fixture.detectChanges();
    expect(names()).toEqual(['Piano', 'Synthé', 'Basse 808']);
    expect(card('Instruments').getAttribute('aria-pressed')).toBe('true');
    card('Instruments').click();
    fixture.detectChanges();
    expect(names()).toHaveLength(15);
  });

  it('filtre avec la recherche', () => {
    const { fixture, root, names } = render();
    const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'clap';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(names()).toEqual(['Clap Boom bap', 'Clap Trap']);
  });

  it('explique la catégorie Samples vide et permet de tout réafficher', () => {
    const { fixture, root, names, card } = render();
    card('Samples').click();
    fixture.detectChanges();
    expect(root.querySelector('.library-empty')?.textContent).toContain('Importez votre propre instrumentale');
    root.querySelector<HTMLButtonElement>('.library-empty button')!.click();
    fixture.detectChanges();
    expect(names()).toHaveLength(15);
  });

  it('lance la préécoute du son cliqué et la coupe en quittant la page', () => {
    const { fixture, root } = render();
    root.querySelector<HTMLButtonElement>('[aria-label="Préécouter Piano"]')!.click();
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ id: 'instrument-piano' }));
    fixture.destroy();
    expect(stop).toHaveBeenCalled();
  });
});
