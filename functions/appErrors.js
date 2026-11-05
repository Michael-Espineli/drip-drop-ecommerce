const { HttpsError: FirebaseHttpsError } = require('firebase-functions/v2/https');

// Only errors deliberately created by application code receive this source.
// Firebase transport, App Check, and security-rule errors remain distinguishable.
class HttpsError extends FirebaseHttpsError {
  static [Symbol.hasInstance](error) {
    return error instanceof FirebaseHttpsError;
  }

  constructor(code, message, details) {
    super(code, message, code === 'permission-denied'
      ? { ...(details && typeof details === 'object' && !Array.isArray(details) ? details : {}),
          ...(details !== undefined && (typeof details !== 'object' || details === null || Array.isArray(details)) ? { originalDetails: details } : {}),
          permissionSource: 'drip-drop' }
      : details);
  }
}

module.exports = { HttpsError };
