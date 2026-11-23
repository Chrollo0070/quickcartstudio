/**
 * Global, framework-agnostic constants shared between apps.
 * Keep this file dependency-free and pure — it must be safe to import
 * from both Node (NestJS) and browser (Next.js) bundles.
 */

export const APP_NAME = 'QuickCart' as const;
export const SERVICE_NAME = 'quickcart-api' as const;

/** Global API prefix used by the NestJS backend. */
export const API_PREFIX = 'api/v1' as const;
