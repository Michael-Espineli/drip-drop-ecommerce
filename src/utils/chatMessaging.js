import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { salesCollectionNames } from './models/Sales';

export const CHAT_VISIBILITY = {
  direct: 'direct',
  company: 'company',
  customer: 'customer',
  companyToCompany: 'companyToCompany',
};

export const CHAT_MESSAGE_KIND = {
  text: 'text',
  linkedRecord: 'linkedRecord',
};

export const CONVERSATION_LINK_TYPES = {
  serviceRequest: 'serviceRequest',
  repairRequest: 'repairRequest',
  serviceStop: 'serviceStop',
  recurringServiceStop: 'recurringServiceStop',
  estimate: 'estimate',
  serviceAgreement: 'serviceAgreement',
  invoice: 'invoice',
  job: 'job',
  customer: 'customer',
  serviceLocation: 'serviceLocation',
  equipment: 'equipment',
};

export const COMPANY_CONVERSATION_LINK_OPTIONS = [
  { value: CONVERSATION_LINK_TYPES.serviceStop, label: 'Service Stop' },
  { value: CONVERSATION_LINK_TYPES.estimate, label: 'Estimate' },
  { value: CONVERSATION_LINK_TYPES.serviceAgreement, label: 'Service Agreement' },
  { value: CONVERSATION_LINK_TYPES.invoice, label: 'Invoice' },
  { value: CONVERSATION_LINK_TYPES.repairRequest, label: 'Repair Request' },
  { value: CONVERSATION_LINK_TYPES.serviceRequest, label: 'Service Request' },
  { value: CONVERSATION_LINK_TYPES.job, label: 'Job' },
  { value: CONVERSATION_LINK_TYPES.recurringServiceStop, label: 'Recurring Stop' },
  { value: CONVERSATION_LINK_TYPES.customer, label: 'Customer' },
  { value: CONVERSATION_LINK_TYPES.serviceLocation, label: 'Service Location' },
  { value: CONVERSATION_LINK_TYPES.equipment, label: 'Equipment' },
];

export const CLIENT_CONVERSATION_LINK_OPTIONS = [
  { value: CONVERSATION_LINK_TYPES.serviceRequest, label: 'Service Request' },
  { value: CONVERSATION_LINK_TYPES.repairRequest, label: 'Repair Request' },
  { value: CONVERSATION_LINK_TYPES.serviceAgreement, label: 'Service Agreement' },
  { value: CONVERSATION_LINK_TYPES.invoice, label: 'Invoice' },
  { value: CONVERSATION_LINK_TYPES.equipment, label: 'Equipment' },
  { value: CONVERSATION_LINK_TYPES.serviceLocation, label: 'Service Location' },
];

const noop = () => {};

const cleanString = (value) => String(value || '').trim();

const uniqueStrings = (values = []) => (
  [...new Set(values.map(cleanString).filter(Boolean))]
);

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export const getUserDisplayName = (dataBaseUser, fallbackUser) => {
  const first = cleanString(dataBaseUser?.firstName);
  const last = cleanString(dataBaseUser?.lastName);
  const fullName = `${first} ${last}`.trim();

  return fullName || fallbackUser?.displayName || fallbackUser?.email || 'User';
};

export const getTimestampMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  return 0;
};

const formatShortDate = (value) => {
  const millis = getTimestampMillis(value);
  if (!millis) return '';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(millis));
};

const formatMoney = (amountCents) => {
  if (amountCents === undefined || amountCents === null || amountCents === '') return '';
  return moneyFormatter.format((Number(amountCents) || 0) / 100);
};

export const sortChatsNewest = (chats = []) => (
  [...chats].sort((a, b) => getTimestampMillis(b.mostRecentChat) - getTimestampMillis(a.mostRecentChat))
);

export const normalizeParticipant = (participant = {}) => ({
  id: participant.id || `par_${uuidv4()}`,
  userId: cleanString(participant.userId || participant.id),
  userName: cleanString(participant.userName || participant.name) || 'Unknown User',
  userImage: participant.userImage || participant.image || participant.photoUrl || participant.profileImageUrl || '',
  userEmail: participant.userEmail || participant.email || '',
  accountType: participant.accountType || '',
  companyId: participant.companyId || '',
  companyName: participant.companyName || '',
  isCompany: Boolean(participant.isCompany),
});

export const userParticipantFromContext = ({ user, dataBaseUser, companyId = '', companyName = '' }) => (
  normalizeParticipant({
    id: `par_${uuidv4()}`,
    userId: user?.uid,
    userName: getUserDisplayName(dataBaseUser, user),
    userImage: dataBaseUser?.photoUrl || dataBaseUser?.profileImageUrl || user?.photoURL || '',
    userEmail: dataBaseUser?.email || user?.email || '',
    accountType: dataBaseUser?.accountType || '',
    companyId,
    companyName,
    isCompany: Boolean(companyId),
  })
);

