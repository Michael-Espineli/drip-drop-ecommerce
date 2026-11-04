import { collection, onSnapshot, query, where } from 'firebase/firestore';

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
  const queries = [query(collection(db, collectionName), where('customerUserId', '==', user.uid))];
  if (user.emailVerified && user.email) fields.forEach(field => queries.push(query(collection(db, collectionName), where(field, '==', user.email), where('customerUserId', 'in', ['', null]))));
  const sources = new Map();
  const stops = queries.map((q, index) => onSnapshot(q, snapshot => {
    sources.set(index, snapshot.docs);
    const documents = new Map();
    sources.forEach(docs => docs.forEach(document => {
      const data = document.data();
      if (!data.customerUserId || data.customerUserId === user.uid) documents.set(document.id, document);
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
