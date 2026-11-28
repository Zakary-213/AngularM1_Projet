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