export const companyParticipantFromCompany = (company = {}) => (
  normalizeParticipant({
    id: `par_${uuidv4()}`,
    userId: company.ownerId || company.userId || company.id,
    userName: company.ownerName || company.name || 'Company',
    userImage: company.logoUrl || company.photoUrl || '',
    userEmail: company.ownerEmail || company.email || '',
    accountType: 'Company',
    companyId: company.id,
    companyName: company.name || '',
    isCompany: true,
  })
);

export const isChatVisibleTo = (chat = {}, userId, companyId = '') => {
  const participantIds = Array.isArray(chat.participantIds) ? chat.participantIds : [];
  const participantCompanyIds = Array.isArray(chat.participantCompanyIds) ? chat.participantCompanyIds : [];

  return Boolean(
    (userId && participantIds.includes(userId))
    || (companyId && participantCompanyIds.includes(companyId))
    || (companyId && chat.companyId === companyId)
    || (companyId && chat.receiverCompanyId === companyId)
    || (companyId && chat.senderCompanyId === companyId)
  );
};

export const isChatUnreadFor = (chat = {}, userId, companyId = '') => {
  const unreadUserIds = Array.isArray(chat.userWhoHaveNotRead) ? chat.userWhoHaveNotRead : [];
  const legacyUnreadUserIds = Array.isArray(chat.unreadMessages) ? chat.unreadMessages : [];
  const unreadCompanyIds = Array.isArray(chat.companyIdsWhoHaveNotRead) ? chat.companyIdsWhoHaveNotRead : [];
  const readByUserIds = Array.isArray(chat.readByUserIds) ? chat.readByUserIds : [];

  const userUnread = userId && (unreadUserIds.includes(userId) || legacyUnreadUserIds.includes(userId));
  const companyUnread = companyId && unreadCompanyIds.includes(companyId) && !readByUserIds.includes(userId);

  return Boolean(userUnread || companyUnread);
};

export const getOtherParticipant = (chat = {}, userId, { companyId = '', audience = 'company' } = {}) => {
  const participants = Array.isArray(chat.participants) ? chat.participants.map(normalizeParticipant) : [];

  if (audience === 'company' && companyId) {
    return participants.find((participant) => (
      participant.companyId !== companyId
      && participant.userId !== companyId
    )) || participants.find((participant) => participant.userId !== userId) || null;
  }

  return participants.find((participant) => participant.userId !== userId) || null;
};

export const getChatDisplayTitle = (chat = {}, userId, { companyId = '', audience = 'client' } = {}) => {
  if (audience === 'client') {
    return chat.companyName || getOtherParticipant(chat, userId, { companyId, audience })?.userName || chat.title || 'Conversation';
  }

  const otherParticipant = getOtherParticipant(chat, userId, { companyId, audience });
  return otherParticipant?.userName || chat.customerName || chat.title || chat.companyName || 'Conversation';
};

export const getChatAvatarText = (chat = {}, userId, options = {}) => (
  getChatDisplayTitle(chat, userId, options).charAt(0).toUpperCase() || 'C'
);

export const getConversationLinkLabel = (type) => {
  const option = [...COMPANY_CONVERSATION_LINK_OPTIONS, ...CLIENT_CONVERSATION_LINK_OPTIONS]
    .find((candidate) => candidate.value === type);

  return option?.label || 'Linked Item';
};

export const normalizeConversationLink = (link = {}) => {
  const type = link.type || link.linkType || CONVERSATION_LINK_TYPES.serviceRequest;
  const recordId = cleanString(link.recordId || link.id || link.sourceId);

  return {
    id: link.id || `link_${uuidv4()}`,
    type,
    recordId,
    title: cleanString(link.title) || getConversationLinkLabel(type),
    subtitle: cleanString(link.subtitle || link.summary || link.description),
    companyId: link.companyId || '',
    customerId: link.customerId || '',
    customerUserId: link.customerUserId || '',
    collectionPath: link.collectionPath || '',
    webPath: link.webPath || '',
    clientWebPath: link.clientWebPath || '',
    companyWebPath: link.companyWebPath || '',
    createdAt: link.createdAt || null,
  };
};

const getChatCustomerContext = (chat = {}) => {
  const participants = Array.isArray(chat.participants) ? chat.participants.map(normalizeParticipant) : [];
  const customerParticipant = participants.find((participant) => !participant.companyId);

  return {
    customerId: chat.customerId || chat.customer?.id || chat.relationshipCustomerId || '',
    customerUserId: chat.customerUserId || chat.homeownerId || chat.clientId || customerParticipant?.userId || '',
    customerName: chat.customerName || customerParticipant?.userName || '',
    customerEmail: chat.customerEmail || chat.email || customerParticipant?.userEmail || '',
  };
};

