import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CUSTOMER_VISIBLE_AGREEMENT_STATUSES, isCustomerVisibleAgreement } from './sales/customerAgreementVisibility';

// Before account linking finishes, verified recipients can still find emailed records.
export function listenClientRecords({
  db,
  user,
  collectionName,
  emailFields
}, onChange, onError = () => {}) {
  if (!user?.uid) {
    onChange({
      docs: []
    });
    return () => {};
  }
  const fields = emailFields || (collectionName === 'customerPartApprovals' ? ['customerEmail', 'email'] : ['email']);
  const isAgreement = collectionName === 'salesAgreements';
  const visibility = isAgreement ? [where('status', 'in', CUSTOMER_VISIBLE_AGREEMENT_STATUSES)] : [];
  const queries = [query(collection(db, collectionName), where('customerUserId', '==', user.uid), ...visibility)];
  if (user.emailVerified && user.email) fields.forEach(field => queries.push(query(collection(db, collectionName), where(field, '==', user.email), where('customerUserId', 'in', ['', null]), ...visibility)));
  const sources = new Map();
  const stops = queries.map((q, index) => onSnapshot(q, snapshot => {
    sources.set(index, snapshot.docs);
    const documents = new Map();
    sources.forEach(docs => docs.forEach(document => {
      const data = document.data();
      if ((!data.customerUserId || data.customerUserId === user.uid) && (!isAgreement || isCustomerVisibleAgreement(data))) documents.set(document.id, document);
    }));
    const docs = [...documents.values()];
    onChange({
      docs,
      empty: !docs.length,
      size: docs.length,
      ready: sources.size === queries.length
    });
  }, onError));
  return () => stops.forEach(stop => stop());
}
