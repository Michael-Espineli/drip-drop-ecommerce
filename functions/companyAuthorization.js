const { companyActor, can, documentId, fail, key } = require('./companyActor');
const { hasPlatformAdminAccess } = require('./platformAccess');
const protectedRoleNames = new Set(['owner', 'admin', 'manager']);
const protectedGrants = new Set(['262', '264', '266', '274', '404', '408', '424', '862', '864', '866', '890']);

async function authority(db, uid, companyId, token) {
  return companyActor(db, { get: ref => ref.get() }, companyId, uid, token);
}
async function hasPermission(db, uid, companyId, permission, token) {
  try { return can(await authority(db, uid, companyId, token), permission); }
  catch (error) { if (['permission-denied', 'unauthenticated', 'invalid-argument'].includes(error.code)) return false; throw error; }
}
async function requirePermission(db, uid, companyId, permission, token) {
  const actor = await authority(db, uid, companyId, token);
  if (!can(actor, permission)) fail('permission-denied', 'Your role cannot perform this company action.');
  return actor;
}
async function delegatedRole(db, actor, roleId) {
  documentId(roleId, 'Role');
  const snapshot = await db.collection('companies').doc(actor.companyId).collection('roles').doc(roleId).get();
  const role = snapshot.data();
  if (!snapshot.exists || !Array.isArray(role.permissionIdList) || role.permissionIdList.some(id => typeof id !== 'string')) {
    fail('permission-denied', 'Select a valid company role.');
  }
  const owner = actor.company.ownerId === actor.uid;
  if (!owner && (roleId === '1' || protectedRoleNames.has(key(role.name)) ||
      role.permissionIdList.some(id => protectedGrants.has(id) || !actor.permissions.includes(id)))) {
    fail('permission-denied', 'Only the company owner can assign protected roles or delegate additional authority.');
  }
  return { ...role, id: snapshot.id };
}
async function protectMembershipTarget(db, actor, userId, roleId) {
  if (actor.company.ownerId === actor.uid) return;
  if (userId === actor.company.ownerId) fail('permission-denied', 'Only the company owner can change owner access.');
  if (roleId) {
    const role = await db.collection('companies').doc(actor.companyId).collection('roles').doc(roleId).get();
    if (roleId === '1' || protectedRoleNames.has(key(role.data()?.name))) fail('permission-denied', 'Only the company owner can change administrative access.');
  }
}
module.exports = { authority, hasPermission, requirePermission, delegatedRole, protectMembershipTarget, hasPlatformAdminAccess };
