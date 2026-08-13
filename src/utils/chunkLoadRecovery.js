const CHUNK_LOAD_RELOAD_KEY_PREFIX = 'dripdrop:chunk-load-reload';

const chunkLoadPatterns = [
  /ChunkLoadError/i,
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk \S+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

const staticChunkPathPattern = /\/static\/(?:js|css)\//i;

const getEventTargetUrl = (value) => {
  const target = value?.target || value?.srcElement;
  return target?.src || target?.href || '';
};

const getErrorSearchText = (value) => {
  if (!value) return '';

  if (typeof value === 'string') {
    return value;
  }

  const nestedReason = value.reason && value.reason !== value ? getErrorSearchText(value.reason) : '';
  const nestedError = value.error && value.error !== value ? getErrorSearchText(value.error) : '';

  return [
    value.name,
    value.message,
    value.stack,
    value.type,
    value.request,
    value.filename,
    getEventTargetUrl(value),
    nestedReason,
    nestedError,
  ].filter(Boolean).join(' ');
};

export const isChunkLoadError = (value) => {
  const targetUrl = getEventTargetUrl(value);

  if (staticChunkPathPattern.test(targetUrl)) {
    return true;
  }

  const searchText = getErrorSearchText(value);

  if (staticChunkPathPattern.test(searchText) && /SyntaxError|Unexpected token/i.test(searchText)) {
    return true;
  }

  return chunkLoadPatterns.some((pattern) => pattern.test(searchText));
};

const getCurrentBundleSignature = () => {
  if (typeof document === 'undefined') return 'unknown-bundle';

  const scriptSources = Array.from(document.scripts || [])
    .map((script) => script.src || '')
    .filter((src) => /\/static\/js\/(?:main|runtime-main)\./.test(src))
    .sort();

  return scriptSources.join('|') || 'unknown-bundle';
};

const getReloadStorageKey = () => {
  if (typeof window === 'undefined') {
    return `${CHUNK_LOAD_RELOAD_KEY_PREFIX}:server`;
  }

  const locationKey = [
    window.location?.origin || '',
    window.location?.pathname || '',
    window.location?.search || '',
  ].join('');

  return `${CHUNK_LOAD_RELOAD_KEY_PREFIX}:${getCurrentBundleSignature()}:${locationKey}`;
};

const getSessionStorage = () => {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window.sessionStorage;
    const testKey = `${CHUNK_LOAD_RELOAD_KEY_PREFIX}:test`;
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return storage;
  } catch (error) {
    return null;
  }
};

export const recoverFromChunkLoadError = (value, options = {}) => {
  if (!isChunkLoadError(value) || typeof window === 'undefined') {
    return false;
  }

  const storage = getSessionStorage();

  if (!storage) {
    return false;
  }

  const reloadKey = getReloadStorageKey();

  if (storage.getItem(reloadKey)) {
    return false;
  }

  storage.setItem(reloadKey, new Date().toISOString());

  window.setTimeout(() => {
    window.location.reload();
  }, options.reloadDelayMs ?? 500);

  return true;
};
