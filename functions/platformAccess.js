const PLATFORM_OWNER_UID = 'yRV5Ie18rrUSxT6UkWctPc99lMJ2';
const isPlatformAdmin = (uid, token = {}) => uid === PLATFORM_OWNER_UID || token.admin === true;

// For legacy helpers which receive a UID instead of a callable token. Auth claims
// are server-owned; users/{uid}.accountType is presentation data, not authority.
async function hasPlatformAdminAccess(uid, token) {
  if (!uid) return false;
  if (isPlatformAdmin(uid, token)) return true;
  if (token) return false;
  try {
    const user = await require('firebase-admin').auth().getUser(uid);
    return !user.disabled && user.customClaims?.admin === true;
  } catch (_) { return false; }
}
module.exports = { PLATFORM_OWNER_UID, isPlatformAdmin, hasPlatformAdminAccess };
