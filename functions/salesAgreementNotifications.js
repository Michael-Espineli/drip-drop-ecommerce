const admin = require('firebase-admin');

function createSalesAgreementNotifications(db) {
  const normalizeSalesWorkflowText = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  const salesWorkflowFirstText = (...values) => (
    values.map((value) => String(value || '').trim()).find(Boolean) || ''
  );

  const labelizeSalesWorkflowValue = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';

    return text
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const salesAgreementIsEstimateRecord = (agreement = {}) => {
    const sourceType = normalizeSalesWorkflowText(agreement.sourceType);
    const rateType = normalizeSalesWorkflowText(agreement.rateType);
    const serviceCadence = normalizeSalesWorkflowText(agreement.serviceCadence);

    return (
      sourceType === 'oneoffjob' ||
      sourceType === 'workoffer' ||
      sourceType === 'lead' ||
      rateType === 'onetime' ||
      serviceCadence === 'onetime'
    );
  };

  const salesAgreementRecordLabel = (agreement = {}) => (
    salesAgreementIsEstimateRecord(agreement) ? 'Estimate' : 'Service Agreement'
  );

  const salesAgreementAcceptedByClient = (agreement = {}) => {
    const source = normalizeSalesWorkflowText(agreement.acceptedSource);
    if (source) return ['customerportal', 'emaillink'].includes(source);
    // Older accepted records may have actor attribution without acceptedSource.
    return Boolean(agreement.acceptedByUserId &&
      agreement.acceptedByUserId === agreement.customerUserId);
  };

  const salesAgreementRecurringSetupReady = (agreement = {}) => {
    const setupStatus = normalizeSalesWorkflowText(agreement.operationsSetupStatus);

    return Boolean(
      agreement.recurringServiceStopId ||
      agreement.recurringRouteId ||
      [
        'recurringservicestopcreated',
        'recurringservicestopandroutecreated',
        'recurringroutecreated',
        'recurringrouteassigned',
        'servicestopcreated',
        'ready',
        'complete',
        'completed',
      ].includes(setupStatus)
    );
  };

  const workflowAlertDisplayName = (user = {}, fallback = 'Company user') => {
    const fullName = [
      user.firstName,
      user.lastName,
    ].map((value) => salesWorkflowFirstText(value)).filter(Boolean).join(' ');

    return salesWorkflowFirstText(
      user.userName,
      user.displayName,
      user.name,
      fullName,
      user.email,
      fallback
    );
  };

  const workflowAlertUserId = (user = {}, fallback = '') => (
    salesWorkflowFirstText(user.userId, user.uid, user.authUserId, user.id, fallback)
  );

  const workflowAlertCompanyUserIsActive = (user = {}) => {
    return user.active !== false && user.isActive !== false &&
      ![user.status, user.userStatus, user.companyUserStatus].some(value =>
        ['inactive', 'revoked', 'past', 'deleted', 'disabled'].includes(normalizeSalesWorkflowText(value)));
  };

  const workflowAlertCompanyUserReceivesOperations = (user = {}) => {
    const searchable = [
      user.roleName,
      user.role,
      user.position,
      user.workerType,
      user.department,
    ].map(value => salesWorkflowFirstText(value)).join(' ').toLowerCase();

    return ['owner', 'admin', 'manager', 'office', 'dispatcher', 'sales'].some((term) => searchable.includes(term));
  };

  const getWorkflowAlertPersonalRecipients = async (companyId) => {
    if (!companyId) return [];

    const [snapshot, companySnapshot] = await Promise.all([
      db.collection('companies').doc(companyId).collection('companyUsers').get(),
      db.collection('companies').doc(companyId).get(),
    ]);
    const activeUsers = snapshot.docs
      .map((companyUserDoc) => ({
        companyUserDocId: companyUserDoc.id,
        data: {
          id: companyUserDoc.id,
          ...(companyUserDoc.data() || {}),
        },
      }))
      .filter(({ data }) => workflowAlertCompanyUserIsActive(data));
    const preferredUsers = activeUsers.filter(({ data }) => workflowAlertCompanyUserReceivesOperations(data));
    const selectedUsers = preferredUsers.length ? preferredUsers : activeUsers;
    const seenUserIds = new Set();

    const recipients = selectedUsers.reduce((recipients, { companyUserDocId, data }) => {
      const userId = workflowAlertUserId(data, companyUserDocId);
      if (!userId || seenUserIds.has(userId)) return recipients;

      seenUserIds.add(userId);
      recipients.push({
        userId,
        companyUserDocId,
        name: workflowAlertDisplayName(data, userId),
      });

      return recipients;
    }, []);
    const ownerId = salesWorkflowFirstText(companySnapshot.data()?.ownerId);
    const ownerMembership = snapshot.docs.find(doc => workflowAlertUserId(doc.data(), doc.id) === ownerId);
    if (ownerId && !seenUserIds.has(ownerId) && (!ownerMembership || workflowAlertCompanyUserIsActive(ownerMembership.data()))) {
      recipients.push({ userId: ownerId, companyUserDocId: ownerMembership?.id || '', name: 'Company owner' });
    }
    return recipients;
  };

  const createAlertIfMissing = (ref, data) => db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (!existing.exists) transaction.set(ref, data);
  });

  const writeCompanyWorkflowAlert = async ({ companyId, alertId, payload }) => {
    if (!companyId || !alertId || !payload) return [];

    const recipients = await getWorkflowAlertPersonalRecipients(companyId);
    const records = [{ ref: db.collection('companies').doc(companyId).collection('alerts').doc(alertId), data: payload }];
    recipients.forEach(recipient => {
      const personalAlertId = `${alertId}_${recipient.userId}`;
      records.push({
        ref: db.collection('users').doc(recipient.userId).collection('alerts').doc(personalAlertId),
        data: {
          ...payload,
          id: personalAlertId,
          targetScope: 'specific',
          recipientUserId: recipient.userId,
          assignedToUserId: recipient.userId,
          assignedToCompanyUserDocId: recipient.companyUserDocId,
          assignedToName: recipient.name,
          notificationGroupId: alertId,
        },
      });
    });

    // Replayed events must never reset a notification the recipient already read.
    // Separate transactions keep the fan-out bounded for larger companies.
    for (const { ref, data } of records) {
      await createAlertIfMissing(ref, data);
    }
    return recipients.map((recipient) => recipient.userId);
  };

  const createCompanySalesAgreementAcceptedAlert = async ({ agreementId, agreement }) => {
    const companyId = salesWorkflowFirstText(agreement.companyId, agreement.recipientCompanyId);
    if (!agreementId || !companyId) return '';

    const recordLabel = salesAgreementRecordLabel(agreement);
    const recordTitle = salesWorkflowFirstText(agreement.title, recordLabel);
    const customerName = salesWorkflowFirstText(
      agreement.acceptedByUserName,
      agreement.customerName,
      agreement.acceptedByEmail,
      'Customer'
    );
    const billingChoice = labelizeSalesWorkflowValue(
      agreement.customerBillingPreference ||
      agreement.requestedBillingPreference ||
      agreement.billingPreference ||
      agreement.paymentPreference
    );
    const alertId = `sales_agreement_accepted_${agreementId}`;
    const companyWebPath = `/company/sales/agreements/${agreementId}`;
    const clientWebPath = `/client/service-agreements/${agreementId}`;
    const message = [
      `${customerName} accepted ${recordTitle}.`,
      billingChoice ? `Billing choice: ${billingChoice}.` : '',
    ].filter(Boolean).join(' ');

    const alertPayload = {
      id: alertId,
      companyId,
      recipientCompanyId: companyId,
      title: `${recordLabel} accepted`,
      name: `${recordLabel} accepted`,
      message,
      description: message,
      status: 'unread',
      read: false,
      severity: 'success',
      type: 'sales_agreement_accepted',
      source: 'salesAgreements',
      sourceId: agreementId,
      route: companyWebPath,
      category: salesAgreementIsEstimateRecord(agreement) ? 'estimate' : 'serviceAgreement',
      hasItem: true,
      itemId: agreementId,
      itemName: recordTitle,
      targetScope: 'team',
      deliveryTargets: ['web', 'ios'],
      channels: {
        dashboard: true,
        ios: true,
        push: true,
      },
      relatedEntity: {
        type: salesAgreementIsEstimateRecord(agreement) ? 'estimate' : 'serviceAgreement',
        id: agreementId,
        label: recordTitle,
        companyId,
        webPath: companyWebPath,
        companyWebPath,
        clientWebPath,
      },
      share: {
        type: salesAgreementIsEstimateRecord(agreement) ? 'estimate' : 'serviceAgreement',
        recordId: agreementId,
        title: recordTitle,
        subtitle: `${customerName} accepted`,
        companyId,
        collectionPath: `salesAgreements/${agreementId}`,
        webPath: companyWebPath,
        companyWebPath,
        clientWebPath,
      },
      customerId: agreement.customerId || '',
      customerUserId: agreement.customerUserId || agreement.acceptedByUserId || '',
      customerName: agreement.customerName || customerName,
      acceptedByUserId: agreement.acceptedByUserId || '',
      acceptedByUserName: agreement.acceptedByUserName || customerName,
      acceptedByEmail: agreement.acceptedByEmail || agreement.email || agreement.customerEmail || '',
      acceptedAt: agreement.acceptedAt || admin.firestore.FieldValue.serverTimestamp(),
      date: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await writeCompanyWorkflowAlert({
      companyId,
      alertId,
      payload: alertPayload,
    });

    return alertId;
  };

  const createClientSalesAgreementSetupAlert = async ({ agreementId, agreement }) => {
    const companyId = salesWorkflowFirstText(agreement.companyId, agreement.recipientCompanyId);
    const customerUserId = salesWorkflowFirstText(
      agreement.customerUserId,
      agreement.homeownerUserId,
      agreement.homeownerId,
      agreement.acceptedByUserId
    );

    if (!agreementId || !companyId || !customerUserId) return '';

    const recordTitle = salesWorkflowFirstText(agreement.title, 'Service Agreement');
    const companyName = salesWorkflowFirstText(agreement.companyName, 'Your pool company');
    const recurringRouteId = salesWorkflowFirstText(agreement.recurringRouteId);
    const alertId = `sales_agreement_service_setup_${agreementId}`;
    const companyWebPath = `/company/sales/agreements/${agreementId}`;
    const clientWebPath = `/client/service-agreements/${agreementId}`;
    const message = recurringRouteId
      ? `${companyName} created your recurring service stop and added it to a recurring route.`
      : `${companyName} created your recurring service stop. Route planning details may still be in progress.`;

    await createAlertIfMissing(db.collection('users').doc(customerUserId).collection('alerts').doc(alertId), {
      id: alertId,
      companyId,
      recipientCompanyId: companyId,
      recipientUserId: customerUserId,
      title: 'Recurring service setup started',
      name: 'Recurring service setup started',
      message,
      description: message,
      status: 'unread',
      read: false,
      severity: 'success',
      type: 'sales_agreement_service_setup',
      source: 'salesAgreements',
      sourceId: agreementId,
      route: clientWebPath,
      hasItem: true,
      itemId: agreementId,
      itemName: recordTitle,
      deliveryTargets: ['web', 'ios'],
      channels: {
        dashboard: true,
        ios: true,
        push: true,
      },
      relatedEntity: {
        type: 'serviceAgreement',
        id: agreementId,
        label: recordTitle,
        companyId,
        webPath: clientWebPath,
        companyWebPath,
        clientWebPath,
      },
      share: {
        type: 'serviceAgreement',
        recordId: agreementId,
        title: recordTitle,
        subtitle: 'Recurring service setup started',
        companyId,
        collectionPath: `salesAgreements/${agreementId}`,
        webPath: clientWebPath,
        companyWebPath,
        clientWebPath,
      },
      customerId: agreement.customerId || '',
      customerUserId,
      customerName: agreement.customerName || '',
      recurringServiceStopId: agreement.recurringServiceStopId || '',
      recurringRouteId,
      setupStatus: agreement.operationsSetupStatus || '',
      setupUpdatedAt: agreement.operationsSetupUpdatedAt || admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return alertId;
  };


  const onAgreementWritten = async (change, context) => {
      if (!change.after.exists) return null;
      const agreementId = context.params.agreementId;
      // A newer write may arrive before this event; use the current state.
      const current = await change.after.ref.get();
      if (!current.exists) return null;
      const after = current.data() || {};
      const markerUpdates = {};

      const isAccepted = normalizeSalesWorkflowText(after.status) === 'accepted';
      const acceptedByClient = salesAgreementAcceptedByClient(after);

      if (
        isAccepted &&
        acceptedByClient &&
        !after.companyAcceptanceAlertCreatedAt
      ) {
        const companyAlertId = await createCompanySalesAgreementAcceptedAlert({
          agreementId,
          agreement: after,
        });

        if (companyAlertId) {
          markerUpdates.companyAcceptanceAlertId = companyAlertId;
          markerUpdates.companyAcceptanceAlertCreatedAt = admin.firestore.FieldValue.serverTimestamp();
        }
      }

      const afterSetupReady = isAccepted &&
        !salesAgreementIsEstimateRecord(after) &&
        salesAgreementRecurringSetupReady(after);

      if (
        afterSetupReady &&
        !after.recurringServiceSetupCustomerNotifiedAt
      ) {
        const customerAlertId = await createClientSalesAgreementSetupAlert({
          agreementId,
          agreement: after,
        });

        if (customerAlertId) {
          markerUpdates.recurringServiceSetupCustomerNotificationId = customerAlertId;
          markerUpdates.recurringServiceSetupCustomerNotifiedAt = admin.firestore.FieldValue.serverTimestamp();
        }
      }

      if (Object.keys(markerUpdates).length > 0) {
        await change.after.ref.set({
          ...markerUpdates,
          notificationWorkflowUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      return null;
  };

  return { onAgreementWritten, writeCompanyWorkflowAlert, salesWorkflowFirstText };
}

module.exports = { createSalesAgreementNotifications };
