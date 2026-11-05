const messageOf = error => typeof error === 'string' ? error : error?.message || '';

export const permissionErrorInfo = error => {
  const code = String(error?.code || '').toLowerCase();
  const details = error?.details || {};
  if (details.permissionSource === 'drip-drop') {
    return { source: 'drip-drop', label: 'Drip Drop permission denied', code: code || 'drip-drop/permission-denied', permissionId: details.permissionId || '' };
  }
  if (['permission-denied', 'firestore/permission-denied'].includes(code)
      || (!code && /missing or insufficient permissions\.?/i.test(messageOf(error)))) {
    return { source: 'firebase-firestore', label: 'Firebase Firestore permission denied', code: code || 'firestore/permission-denied' };
  }
  if (code === 'storage/unauthorized') {
    return { source: 'firebase-storage', label: 'Firebase Storage permission denied', code };
  }
  if (code === 'functions/permission-denied') {
    return { source: 'unconfirmed', label: 'Permission denied (source unconfirmed)', code };
  }
  return null;
};

export const userFacingErrorMessage = (error, fallback = '') => {
  const info = permissionErrorInfo(error);
  const message = messageOf(error);
  if (!info) return fallback || message || 'Something went wrong. Please try again.';
  const detail = info.source === 'drip-drop'
    ? `${message || 'Your company role does not allow this action.'} Ask a company administrator to review your access.${info.permissionId ? ` Required permission: ${info.permissionId}.` : ''}`
    : info.source === 'unconfirmed'
      ? `${message || 'The server denied this action.'} This server response does not identify whether Firebase or Drip Drop denied access.`
      : 'Firebase blocked this request. Share this error with support so they can check Firebase security rules and your company access.';
  return `${info.label}: ${detail} [${info.code}]`;
};

export const companyPermissionError = (permissionId, action = 'perform this action') => Object.assign(
  new Error(`Your company role does not allow you to ${action}.`),
  { code: 'drip-drop/permission-denied', details: { permissionSource: 'drip-drop', permissionId } }
);
