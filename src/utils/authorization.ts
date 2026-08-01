import type { AuthenticatedUser, UserRole } from '../types/auth';
import { ForbiddenError, NotFoundError } from './errors';

export function isAdmin(actor: AuthenticatedUser): boolean {
  return actor.rol === 'ADMINISTRADOR';
}

export function assertRole(actor: AuthenticatedUser, ...roles: UserRole[]): void {
  if (!isAdmin(actor) && !roles.includes(actor.rol)) {
    throw new ForbiddenError();
  }
}

export function assertOwnerOrAdmin(
  actor: AuthenticatedUser,
  ownerId: string,
  resource: string,
): void {
  if (!isAdmin(actor) && actor.id !== ownerId) {
    throw new NotFoundError(resource);
  }
}
