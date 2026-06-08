import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './config';

export const PRODUCT_FEEDBACK_COLLECTION = 'productFeedback';
export const CONTACT_MESSAGES_COLLECTION = 'contactMessages';

export const FEEDBACK_TYPES = {
  bug: 'Bug Report',
  feature: 'Feature Request',
};

export const FEEDBACK_AUDIENCES = {
  company: 'Company',
  client: 'Client',
  prospect: 'Prospect',
  other: 'Other',
};

const trimValue = (value) => String(value || '').trim();

const normalizedContext = (context = {}) => ({
  userId: context.user?.uid || '',
  userEmail: context.user?.email || '',
  accountType: context.accountType || '',
  companyId: context.recentlySelectedCompany || '',
  companyName: context.recentlySelectedCompanyName || '',
});

export const createProductFeedbackSubmission = async (payload, context) => {
  const submissionContext = normalizedContext(context);
  const type = FEEDBACK_TYPES[payload.type] ? payload.type : 'feature';

  return addDoc(collection(db, PRODUCT_FEEDBACK_COLLECTION), {
    type,
    typeLabel: FEEDBACK_TYPES[type],
    audience: payload.audience || submissionContext.accountType || FEEDBACK_AUDIENCES.other,
    title: trimValue(payload.title),
    description: trimValue(payload.description),
    priority: payload.priority || 'Medium',
    requesterName: trimValue(payload.requesterName),
    requesterEmail: trimValue(payload.requesterEmail) || submissionContext.userEmail,
    status: 'New',
    source: 'footer',
    ...submissionContext,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const createContactMessage = async (payload, context) => {
  const submissionContext = normalizedContext(context);

  return addDoc(collection(db, CONTACT_MESSAGES_COLLECTION), {
    ...submissionContext,
    name: trimValue(payload.name),
    email: trimValue(payload.email) || submissionContext.userEmail,
    companyName: trimValue(payload.companyName) || submissionContext.companyName,
    subject: trimValue(payload.subject),
    message: trimValue(payload.message),
    audience: payload.audience || submissionContext.accountType || FEEDBACK_AUDIENCES.prospect,
    status: 'New',
    source: payload.source || 'contact-page',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const getAdminInboxItems = async (collectionName) => {
  const snapshot = await getDocs(query(collection(db, collectionName), orderBy('createdAt', 'desc')));

  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
};

export const updateAdminInboxStatus = async (collectionName, itemId, status) => (
  updateDoc(doc(db, collectionName, itemId), {
    status,
    updatedAt: serverTimestamp(),
  })
);