const recordMatchesCustomerContext = (record = {}, context = {}) => {
  if (!context.customerId && !context.customerUserId && !context.customerEmail) return true;

  const recordCustomerIds = [
    record.customerId,
    record.relationshipCustomerId,
    record.customerCompanyRelationshipId,
  ].filter(Boolean).map(String);
  const recordUserIds = [
    record.customerUserId,
    record.homeownerId,
    record.userId,
    record.clientId,
  ].filter(Boolean).map(String);
  const recordEmails = [
    record.email,
    record.customerEmail,
    record.billingEmail,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return Boolean(
    (context.customerId && recordCustomerIds.includes(String(context.customerId)))
    || (context.customerUserId && recordUserIds.includes(String(context.customerUserId)))
    || (context.customerEmail && recordEmails.includes(String(context.customerEmail).toLowerCase()))
  );
};

const safeGetDocs = async (queryRef) => {
  try {
    const snapshot = await getDocs(queryRef);
    return snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
  } catch (error) {
    console.error('Unable to load conversation link picker records:', error);
    return [];
  }
};

const safeGetDoc = async (docRef) => {
  try {
    const snapshot = await getDoc(docRef);
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    console.error('Unable to load conversation link picker record:', error);
    return null;
  }
};

const dedupeRecords = (records = []) => {
  const map = new Map();
  records.forEach((record) => {
    if (record?.id) map.set(`${record.collectionPath || record.sourceCollection || ''}:${record.id}`, record);
  });
  return Array.from(map.values());
};

const sortFreshestRecords = (records = []) => (
  [...records].sort((left, right) => {
    const rightSource = right.raw || right;
    const leftSource = left.raw || left;
    const rightMillis = getTimestampMillis(rightSource.updatedAt || rightSource.createdAt || rightSource.date || rightSource.serviceDate || rightSource.sentAt || rightSource.dueDate);
    const leftMillis = getTimestampMillis(leftSource.updatedAt || leftSource.createdAt || leftSource.date || leftSource.serviceDate || leftSource.sentAt || leftSource.dueDate);
    return rightMillis - leftMillis;
  })
);

const buildAddressLine = (address = {}) => (
  [
    address.streetAddress || address.address1,
    address.city,
    address.state,
    address.zip || address.zipCode,
  ].filter(Boolean).join(', ')
);

const recordTitle = (type, record = {}) => {
  if (record.title) return record.title;

  switch (type) {
    case CONVERSATION_LINK_TYPES.equipment:
      return record.name || [record.make, record.model].filter(Boolean).join(' ') || record.type || record.category || 'Equipment';
    case CONVERSATION_LINK_TYPES.serviceLocation:
      return record.nickName || record.name || buildAddressLine(record.address) || 'Service Location';
    case CONVERSATION_LINK_TYPES.repairRequest:
      return record.description || record.notes || 'Repair Request';
    case CONVERSATION_LINK_TYPES.serviceRequest:
      return record.serviceDescription || record.description || record.companyName || 'Service Request';
    case CONVERSATION_LINK_TYPES.serviceStop:
      return record.type || record.serviceStopType || record.customerName || 'Service Stop';
    case CONVERSATION_LINK_TYPES.recurringServiceStop:
      return record.type || record.serviceStopType || record.customerName || 'Recurring Service Stop';
    case CONVERSATION_LINK_TYPES.estimate:
      return record.title || record.estimateTitle || (record.jobId ? 'Job Estimate' : 'Estimate');
    case CONVERSATION_LINK_TYPES.serviceAgreement:
      return record.title || 'Service Agreement';
    case CONVERSATION_LINK_TYPES.invoice:
      return record.invoiceNumber ? `Invoice ${record.invoiceNumber}` : record.title || 'Invoice';
    case CONVERSATION_LINK_TYPES.job:
      return record.title || record.name || record.description || 'Job';
    case CONVERSATION_LINK_TYPES.customer:
      return record.customerName || [record.firstName, record.lastName].filter(Boolean).join(' ') || record.name || 'Customer';
    default:
      return record.name || record.title || 'Linked Item';
  }
};

const recordSubtitle = (type, record = {}) => {
  const date = formatShortDate(record.updatedAt || record.createdAt || record.date || record.serviceDate || record.sentAt || record.dueDate);

  switch (type) {
    case CONVERSATION_LINK_TYPES.equipment:
      return [
        [record.make, record.model].filter(Boolean).join(' '),
        record.status,
        record.customerName,
      ].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.serviceLocation:
      return buildAddressLine(record.address) || record.customerName || '';
    case CONVERSATION_LINK_TYPES.repairRequest:
    case CONVERSATION_LINK_TYPES.serviceRequest:
      return [record.status, record.customerName || record.requesterName || record.companyName, date].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.serviceStop:
      return [record.customerName, record.tech || record.technicianName, formatShortDate(record.serviceDate || record.date)].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.recurringServiceStop:
      return [record.customerName, record.day, record.frequency || record.serviceCadence].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.estimate:
    case CONVERSATION_LINK_TYPES.serviceAgreement:
      return [
        record.customerName,
        record.status,
        formatMoney(record.totalAmountCents || record.rateAmountCents || record.amountCents),
      ].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.invoice:
      return [
        record.customerName,
        record.status,
        formatMoney(record.amountDueCents ?? record.totalAmountCents ?? record.totalCents),
        date,
      ].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.job:
      return [record.customerName, record.operationStatus || record.status, date].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.customer:
      return [record.email || record.customerEmail, record.phoneNumber || record.phone].filter(Boolean).join(' - ');
    default:
      return [record.status, date].filter(Boolean).join(' - ');
  }
};

const buildPickerItem = ({ type, record, audience, companyId = '', collectionPath = '', webPath = '' }) => {
  const title = recordTitle(type, record);
  const subtitle = recordSubtitle(type, record);

  return {
    id: record.id,
    type,
    recordId: record.id,
    title,
    subtitle,
    companyId: record.companyId || companyId || '',
    customerId: record.customerId || record.relationshipCustomerId || record.customerCompanyRelationshipId || '',
    customerUserId: record.customerUserId || record.homeownerId || record.userId || '',
    collectionPath,
    webPath: webPath || getConversationLinkRoute({ type, recordId: record.id }, audience),
    searchText: [
      title,
      subtitle,
      record.id,
      record.customerName,
      record.email,
      record.status,
      record.description,
      record.name,
      record.invoiceNumber,
    ].filter(Boolean).join(' ').toLowerCase(),
    raw: record,
  };
};

export const getMessageLinks = (message = {}) => {
  const linksByKey = new Map();
  const addLink = (item) => {
    if (!item?.type && !item?.linkType && !item?.recordId && !item?.id) return;

    const normalizedLink = normalizeConversationLink(item);
    const key = normalizedLink.recordId
      ? `${normalizedLink.type}:${normalizedLink.recordId}`
      : [normalizedLink.type, normalizedLink.collectionPath, normalizedLink.id].filter(Boolean).join(':');

    linksByKey.set(key, normalizedLink);
  };

  if (message.conversationLink) addLink(message.conversationLink);
  if (Array.isArray(message.attachments)) {
    message.attachments.forEach(addLink);
  }

  return Array.from(linksByKey.values());
};

export const getChatPreview = (chat = {}) => {
  if (chat.lastConversationLink) {
    const link = normalizeConversationLink(chat.lastConversationLink);
    return `Shared ${getConversationLinkLabel(link.type)}: ${link.title}`;
  }

  return chat.lastMessage || 'No messages yet';
};

export const getConversationLinkRoute = (link = {}, audience = 'company') => {
  const normalizedLink = normalizeConversationLink(link);
  const id = encodeURIComponent(normalizedLink.recordId || '');

  const explicitAudiencePath = audience === 'client'
    ? normalizedLink.clientWebPath
    : normalizedLink.companyWebPath;
  if (explicitAudiencePath) return explicitAudiencePath;

  if (normalizedLink.webPath) {
    const path = normalizedLink.webPath;
    const isCompanyPath = path.startsWith('/company') || path.startsWith('/Company') || path.includes('/company/');
    const isClientPath = path.startsWith('/client') || path.startsWith('/customer') || path.includes('/client/') || path.includes('/customer/');

    if (audience === 'company' && !isClientPath) return path;
    if (audience === 'client' && !isCompanyPath) return path;
  }

  if (!id) return '';

  const companyRoutes = {
    [CONVERSATION_LINK_TYPES.serviceRequest]: `/company/leads/${id}`,
    [CONVERSATION_LINK_TYPES.repairRequest]: `/company/repair-requests/detail/${id}`,
    [CONVERSATION_LINK_TYPES.serviceStop]: `/company/serviceStops/detail/${id}`,
    [CONVERSATION_LINK_TYPES.recurringServiceStop]: `/company/recurringServiceStop/details/${id}`,
    [CONVERSATION_LINK_TYPES.estimate]: `/company/leads/${id}`,
    [CONVERSATION_LINK_TYPES.serviceAgreement]: `/company/sales/agreements/${id}`,
    [CONVERSATION_LINK_TYPES.invoice]: `/company/sales/invoices/${id}`,
    [CONVERSATION_LINK_TYPES.job]: `/company/jobs/detail/${id}`,
    [CONVERSATION_LINK_TYPES.customer]: `/company/customers/details/${id}`,
    [CONVERSATION_LINK_TYPES.serviceLocation]: `/company/serviceLocations/detail/${id}`,
    [CONVERSATION_LINK_TYPES.equipment]: `/company/equipment/detail/${id}`,
  };

  const clientRoutes = {
    [CONVERSATION_LINK_TYPES.serviceRequest]: `/client/service-requests/${id}`,
    [CONVERSATION_LINK_TYPES.repairRequest]: `/client/repair-requests/${id}`,
    [CONVERSATION_LINK_TYPES.serviceStop]: `/serviceStop/detail/${id}`,
    [CONVERSATION_LINK_TYPES.serviceAgreement]: `/client/service-agreements/${id}`,
    [CONVERSATION_LINK_TYPES.invoice]: `/client/billing/invoices/${id}`,
    [CONVERSATION_LINK_TYPES.equipment]: `/client/equipment/${id}`,
    [CONVERSATION_LINK_TYPES.serviceLocation]: '/client/my-pool',
    [CONVERSATION_LINK_TYPES.estimate]: `/client/service-agreements/${id}`,
  };

  return audience === 'client' ? (clientRoutes[normalizedLink.type] || '') : (companyRoutes[normalizedLink.type] || '');
};

const loadClientConversationLinkRecords = async ({ db, type, user, chat = {} }) => {
  if (!db || !user?.uid) return [];

  const uid = user.uid;
  const email = user.email || '';
  const chatCompanyId = chat.companyId || chat.receiverCompanyId || '';

  if (type === CONVERSATION_LINK_TYPES.equipment) {
    const records = await safeGetDocs(query(collection(db, 'homeownerEquipment'), where('userId', '==', uid)));
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'client',
      collectionPath: 'homeownerEquipment',
      webPath: `/client/equipment/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceLocation) {
    const records = await safeGetDocs(query(collection(db, 'homeownerServiceLocations'), where('userId', '==', uid)));
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'client',
      collectionPath: 'homeownerServiceLocations',
      webPath: '/client/my-pool',
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.repairRequest) {
    const records = await safeGetDocs(query(collection(db, 'homeownerRepairRequests'), where('userId', '==', uid)));
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'client',
      collectionPath: 'homeownerRepairRequests',
      webPath: `/client/repair-requests/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceRequest) {
    const records = await safeGetDocs(query(collection(db, 'homeownerServiceRequests'), where('homeownerId', '==', uid)));
    return records
      .filter((record) => !chatCompanyId || record.companyId === chatCompanyId)
      .map((record) => buildPickerItem({
        type,
        record,
        audience: 'client',
        collectionPath: 'homeownerServiceRequests',
        webPath: `/client/service-requests/${record.id}`,
      }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceAgreement) {
    const snapshots = await Promise.all([
      safeGetDocs(query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', uid))),
      email ? safeGetDocs(query(collection(db, salesCollectionNames.agreements), where('email', '==', email))) : Promise.resolve([]),
    ]);
    return dedupeRecords(snapshots.flat())
      .map((record) => buildPickerItem({
        type,
        record,
        audience: 'client',
        collectionPath: salesCollectionNames.agreements,
        webPath: `/client/service-agreements/${record.id}`,
      }));
  }

  if (type === CONVERSATION_LINK_TYPES.invoice) {
    const snapshots = await Promise.all([
      safeGetDocs(query(collection(db, salesCollectionNames.invoices), where('customerUserId', '==', uid))),
      email ? safeGetDocs(query(collection(db, salesCollectionNames.invoices), where('email', '==', email))) : Promise.resolve([]),
    ]);
    return dedupeRecords(snapshots.flat())
      .map((record) => buildPickerItem({
        type,
        record,
        audience: 'client',
        collectionPath: salesCollectionNames.invoices,
        webPath: `/client/billing/invoices/${record.id}`,
      }));
  }

  return [];
};

const loadCompanySubcollectionRecords = async ({ db, companyId, collectionName, context }) => {
  if (!db || !companyId) return [];

  if (context.customerId) {
    return safeGetDocs(query(
      collection(db, 'companies', companyId, collectionName),
      where('customerId', '==', context.customerId)
    ));
  }

  const records = await safeGetDocs(collection(db, 'companies', companyId, collectionName));
  return records.filter((record) => recordMatchesCustomerContext(record, context));
};

const loadCompanyRootRecords = async ({ db, collectionName, companyId, context }) => {
  if (!db || !companyId) return [];

  const records = await safeGetDocs(query(collection(db, collectionName), where('companyId', '==', companyId)));
  return records.filter((record) => recordMatchesCustomerContext(record, context));
};

const loadCompanyCustomerRecord = async ({ db, companyId, context }) => {
  if (!db || !companyId || !context.customerId) return [];

  const record = await safeGetDoc(doc(db, 'companies', companyId, 'customers', context.customerId));
  return record ? [record] : [];
};

const loadCompanyConversationLinkRecords = async ({ db, type, chat, companyId }) => {
  if (!db || !companyId) return [];

  const context = getChatCustomerContext(chat);
  const hasCustomerContext = Boolean(context.customerId || context.customerUserId || context.customerEmail);

  if (!hasCustomerContext && type !== CONVERSATION_LINK_TYPES.customer) return [];

  if (type === CONVERSATION_LINK_TYPES.customer) {
    const records = await loadCompanyCustomerRecord({ db, companyId, context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/customers`,
      webPath: `/company/customers/details/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.equipment) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'equipment', context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/equipment`,
      webPath: `/company/equipment/detail/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceLocation) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'serviceLocations', context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/serviceLocations`,
      webPath: `/company/serviceLocations/detail/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceStop) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'serviceStops', context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/serviceStops`,
      webPath: `/company/serviceStops/detail/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.recurringServiceStop) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'recurringServiceStop', context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/recurringServiceStop`,
      webPath: `/company/recurringServiceStop/details/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.job) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'workOrders', context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/workOrders`,
      webPath: `/company/jobs/detail/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.repairRequest) {
    const [internal, external] = await Promise.all([
      loadCompanySubcollectionRecords({ db, companyId, collectionName: 'repairRequests', context }),
      loadCompanyRootRecords({ db, collectionName: 'homeownerRepairRequests', companyId, context }),
    ]);

    return [
      ...internal.map((record) => ({ ...record, source: 'internal' })),
      ...external.map((record) => ({ ...record, source: 'homeowner' })),
    ].map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: record.source === 'internal' ? `companies/${companyId}/repairRequests` : 'homeownerRepairRequests',
      webPath: `/company/repair-requests/detail/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceRequest) {
    const records = await loadCompanyRootRecords({ db, collectionName: 'homeownerServiceRequests', companyId, context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: 'homeownerServiceRequests',
      webPath: `/company/leads/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.serviceAgreement || type === CONVERSATION_LINK_TYPES.estimate) {
    const records = await loadCompanyRootRecords({ db, collectionName: salesCollectionNames.agreements, companyId, context });
    const filteredRecords = type === CONVERSATION_LINK_TYPES.estimate
      ? records.filter((record) => {
        const sourceType = String(record.sourceType || '').toLowerCase();
        const title = String(record.title || '').toLowerCase();
        return sourceType.includes('job') || title.includes('estimate') || record.jobId || record.leadId;
      })
      : records;

    return filteredRecords.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: salesCollectionNames.agreements,
      webPath: `/company/sales/agreements/${record.id}`,
    }));
  }

  if (type === CONVERSATION_LINK_TYPES.invoice) {
    const records = await loadCompanyRootRecords({ db, collectionName: salesCollectionNames.invoices, companyId, context });
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'company',
      companyId,
      collectionPath: salesCollectionNames.invoices,
      webPath: `/company/sales/invoices/${record.id}`,
    }));
  }

  return [];
};

