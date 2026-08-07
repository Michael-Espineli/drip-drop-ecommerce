import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { salesCollectionNames } from './models/Sales';
import { isFirebaseNetworkError } from './firebaseNetwork';
import { sortCompanyUsersByName } from './companyUsers';

export const CHAT_VISIBILITY = {
  direct: 'direct',
  company: 'company',
  customer: 'customer',
  companyToCompany: 'companyToCompany',
  companyInternal: 'companyInternal',
  companyExternal: 'companyExternal',
};

export const CHAT_AUDIENCE = {
  internal: 'internal',
  external: 'external',
};

export const CHAT_TARGET_TYPE = {
  companyUser: 'companyUser',
  customer: 'customer',
  company: 'company',
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
  bodyOfWater: 'bodyOfWater',
  equipment: 'equipment',
  purchase: 'purchase',
  shoppingListItem: 'shoppingListItem',
  databaseItem: 'databaseItem',
  receipt: 'receipt',
  vendor: 'vendor',
  companyUser: 'companyUser',
  todo: 'todo',
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
  { value: CONVERSATION_LINK_TYPES.bodyOfWater, label: 'Body of Water' },
  { value: CONVERSATION_LINK_TYPES.equipment, label: 'Equipment' },
  { value: CONVERSATION_LINK_TYPES.purchase, label: 'Purchase' },
  { value: CONVERSATION_LINK_TYPES.receipt, label: 'Receipt' },
  { value: CONVERSATION_LINK_TYPES.shoppingListItem, label: 'Shopping Item' },
  { value: CONVERSATION_LINK_TYPES.databaseItem, label: 'Database Item' },
  { value: CONVERSATION_LINK_TYPES.vendor, label: 'Vendor' },
  { value: CONVERSATION_LINK_TYPES.companyUser, label: 'Company User' },
  { value: CONVERSATION_LINK_TYPES.todo, label: 'Todo' },
];

export const CLIENT_CONVERSATION_LINK_OPTIONS = [
  { value: CONVERSATION_LINK_TYPES.serviceRequest, label: 'Service Request' },
  { value: CONVERSATION_LINK_TYPES.repairRequest, label: 'Repair Request' },
  { value: CONVERSATION_LINK_TYPES.serviceAgreement, label: 'Service Agreement' },
  { value: CONVERSATION_LINK_TYPES.invoice, label: 'Invoice' },
  { value: CONVERSATION_LINK_TYPES.equipment, label: 'Equipment' },
  { value: CONVERSATION_LINK_TYPES.serviceLocation, label: 'Service Location' },
  { value: CONVERSATION_LINK_TYPES.bodyOfWater, label: 'Body of Water' },
];

const noop = () => {};

const cleanString = (value) => String(value || '').trim();

const normalizeLinkType = (value) => {
  const aliases = {
    purchasedItem: CONVERSATION_LINK_TYPES.purchase,
    purchasedItems: CONVERSATION_LINK_TYPES.purchase,
    purchaseItem: CONVERSATION_LINK_TYPES.purchase,
    dataBaseItem: CONVERSATION_LINK_TYPES.databaseItem,
    databaseItems: CONVERSATION_LINK_TYPES.databaseItem,
    dbItem: CONVERSATION_LINK_TYPES.databaseItem,
    shoppingItem: CONVERSATION_LINK_TYPES.shoppingListItem,
    shoppingList: CONVERSATION_LINK_TYPES.shoppingListItem,
    bodyOfWaterDetail: CONVERSATION_LINK_TYPES.bodyOfWater,
    company_user: CONVERSATION_LINK_TYPES.companyUser,
  };
  const type = cleanString(value);

  return aliases[type] || type || CONVERSATION_LINK_TYPES.serviceRequest;
};

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

export const getChatAudience = (chat = {}) => {
  const explicitAudience = cleanString(chat.audience || chat.chatAudience).toLowerCase();
  if (explicitAudience === CHAT_AUDIENCE.internal) return CHAT_AUDIENCE.internal;
  if (explicitAudience === CHAT_AUDIENCE.external || explicitAudience === 'customer' || explicitAudience === 'client') {
    return CHAT_AUDIENCE.external;
  }

  const targetType = cleanString(chat.targetType || chat.participantType).toLowerCase();
  if (targetType === 'companyuser' || targetType === 'company_user' || targetType === 'team' || targetType === 'employee') {
    return CHAT_AUDIENCE.internal;
  }

  if (chat.visibility === CHAT_VISIBILITY.companyInternal) return CHAT_AUDIENCE.internal;
  if (
    chat.visibility === CHAT_VISIBILITY.customer
    || chat.visibility === CHAT_VISIBILITY.companyExternal
    || chat.visibility === CHAT_VISIBILITY.companyToCompany
    || targetType === 'customer'
    || targetType === 'company'
    || chat.customerId
    || chat.customerUserId
  ) {
    return CHAT_AUDIENCE.external;
  }

  return CHAT_AUDIENCE.external;
};

