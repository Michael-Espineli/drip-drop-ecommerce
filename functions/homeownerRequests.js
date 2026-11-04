const {
  onCall,
  HttpsError
} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const {
  createHash
} = require('node:crypto');
const {
  documentId
} = require('./companyActor');
const text = value => String(value ?? '').trim();
const owner = (record, uid) => [record.userId, record.customerUserId, record.homeownerId, record.homeownerUserId].includes(uid);
const fail = (code, message) => {
  throw new HttpsError(code, message);
};
function createHomeownerRequests(db, now = () => new Date()) {
  async function submit(request) {
    const uid = request.auth?.uid,
      data = request.data || {};
    if (!uid) fail('unauthenticated', 'Sign in before sending a repair request.');
    if (request.auth.token?.email_verified !== true) fail('failed-precondition', 'Verify your email before sending a repair request.');
    const companyId = documentId(data.companyId, 'Company'),
      locationId = documentId(data.locationId, 'Service address');
    const submissionId = documentId(data.submissionId, 'Submission'),
      description = text(data.description);
    if (!description || description.length > 5000) fail('invalid-argument', 'Describe the issue in 1–5000 characters.');
    const bodyOfWaterId = data.bodyOfWaterId ? documentId(data.bodyOfWaterId, 'Pool') : '';
    const equipmentId = data.equipmentId ? documentId(data.equipmentId, 'Equipment') : '';
    const photos = Array.isArray(data.photoUrls) ? data.photoUrls : [];
    if (photos.length > 3 || photos.some(photo => typeof photo !== 'string' || !/^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(photo) || photo.length > 3000)) fail('invalid-argument', 'Attach up to three uploaded photos.');
    const fingerprint = createHash('sha256').update(JSON.stringify({companyId,locationId,bodyOfWaterId,equipmentId,description,photos,priority:Number(data.issuePriorityLevel)||2})).digest('hex');
    const requestId = `horr_${createHash('sha256').update(`${uid}:${submissionId}`).digest('hex').slice(0, 32)}`;
    const ref = db.collection('homeownerRepairRequests').doc(requestId);
    return db.runTransaction(async transaction => {
      const [existing, location, relationships, profile, company] = await Promise.all([transaction.get(ref), transaction.get(db.collection('homeownerServiceLocations').doc(locationId)), transaction.get(db.collection('customerCompanyRelationships').where('homeownerUserId', '==', uid).where('companyId', '==', companyId)), transaction.get(db.collection('users').doc(uid)), transaction.get(db.collection('companies').doc(companyId))]);
      if (existing.exists) {
        if (existing.data().userId !== uid || existing.data().companyId !== companyId || existing.data().description !== description || existing.data().locationId !== locationId || existing.data().submissionFingerprint !== fingerprint) fail('already-exists', 'This submission was already used. Start a new request.');
        return {
          requestId,
          alreadySubmitted: true
        };
      }
      if (!location.exists || !owner(location.data(), uid)) fail('permission-denied', 'Choose a service address from your account.');
      const relationship = relationships.docs.find(item => item.data().status === 'active' && (!location.data().linkedCompanyId || location.data().linkedCompanyId === companyId));
      if (!relationship || !company.exists || company.data().deleted) fail('failed-precondition', 'Connect this service address to the receiving pool company first.');
      const relation = relationship.data(),
        customerId = documentId(relation.companyCustomerId, 'Customer');
      const customer = await transaction.get(db.collection('companies').doc(companyId).collection('customers').doc(customerId));
      if (!customer.exists || !(customer.data().linkedCustomerIds || []).includes(uid)) fail('permission-denied', 'Your company connection is no longer active. Ask the company for a new invitation.');
      const body = bodyOfWaterId ? await transaction.get(db.collection('homeownerBodiesOfWater').doc(bodyOfWaterId)) : null;
      const equipment = equipmentId ? await transaction.get(db.collection('homeownerEquipment').doc(equipmentId)) : null;
      if (body && (!body.exists || !owner(body.data(), uid) || body.data().serviceLocationId !== locationId)) fail('permission-denied', 'The selected pool does not belong to this address.');
      if (equipment && (!equipment.exists || !owner(equipment.data(), uid) || equipment.data().serviceLocationId !== locationId || bodyOfWaterId && equipment.data().bodyOfWaterId !== bodyOfWaterId)) fail('permission-denied', 'The selected equipment does not belong to this address and pool.');
      const p = profile.data() || {},
        date = now(),
        companyName = company.data().name || 'Pool company';
      const priority = Number(data.issuePriorityLevel);
      const issuePriorityLevel = [1, 2, 3, 4].includes(priority) ? priority : 2;
      const saved = {
        id: requestId,
        submissionFingerprint: fingerprint,
        userId: uid,
        homeownerId: uid,
        customerUserId: uid,
        companyId,
        companyName,
        customerId,
        customerName: [p.firstName, p.lastName].filter(Boolean).join(' ') || customer.data().customerName || '',
        requesterId: uid,
        requesterName: [p.firstName, p.lastName].filter(Boolean).join(' ') || request.auth.token.email || 'Homeowner',
        relationshipId: relationship.id,
        customerCompanyRelationshipId: relationship.id,
        locationId,
        serviceLocationId: locationId,
        bodyOfWaterId,
        equipmentId,
        companyServiceLocationId: location.data().linkedCompanyServiceLocationId || location.data().sourceCompanyServiceLocationId || '',
        companyBodyOfWaterId: body?.data()?.linkedCompanyBodyOfWaterId || '',
        companyEquipmentId: equipment?.data()?.linkedCompanyEquipmentId || '',
        description,
        issueDescription: description,
        issuePriorityLevel,
        priorityLevel: issuePriorityLevel,
        issuePriorityLabel: ({1:'Critical',2:'Recommended',3:'Preventive',4:'Optional Upgrade'})[issuePriorityLevel],
        priorityLabel: ({1:'Critical',2:'Recommended',3:'Preventive',4:'Optional Upgrade'})[issuePriorityLevel],
        status: 'Unresolved',
        source: 'homeowner',
        photoUrls: photos.map((imageURL, index) => ({
          id: `${requestId}_${index}`,
          imageURL,
          description: ''
        })),
        date,
        createdAt: date,
        updatedAt: date,
        jobIds: []
      };
      transaction.set(ref, saved);
      if (equipment && data.equipmentStatusUpdate && ['Needs Repair', 'Needs Maintenance', 'Nonoperational'].includes(data.equipmentStatusUpdate)) transaction.set(equipment.ref, {
        status: data.equipmentStatusUpdate
      }, {
        merge: true
      });
      const alertId = `homeowner_repair_${requestId}`;
      transaction.set(db.collection('companies').doc(companyId).collection('alerts').doc(alertId), {
        id: alertId,
        companyId,
        title: 'Customer repair request',
        message: `${saved.requesterName}: ${description}`,
        status: 'unread',
        read: false,
        createdAt: date,
        route: `/company/repair-requests/detail/${requestId}?sourcePath=homeowner`,
        source: 'homeownerRepairRequests',
        sourceId: requestId,
        relatedEntity: {
          type: 'repairRequest',
          id: requestId,
          companyId,
          collectionPath: 'homeownerRepairRequests',
          webPath: `/company/repair-requests/detail/${requestId}?sourcePath=homeowner`
        }
      });
      return {
        requestId,
        companyName
      };
    });
  }
  return {
    submit
  };
}
exports.createHomeownerRequests = createHomeownerRequests;
exports.submitHomeownerRepairRequest = onCall({
  cors: true
}, request => createHomeownerRequests(admin.firestore()).submit(request));
