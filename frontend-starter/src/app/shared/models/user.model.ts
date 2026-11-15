/** Public user data returned by the API. */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  /** True when a profile picture can be fetched from `GET /api/users/me/avatar`. */
  hasAvatar?: boolean;
  /** ISO date of the last picture change, used to refresh the cached image. */
  avatarUpdatedAt?: string | null;
}