export const getChatAudienceLabel = (chat = {}) => {
  if (getChatAudience(chat) === CHAT_AUDIENCE.internal) return 'Internal';
  if (chat.visibility === CHAT_VISIBILITY.companyToCompany || chat.targetType === CHAT_TARGET_TYPE.company) return 'External';
  return 'Customer';
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
  const normalizedType = normalizeLinkType(type);
  const option = [...COMPANY_CONVERSATION_LINK_OPTIONS, ...CLIENT_CONVERSATION_LINK_OPTIONS]
    .find((candidate) => candidate.value === normalizedType);

  return option?.label || 'Linked Item';
};

export const getConversationLinkMobileRoute = (type) => {
  const routes = {
    [CONVERSATION_LINK_TYPES.customer]: 'customer',
    [CONVERSATION_LINK_TYPES.serviceLocation]: 'customers',
    [CONVERSATION_LINK_TYPES.bodyOfWater]: 'customers',
    [CONVERSATION_LINK_TYPES.equipment]: 'equipmentDetailView',
    [CONVERSATION_LINK_TYPES.serviceStop]: 'serviceStop',
    [CONVERSATION_LINK_TYPES.repairRequest]: 'repairRequest',
    [CONVERSATION_LINK_TYPES.serviceRequest]: 'serviceRequest',
    [CONVERSATION_LINK_TYPES.estimate]: 'serviceAgreementDetail',
    [CONVERSATION_LINK_TYPES.serviceAgreement]: 'serviceAgreementDetail',
    [CONVERSATION_LINK_TYPES.invoice]: 'accountsReceivableDetail',
    [CONVERSATION_LINK_TYPES.job]: 'job',
    [CONVERSATION_LINK_TYPES.purchase]: 'purchase',
    [CONVERSATION_LINK_TYPES.receipt]: 'receipt',
    [CONVERSATION_LINK_TYPES.shoppingListItem]: 'shoppingListDetail',
    [CONVERSATION_LINK_TYPES.databaseItem]: 'dataBaseItem',
    [CONVERSATION_LINK_TYPES.vendor]: 'vender',
    [CONVERSATION_LINK_TYPES.companyUser]: 'companyUserDetailView',
    [CONVERSATION_LINK_TYPES.todo]: 'toDoList',
  };

  return routes[normalizeLinkType(type)] || '';
};

export const normalizeConversationLink = (link = {}) => {
  const type = normalizeLinkType(link.type || link.linkType || link.relatedEntity?.type || CONVERSATION_LINK_TYPES.serviceRequest);
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
    mobileRoute: link.mobileRoute || getConversationLinkMobileRoute(type),
    deeplinkUrl: link.deeplinkUrl || link.deepLinkUrl || '',
    sharePath: link.sharePath || '',
    shareUrl: link.shareUrl || '',
    audience: link.audience || '',
    createdAt: link.createdAt || null,
  };
};

const sharedRecordParams = (link = {}, options = {}) => {
  const normalizedLink = normalizeConversationLink(link);
  const params = new URLSearchParams();
  const recordId = normalizedLink.recordId || options.recordId || '';

  params.set('type', normalizedLink.type);
  params.set('id', recordId);

  const companyId = options.companyId || normalizedLink.companyId || '';
  const customerId = options.customerId || normalizedLink.customerId || '';
  const customerUserId = options.customerUserId || normalizedLink.customerUserId || '';
  const audience = options.audience || normalizedLink.audience || '';
  const chatId = options.chatId || '';

  if (companyId) params.set('companyId', companyId);
  if (customerId) params.set('customerId', customerId);
  if (customerUserId) params.set('customerUserId', customerUserId);
  if (audience) params.set('audience', audience);
  if (chatId) params.set('chatId', chatId);

  return params;
};

export const buildSharedRecordPath = (link = {}, options = {}) => (
  `/share?${sharedRecordParams(link, options).toString()}`
);

export const buildSharedRecordUrl = (link = {}, options = {}) => {
  const path = buildSharedRecordPath(link, options);
  const origin = options.origin
    || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');

  return origin ? `${origin}${path}` : path;
};

