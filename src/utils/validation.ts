import type { ZodError } from 'zod';

/**
 * Primer problema de validación como mensaje, con el campo antepuesto.
 *
 * Los mensajes que genera zod no dicen qué campo falló — `Invalid input: expected string,
 * received undefined` o `Too small: expected string to have >=1 characters` son inútiles por sí
 * solos. Los de código `custom` los escribimos nosotros y ya se leen como frases, así que se
 * dejan intactos.
 */
export function firstIssueMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Datos inválidos';
  const path = issue.path.join('.');
  return issue.code === 'custom' || !path ? issue.message : `${path}: ${issue.message}`;
}
