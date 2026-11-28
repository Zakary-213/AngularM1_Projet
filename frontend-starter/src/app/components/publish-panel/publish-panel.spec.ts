import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishPanelComponent, publishErrorMessage } from './publish-panel';
import { StudioSessionService } from '../../shared/audio/studio-session.service';
import { StudioProjectService } from '../../shared/services/studio-project.service';
import { PUBLICATION_LIMITS } from '../../shared/models/publication.model';

describe('PublishPanelComponent', () => {
  let http: HttpTestingController;
  const saveState = signal<string>('saved');
  const planOk = signal(true);
  const renderWav = vi.fn();
  const session = {
    exportPlan: computed(() => ({ ok: planOk() })),
    exportProgress: signal<number | null>(null),
    exportError: signal<string | null>(null),
    exportReport: signal<unknown>(null),
    renderWav,
  };
  const studioProject = {
    project: signal<{ id: string; title: string } | null>({ id: 'p1', title: 'Minuit' }),
    saveState,
    canSave: signal(true),
    save: vi.fn(),
  };

  beforeEach(() => {
    saveState.set('saved');
    planOk.set(true);
    renderWav.mockReset();
    renderWav.mockResolvedValue({ wav: new Blob(['RIFF'], { type: 'audio/wav' }), report: {} });
    TestBed.configureTestingModule({
      imports: [PublishPanelComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StudioSessionService, useValue: session },
        { provide: StudioProjectService, useValue: studioProject },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(PublishPanelComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
  }

  it('préremplit le titre avec celui du projet', () => {
    const { component } = render();
    expect(component.form.controls.title.value).toBe('Minuit');
  });

  it('bloque la publication d’un projet non sauvegardé ou vide', () => {
    const { component, fixture, root } = render();
    saveState.set('dirty');
    fixture.detectChanges();
    expect(component.blocker()).toContain('Sauvegardez');
    expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    saveState.set('saved');
    planOk.set(false);
    expect(component.blocker()).toContain('Rien à publier');
  });

  it('rend le mix puis l’envoie avec le titre saisi et le projet ouvert', async () => {
    const { component, fixture, root } = render();
    component.form.controls.title.setValue('  Mon son  ');
    await component.publish();
    expect(renderWav).toHaveBeenCalledOnce();
    expect(component.state().step).toBe('uploading');
    const request = http.expectOne('/api/publications');
    const body = request.request.body as FormData;
    expect(body.get('projectId')).toBe('p1');
    expect(body.get('title')).toBe('Mon son');
    request.flush({ id: 'pub1', title: 'Mon son' }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    expect(component.state().step).toBe('done');
    expect(root.textContent).toContain('Morceau publié');
  });

  it('refuse un titre vide sans rien rendre', async () => {
    const { component } = render();
    component.form.controls.title.setValue('   ');
    await component.publish();
    expect(renderWav).not.toHaveBeenCalled();
    expect(component.form.controls.title.touched).toBe(true);
  });

  it('affiche l’erreur du rendu ou un fichier trop lourd, sans envoi', async () => {
    const { component } = render();
    renderWav.mockImplementationOnce(async () => {
      session.exportError.set('Rendu impossible');
      return null;
    });
    await component.publish();
    expect(component.state()).toEqual({ step: 'error', message: 'Rendu impossible' });

    renderWav.mockResolvedValueOnce({ wav: { size: PUBLICATION_LIMITS.maxBytes + 1 } as Blob, report: {} });
    await component.publish();
    expect(component.state().step).toBe('error');
    http.expectNone('/api/publications');
  });

  it('affiche le message d’erreur du serveur et permet de réessayer', async () => {
    const { component, fixture, root } = render();
    await component.publish();
    http.expectOne('/api/publications').flush({ message: 'Projet inconnu' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Projet inconnu');
    expect(root.querySelector('.retry')).not.toBeNull();
  });

  it('traduit les erreurs réseau et de session', () => {
    expect(publishErrorMessage(new HttpErrorResponse({ status: 0 }))).toContain('injoignable');
    expect(publishErrorMessage(new HttpErrorResponse({ status: 401 }))).toContain('reconnectez-vous');
    expect(publishErrorMessage(new Error('x'))).toContain('Réessayez');
  });
});