export const fetchConversationLinkPickerItems = async ({
  db,
  type,
  audience = 'company',
  chat = {},
  user = null,
  companyId = '',
}) => {
  const records = audience === 'client'
    ? await loadClientConversationLinkRecords({ db, type, user, chat })
    : await loadCompanyConversationLinkRecords({ db, type, chat, companyId });

  return sortFreshestRecords(dedupeRecords(records)).slice(0, 100);
};

export const isOutgoingMessage = (message = {}, { userId, companyId = '' } = {}) => (
  Boolean(
    message.senderId === userId
    || (companyId && message.senderCompanyId === companyId)
  )
);

const docsFromSnapshot = (snapshot) => (
  snapshot.docs.map((chatDoc) => ({ id: chatDoc.id, ...chatDoc.data() }))
);

export const listenVisibleChats = ({ db, userId, companyId = '', onChange, onError = noop }) => {
  if (!db || !userId) return noop;

  const buckets = new Map();
  const unsubscribers = [];

  const emit = () => {
    const merged = new Map();

    buckets.forEach((items) => {
      items.forEach((item) => {
        if (isChatVisibleTo(item, userId, companyId)) merged.set(item.id, item);
      });
    });

    onChange(sortChatsNewest(Array.from(merged.values())));
  };

  const chatsRef = collection(db, 'chats');
  const directQuery = query(chatsRef, where('participantIds', 'array-contains', userId));

  unsubscribers.push(onSnapshot(
    directQuery,
    (snapshot) => {
      buckets.set('direct', docsFromSnapshot(snapshot));
      emit();
    },
    (error) => {
      console.error('Error listening to direct chats:', error);
      buckets.set('direct', []);
      onError(error);
      emit();
    },
  ));

  if (companyId) {
    const companyOwnerQuery = query(chatsRef, where('companyId', '==', companyId));
    const companyReceiverQuery = query(chatsRef, where('receiverCompanyId', '==', companyId));

    unsubscribers.push(onSnapshot(
      companyOwnerQuery,
      (snapshot) => {
        buckets.set('company-owned', docsFromSnapshot(snapshot));
        emit();
      },
      (error) => {
        console.error('Error listening to company-owned chats:', error);
        buckets.set('company-owned', []);
        onError(error);
        emit();
      },
    ));

    unsubscribers.push(onSnapshot(
      companyReceiverQuery,
      (snapshot) => {
        buckets.set('company-received', docsFromSnapshot(snapshot));
        emit();
      },
      (error) => {
        console.error('Error listening to company-received chats:', error);
        buckets.set('company-received', []);
        onError(error);
        emit();
      },
    ));
  }

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
};

