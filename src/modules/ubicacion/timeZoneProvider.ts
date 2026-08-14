import { env } from '../../config/env';
import { ValidationError } from '../../utils/errors';
import { isValidTimeZone } from '../../utils/timeZone';

export async function resolveTimeZone(lat: number, lng: number): Promise<string> {
  if (!env.GOOGLE_MAPS_API_KEY) {
    if (env.APP_ENV === 'local' || env.NODE_ENV === 'test') return 'America/Mexico_City';
    throw new ValidationError('No está configurada la resolución automática de zona horaria');
  }
  const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new ValidationError('No se pudo consultar la zona horaria de la ubicación');
    const result = await response.json() as { status?: string; timeZoneId?: string; errorMessage?: string };
    if (result.status !== 'OK' || !result.timeZoneId || !isValidTimeZone(result.timeZoneId)) {
      throw new ValidationError(result.errorMessage || 'No se pudo determinar la zona horaria de la ubicación');
    }
    return result.timeZoneId;
  } finally {
    clearTimeout(timeout);
  }
}
