import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPageComponent } from './projects-page';
import { ProjectSummary } from '../../shared/models/musical-project.model';

const summary: ProjectSummary = {
  id: 'p1',
  title: 'Minuit sur la ville',
  origin: 'create',
  bpm: 90,
  key: { root: 9, scale: 'minor' },
  trackCount: 3,
  formatVersion: 1,
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-20T09:00:00.000Z',
};
const page = (items: ProjectSummary[], extra = {}) => ({ items, page: 1, limit: 12, total: items.length, pages: 1, ...extra });
const LIST_URL = '/api/projects?page=1&limit=12';

describe('ProjectsPage', () => {
  let fixture: ComponentFixture<ProjectsPageComponent>;
  let http: HttpTestingController;
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const button = (label: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(element => element.textContent?.trim() === label)!;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProjectsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectsPageComponent);
  });

  afterEach(() => http.verify());

  it('affiche les projets de l’utilisateur avec tempo, tonalité et pistes', async () => {
    http.expectOne(LIST_URL).flush(page([summary]));
    await fixture.whenStable();
    expect(text()).toContain('Minuit sur la ville');
    expect(text()).toContain('90 BPM · La mineur · 3 pistes');
    expect(text()).toContain('1 projet');
  });

  it('état vide puis erreur avec nouvel essai', async () => {
    http.expectOne(LIST_URL).flush(page([]));
    await fixture.whenStable();
    expect(text()).toContain('Aucun projet');

    fixture.componentInstance.load(1);
    http.expectOne(LIST_URL).flush(null, { status: 0, statusText: 'Unknown' });
    await fixture.whenStable();
    expect(text()).toContain('Serveur injoignable');
    button('Réessayer').click();
    http.expectOne(LIST_URL).flush(page([summary]));
    await fixture.whenStable();
    expect(text()).toContain('Minuit sur la ville');
  });

  it('crée un projet « Importer une prod » puis ouvre le studio', async () => {
    http.expectOne(LIST_URL).flush(page([]));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const form = fixture.componentInstance.createForm;
    form.setValue({ title: '  Nouvelle prod  ', origin: 'import' });
    fixture.componentInstance.create();
    fixture.componentInstance.create(); // double clic : une seule requête

    const request = http.expectOne('/api/projects');
    expect(request.request.body).toEqual({ title: 'Nouvelle prod', origin: 'import' });
    request.flush({ ...summary, id: 'new-id' });
    expect(navigate).toHaveBeenCalledWith(['/studio', 'new-id']);
  });

  it('refuse un titre vide sans appeler l’API', async () => {
    http.expectOne(LIST_URL).flush(page([]));
    fixture.componentInstance.createForm.controls.title.setValue('   ');
    fixture.componentInstance.create();
    await fixture.whenStable();
    expect(text()).toContain('Donnez un titre');
  });

  it('demande confirmation avant de supprimer puis recharge la liste', async () => {
    http.expectOne(LIST_URL).flush(page([summary]));
    await fixture.whenStable();
    button('Supprimer').click();
    await fixture.whenStable();
    expect(text()).toContain('Supprimer définitivement « Minuit sur la ville »');
    http.expectNone({ method: 'DELETE' });

    button('Supprimer').click();
    http.expectOne({ method: 'DELETE', url: '/api/projects/p1' }).flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(LIST_URL).flush(page([]));
    await fixture.whenStable();
    expect(text()).toContain('Aucun projet');
  });

  it('renomme un projet sur place', async () => {
    http.expectOne(LIST_URL).flush(page([summary]));
    await fixture.whenStable();
    button('Renommer').click();
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#rename-p1')!;
    input.value = 'Titre définitif';
    input.dispatchEvent(new Event('input'));
    button('Enregistrer').click(); // vraie soumission du formulaire
    const request = http.expectOne({ method: 'PATCH', url: '/api/projects/p1' });
    expect(request.request.body).toEqual({ title: 'Titre définitif' });
    request.flush({ ...summary, title: 'Titre définitif' });
    await fixture.whenStable();
    expect(text()).toContain('Titre définitif');
  });
});
