import { companyPermissionError, permissionErrorInfo, userFacingErrorMessage } from './permissionErrors';

test.each(['permission-denied', 'firestore/permission-denied'])('identifies Firestore rules by code %s', code => {
  const message = userFacingErrorMessage({ code, message: 'Missing or insufficient permissions.' });
  expect(message).toContain('Firebase Firestore permission denied');
  expect(message).toContain(code);
  expect(message).not.toContain('Your company role does not allow');
});
test('identifies Firebase Storage and keeps its diagnostic code', () => {
  expect(userFacingErrorMessage({ code: 'storage/unauthorized', message: 'Denied' })).toContain('Firebase Storage permission denied');
});
test('local role denials name Drip Drop and the exact grant', () => {
  const error = companyPermissionError('244', 'finish service stops');
  expect(permissionErrorInfo(error)).toMatchObject({ source: 'drip-drop', permissionId: '244' });
  expect(userFacingErrorMessage(error)).toContain('Drip Drop permission denied');
  expect(userFacingErrorMessage(error)).toContain('Required permission: 244');
});
test('tagged server denials identify Drip Drop without guessing for old servers', () => {
  const error = { code: 'functions/permission-denied', message: 'Active company access is required.' };
  expect(userFacingErrorMessage(error)).toContain('source unconfirmed');
  expect(userFacingErrorMessage({ ...error, details: { permissionSource: 'drip-drop' } })).toContain('Drip Drop permission denied');
});
test('unrelated errors, existing fallback text, and formatted messages remain intact', () => {
  expect(userFacingErrorMessage(new Error('Network disconnected'))).toBe('Network disconnected');
  expect(userFacingErrorMessage(new Error('Internal detail'), 'Failed to finish service stop')).toBe('Failed to finish service stop');
  expect(permissionErrorInfo({ code: 'auth/wrong-password' })).toBeNull();
  const message = userFacingErrorMessage(companyPermissionError('244'));
  expect(userFacingErrorMessage(message)).toBe(message);
});
