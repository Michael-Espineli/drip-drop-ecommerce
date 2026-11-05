const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HttpsError: FirebaseHttpsError } = require('firebase-functions/v2/https');
const { HttpsError } = require('./appErrors');

test('application authorization errors retain Firebase serialization and identify the denying layer', () => {
  const error = new HttpsError('permission-denied', 'Manage Payroll permission is required.', { permissionId: '424', context: 'payroll' });
  assert.ok(error instanceof FirebaseHttpsError);
  assert.equal(error.code, 'permission-denied');
  assert.equal(error.message, 'Manage Payroll permission is required.');
  assert.deepEqual(error.toJSON().details, { permissionId: '424', context: 'payroll', permissionSource: 'drip-drop' });
});
test('only application denials receive the tag and existing detail values survive', () => {
  assert.equal(new HttpsError('unavailable', 'Try later', 'detail').details, 'detail');
  assert.deepEqual(new HttpsError('permission-denied', 'Denied', ['original']).details, { originalDetails: ['original'], permissionSource: 'drip-drop' });
  assert.equal(new FirebaseHttpsError('permission-denied', 'Transport denied').details, undefined);
  assert.ok(new FirebaseHttpsError('permission-denied', 'Transport denied') instanceof HttpsError);
});
