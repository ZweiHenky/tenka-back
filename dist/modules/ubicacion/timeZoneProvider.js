"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTimeZone = resolveTimeZone;
const env_1 = require("../../config/env");
const errors_1 = require("../../utils/errors");
const timeZone_1 = require("../../utils/timeZone");
async function resolveTimeZone(lat, lng) {
    if (!env_1.env.GOOGLE_MAPS_API_KEY) {
        if (env_1.env.APP_ENV === 'local' || env_1.env.NODE_ENV === 'test')
            return 'America/Mexico_City';
        throw new errors_1.ValidationError('No está configurada la resolución automática de zona horaria');
    }
    const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
    url.searchParams.set('key', env_1.env.GOOGLE_MAPS_API_KEY);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env_1.env.PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
            throw new errors_1.ValidationError('No se pudo consultar la zona horaria de la ubicación');
        const result = await response.json();
        if (result.status !== 'OK' || !result.timeZoneId || !(0, timeZone_1.isValidTimeZone)(result.timeZoneId)) {
            throw new errors_1.ValidationError(result.errorMessage || 'No se pudo determinar la zona horaria de la ubicación');
        }
        return result.timeZoneId;
    }
    finally {
        clearTimeout(timeout);
    }
}
//# sourceMappingURL=timeZoneProvider.js.map