export const buildAppDeepLink = (link = {}, options = {}) => (
  `dripdrop://share?${sharedRecordParams(link, options).toString()}`
);

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
    if (isFirebaseNetworkError(error)) {
      try {
        const cacheSnapshot = await getDocsFromCache(queryRef);
        return cacheSnapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
      } catch (cacheError) {
        console.warn('Unable to load cached conversation link picker records:', cacheError);
      }
    }

    return [];
  }
};

const safeGetDoc = async (docRef) => {
  try {
    const snapshot = await getDoc(docRef);
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    console.error('Unable to load conversation link picker record:', error);
    if (isFirebaseNetworkError(error)) {
      try {
        const cacheSnapshot = await getDocFromCache(docRef);
        return cacheSnapshot.exists() ? { id: cacheSnapshot.id, ...cacheSnapshot.data() } : null;
      } catch (cacheError) {
        console.warn('Unable to load cached conversation link picker record:', cacheError);
      }
    }

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
    case CONVERSATION_LINK_TYPES.bodyOfWater:
      return record.nickName || record.name || record.type || record.bodyOfWaterType || 'Body of Water';
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
    case CONVERSATION_LINK_TYPES.purchase:
      return record.name || record.itemName || record.description || record.invoiceNum || 'Purchase';
    case CONVERSATION_LINK_TYPES.receipt:
      return record.vendorName || record.venderName || record.storeName || record.invoiceNum || record.name || 'Receipt';
    case CONVERSATION_LINK_TYPES.shoppingListItem:
      return record.name || record.itemName || record.description || record.dataBaseItemName || 'Shopping Item';
    case CONVERSATION_LINK_TYPES.databaseItem:
      return record.name || record.commonName || record.itemName || [record.make, record.model].filter(Boolean).join(' ') || 'Database Item';
    case CONVERSATION_LINK_TYPES.vendor:
      return record.name || record.vendorName || record.venderName || record.companyName || 'Vendor';
    case CONVERSATION_LINK_TYPES.companyUser:
      return record.userName || [record.firstName, record.lastName].filter(Boolean).join(' ') || record.name || record.email || 'Company User';
    case CONVERSATION_LINK_TYPES.todo:
      return record.title || record.name || record.description || 'Todo';
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
    case CONVERSATION_LINK_TYPES.bodyOfWater:
      return [record.customerName, record.serviceLocationName, record.status].filter(Boolean).join(' - ');
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
    case CONVERSATION_LINK_TYPES.purchase:
      return [
        record.customerName,
        record.techName || record.technicianName,
        record.vendorName || record.venderName,
        formatMoney(record.totalCents || record.amountCents || record.priceCents),
        date,
      ].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.receipt:
      return [
        record.vendorName || record.venderName || record.storeName,
        record.invoiceNum || record.receiptNumber,
        formatMoney(record.totalCents || record.amountCents),
        date,
      ].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.shoppingListItem:
      return [record.customerName, record.jobTitle || record.jobName, record.status, date].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.databaseItem:
      return [record.category || record.equipmentType || record.type, record.make, record.model].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.vendor:
      return [record.email, record.phoneNumber || record.phone, buildAddressLine(record.address || record)].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.companyUser:
      return [record.roleName || record.role, record.status, record.email].filter(Boolean).join(' - ');
    case CONVERSATION_LINK_TYPES.todo:
      return [record.status, record.assignedToName, date].filter(Boolean).join(' - ');
    default:
      return [record.status, date].filter(Boolean).join(' - ');
  }
};

