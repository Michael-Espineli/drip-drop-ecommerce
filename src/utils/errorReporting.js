import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './config';

export const APP_ERRORS_COLLECTION = 'appErrors';

export const APP_ERROR_STATUS_OPTIONS = ['New', 'Investigating', 'Resolved', 'Ignored'];
export const APP_ERROR_SEVERITY_OPTIONS = ['info', 'warning', 'error', 'critical'];

const MAX_TITLE_LENGTH = 220;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_STACK_LENGTH = 15000;
const MAX_DATA_LENGTH = 10000;
const RECENT_ERROR_WINDOW_MS = 30000;

const recentFingerprints = new Map();

const trimString = (value, maxLength = 1000) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};

const getBrowserLocation = () => {
  if (typeof window === 'undefined') {
    return {
      href: '',
      pathname: '',
    };
  }

  return {
    href: window.location?.href || '',
    pathname: window.location?.pathname || '',
  };
};

const normalizeError = (error) => {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
      stack: error.stack || '',
      code: error.code || '',
    };
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
      stack: '',
      code: '',
    };
  }

  if (error && typeof error === 'object') {
    return {
      name: error.name || error.constructor?.name || 'Error',
      message: error.message || error.reason?.message || JSON.stringify(error),
      stack: error.stack || error.reason?.stack || '',
      code: error.code || '',
    };
  }

  return {
    name: 'Error',
    message: String(error || 'Unknown error'),
    stack: '',
    code: '',
  };
};

const safeSerialize = (value, maxLength = MAX_DATA_LENGTH) => {
  if (!value) return '';

  try {
    const serialized = typeof value === 'string'
      ? value
      : JSON.stringify(value, (key, nestedValue) => {
        if (nestedValue instanceof Error) {
          return normalizeError(nestedValue);
        }

        if (typeof nestedValue === 'function') {
          return `[Function ${nestedValue.name || 'anonymous'}]`;
        }

        return nestedValue;
      }, 2);

    return trimString(serialized, maxLength);
  } catch (error) {
    return trimString(String(value), maxLength);
  }
};

const getContextValue = (context, key) => trimString(context?.[key] || '', 320);

const buildFingerprint = (payload) => [
  payload.message,
  payload.where,
  payload.pathname,
  payload.source,
].join('|').toLowerCase();

const shouldSkipRecentDuplicate = (fingerprint) => {
  const now = Date.now();

  Array.from(recentFingerprints.entries()).forEach(([key, timestamp]) => {
    if (now - timestamp > RECENT_ERROR_WINDOW_MS) {
      recentFingerprints.delete(key);
    }
  });

  if (recentFingerprints.has(fingerprint)) {
    return true;
  }

  recentFingerprints.set(fingerprint, now);
  return false;
};

export const reportAppError = async (error, options = {}) => {
  const normalizedError = normalizeError(error);
  const browserLocation = getBrowserLocation();
  const context = options.context || {};
  const pathname = trimString(options.pathname || context.pathname || browserLocation.pathname, 500);
  const location = trimString(options.location || context.location || browserLocation.href, 1000);
  const source = trimString(options.source || 'client', 100) || 'client';
  const where = trimString(options.where || pathname || source, 500) || 'Unknown location';
  const severity = APP_ERROR_SEVERITY_OPTIONS.includes(options.severity) ? options.severity : 'error';
  const message = trimString(options.message || normalizedError.message, MAX_MESSAGE_LENGTH) || 'Unknown error';
  const title = trimString(options.title || `${normalizedError.name}: ${message}`, MAX_TITLE_LENGTH);
  const description = trimString(
    options.description || `An app error was captured from ${where}.`,
    MAX_DESCRIPTION_LENGTH
  );
  const data = safeSerialize({
    ...(options.data || {}),
    errorName: normalizedError.name,
    errorCode: normalizedError.code,
  });
  const stack = trimString(options.stack || normalizedError.stack, MAX_STACK_LENGTH);
  const payload = {
    title,
    description,
    message,
    where,
    status: 'New',
    severity,
    source,
    userId: getContextValue(context, 'userId'),
    userEmail: getContextValue(context, 'userEmail'),
    accountType: getContextValue(context, 'accountType'),
    companyId: getContextValue(context, 'companyId'),
    companyName: getContextValue(context, 'companyName'),
    location,
    pathname,
    data,
    stack,
    fingerprint: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  payload.fingerprint = trimString(buildFingerprint(payload), 500);

  if (shouldSkipRecentDuplicate(payload.fingerprint)) {
    return null;
  }

  try {
    return await addDoc(collection(db, APP_ERRORS_COLLECTION), payload);
  } catch (loggingError) {
    console.error('Unable to report app error:', loggingError);
    return null;
  }
};

export const getAppErrorReports = async () => {
  const snapshot = await getDocs(query(
    collection(db, APP_ERRORS_COLLECTION),
    orderBy('createdAt', 'desc')
  ));

  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
};

export const updateAppErrorStatus = async (errorId, status) => (
  updateDoc(doc(db, APP_ERRORS_COLLECTION, errorId), {
    status,
    updatedAt: serverTimestamp(),
  })
);