export const markChatAsRead = async ({ db, chatId, chat, userId, companyId = '' }) => {
  if (!db || !chatId || !userId) return;

  const nextUnreadUsers = (Array.isArray(chat?.userWhoHaveNotRead) ? chat.userWhoHaveNotRead : [])
    .filter((id) => id !== userId);
  const nextReadBy = uniqueStrings([...(Array.isArray(chat?.readByUserIds) ? chat.readByUserIds : []), userId]);
  const updatePayload = {
    userWhoHaveNotRead: nextUnreadUsers,
    readByUserIds: nextReadBy,
    updatedAt: serverTimestamp(),
  };

  if (!companyId) {
    updatePayload.companyIdsWhoHaveNotRead = Array.isArray(chat?.companyIdsWhoHaveNotRead)
      ? chat.companyIdsWhoHaveNotRead
      : [];
  }

  await updateDoc(doc(db, 'chats', chatId), updatePayload);
};

const getUnreadTargets = ({ chat = {}, senderId, senderCompanyId = '' }) => {
  const participants = Array.isArray(chat.participants) ? chat.participants.map(normalizeParticipant) : [];
  const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));
  const participantIds = Array.isArray(chat.participantIds) ? chat.participantIds : [];
  const participantCompanyIds = Array.isArray(chat.participantCompanyIds) ? chat.participantCompanyIds : [];

  const userTargets = participantIds.filter((participantId) => {
    if (!participantId || participantId === senderId) return false;
    if (!senderCompanyId) return true;

    const participant = participantByUserId.get(participantId);
    return participant?.companyId !== senderCompanyId;
  });

  const companyTargets = senderCompanyId
    ? participantCompanyIds.filter((companyId) => companyId && companyId !== senderCompanyId)
    : participantCompanyIds;

  return {
    userTargets: uniqueStrings(userTargets),
    companyTargets: uniqueStrings(companyTargets),
  };
};

