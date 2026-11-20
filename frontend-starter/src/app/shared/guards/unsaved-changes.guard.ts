import { CanDeactivateFn } from '@angular/router';

/** Composant qui peut refuser la navigation (ex. studio avec modifications non sauvegardées). */
export interface LeaveConfirmation {
  canLeave(): boolean;
}

export const unsavedChangesGuard: CanDeactivateFn<LeaveConfirmation> = component => component.canLeave();
