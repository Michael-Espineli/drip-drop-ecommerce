const { active, documentId, fail, key } = require('./companyActor');

const MANAGE_BILLING_PERMISSION = '404';
const activeMembership = value => active(value) && value?.accessActive !== false &&
  [value?.accessStatus, value?.userAccessStatus].every(status => !['inactive', 'revoked', 'past', 'deleted', 'declined', 'pending', 'invited', 'rejected', 'canceled', 'cancelled', 'expired'].includes(key(status)));

// Billing never derives authority from users/{uid}.accountType, which is a profile field.
async function companyBillingMembership(db, reader, companyId, uid) {
  if (!uid) fail('unauthenticated', 'Sign in to access company billing.');
  documentId(companyId, 'Company');
  documentId(uid, 'User');
  const companyRef = db.collection('companies').doc(companyId);
  const [companySnap, accessSnap] = await Promise.all([
    reader.get(companyRef),
    reader.get(db.collection('users').doc(uid).collection('userAccess').doc(companyId)),
  ]);
  const company = companySnap.data() || {}, access = accessSnap.data() || {};
  const owner = company.ownerId === uid;
  if (!companySnap.exists || !owner && (!accessSnap.exists || !activeMembership(access))) {
    fail('permission-denied', 'Active company billing access is required.');
  }
  const role = !owner && access.roleId
    ? await reader.get(companyRef.collection('roles').doc(documentId(access.roleId, 'Role'))) : null;
  const permissions = Array.isArray(role?.data()?.permissionIdList) ? role.data().permissionIdList.map(String) : [];
  const administrator = owner || (role?.exists && Array.isArray(role.data()?.permissionIdList) && key(role.data()?.name) === key(access.roleName) && ['owner', 'admin', 'manager'].includes(key(access.roleName)));
  const managesBilling = administrator || permissions.includes(MANAGE_BILLING_PERMISSION);
  return { uid, companyId, company, companyRef, administrator, permissions, managesBilling };
}

async function billingActor(db, reader, companyId, uid, { manage = true } = {}) {
  const actor = await companyBillingMembership(db, reader, companyId, uid);
  if (manage ? !actor.managesBilling : !(actor.managesBilling || actor.permissions.includes('400'))) {
    fail('permission-denied', manage ? 'Manage Customer Billing permission is required.' : 'Finance access is required.');
  }
  return actor;
}

async function hasActiveCompanyPermission(db, companyId, uid, permissions) {
  try {
    const actor = await companyBillingMembership(db, { get: ref => ref.get() }, companyId, uid);
    return actor.administrator || permissions.some(permission => actor.permissions.includes(String(permission)));
  } catch (error) {
    if (['permission-denied', 'unauthenticated', 'invalid-argument'].includes(error.code)) return false;
    throw error;
  }
}

const requireBillingActor = (db, companyId, uid, options) => billingActor(db, { get: ref => ref.get() }, companyId, uid, options);

module.exports = { billingActor, companyBillingMembership, requireBillingActor, hasActiveCompanyPermission, MANAGE_BILLING_PERMISSION };
