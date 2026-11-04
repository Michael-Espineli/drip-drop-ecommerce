export const safeClientReturnPath = (value, fallback = '/client/dashboard') => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : fallback;
export const clientVerificationPath = destination => `/client/verify-email?redirect=${encodeURIComponent(safeClientReturnPath(destination))}`;