const buildPickerItem = ({ type, record, audience, companyId = '', collectionPath = '', webPath = '' }) => {
  const title = recordTitle(type, record);
  const subtitle = recordSubtitle(type, record);
  const normalizedType = normalizeLinkType(type);
  const recordId = cleanString(record.id);
  const resolvedCompanyId = record.companyId || companyId || '';
  const customerId = record.customerId || record.relationshipCustomerId || record.customerCompanyRelationshipId || '';
  const customerUserId = record.customerUserId || record.homeownerId || record.userId || '';
  const resolvedWebPath = webPath || getConversationLinkRoute({ type: normalizedType, recordId }, audience);
  const linkSeed = {
    type: normalizedType,
    recordId,
    companyId: resolvedCompanyId,
    customerId,
    customerUserId,
  };

  return {
    id: recordId,
    type: normalizedType,
    recordId,
    title,
    subtitle,
    companyId: resolvedCompanyId,
    customerId,
    customerUserId,
    collectionPath,
    webPath: resolvedWebPath,
    companyWebPath: audience === 'company' ? resolvedWebPath : '',
    clientWebPath: audience === 'client' ? resolvedWebPath : '',
    mobileRoute: getConversationLinkMobileRoute(normalizedType),
    sharePath: buildSharedRecordPath(linkSeed, { audience, companyId: resolvedCompanyId, customerId, customerUserId }),
    deeplinkUrl: buildAppDeepLink(linkSeed, { audience, companyId: resolvedCompanyId, customerId, customerUserId }),
    searchText: [
      title,
      subtitle,
      recordId,
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
  const routeAudience = audience === 'client' ? 'client' : 'company';

  const explicitAudiencePath = routeAudience === 'client'
    ? normalizedLink.clientWebPath
    : normalizedLink.companyWebPath;
  if (explicitAudiencePath) return explicitAudiencePath;

  if (normalizedLink.webPath) {
    const path = normalizedLink.webPath;
    const isCompanyPath = path.startsWith('/company') || path.startsWith('/Company') || path.includes('/company/');
    const isClientPath = path.startsWith('/client') || path.startsWith('/customer') || path.includes('/client/') || path.includes('/customer/');

    if (routeAudience === 'company' && !isClientPath) return path;
    if (routeAudience === 'client' && !isCompanyPath) return path;
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
    [CONVERSATION_LINK_TYPES.bodyOfWater]: `/company/bodiesOfWater/detail/${id}`,
    [CONVERSATION_LINK_TYPES.equipment]: `/company/equipment/detail/${id}`,
    [CONVERSATION_LINK_TYPES.purchase]: `/company/purchased-items/detail/${id}`,
    [CONVERSATION_LINK_TYPES.receipt]: `/company/receipts/detail/${id}`,
    [CONVERSATION_LINK_TYPES.shoppingListItem]: `/company/shopping-list/detail/${id}`,
    [CONVERSATION_LINK_TYPES.databaseItem]: `/company/items/detail/${id}`,
    [CONVERSATION_LINK_TYPES.vendor]: `/company/vendors/detail/${id}`,
    [CONVERSATION_LINK_TYPES.companyUser]: `/company/companyUsers/${id}/general`,
    [CONVERSATION_LINK_TYPES.todo]: `/company/todo-list?todoId=${id}`,
  };

  const clientRoutes = {
    [CONVERSATION_LINK_TYPES.serviceRequest]: `/client/service-requests/${id}`,
    [CONVERSATION_LINK_TYPES.repairRequest]: `/client/repair-requests/${id}`,
    [CONVERSATION_LINK_TYPES.serviceStop]: `/serviceStop/detail/${id}`,
    [CONVERSATION_LINK_TYPES.serviceAgreement]: `/client/service-agreements/${id}`,
    [CONVERSATION_LINK_TYPES.invoice]: `/client/billing/invoices/${id}`,
    [CONVERSATION_LINK_TYPES.equipment]: `/client/equipment/${id}`,
    [CONVERSATION_LINK_TYPES.serviceLocation]: '/client/my-pool',
    [CONVERSATION_LINK_TYPES.bodyOfWater]: `/client/pools-spas/${id}`,
    [CONVERSATION_LINK_TYPES.estimate]: `/client/service-agreements/${id}`,
  };

  return routeAudience === 'client' ? (clientRoutes[normalizedLink.type] || '') : (companyRoutes[normalizedLink.type] || '');
};

export const buildConversationLinkSharePayload = (link = {}, { chat = {}, audience = 'company', origin = '' } = {}) => {
  const normalizedLink = normalizeConversationLink(link);
  const chatAudience = getChatAudience(chat);
  const routeAudience = audience === 'client' ? 'client' : 'company';
  const notificationAudience = routeAudience === 'client' ? 'client' : chatAudience;
  const companyId = normalizedLink.companyId || chat.companyId || chat.senderCompanyId || chat.receiverCompanyId || '';
  const customerId = normalizedLink.customerId || chat.customerId || '';
  const customerUserId = normalizedLink.customerUserId || chat.customerUserId || '';
  const chatId = chat.id || chat.chatId || '';
  const route = getConversationLinkRoute({
    ...normalizedLink,
    companyId,
    customerId,
    customerUserId,
  }, routeAudience);
  const shareOptions = {
    audience: notificationAudience,
    companyId,
    customerId,
    customerUserId,
    chatId,
    origin,
  };

  return {
    ...normalizedLink,
    companyId,
    customerId,
    customerUserId,
    webPath: normalizedLink.webPath || route,
    companyWebPath: normalizedLink.companyWebPath || (routeAudience === 'company' ? route : ''),
    clientWebPath: normalizedLink.clientWebPath || (routeAudience === 'client' ? route : ''),
    mobileRoute: normalizedLink.mobileRoute || getConversationLinkMobileRoute(normalizedLink.type),
    audience: notificationAudience,
    sharePath: normalizedLink.sharePath || buildSharedRecordPath(normalizedLink, shareOptions),
    shareUrl: normalizedLink.shareUrl || buildSharedRecordUrl(normalizedLink, shareOptions),
    deeplinkUrl: normalizedLink.deeplinkUrl || buildAppDeepLink(normalizedLink, shareOptions),
  };
};

const loadClientConversationLinkRecords = async ({ db, type, user, chat = {} }) => {
  if (!db || !user?.uid) return [];

  const uid = user.uid;
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

  if (type === CONVERSATION_LINK_TYPES.bodyOfWater) {
    const records = await safeGetDocs(query(collection(db, 'homeownerBodiesOfWater'), where('userId', '==', uid)));
    return records.map((record) => buildPickerItem({
      type,
      record,
      audience: 'client',
      collectionPath: 'homeownerBodiesOfWater',
      webPath: `/client/pools-spas/${record.id}`,
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
    const records = await safeGetDocs(query(collection(db, salesCollectionNames.agreements), where('customerUserId', '==', uid)));
    return records
      .map((record) => buildPickerItem({
        type,
        record,
        audience: 'client',
        collectionPath: salesCollectionNames.agreements,
        webPath: `/client/service-agreements/${record.id}`,
      }));
  }

  if (type === CONVERSATION_LINK_TYPES.invoice) {
    const records = await safeGetDocs(query(collection(db, salesCollectionNames.invoices), where('customerUserId', '==', uid)));
    return records
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

  const normalizedType = normalizeLinkType(type);
  const context = getChatCustomerContext(chat);
  const hasCustomerContext = Boolean(context.customerId || context.customerUserId || context.customerEmail);

  if (normalizedType === CONVERSATION_LINK_TYPES.customer) {
    const records = hasCustomerContext
      ? await loadCompanyCustomerRecord({ db, companyId, context })
      : await safeGetDocs(collection(db, 'companies', companyId, 'customers'));

    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/customers`,
      webPath: `/company/customers/details/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.equipment) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'equipment', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/equipment`,
      webPath: `/company/equipment/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.serviceLocation) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'serviceLocations', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/serviceLocations`,
      webPath: `/company/serviceLocations/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.bodyOfWater) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'bodiesOfWater', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/bodiesOfWater`,
      webPath: `/company/bodiesOfWater/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.serviceStop) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'serviceStops', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/serviceStops`,
      webPath: `/company/serviceStops/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.recurringServiceStop) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'recurringServiceStop', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/recurringServiceStop`,
      webPath: `/company/recurringServiceStop/details/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.job) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'workOrders', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/workOrders`,
      webPath: `/company/jobs/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.repairRequest) {
    const [internal, external] = await Promise.all([
      loadCompanySubcollectionRecords({ db, companyId, collectionName: 'repairRequests', context }),
      loadCompanyRootRecords({ db, collectionName: 'homeownerRepairRequests', companyId, context }),
    ]);

    return [
      ...internal.map((record) => ({ ...record, source: 'internal' })),
      ...external.map((record) => ({ ...record, source: 'homeowner' })),
    ].map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: record.source === 'internal' ? `companies/${companyId}/repairRequests` : 'homeownerRepairRequests',
      webPath: `/company/repair-requests/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.serviceRequest) {
    const records = await loadCompanyRootRecords({ db, collectionName: 'homeownerServiceRequests', companyId, context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: 'homeownerServiceRequests',
      webPath: `/company/leads/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.serviceAgreement || normalizedType === CONVERSATION_LINK_TYPES.estimate) {
    const records = await loadCompanyRootRecords({ db, collectionName: salesCollectionNames.agreements, companyId, context });
    const filteredRecords = normalizedType === CONVERSATION_LINK_TYPES.estimate
      ? records.filter((record) => {
        const sourceType = String(record.sourceType || '').toLowerCase();
        const title = String(record.title || '').toLowerCase();
        return sourceType.includes('job') || title.includes('estimate') || record.jobId || record.leadId;
      })
      : records;

    return filteredRecords.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: salesCollectionNames.agreements,
      webPath: `/company/sales/agreements/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.invoice) {
    const records = await loadCompanyRootRecords({ db, collectionName: salesCollectionNames.invoices, companyId, context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: salesCollectionNames.invoices,
      webPath: `/company/sales/invoices/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.purchase) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'purchasedItems', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/purchasedItems`,
      webPath: `/company/purchased-items/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.receipt) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'receipts', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/receipts`,
      webPath: `/company/receipts/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.shoppingListItem) {
    const [current, legacy] = await Promise.all([
      loadCompanySubcollectionRecords({ db, companyId, collectionName: 'shoppingList', context }),
      loadCompanySubcollectionRecords({ db, companyId, collectionName: 'shoppingListItems', context }),
    ]);

    return [
      ...current.map((record) => ({ ...record, sourceCollection: 'shoppingList' })),
      ...legacy.map((record) => ({ ...record, sourceCollection: 'shoppingListItems' })),
    ].map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/${record.sourceCollection}`,
      webPath: `/company/shopping-list/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.databaseItem) {
    const records = await safeGetDocs(collection(db, 'companies', companyId, 'settings', 'dataBase', 'dataBase'));
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/settings/dataBase/dataBase`,
      webPath: `/company/items/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.vendor) {
    const [vendors, legacyVendors] = await Promise.all([
      safeGetDocs(collection(db, 'companies', companyId, 'settings', 'vendors', 'vendor')),
      safeGetDocs(collection(db, 'companies', companyId, 'settings', 'venders', 'vender')),
    ]);

    return [
      ...vendors.map((record) => ({ ...record, sourceCollection: 'settings/vendors/vendor' })),
      ...legacyVendors.map((record) => ({ ...record, sourceCollection: 'settings/venders/vender' })),
    ].map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/${record.sourceCollection}`,
      webPath: `/company/vendors/detail/${record.id}`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.companyUser) {
    const records = await safeGetDocs(collection(db, 'companies', companyId, 'companyUsers'));
    return sortCompanyUsersByName(records).map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/companyUsers`,
      webPath: `/company/companyUsers/${record.userId || record.id}/general`,
    }));
  }

  if (normalizedType === CONVERSATION_LINK_TYPES.todo) {
    const records = await loadCompanySubcollectionRecords({ db, companyId, collectionName: 'todoItems', context });
    return records.map((record) => buildPickerItem({
      type: normalizedType,
      record,
      audience: 'company',
      companyId,
      collectionPath: `companies/${companyId}/todoItems`,
      webPath: `/company/todo-list?todoId=${record.id}`,
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
  if (!companyId) {
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
  } else {
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
  const isInternalChat = getChatAudience(chat) === CHAT_AUDIENCE.internal;

  const userTargets = participantIds.filter((participantId) => {
    if (!participantId || participantId === senderId) return false;
    if (isInternalChat) return true;
    if (!senderCompanyId) return true;

    const participant = participantByUserId.get(participantId);
    return participant?.companyId !== senderCompanyId;
  });

  const companyTargets = isInternalChat
    ? []
    : senderCompanyId
    ? participantCompanyIds.filter((companyId) => companyId && companyId !== senderCompanyId)
    : participantCompanyIds;

  return {
    userTargets: uniqueStrings(userTargets),
    companyTargets: uniqueStrings(companyTargets),
  };
};

const notificationRouteFor = ({ chatId, link, audience }) => {
  if (link) {
    const route = getConversationLinkRoute(link, audience);
    if (route) return route;
  }

  return audience === 'client' ? `/client/chat/details/${chatId}` : `/companies-chat/detail/${chatId}`;
};

const notificationTargetScope = ({ recipientUserId = '', recipientCompanyId = '' }) => (
  recipientUserId ? 'specific' : (recipientCompanyId ? 'company' : 'team')
);

const buildChatNotificationPayload = ({
  alertId,
  chatId,
  chat,
  messageId,
  preview,
  normalizedLink,
  senderId,
  senderName,
  senderCompanyId,
  senderCompanyName,
  recipientUserId = '',
  recipientCompanyId = '',
  recipientAudience = 'company',
}) => {
  const label = normalizedLink ? getConversationLinkLabel(normalizedLink.type) : '';
  const title = normalizedLink
    ? `${senderName || 'Someone'} shared ${label}`
    : `New message from ${senderName || 'User'}`;
  const companyId = recipientCompanyId
    || normalizedLink?.companyId
    || chat.companyId
    || chat.senderCompanyId
    || chat.receiverCompanyId
    || senderCompanyId
    || '';
  const route = notificationRouteFor({
    chatId,
    link: normalizedLink,
    audience: recipientAudience,
  });
  const payload = {
    id: alertId,
    companyId,
    title,
    name: title,
    message: preview || '',
    description: preview || '',
    status: 'unread',
    read: false,
    severity: 'info',
    type: normalizedLink ? 'chat_shared_record' : 'chat_message',
    source: 'chat',
    sourceId: messageId,
    chatId,
    conversationId: chatId,
    route,
    audience: getChatAudience(chat),
    targetScope: notificationTargetScope({ recipientUserId, recipientCompanyId }),
    assignedToUserId: recipientUserId,
    recipientUserId,
    recipientCompanyId,
    deliveryTargets: ['web', 'ios'],
    channels: {
      dashboard: true,
      ios: true,
      push: true,
    },
    createdByUserId: senderId || '',
    createdByName: senderName || 'User',
    createdByCompanyId: senderCompanyId || '',
    createdByCompanyName: senderCompanyName || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (normalizedLink) {
    payload.hasItem = true;
    payload.itemId = normalizedLink.recordId || '';
    payload.itemName = normalizedLink.title || label;
    payload.relatedEntity = {
      type: normalizedLink.type,
      id: normalizedLink.recordId || '',
      label: normalizedLink.title || label,
      companyId,
      collectionPath: normalizedLink.collectionPath || '',
      webPath: route,
      deeplinkUrl: normalizedLink.deeplinkUrl || '',
    };
    payload.share = {
      type: normalizedLink.type,
      id: normalizedLink.recordId || '',
      recordId: normalizedLink.recordId || '',
      companyId,
      customerId: normalizedLink.customerId || chat.customerId || '',
      customerUserId: normalizedLink.customerUserId || chat.customerUserId || '',
      title: normalizedLink.title || label,
      subtitle: normalizedLink.subtitle || '',
      collectionPath: normalizedLink.collectionPath || '',
      webPath: route,
      sharePath: normalizedLink.sharePath || buildSharedRecordPath(normalizedLink, { audience: recipientAudience, companyId, chatId }),
      shareUrl: normalizedLink.shareUrl || buildSharedRecordUrl(normalizedLink, { audience: recipientAudience, companyId, chatId }),
      deeplinkUrl: normalizedLink.deeplinkUrl || buildAppDeepLink(normalizedLink, { audience: recipientAudience, companyId, chatId }),
      mobileRoute: normalizedLink.mobileRoute || getConversationLinkMobileRoute(normalizedLink.type),
      audience: recipientAudience,
    };
  } else {
    payload.hasItem = false;
    payload.itemId = '';
    payload.itemName = '';
    payload.relatedEntity = {
      type: 'chat',
      id: chatId,
      label: chat.title || 'Conversation',
      companyId,
    };
  }

  return payload;
};

const addMessageNotificationWrites = ({
  batch,
  db,
  chatId,
  chat,
  messageId,
  preview,
  normalizedLink,
  senderId,
  senderName,
  senderCompanyId = '',
  senderCompanyName = '',
  userTargets = [],
  companyTargets = [],
}) => {
  if (!batch || !db) return;

  const participants = Array.isArray(chat.participants) ? chat.participants.map(normalizeParticipant) : [];
  const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));
  const uniqueUserTargets = uniqueStrings(userTargets);
  const uniqueCompanyTargets = uniqueStrings(companyTargets);

  uniqueUserTargets.forEach((recipientUserId) => {
    const participant = participantByUserId.get(recipientUserId);
    const recipientAudience = (
      getChatAudience(chat) === CHAT_AUDIENCE.internal
      || participant?.companyId
      || participant?.accountType === 'Company'
    ) ? 'company' : 'client';
    const alertId = `alert_${messageId}_${recipientUserId}`;
    const alertRef = doc(db, 'users', recipientUserId, 'alerts', alertId);

    batch.set(alertRef, buildChatNotificationPayload({
      alertId,
      chatId,
      chat,
      messageId,
      preview,
      normalizedLink,
      senderId,
      senderName,
      senderCompanyId,
      senderCompanyName,
      recipientUserId,
      recipientAudience,
    }));
  });

  uniqueCompanyTargets.forEach((recipientCompanyId) => {
    const alertId = `alert_${messageId}_${recipientCompanyId}`;
    const alertRef = doc(db, 'companies', recipientCompanyId, 'alerts', alertId);

    batch.set(alertRef, buildChatNotificationPayload({
      alertId,
      chatId,
      chat,
      messageId,
      preview,
      normalizedLink,
      senderId,
      senderName,
      senderCompanyId,
      senderCompanyName,
      recipientCompanyId,
      recipientAudience: 'company',
    }));
  });
};

const commitMessageNotificationWrites = async ({
  db,
  chatId,
  chat,
  messageId,
  preview,
  normalizedLink,
  senderId,
  senderName,
  senderCompanyId = '',
  senderCompanyName = '',
  userTargets = [],
  companyTargets = [],
}) => {
  const uniqueUserTargets = uniqueStrings(userTargets);
  const uniqueCompanyTargets = uniqueStrings(companyTargets);

  if (!db || (!uniqueUserTargets.length && !uniqueCompanyTargets.length)) return;

  const notificationBatch = writeBatch(db);

  addMessageNotificationWrites({
    batch: notificationBatch,
    db,
    chatId,
    chat,
    messageId,
    preview,
    normalizedLink,
    senderId,
    senderName,
    senderCompanyId,
    senderCompanyName,
    userTargets: uniqueUserTargets,
    companyTargets: uniqueCompanyTargets,
  });

  try {
    await notificationBatch.commit();
  } catch (error) {
    console.warn('Chat message was sent, but notification alerts could not be created:', error);
  }
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

  if (!db || !chatId || !senderId || (!messageText && !link)) return null;

  let chatData = chat;
  if (!chatData) {
    const chatSnap = await getDoc(doc(db, 'chats', chatId));
    if (!chatSnap.exists()) throw new Error('Chat not found.');
    chatData = { id: chatSnap.id, ...chatSnap.data() };
  }

  const normalizedLink = link
    ? buildConversationLinkSharePayload(link, {
      chat: chatData,
      audience: senderCompanyId ? 'company' : 'client',
    })
    : null;
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
  const batch = writeBatch(db);

  batch.set(messageRef, {
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

  batch.update(doc(db, 'chats', chatId), {
    lastMessage: preview,
    lastMessageKind: kind,
    lastConversationLink: normalizedLink,
    mostRecentChat: serverTimestamp(),
    userWhoHaveNotRead: userTargets,
    companyIdsWhoHaveNotRead: companyTargets,
    readByUserIds: [senderId],
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await commitMessageNotificationWrites({
    db,
    chatId,
    chat: chatData,
    messageId,
    preview,
    normalizedLink,
    senderId,
    senderName: senderName || 'User',
    senderCompanyId,
    senderCompanyName,
    userTargets,
    companyTargets,
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
    visibility: CHAT_VISIBILITY.companyExternal,
    audience: CHAT_AUDIENCE.external,
    targetType: CHAT_TARGET_TYPE.company,
    companyVisibility: 'public',
    publicToCompanyId: company.id,
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

  await commitMessageNotificationWrites({
    db,
    chatId,
    chat: chatData,
    messageId,
    preview: messageText,
    normalizedLink: null,
    senderId: user.uid,
    senderName: homeownerName,
    userTargets: ownerParticipant.userId ? [ownerParticipant.userId] : [],
    companyTargets: [company.id],
  });

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
  const targetType = participant.type === CHAT_TARGET_TYPE.companyUser
    ? CHAT_TARGET_TYPE.companyUser
    : participant.type === CHAT_TARGET_TYPE.company
      ? CHAT_TARGET_TYPE.company
      : CHAT_TARGET_TYPE.customer;
  const chatAudience = targetType === CHAT_TARGET_TYPE.companyUser
    ? CHAT_AUDIENCE.internal
    : CHAT_AUDIENCE.external;
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
    companyId: targetType === CHAT_TARGET_TYPE.companyUser ? selectedCompanyId : targetCompanyId,
    companyName: participant.companyName || (participant.type === 'company' ? participant.name : ''),
    isCompany: participant.type === 'company',
  });

  const chatData = {
    id: chatId,
    title: `${participant.name || targetParticipant.userName} / ${selectedCompanyName || 'Company'}`,
    visibility: targetType === CHAT_TARGET_TYPE.companyUser
      ? CHAT_VISIBILITY.companyInternal
      : targetCompanyId
        ? CHAT_VISIBILITY.companyToCompany
        : CHAT_VISIBILITY.companyExternal,
    audience: chatAudience,
    targetType,
    companyVisibility: targetType === CHAT_TARGET_TYPE.customer ? 'public' : '',
    publicToCompanyId: targetType === CHAT_TARGET_TYPE.customer ? selectedCompanyId : '',
    companyId: selectedCompanyId,
    companyName: selectedCompanyName || '',
    senderCompanyId: selectedCompanyId,
    receiverCompanyId: targetCompanyId,
    participantIds,
    participantCompanyIds,
    participants: [senderParticipant, targetParticipant],
    customerId: participant.customerId || (participant.type === 'customer' ? participant.id : ''),
    customerUserId: targetType === CHAT_TARGET_TYPE.customer ? targetUserId : '',
    customerName: targetType === CHAT_TARGET_TYPE.customer ? (participant.customerName || targetParticipant.userName) : '',
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

  await commitMessageNotificationWrites({
    db,
    chatId,
    chat: chatData,
    messageId,
    preview: messageText,
    normalizedLink: null,
    senderId: user.uid,
    senderName,
    senderCompanyId: selectedCompanyId,
    senderCompanyName: selectedCompanyName || '',
    userTargets: targetUserId ? [targetUserId] : [],
    companyTargets: targetCompanyId ? [targetCompanyId] : [],
  });

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
