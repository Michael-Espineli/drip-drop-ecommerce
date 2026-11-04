const {
  onDocumentWritten
} = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const clean = value => String(value ?? '').trim();
const key = value => clean(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
const safePart = value => clean(value).replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140);
const linkedId = (prefix, companyId, sourceId) => `${prefix}_${safePart(companyId)}_${safePart(sourceId)}`;
const measurements = items => (Array.isArray(items) ? items : []).map(item => ({
  id: clean(item.id),
  name: clean(item.name || item.label || item.readingName || item.dosageName),
  amount: clean(item.amount ?? item.value ?? item.quantity),
  UOM: clean(item.UOM || item.uom || item.unit || item.units)
}));
const photos = items => (Array.isArray(items) ? items : []).map(item => typeof item === 'string' ? item : item?.imageURL || item?.url || item?.downloadURL).filter(value => typeof value === 'string' && /^https:\/\//.test(value));
const dateValue = value => value?.toDate?.() || (value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null);
const owner = (value, uid) => [value?.userId, value?.homeownerId, value?.customerUserId].includes(uid);
function createHomeownerServicePublishing(db, now = () => new Date()) {
  async function syncStop(companyId, stopId, previous = null) {
    const stopRef = db.collection('companies').doc(companyId).collection('serviceStops').doc(stopId);
    const portalRef = db.collection('homeownerServiceStops').doc(linkedId('hoss', companyId, stopId));
    return db.runTransaction(async tx => {
      const [source, oldPortal] = await Promise.all([tx.get(stopRef), tx.get(portalRef)]);
      const stop = source.data() || previous;
      if (!stop?.customerId) {
        if (oldPortal.exists) tx.set(portalRef, {
          userId: '',
          homeownerId: '',
          customerUserId: '',
          status: 'Unavailable',
          updatedAt: now()
        }, {
          merge: true
        });
        return;
      }
      const co = db.collection('companies').doc(companyId);
      const [customer, company, relationships, readings, tasks, site, body] = await Promise.all([tx.get(co.collection('customers').doc(stop.customerId)), tx.get(co), tx.get(db.collection('customerCompanyRelationships').where('companyId', '==', companyId).where('companyCustomerId', '==', stop.customerId)), tx.get(co.collection('stopData').where('serviceStopId', '==', stopId)), tx.get(stopRef.collection('tasks')), stop.serviceLocationId ? tx.get(co.collection('serviceLocations').doc(stop.serviceLocationId)) : null, stop.bodyOfWaterId ? tx.get(co.collection('bodiesOfWater').doc(stop.bodyOfWaterId)) : null]);
      const relation = relationships.docs.find(r => r.data().status === 'active' && (customer.data()?.linkedCustomerIds || []).includes(r.data().homeownerUserId));
      if (!relation) {
        if (oldPortal.exists) tx.set(portalRef, {
          userId: '',
          homeownerId: '',
          customerUserId: '',
          status: 'Unavailable',
          updatedAt: now()
        }, {
          merge: true
        });
        return;
      }
      const uid = relation.data().homeownerUserId;
      const locationId = stop.serviceLocationId ? site?.data()?.sourceHomeownerServiceLocationId || site?.data()?.linkedHomeownerServiceLocationId || linkedId('hosl', companyId, stop.serviceLocationId) : '';
      const bodyId = stop.bodyOfWaterId ? body?.data()?.sourceHomeownerBodyOfWaterId || body?.data()?.linkedHomeownerBodyOfWaterId || linkedId('hobow', companyId, stop.bodyOfWaterId) : '';
      const bodyMappings = new Map(stop.bodyOfWaterId ? [[stop.bodyOfWaterId, bodyId]] : []);
      const extraBodyIds = [...new Set(readings.docs.map(record => record.data().bodyOfWaterId).filter(id => id && id !== stop.bodyOfWaterId))];
      const extraCompanyBodies = await Promise.all(extraBodyIds.map(id => tx.get(co.collection('bodiesOfWater').doc(id))));
      const extraBodies = extraCompanyBodies.filter(snapshot => snapshot.exists).map(snapshot => ({
        source: snapshot, id: snapshot.data().sourceHomeownerBodyOfWaterId || snapshot.data().linkedHomeownerBodyOfWaterId || linkedId('hobow', companyId, snapshot.id)
      }));
      const extraHomeBodies = await Promise.all(extraBodies.map(item => tx.get(db.collection('homeownerBodiesOfWater').doc(item.id))));
      extraBodies.forEach((item, index) => {
        if (extraHomeBodies[index].exists && !owner(extraHomeBodies[index].data(), uid)) throw Error('Homeowner projection ownership mismatch.');
        bodyMappings.set(item.source.id, item.id);
      });
      const locationRef = locationId ? db.collection('homeownerServiceLocations').doc(locationId) : null;
      const bodyRef = bodyId ? db.collection('homeownerBodiesOfWater').doc(bodyId) : null;
      const [homeSite, homeBody] = await Promise.all([locationRef ? tx.get(locationRef) : null, bodyRef ? tx.get(bodyRef) : null]);
      // Never redirect a projection to a property that belongs to another homeowner.
      if (homeSite?.exists && !owner(homeSite.data(), uid) || homeBody?.exists && !owner(homeBody.data(), uid)) throw Error('Homeowner projection ownership mismatch.');
      const identity = {
        userId: uid,
        homeownerId: uid,
        customerUserId: uid,
        companyId,
        companyName: company.data()?.name || '',
        companyCustomerId: stop.customerId,
        relationshipId: relation.id,
        customerCompanyRelationshipId: relation.id
      };
      const cancelled = !source.exists || ['canceled', 'cancelled', 'skipped', 'deleted'].includes(key(stop.operationStatus || stop.status));
      const completed = !cancelled && (['finished', 'completed', 'complete', 'done'].includes(key(stop.operationStatus || stop.status)) || !!stop.finishedAt || !!stop.completedAt);
      const portal = {
        ...identity,
        id: portalRef.id,
        source: 'company',
        linkedCompanyId: companyId,
        linkedCompanyCustomerId: stop.customerId,
        linkedCompanyServiceStopId: stopId,
        sourceCompanyServiceStopId: stopId,
        serviceLocationId: locationId,
        bodyOfWaterId: bodyId,
        serviceDate: stop.serviceDate || stop.date || null,
        type: stop.type || stop.serviceType || 'Pool service',
        techName: stop.techName || stop.tech || '',
        notes: stop.customerNotes || stop.serviceNotes || stop.notes || '',
        photoUrls: photos(stop.photoUrls || stop.photos),
        status: cancelled ? 'Cancelled' : completed ? 'Finished' : 'Scheduled',
        operationStatus: cancelled ? 'Cancelled' : completed ? 'Finished' : 'Not Finished',
        completedAt: completed ? stop.completedAt || stop.finishedAt || stop.endTime || stop.serviceDate || now() : null,
        tasks: tasks.docs.map(t => ({
          id: t.id,
          name: clean(t.data().name || t.data().title || t.data().taskName),
          status: clean(t.data().status || t.data().operationStatus),
          completed: ['finished', 'complete', 'completed', 'done'].includes(key(t.data().status || t.data().operationStatus))
        })),
        updatedAt: now()
      };
      if (locationRef && !homeSite.exists) tx.set(locationRef, {
        ...identity,
        id: locationId,
        nickName: site?.data()?.nickName || 'Service address',
        address: site?.data()?.address || {},
        linkedCompanyId: companyId,
        linkedCompanyName: identity.companyName,
        linkedCompanyCustomerId: stop.customerId,
        linkedCompanyServiceLocationId: stop.serviceLocationId
      });
      if (bodyRef && !homeBody.exists) tx.set(bodyRef, {
        ...identity,
        id: bodyId,
        name: body?.data()?.name || 'Pool',
        serviceLocationId: locationId,
        linkedCompanyId: companyId,
        linkedCompanyBodyOfWaterId: stop.bodyOfWaterId
      });
      extraBodies.forEach((item,index) => {
        if (!extraHomeBodies[index].exists) tx.set(db.collection('homeownerBodiesOfWater').doc(item.id), {
          ...identity, id: item.id, name: item.source.data().name || 'Pool', serviceLocationId: locationId,
          linkedCompanyId: companyId, linkedCompanyBodyOfWaterId: item.source.id
        });
      });
      tx.set(portalRef, portal);
      readings.docs.forEach(record => {
        const data = record.data(),
          id = linkedId('hostop', companyId, record.id);
        tx.set(db.collection('stopData').doc(id), {
          ...identity,
          id,
          source: 'company',
          linkedCompanyId: companyId,
          sourceCompanyStopDataId: record.id,
          linkedCompanyStopDataId: record.id,
          serviceStopId: portalRef.id,
          serviceLocationId: locationId,
          bodyOfWaterId: bodyMappings.get(data.bodyOfWaterId) || bodyId,
          date: data.date || stop.serviceDate || null,
          readings: measurements(data.readings),
          dosages: measurements(data.dosages),
          observation: (Array.isArray(data.observation) ? data.observation : []).map(item => typeof item === 'string' ? item : clean(item.text || item.description || item.name)).filter(Boolean),
          updatedAt: now()
        });
      });
      return portal;
    });
  }
  async function syncRelationship(relationship) {
    if (!relationship?.companyId || !relationship?.companyCustomerId) return;
    const stops = await db.collection('companies').doc(relationship.companyId).collection('serviceStops').where('customerId', '==', relationship.companyCustomerId).get();
    // Retain history and include every future visit when a customer first connects.
    const cutoff = now().getTime() - 730 * 86400000;
    for (const stop of stops.docs) {
      const date = dateValue(stop.data().serviceDate || stop.data().date);
      if (!date || date.getTime() >= cutoff) await syncStop(relationship.companyId, stop.id);
    }
  }
  return {
    syncStop,
    syncRelationship
  };
}
exports.createHomeownerServicePublishing = createHomeownerServicePublishing;
exports.linkedId = linkedId;
exports.publishHomeownerServiceStop = onDocumentWritten('companies/{companyId}/serviceStops/{stopId}', event => createHomeownerServicePublishing(admin.firestore()).syncStop(event.params.companyId, event.params.stopId, event.data?.before?.data()));
exports.publishHomeownerStopReadings = onDocumentWritten('companies/{companyId}/stopData/{recordId}', async event => {
  const before = event.data?.before?.data(),
    after = event.data?.after?.data();
  const worker = createHomeownerServicePublishing(admin.firestore());
  for (const id of new Set([before?.serviceStopId, after?.serviceStopId].filter(Boolean))) await worker.syncStop(event.params.companyId, id);
  if (!event.data?.after?.exists) await admin.firestore().collection('stopData').doc(linkedId('hostop', event.params.companyId, event.params.recordId)).delete();
});
exports.publishHomeownerStopTask = onDocumentWritten('companies/{companyId}/serviceStops/{stopId}/tasks/{taskId}', event => createHomeownerServicePublishing(admin.firestore()).syncStop(event.params.companyId, event.params.stopId));
exports.publishHomeownerRelationship = onDocumentWritten('customerCompanyRelationships/{relationshipId}', async event => {
  const before = event.data?.before?.data(),
    after = event.data?.after?.data();
  if (after?.status !== before?.status || after?.homeownerUserId !== before?.homeownerUserId) await createHomeownerServicePublishing(admin.firestore()).syncRelationship(after || before);
});

exports.publicMeasurements = measurements;
exports.publicPhotos = photos;
