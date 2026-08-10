import {
  arrayUnion,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  SalesAgreementSourceType,
  salesCollectionNames,
} from '../models/Sales';

export const linkedInitialEstimateServiceStopIds = (agreement = {}) => ([
  agreement.serviceAgreementEstimateServiceStopId,
  agreement.inspectionServiceStopId,
  agreement.sourceServiceStopId,
  agreement.serviceStopId,
  ...(Array.isArray(agreement.serviceStopIds) ? agreement.serviceStopIds : []),
].filter(Boolean));

export const agreementLinksInitialEstimate = (agreement = {}, serviceStopId = '') => (
  Boolean(serviceStopId && linkedInitialEstimateServiceStopIds(agreement).includes(serviceStopId))
);

export const agreementDisplayTitle = (agreement = {}) => (
  agreement.title || agreement.name || agreement.agreementTitle || 'Service Agreement'
);

export const connectServiceAgreementToInitialEstimate = async ({
  db,
  companyId,
  serviceStopId,
  serviceStop = {},
  agreement = {},
}) => {
  if (!db || !companyId || !serviceStopId || !agreement?.id) {
    throw new Error('A company, service stop, and agreement are required.');
  }

  const timestamp = serverTimestamp();
  const agreementTitle = agreementDisplayTitle(agreement);
  const leadId = serviceStop.leadId || agreement.leadId || '';
  const stopUpdate = {
    serviceAgreementId: agreement.id,
    serviceAgreementTitle: agreementTitle,
    serviceAgreementStatus: agreement.status || '',
    salesAgreementId: agreement.id,
    agreementId: agreement.id,
    updatedAt: timestamp,
  };
  const agreementUpdate = {
    serviceAgreementEstimateServiceStopId: serviceStopId,
    inspectionServiceStopId: serviceStopId,
    serviceStopIds: arrayUnion(serviceStopId),
    updatedAt: timestamp,
  };

  if (leadId) {
    stopUpdate.leadId = leadId;
    if (!agreement.leadId) agreementUpdate.leadId = leadId;
  }

  if (!agreement.sourceId || agreement.sourceType === SalesAgreementSourceType.manual) {
    agreementUpdate.sourceType = SalesAgreementSourceType.serviceAgreementSurvey;
    agreementUpdate.sourceId = serviceStopId;
  }

  const batch = writeBatch(db);
  batch.update(
    doc(db, 'companies', companyId, 'serviceStops', serviceStopId),
    stopUpdate,
  );
  batch.update(
    doc(db, salesCollectionNames.agreements, agreement.id),
    agreementUpdate,
  );

  await batch.commit();

  if (leadId) {
    try {
      await updateDoc(doc(db, 'homeownerServiceRequests', leadId), {
        serviceAgreementId: agreement.id,
        serviceAgreementTitle: agreementTitle,
        serviceAgreementStatus: agreement.status || '',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn('Initial estimate connected, but the source lead was not updated.', error);
    }
  }

  return {
    agreementTitle,
    leadId,
    stopUpdate,
  };
};
