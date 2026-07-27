import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../config';
import {
  ContractTerm,
  TermsTemplate,
  termsCollectionName,
  termsTemplateCollectionName,
} from '../models/TermsTemplate';

export const termsTemplateCollection = (companyId) =>
  collection(db, 'companies', companyId, termsTemplateCollectionName);

export const termsTemplateDoc = (companyId, templateId) =>
  doc(db, 'companies', companyId, termsTemplateCollectionName, templateId);

export const termsCollection = (companyId, templateId) =>
  collection(db, 'companies', companyId, termsTemplateCollectionName, templateId, termsCollectionName);

export const termDoc = (companyId, templateId, termId) =>
  doc(db, 'companies', companyId, termsTemplateCollectionName, templateId, termsCollectionName, termId);

export const listenTermsTemplates = (companyId, onChange, onError) => {
  const templatesQuery = query(termsTemplateCollection(companyId), orderBy('name'));
  return onSnapshot(
    templatesQuery,
    (snapshot) => onChange(snapshot.docs.map((templateDoc) => TermsTemplate.fromFirestore(templateDoc))),
    onError
  );
};

export const getTerms = async (companyId, templateId) => {
  const snapshot = await getDocs(termsCollection(companyId, templateId));
  return snapshot.docs.map((termSnapshot) => ContractTerm.fromFirestore(termSnapshot));
};

export const getTermsTemplates = async (companyId) => {
  const snapshot = await getDocs(query(termsTemplateCollection(companyId), orderBy('name')));
  return snapshot.docs.map((templateSnapshot) => TermsTemplate.fromFirestore(templateSnapshot));
};

export const getTermsTemplate = async (companyId, templateId) => {
  const snapshot = await getDoc(termsTemplateDoc(companyId, templateId));
  if (!snapshot.exists()) return null;
  return TermsTemplate.fromFirestore(snapshot);
};

export const saveTermsTemplate = async (companyId, termsTemplate) => {
  const template = termsTemplate instanceof TermsTemplate ? termsTemplate : new TermsTemplate(termsTemplate);
  await setDoc(termsTemplateDoc(companyId, template.id), template.toFirestore(), { merge: true });
  return template;
};

export const getNextTermsTemplateDuplicateName = (sourceName, existingTemplates = []) => {
  const baseName = String(sourceName || '').trim() || 'Terms Template';
  const existingNames = new Set(
    existingTemplates
      .map((template) => String(template?.name || '').trim())
      .filter(Boolean)
  );

  let duplicateIndex = 1;
  let candidateName = `${baseName} ${duplicateIndex}`;

  while (existingNames.has(candidateName)) {
    duplicateIndex += 1;
    candidateName = `${baseName} ${duplicateIndex}`;
  }

  return candidateName;
};

export const duplicateTermsTemplate = async (companyId, sourceTemplateId) => {
  const [sourceTemplate, sourceTerms, existingTemplates] = await Promise.all([
    getTermsTemplate(companyId, sourceTemplateId),
    getTerms(companyId, sourceTemplateId),
    getTermsTemplates(companyId),
  ]);

  if (!sourceTemplate) {
    throw new Error('Terms template not found.');
  }

  const now = new Date();
  const duplicatedTemplate = new TermsTemplate({
    name: getNextTermsTemplateDuplicateName(sourceTemplate.name, existingTemplates),
    description: sourceTemplate.description,
    content: sourceTemplate.content,
    category: sourceTemplate.category,
    createdAt: now,
    updatedAt: now,
  });
  const duplicatedTerms = sourceTerms.map((term) => new ContractTerm({
    description: term.description,
  }));

  const batch = writeBatch(db);
  batch.set(termsTemplateDoc(companyId, duplicatedTemplate.id), duplicatedTemplate.toFirestore());
  duplicatedTerms.forEach((term) => {
    batch.set(termDoc(companyId, duplicatedTemplate.id, term.id), term.toFirestore());
  });

  await batch.commit();
  return duplicatedTemplate;
};

export const updateTermsTemplate = (companyId, templateId, fields) =>
  updateDoc(termsTemplateDoc(companyId, templateId), {
    ...fields,
    updatedAt: new Date(),
  });

export const saveContractTerm = async (companyId, templateId, term) => {
  const contractTerm = term instanceof ContractTerm ? term : new ContractTerm(term);
  await setDoc(termDoc(companyId, templateId, contractTerm.id), contractTerm.toFirestore(), { merge: true });
  return contractTerm;
};

export const deleteContractTerm = (companyId, templateId, termId) => deleteDoc(termDoc(companyId, templateId, termId));
