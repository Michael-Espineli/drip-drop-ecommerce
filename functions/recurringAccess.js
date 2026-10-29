const { HttpsError } = require('firebase-functions/v2/https');

const text = (value) => typeof value === 'string' ? value.trim() : '';
const key = (value) => text(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
const fail = (code, message) => { throw new HttpsError(code, message); };
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const active = (value = {}) => value.active !== false && value.isActive !== false && value.revoked !== true &&
  !['inactive', 'revoked', 'past', 'deleted', 'declined', 'pending', 'invited', 'rejected', 'canceled', 'cancelled', 'expired'].includes(key(value.status || value.userStatus || value.companyUserStatus));
const permissions = {
  create: ['242'], update: ['244'], end: ['244'], delete: ['246'],
  routeOrder: ['234', '244'], routeAssignment: ['234', '244'], permanentMove: ['234', '244'],
  routeDelete: ['236', '246'], report: ['244'],
};
const recurringFields = [
  'id', 'internalId', 'type', 'typeId', 'typeImage', 'category', 'serviceStopTypeUseCaseRawValue',
  'payTypeId', 'payTypeName', 'defaultWorkTypeIds', 'customerId', 'customerName', 'address', 'techId', 'tech',
  'dateCreated', 'startDate', 'endDate', 'noEndDate', 'frequency', 'day', 'daysOfWeek', 'description',
  'serviceLocationId', 'estimatedTime', 'otherCompany', 'laborContractId', 'contractedCompanyId', 'mainCompanyId',
  'salesAgreementId', 'salesBillingSubscriptionId',
];
const pick = (source, fields) => Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
function identifier(value, label, required = true) {
  const result = text(value);
  if ((!result && required) || result.includes('/') || result === '.' || result === '..' || result.length > 500) {
    fail('invalid-argument', `${label} must be a valid document ID.`);
  }
  return result;
}

// The handlers still receive a flat operational payload. Authentication belongs to
// the actual callable request, never to a client-supplied uid/role object.
function createRecurringAccess(db, { verifyIdToken } = {}) {
  const company = (companyId) => db.collection('companies').doc(companyId);
  async function authentication(request, legacyContext) {
    let payload = record(request?.data ?? request);
    if (!payload.companyId && payload.data) payload = record(payload.data);
    const v2Request = request?.rawRequest && Object.hasOwn(request, 'data');
    const supplied = v2Request ? request.auth : legacyContext?.auth;
    if (supplied?.uid) return { payload, auth: supplied };
    const headers = request?.rawRequest?.headers || legacyContext?.rawRequest?.headers || {};
    const authorization = text(headers.authorization || headers.Authorization);
    const token = payload.idToken || payload.auth?.idToken || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
    if (token && verifyIdToken) {
      try { const decoded = await verifyIdToken(token); if (decoded?.uid) return { payload, auth: { uid: decoded.uid, token: decoded } }; } catch (_) { /* Fail closed. */ }
    }
    fail('unauthenticated', 'Sign in before changing recurring work or sending a service report.');
  }
  async function actorFor(companyId, auth) {
    const c = company(companyId);
    const [co, access, user] = await Promise.all([
      c.get(), db.collection('users').doc(auth.uid).collection('userAccess').doc(companyId).get(),
      db.collection('users').doc(auth.uid).get(),
    ]);
    if (!co.exists) fail('permission-denied', 'Company access is required.');
    const globalAdmin = auth.token?.admin === true || key(user.data()?.accountType) === 'admin';
    const owner = co.data().ownerId === auth.uid;
    const membership = access.data() || {};
    if (!globalAdmin && !owner && (!access.exists || !active(membership))) fail('permission-denied', 'Active company access is required.');
    const administrator = globalAdmin || owner || ['owner', 'admin', 'manager'].includes(key(membership.roleName));
    const roleId = identifier(membership.roleId, 'Role', false);
    const role = roleId ? await c.collection('roles').doc(roleId).get() : null;
    const ids = Array.isArray(role?.data()?.permissionIdList) ? role.data().permissionIdList.map(String) : [];
    return { auth, companyId, administrator, permissions: ids };
  }
  async function owned(companyId, collectionName, value, required = true) {
    const id = identifier(value, collectionName, required);
    if (!id) return null;
    const snap = await company(companyId).collection(collectionName).doc(id).get();
    if (!snap.exists || (snap.data().companyId && snap.data().companyId !== companyId)) fail('failed-precondition', `The ${collectionName} reference is unavailable in this company.`);
    return { ...snap.data(), id: snap.id };
  }
  async function technician(companyId, value) {
    const id = identifier(value, 'Technician');
    const direct = await company(companyId).collection('companyUsers').doc(id).get();
    const matches = direct.exists && (!direct.data().userId || direct.data().userId === id)
      ? [direct] : (await company(companyId).collection('companyUsers').where('userId', '==', id).get()).docs;
    const match = matches.find((snap) => active(snap.data()) && (!snap.data().companyId || snap.data().companyId === companyId));
    if (!match) fail('failed-precondition', 'Select an active technician in this company.');
    const data = match.data();
    return { userId: id, id, userName: data.userName || [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || id };
  }
  async function sourceCompany(companyId, rss) {
    const source = identifier(rss.mainCompanyId || (rss.otherCompany ? rss.contractedCompanyId : '') || companyId, 'Source company');
    if (source === companyId) return companyId;
    const contractId = identifier(rss.laborContractId, 'Recurring labor contract');
    const contract = await db.collection('recurringLaborContracts').doc(contractId).get();
    const data = contract.data() || {};
    if (!contract.exists || !active(data) || data.senderAcceptance !== true || data.receiverAcceptance !== true ||
        data.receiverId !== companyId || data.senderId !== source) fail('permission-denied', 'An accepted active labor contract is required for external service locations.');
    const scope = await contract.ref.collection('recurringWork').where('customerId', '==', rss.customerId).where('serviceLocationId', '==', rss.serviceLocationId).get();
    if (scope.empty) fail('permission-denied', 'This service location is outside the labor contract scope.');
    return source;
  }
  async function salesReference(companyId, collectionName, value, rss) {
    const id = identifier(value, collectionName, false);
    if (!id) return null;
    const snap = await db.collection(collectionName).doc(id).get();
    const data = snap.data() || {};
    if (!snap.exists || data.companyId !== companyId || (data.customerId && data.customerId !== rss.customerId) ||
        (Array.isArray(data.serviceLocationIds) && data.serviceLocationIds.length && !data.serviceLocationIds.includes(rss.serviceLocationId))) {
      fail('permission-denied', `The ${collectionName} reference does not match this company and customer.`);
    }
    return { ...data, id: snap.id };
  }
  async function template(companyId, incoming, create, actor) {
    const id = identifier(incoming.id, 'Recurring service stop');
    const snap = await company(companyId).collection('recurringServiceStop').doc(id).get();
    if (!create && !snap.exists) fail('not-found', 'Recurring service stop was not found.');
    if (create && snap.exists && !actor.administrator && !actor.permissions.includes('244')) {
      fail('permission-denied', 'Updating an existing recurring service stop requires update permission.');
    }
    const previous = snap.data() || {};
    const next = { ...previous, ...pick(incoming, recurringFields), id };
    if (previous.companyId && previous.companyId !== companyId) fail('permission-denied', 'The recurring service stop belongs to another company.');
    const source = await sourceCompany(companyId, next);
    const [customer, location, worker] = await Promise.all([
      owned(source, 'customers', next.customerId), owned(source, 'serviceLocations', next.serviceLocationId), technician(companyId, next.techId),
    ]);
    if (location.customerId !== customer.id) fail('failed-precondition', 'The service location does not belong to the selected customer.');
    const [agreement, subscription] = await Promise.all([
      salesReference(companyId, 'salesAgreements', next.salesAgreementId, next),
      salesReference(companyId, 'salesBillingSubscriptions', next.salesBillingSubscriptionId, next),
    ]);
    // The legacy edit handler falls back to saved links when a client sends an
    // empty link. Validate those references too, before it can write to Sales.
    if (previous.salesAgreementId && previous.salesAgreementId !== next.salesAgreementId) await salesReference(companyId, 'salesAgreements', previous.salesAgreementId, next);
    if (previous.salesBillingSubscriptionId && previous.salesBillingSubscriptionId !== next.salesBillingSubscriptionId) await salesReference(companyId, 'salesBillingSubscriptions', previous.salesBillingSubscriptionId, next);
    if (subscription?.agreementId && agreement && subscription.agreementId !== agreement.id) fail('failed-precondition', 'The billing subscription belongs to a different agreement.');
    // Denormalized customer/worker labels come from company records. Preserve the
    // server cursor and creation timestamp when older clients resubmit a template.
    const result = { ...pick(next, recurringFields), id, techId: worker.userId, tech: worker.userName,
      customerName: customer.displayAsCompany ? customer.company || customer.companyName || next.customerName : customer.customerName || customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || next.customerName,
      address: location.address || next.address,
      ...(snap.exists ? { lastCreated: previous.lastCreated ?? null, dateCreated: previous.dateCreated ?? next.dateCreated } : {}),
    };
    if (!result.customerName) result.customerName = 'Customer';
    if (source !== companyId) result.mainCompanyId = source;
    else { result.mainCompanyId = companyId; result.otherCompany = false; }
    return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
  }
  async function orderItems(companyId, items) {
    if (!Array.isArray(items)) return [];
    if (items.length > 400) fail('resource-exhausted', 'Split this route into smaller routes.');
    return Promise.all(items.map(async (item) => {
      const rssId = identifier(item?.recurringServiceStopId, 'Recurring service stop', false);
      if (!rssId) return pick(record(item), ['id', 'order', 'serviceStopId']);
      const rss = await owned(companyId, 'recurringServiceStop', rssId);
      if (item.serviceStopId) await owned(companyId, 'serviceStops', item.serviceStopId);
      return { ...pick(item, ['id', 'order', 'serviceStopId']), recurringServiceStopId: rss.id,
        customerId: rss.customerId || '', customerName: rss.customerName || '', locationId: rss.serviceLocationId || '' };
    }));
  }
  function wrap(action, handler) {
    if (!permissions[action]) throw new Error(`Unknown recurring action: ${action}`);
    return async (request, legacyContext) => {
      const { payload, auth } = await authentication(request, legacyContext);
      const companyId = identifier(payload.companyId, 'Company');
      const actor = await actorFor(companyId, auth);
      let reportStop;
      if (action === 'report') reportStop = await owned(companyId, 'serviceStops', payload.serviceStopId || payload.stopId);
      const permitted = actor.administrator || (action === 'routeDelete'
        ? permissions[action].every((id) => actor.permissions.includes(id))
        : permissions[action].some((id) => actor.permissions.includes(id))) ||
        (action === 'report' && reportStop.techId === auth.uid);
      if (!permitted) fail('permission-denied', 'Your role cannot perform this recurring work action.');
      let clean = { companyId };
      if (action === 'create' || action === 'update') {
        clean.recurringServiceStop = await template(companyId, record(payload.recurringServiceStop), action === 'create', actor);
        Object.assign(clean, pick(payload, ['syncRoute', 'futureServiceStopsStartAt']));
      }
      if (['update', 'routeAssignment'].includes(action) && payload.destinationRouteId) {
        await owned(companyId, 'recurringRoutes', payload.destinationRouteId);
        clean.destinationRouteId = payload.destinationRouteId;
      }
      if (action === 'delete' || action === 'end') {
        clean.stopId = identifier(payload.stopId || payload.recurringServiceStopId, 'Recurring service stop');
        await owned(companyId, 'recurringServiceStop', clean.stopId);
        Object.assign(clean, pick(payload, ['includePastServiceStops', 'endDate']));
      }
      if (action === 'routeDelete' || action === 'routeOrder') {
        clean.routeId = identifier(payload.routeId, 'Route');
        // Retain read compatibility for the singular legacy recurringRoute path.
        const snap = await company(companyId).collection('recurringRoutes').doc(clean.routeId).get();
        if (!snap.exists) await owned(companyId, 'recurringRoute', clean.routeId);
        Object.assign(clean, pick(payload, ['includePastServiceStops']));
        if (action === 'routeOrder') {
          clean.recurringRouteOrder = await orderItems(companyId, payload.recurringRouteOrder || payload.order);
          clean.serviceStopOrders = await orderItems(companyId, payload.serviceStopOrders);
        }
      }
      if (action === 'routeAssignment' || action === 'permanentMove') {
        const target = record(payload.targetTech || payload.newTech);
        const worker = await technician(companyId, target.userId || target.id || payload.targetTechId);
        const day = payload.targetDay || payload.day || payload.newDay;
        if (!['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(day)) fail('invalid-argument', 'Select a valid route day.');
        if (action === 'routeAssignment') {
          const ids = [...new Set([...(Array.isArray(payload.recurringServiceStopIds) ? payload.recurringServiceStopIds : []),
            ...(Array.isArray(payload.recurringServiceStops) ? payload.recurringServiceStops.map((rss) => rss?.id) : [])])];
          if (!ids.length || ids.length > 400) fail('invalid-argument', 'Select between 1 and 400 recurring service stops.');
          await Promise.all(ids.map((id) => owned(companyId, 'recurringServiceStop', id)));
          Object.assign(clean, { recurringServiceStopIds: ids, targetTech: worker, targetDay: day }, pick(payload, ['futureServiceStopsStartAt']));
        } else {
          const ids = [...new Set((Array.isArray(payload.serviceStopList) ? payload.serviceStopList : []).map((stop) => identifier(stop?.id, 'Service stop')))];
          if (!ids.length || ids.length > 400) fail('invalid-argument', 'Select between 1 and 400 service stops.');
          await Promise.all(ids.map((id) => owned(companyId, 'serviceStops', id)));
          Object.assign(clean, { serviceStopList: ids.map((id) => ({ id })), newTech: worker, newDay: day });
        }
      }
      if (action === 'report') {
        await sourceCompany(companyId, reportStop);
        clean.serviceStopId = reportStop.id;
        if (payload.serviceReportBaseUrl) clean.serviceReportBaseUrl = payload.serviceReportBaseUrl;
      }
      return handler(clean, { auth, recurringActor: actor });
    };
  }
  return { wrap };
}

module.exports = { createRecurringAccess };