export const sendChatMessage = async ({
  db,
  chatId,
  chat,
  text = '',
  link = null,
  senderId,
  senderName,
  senderCompanyId = '',
  senderCompanyName = '',
}) => {
  const messageText = cleanString(text);
  const normalizedLink = link ? normalizeConversationLink(link) : null;

  if (!db || !chatId || !senderId || (!messageText && !normalizedLink)) return null;

  let chatData = chat;
  if (!chatData) {
    const chatSnap = await getDoc(doc(db, 'chats', chatId));
    if (!chatSnap.exists()) throw new Error('Chat not found.');
    chatData = { id: chatSnap.id, ...chatSnap.data() };
  }

  const messageId = `msg_${uuidv4()}`;
  const messageRef = doc(db, 'messages', messageId);
  const kind = normalizedLink ? CHAT_MESSAGE_KIND.linkedRecord : CHAT_MESSAGE_KIND.text;
  const preview = normalizedLink
    ? `Shared ${getConversationLinkLabel(normalizedLink.type)}: ${normalizedLink.title}`
    : messageText;
  const { userTargets, companyTargets } = getUnreadTargets({
    chat: chatData,
    senderId,
    senderCompanyId,
  });

  await setDoc(messageRef, {
    id: messageId,
    chatId,
    message: messageText,
    kind,
    attachments: normalizedLink ? [normalizedLink] : [],
    conversationLink: normalizedLink,
    actionTitle: normalizedLink ? 'Open' : '',
    senderId,
    senderName: senderName || 'User',
    senderCompanyId,
    senderCompanyName,
    receiverId: userTargets[0] || '',
    receiverCompanyId: companyTargets[0] || '',
    read: false,
    dateSent: serverTimestamp(),
  });

  await updateDoc(doc(db, 'chats', chatId), {
    lastMessage: preview,
    lastMessageKind: kind,
    lastConversationLink: normalizedLink,
    mostRecentChat: serverTimestamp(),
    userWhoHaveNotRead: userTargets,
    companyIdsWhoHaveNotRead: companyTargets,
    readByUserIds: [senderId],
    updatedAt: serverTimestamp(),
  });

  return messageId;
};

