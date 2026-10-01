import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function integrationTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return integrationTests(path);
    return entry.name.endsWith('.integration.test.ts') ? [path] : [];
  });
}

describe('integration destructive SQL policy', () => {
  it('keeps destructive raw SQL out of integration test files', () => {
    for (const path of integrationTests(join(process.cwd(), 'src'))) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/\$executeRawUnsafe\s*\(/);
      expect(source, path).not.toMatch(/\bTRUNCATE\b/i);
    }
  });
});
