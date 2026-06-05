import {
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { salesCollectionNames } from '../models/Sales';

export const salesCollection = (db, collectionKey) => {
  const collectionName = salesCollectionNames[collectionKey] || collectionKey;
  return collection(db, collectionName);
};

export const salesDoc = (db, collectionKey, id) => {
  const collectionName = salesCollectionNames[collectionKey] || collectionKey;
  return doc(db, collectionName, id);
};

export const companySalesSubcollection = (db, companyId, collectionKey) => {
  const collectionName = salesCollectionNames[collectionKey] || collectionKey;
  return collection(db, 'companies', companyId, collectionName);
};

export const companySalesSubcollectionDoc = (db, companyId, collectionKey, id) => {
  const collectionName = salesCollectionNames[collectionKey] || collectionKey;
  return doc(db, 'companies', companyId, collectionName, id);
};

export const salesCatalogCollection = (db, companyId) => (
  companySalesSubcollection(db, companyId, 'catalogItems')
);

export const salesCatalogDoc = (db, companyId, id) => (
  companySalesSubcollectionDoc(db, companyId, 'catalogItems', id)
);

export const companySalesCatalogQuery = (db, companyId, orderField = 'name') => (
  query(
    salesCatalogCollection(db, companyId),
    where('active', '==', true),
    orderBy(orderField, 'asc'),
  )
);

export const companySalesQuery = (db, collectionKey, companyId, orderField = 'createdAt') => (
  query(
    salesCollection(db, collectionKey),
    where('companyId', '==', companyId),
    orderBy(orderField, 'desc'),
  )
);

export const customerSalesByUserQuery = (db, collectionKey, customerUserId, orderField = 'createdAt') => (
  query(
    salesCollection(db, collectionKey),
    where('customerUserId', '==', customerUserId),
    orderBy(orderField, 'desc'),
  )
);

export const customerSalesByCustomerQuery = (db, collectionKey, customerId, orderField = 'createdAt') => (
  query(
    salesCollection(db, collectionKey),
    where('customerId', '==', customerId),
    orderBy(orderField, 'desc'),
  )
);

export const adminSalesQuery = (db, collectionKey, orderField = 'createdAt') => (
  query(
    salesCollection(db, collectionKey),
    orderBy(orderField, 'desc'),
  )
);

export const saveSalesModel = async (db, collectionKey, model, { merge = true } = {}) => {
  const payload = typeof model.toFirestore === 'function' ? model.toFirestore() : model;
  const now = serverTimestamp();

  await setDoc(
    salesDoc(db, collectionKey, payload.id),
    {
      ...payload,
      updatedAt: now,
      createdAt: payload.createdAt || now,
    },
    { merge },
  );
};

export const saveSalesCatalogItem = async (db, companyId, model, { merge = true } = {}) => {
  const payload = typeof model.toFirestore === 'function' ? model.toFirestore() : model;
  const now = serverTimestamp();

  await setDoc(
    salesCatalogDoc(db, companyId, payload.id),
    {
      ...payload,
      companyId,
      updatedAt: now,
      createdAt: payload.createdAt || now,
    },
    { merge },
  );
};