export const createClientCompanyChat = async ({ db, user, dataBaseUser, company, message }) => {
  const messageText = cleanString(message);
  if (!db || !user?.uid || !company?.id || !messageText) return null;

  const chatId = `cha_${uuidv4()}`;
  const messageId = `msg_${uuidv4()}`;
  const chatRef = doc(db, 'chats', chatId);
  const messageRef = doc(db, 'messages', messageId);
  const homeownerName = getUserDisplayName(dataBaseUser, user);
  const ownerParticipant = companyParticipantFromCompany(company);
  const participantIds = uniqueStrings([user.uid, ownerParticipant.userId]);

  const chatData = {
    id: chatId,
    title: `${homeownerName} / ${company.name || 'Company'}`,
    visibility: CHAT_VISIBILITY.customer,
    companyId: company.id,
    companyName: company.name || '',
    receiverCompanyId: company.id,
    participantIds,
    participantCompanyIds: uniqueStrings([company.id]),
    participants: [
      userParticipantFromContext({ user, dataBaseUser }),
      ownerParticipant,
    ],
    customerUserId: user.uid,
    customerName: homeownerName,
    createdByUserId: user.uid,
    createdByCompanyId: '',
    userWhoHaveNotRead: ownerParticipant.userId ? [ownerParticipant.userId] : [],
    companyIdsWhoHaveNotRead: [company.id],
    readByUserIds: [user.uid],
    lastMessage: messageText,
    lastMessageKind: CHAT_MESSAGE_KIND.text,
    lastConversationLink: null,
    mostRecentChat: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(chatRef, chatData);
  batch.set(messageRef, {
    id: messageId,
    chatId,
    message: messageText,
    kind: CHAT_MESSAGE_KIND.text,
    attachments: [],
    conversationLink: null,
    actionTitle: '',
    senderId: user.uid,
    senderName: homeownerName,
    senderCompanyId: '',
    senderCompanyName: '',
    receiverId: ownerParticipant.userId || '',
    receiverCompanyId: company.id,
    read: false,
    dateSent: serverTimestamp(),
  });

  await batch.commit();
  return chatId;
};

export const createCompanyChat = async ({
  db,
  user,
  dataBaseUser,
  selectedCompanyId,
  selectedCompanyName,
  participant,
  message,
}) => {
  const messageText = cleanString(message);
  if (!db || !user?.uid || !selectedCompanyId || !participant?.id || !messageText) return null;

  const chatId = `chat_${uuidv4()}`;
  const messageId = `msg_${uuidv4()}`;
  const targetCompanyId = participant.type === 'company'
    ? (participant.companyId || participant.id)
    : '';
  const targetUserId = participant.ownerId || participant.userId || participant.customerUserId || participant.id;
  const participantIds = uniqueStrings([user.uid, targetUserId]);
  const participantCompanyIds = uniqueStrings([selectedCompanyId, targetCompanyId]);
  const senderName = getUserDisplayName(dataBaseUser, user);
  const senderParticipant = userParticipantFromContext({
    user,
    dataBaseUser,
    companyId: selectedCompanyId,
    companyName: selectedCompanyName,
  });
  const targetParticipant = normalizeParticipant({
    id: `par_${uuidv4()}`,
    userId: targetUserId,
    userName: participant.name || participant.userName,
    userImage: participant.image || participant.userImage || participant.photoUrl || participant.profileImageUrl || '',
    userEmail: participant.email || participant.userEmail || '',
    accountType: participant.type === 'company' ? 'Company' : participant.accountType || 'Client',
    companyId: targetCompanyId,
    companyName: participant.companyName || (participant.type === 'company' ? participant.name : ''),
    isCompany: participant.type === 'company',
  });

  const chatData = {
    id: chatId,
    title: `${participant.name || targetParticipant.userName} / ${selectedCompanyName || 'Company'}`,
    visibility: targetCompanyId ? CHAT_VISIBILITY.companyToCompany : CHAT_VISIBILITY.company,
    companyId: selectedCompanyId,
    companyName: selectedCompanyName || '',
    senderCompanyId: selectedCompanyId,
    receiverCompanyId: targetCompanyId,
    participantIds,
    participantCompanyIds,
    participants: [senderParticipant, targetParticipant],
    customerId: participant.customerId || (participant.type === 'customer' ? participant.id : ''),
    customerUserId: targetCompanyId ? '' : targetUserId,
    customerName: targetCompanyId ? '' : (participant.customerName || targetParticipant.userName),
    createdByUserId: user.uid,
    createdByCompanyId: selectedCompanyId,
    userWhoHaveNotRead: targetUserId ? [targetUserId] : [],
    companyIdsWhoHaveNotRead: targetCompanyId ? [targetCompanyId] : [],
    readByUserIds: [user.uid],
    lastMessage: messageText,
    lastMessageKind: CHAT_MESSAGE_KIND.text,
    lastConversationLink: null,
    mostRecentChat: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'chats', chatId), chatData);
  batch.set(doc(db, 'messages', messageId), {
    id: messageId,
    chatId,
    message: messageText,
    kind: CHAT_MESSAGE_KIND.text,
    attachments: [],
    conversationLink: null,
    actionTitle: '',
    senderId: user.uid,
    senderName,
    senderCompanyId: selectedCompanyId,
    senderCompanyName: selectedCompanyName || '',
    receiverId: targetUserId || '',
    receiverCompanyId: targetCompanyId || '',
    read: false,
    dateSent: serverTimestamp(),
  });

  await batch.commit();
  return chatId;
};

export const findVisibleChatWithParticipant = async ({
  db,
  currentUserId,
  selectedCompanyId = '',
  participantId,
  participantCompanyId = '',
}) => {
  if (!db || !currentUserId || !participantId) return null;

  const chatsRef = collection(db, 'chats');
  const snapshots = selectedCompanyId
    ? await Promise.all([
      getDocs(query(chatsRef, where('companyId', '==', selectedCompanyId))),
      getDocs(query(chatsRef, where('receiverCompanyId', '==', selectedCompanyId))),
    ])
    : [await getDocs(query(chatsRef, where('participantIds', 'array-contains', currentUserId)))];
  const docs = snapshots.flatMap((snapshot) => snapshot.docs);

  const match = docs
    .map((chatDoc) => ({ id: chatDoc.id, ...chatDoc.data() }))
    .find((chat) => {
      const visible = isChatVisibleTo(chat, currentUserId, selectedCompanyId);
      const hasUser = Array.isArray(chat.participantIds) && chat.participantIds.includes(participantId);
      const hasCompany = participantCompanyId
        && Array.isArray(chat.participantCompanyIds)
        && chat.participantCompanyIds.includes(participantCompanyId);

      return visible && (hasUser || hasCompany);
    });

  return match || null;
};
