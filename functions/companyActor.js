const { HttpsError } = require('firebase-functions/v2/https');
const text = value => String(value ?? '').trim();
const key = value => text(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
const active = value => value?.active !== false && value?.isActive !== false && value?.revoked !== true &&
  [value?.status,value?.userStatus,value?.companyUserStatus].every(status=>!['inactive','revoked','past','deleted','declined','pending','invited','rejected','canceled','cancelled','expired'].includes(key(status)));
const fail = (code, message) => { throw new HttpsError(code, message); };
const documentId = (value, label = 'Record') => {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.includes('/') || result === '.' || result === '..' || result.length > 500) fail('invalid-argument', `${label} must be a valid document ID.`);
  return result;
};
async function companyActor(db, transaction, companyId, uid, token = {}) {
  if (!uid) fail('unauthenticated', 'Sign in first.');
  documentId(companyId, 'Company'); documentId(uid, 'User');
  const c = db.collection('companies').doc(companyId);
  const [co, access, profile, users] = await Promise.all([
    transaction.get(c), transaction.get(db.collection('users').doc(uid).collection('userAccess').doc(companyId)),
    transaction.get(db.collection('users').doc(uid)), transaction.get(c.collection('companyUsers').where('userId', '==', uid)),
  ]);
  const a = access.data() || {}, company = co.data() || {};
  const owner = company.ownerId === uid;
  const globalAdmin = token.admin === true || key(profile.data()?.accountType) === 'admin';
  if (!co.exists || (!owner && !globalAdmin && (!access.exists || !active(a)))) fail('permission-denied', 'Active company access is required.');
  const user = users.docs.map(s => ({ ...s.data(), id: s.id })).find(active) || {};
  if (!owner && !globalAdmin && users.docs.length && !users.docs.some(s => active(s.data()))) fail('permission-denied', 'Active company access is required.');
  const role = a.roleId ? await transaction.get(c.collection('roles').doc(documentId(a.roleId, 'Role'))) : null;
  const admin = owner || globalAdmin || ['owner','admin','manager'].includes(key(a.roleName));
  return { uid, companyId, company, user, admin, administrator: admin,
    name: user.userName || [user.firstName,user.lastName].filter(Boolean).join(' ') || a.userName || uid,
    workerType: user.workerType || 'Not Assigned', permissions: Array.isArray(role?.data()?.permissionIdList) ? role.data().permissionIdList.map(String) : [] };
}
const can = (actor, permission) => actor.admin || actor.permissions.includes(permission);
module.exports = { companyActor, active, can, documentId, fail, key };
