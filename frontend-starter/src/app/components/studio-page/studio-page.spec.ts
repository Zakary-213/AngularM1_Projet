import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioPageComponent } from './studio-page';

describe('Raccourci Exporter du studio', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { reducedMotion: false, behavior: 'smooth' },
    { reducedMotion: true, behavior: 'auto' },
  ])('affiche et cible le panneau avec le défilement $behavior', async ({ reducedMotion, behavior }) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion })));
    TestBed.configureTestingModule({
      imports: [StudioPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(StudioPageComponent);
    const root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const editor = root.querySelector<HTMLElement>('.editor-panel')!;
    const shortcut = root.querySelector<HTMLButtonElement>('.studio-heading .heading-actions button')!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(editor, 'scrollIntoView', { value: scrollIntoView });
    expect(editor.querySelector('app-export-panel')).toBeNull();

    shortcut.click();
    await fixture.whenStable();

    const selectedTab = editor.querySelector('.tabs button[aria-pressed="true"]');
    expect(selectedTab?.textContent?.trim()).toBe('Export');
    const panel = editor.querySelector('app-export-panel');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior, block: 'start' });

    shortcut.focus();
    shortcut.click();
    await fixture.whenStable();

    expect(document.activeElement).toBe(panel);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe('Défilement de la timeline', () => {
  it('garde le zoom, affiche les mesures suivantes et déplace la tête vers une mesure au-delà de 32', async () => {
    TestBed.configureTestingModule({
      imports: [StudioPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(StudioPageComponent);
    const root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[aria-label="Dézoomer la timeline"]')!.click();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[aria-label="Mesures suivantes"]')!.click();
    await fixture.whenStable();

    expect(root.querySelector('label[for="timeline-start"]')?.textContent).toBe('Mesures 33 à 64');
    expect(root.querySelector('.timeline-ruler > span:nth-child(2)')?.textContent).toBe('33');
    const lane = root.querySelector<HTMLElement>('.track-lane')!;
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue(new DOMRect(150, 0, 640, 80));
    root.querySelector('.timeline-ruler')!.dispatchEvent(new MouseEvent('click', { clientX: 290, bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.session.position()).toEqual({ bar: 40, beat: 1, sixteenth: 1 });
    root.querySelector<HTMLElement>('[data-measure="41"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.session.position()).toEqual({ bar: 41, beat: 1, sixteenth: 1 });
  });

  it('renomme la piste depuis le formulaire sans soumettre la page', async () => {
    TestBed.configureTestingModule({
      imports: [StudioPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(StudioPageComponent);
    const root = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.session.addInstrument('piano', 'new');
    fixture.componentInstance.beginTrackRename();
    await fixture.whenStable();
    const input = root.querySelector<HTMLInputElement>('#instrument-track-name')!;
    input.value = 'Piano couplet';
    input.dispatchEvent(new Event('input'));
    const submit = new Event('submit', { cancelable: true });
    input.form!.dispatchEvent(submit);
    await fixture.whenStable();
    expect(submit.defaultPrevented).toBe(true);
    expect(root.querySelector('[aria-label="Sélectionner la piste Piano couplet"]')).not.toBeNull();
  });
});
