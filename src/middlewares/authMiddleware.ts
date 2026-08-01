import { Request, Response, NextFunction } from 'express';
import { auth } from '../auth';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { USER_ROLES, type AuthenticatedUser, type UserRole } from '../types/auth';

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({ headers: req.headers as Record<string, string> });
    if (!session?.user) throw new UnauthorizedError();
    const role = session.user.rol;
    if (typeof role !== 'string' || !USER_ROLES.includes(role as UserRole)) {
      throw new UnauthorizedError('La cuenta no tiene un rol válido');
    }
    req.user = { ...session.user, rol: role as UserRole } as AuthenticatedUser;
    next();
  } catch (e) {
    next(e);
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({ headers: req.headers as Record<string, string> });
    const role = session?.user?.rol;
    if (session?.user && typeof role === 'string' && USER_ROLES.includes(role as UserRole)) {
      req.user = { ...session.user, rol: role as UserRole } as AuthenticatedUser;
    }
  } catch {
    // Public requests remain anonymous when a cookie or session is invalid.
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (req.user.rol !== 'ADMINISTRADOR' && !roles.includes(req.user.rol)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
