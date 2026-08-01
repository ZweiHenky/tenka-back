export const USER_ROLES = ['CAPITAN', 'LIGA', 'ADMINISTRADOR'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string | null;
  rol: UserRole;
}
