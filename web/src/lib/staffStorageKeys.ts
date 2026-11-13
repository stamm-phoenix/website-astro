// Names of the browser storage entries that hold data of the Leitendenbereich. They live apart
// from the code that reads them, so BaseLayout can look for them on every page without loading
// that code (it is only loaded when one of the entries exists, see `staffStorageExpiry.ts`).

/** Offline copy of the Nikolaus route (localStorage). */
export const FAHRT_STORAGE_KEY = 'nikolaus-fahrt-offline-v1';
/** Person the offline route belongs to (sessionStorage). */
export const FAHRT_OWNER_KEY = 'nikolaus-fahrt-owner';
/** Start of the keys of the Abrechnung entries of an Aktion (localStorage). */
export const ABRECHNUNG_STORAGE_PREFIX = 'phoenix:abrechnung:v1:';
/** Inputs that were rescued after the login expired (sessionStorage). */
export const RESCUE_KEY = 'phoenix:gerettete-eingaben:v1';
/** Cache with the static page of the Nikolaus route: only that page and its assets, never API or authentication responses. */
export const ROUTE_SHELL_CACHE = 'nikolaus-route-shell-v1';
