import { v4 as uuidv4 } from 'uuid';

export const salesCollectionNames = {
  billingProfiles: 'salesBillingProfiles',
  agreements: 'salesAgreements',
  billingSubscriptions: 'salesBillingSubscriptions',
  invoices: 'salesInvoices',
  payments: 'salesPayments',
  paymentEvents: 'salesPaymentEvents',
  catalogItems: 'salesCatalogItems',
};

export const SalesAgreementStatus = {
  draft: 'draft',
  sent: 'sent',
  revised: 'revised',
  accepted: 'accepted',
  rejected: 'rejected',
  expired: 'expired',
  canceled: 'canceled',
};

export const SalesAgreementSourceType = {
  recurringService: 'recurringService',
  oneOffJob: 'oneOffJob',
  workOffer: 'workOffer',
  manual: 'manual',
};

export const SalesBillingSubscriptionStatus = {
  notStarted: 'notStarted',
  pendingPaymentMethod: 'pendingPaymentMethod',
  pendingStripe: 'pendingStripe',
  active: 'active',
  pastDue: 'pastDue',
  paused: 'paused',
  canceled: 'canceled',
};

export const SalesInvoiceStatus = {
  draft: 'draft',
  open: 'open',
  partiallyPaid: 'partiallyPaid',
  paid: 'paid',
  overdue: 'overdue',
  void: 'void',
  uncollectible: 'uncollectible',
};

export const SalesInvoiceType = {
  subscription: 'subscription',
  oneTime: 'oneTime',
  manual: 'manual',
  adjustment: 'adjustment',
};

export const SalesInvoiceDeliveryMethod = {
  customerPortal: 'customerPortal',
  stripeHostedInvoice: 'stripeHostedInvoice',
  email: 'email',
  print: 'print',
  none: 'none',
};

export const SalesPaymentStatus = {
  pending: 'pending',
  posted: 'posted',
  failed: 'failed',
  refunded: 'refunded',
  void: 'void',
};

export const SalesPaymentMethod = {
  stripeCard: 'stripeCard',
  stripeAch: 'stripeAch',
  cash: 'cash',
  check: 'check',
  externalCard: 'externalCard',
  bankTransfer: 'bankTransfer',
  other: 'other',
};

export const SalesBillingMode = {
  connectedAccountDirectCharge: 'connectedAccountDirectCharge',
  connectedAccountDestinationCharge: 'connectedAccountDestinationCharge',
};

export const SalesBillingCollectionMethod = {
  manualUntilAutopay: 'manualUntilAutopay',
  manualInvoices: 'manualInvoices',
  automaticStripe: 'automaticStripe',
};

export const SalesAutopayStatus = {
  unavailable: 'unavailable',
  available: 'available',
  checkoutStarted: 'checkoutStarted',
  active: 'active',
  pastDue: 'pastDue',
  canceled: 'canceled',
};

export const SalesCatalogItemType = {
  service: 'service',
  recurringService: 'recurringService',
  labor: 'labor',
  material: 'material',
  fee: 'fee',
  discount: 'discount',
  tax: 'tax',
  manual: 'manual',
};

export const SalesCatalogBillingBehavior = {
  oneTime: 'oneTime',
  recurring: 'recurring',
  manualOnly: 'manualOnly',
};

export const SalesCatalogSourceType = {
  manual: 'manual',
  serviceStopType: 'serviceStopType',
  workType: 'workType',
  task: 'task',
  databaseItem: 'databaseItem',
  shoppingListItem: 'shoppingListItem',
  stripeProductPrice: 'stripeProductPrice',
};

export class SalesCatalogItem {
  constructor({
    id = `sci_${uuidv4()}`,
    companyId,
    name = '',
    description = '',
    type = SalesCatalogItemType.service,
    billingBehavior = SalesCatalogBillingBehavior.oneTime,
    sourceType = SalesCatalogSourceType.manual,
    sourceId = '',
    unitAmountCents = 0,
    unitCostCents = 0,
    defaultQuantity = 1,
    taxable = false,
    active = true,
    currency = 'usd',
    stripeConnectedAccountId = '',
    stripeProductId = '',
    stripePriceId = '',
    stripeRecurringInterval = '',
    stripeRecurringIntervalCount = 1,
    metadata = {},
    createdAt = null,
    updatedAt = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.name = name;
    this.description = description;
    this.type = type;
    this.billingBehavior = billingBehavior;
    this.sourceType = sourceType;
    this.sourceId = sourceId;
    this.unitAmountCents = unitAmountCents;
    this.unitCostCents = unitCostCents;
    this.defaultQuantity = defaultQuantity;
    this.taxable = taxable;
    this.active = active;
    this.currency = currency;
    this.stripeConnectedAccountId = stripeConnectedAccountId;
    this.stripeProductId = stripeProductId;
    this.stripePriceId = stripePriceId;
    this.stripeRecurringInterval = stripeRecurringInterval;
    this.stripeRecurringIntervalCount = stripeRecurringIntervalCount;
    this.metadata = metadata;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toFirestore() {
    return { ...this };
  }

  static fromFirestore(snapshot) {
    return new SalesCatalogItem({
      id: snapshot.id,
      ...snapshot.data(),
    });
  }
}

export class SalesBillingProfile {
  constructor({
    id = `sbp_${uuidv4()}`,
    companyId,
    customerId,
    customerUserId = null,
    relationshipId = '',
    customerCompanyRelationshipId = '',
    customerName = '',
    email = '',
    phoneNumber = '',
    serviceLocationIds = [],
    stripeConnectedAccountId = '',
    stripeCustomerId = '',
    defaultPaymentMethodId = '',
    invoiceDeliveryMethod = 'email',
    paymentTerms = 'dueOnReceipt',
    currency = 'usd',
    taxExempt = 'none',
    status = 'active',
    createdAt = null,
    updatedAt = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.customerId = customerId;
    this.customerUserId = customerUserId;
    this.relationshipId = relationshipId;
    this.customerCompanyRelationshipId = customerCompanyRelationshipId || relationshipId;
    this.customerName = customerName;
    this.email = email;
    this.phoneNumber = phoneNumber;
    this.serviceLocationIds = serviceLocationIds;
    this.stripeConnectedAccountId = stripeConnectedAccountId;
    this.stripeCustomerId = stripeCustomerId;
    this.defaultPaymentMethodId = defaultPaymentMethodId;
    this.invoiceDeliveryMethod = invoiceDeliveryMethod;
    this.paymentTerms = paymentTerms;
    this.currency = currency;
    this.taxExempt = taxExempt;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toFirestore() {
    return { ...this };
  }

  static fromFirestore(snapshot) {
    return new SalesBillingProfile({
      id: snapshot.id,
      ...snapshot.data(),
    });
  }
}

export class SalesAgreement {
  constructor({
    id = `sa_${uuidv4()}`,
    companyId,
    companyName = '',
    customerId,
    customerUserId = null,
    relationshipId = '',
    customerCompanyRelationshipId = '',
    customerName = '',
    email = '',
    serviceLocationIds = [],
    sourceType = SalesAgreementSourceType.manual,
    sourceId = '',
    title = '',
    description = '',
    terms = '',
    termsTemplateId = '',
    termsTemplateName = '',
    termsTemplateDescription = '',
    termsList = [],
    lineItems = [],
    serviceLocationSnapshots = [],
    status = SalesAgreementStatus.draft,
    recurringServiceStopId = '',
    recurringRouteId = '',
    recurringRouteName = '',
    operationsSetupStatus = '',
    operationsSetupReason = '',
    billingProfileId = '',
    billingSubscriptionId = '',
    billingFlowStatus = '',
    billingFlowNextAction = '',
    billingCollectionMethod = SalesBillingCollectionMethod.manualUntilAutopay,
    autopayStatus = SalesAutopayStatus.unavailable,
    manualBillingEnabled = true,
    customerCanPayImmediately = false,
    rateAmountCents = 0,
    subtotalAmountCents = 0,
    taxAmountCents = 0,
    totalAmountCents = 0,
    rateType = 'perMonth',
    serviceCadence = 'monthly',
    serviceCadenceCount = 1,
    serviceDaysOfWeek = [],
    serviceFrequencyLabel = '',
    billingFrequency = 'monthly',
    billingFrequencyCount = 1,
    paymentTerms = 'dueOnReceipt',
    invoiceDeliveryMethod = SalesInvoiceDeliveryMethod.email,
    receiptDeliveryMethod = SalesInvoiceDeliveryMethod.email,
    receiptsEnabled = true,
    includedServices = [],
    excludedServices = [],
    startDate = null,
    endDate = null,
    expiresAt = null,
    atWill = false,
    createdByUserId = '',
    createdAt = null,
    updatedAt = null,
    sentAt = null,
    sentByUserId = '',
    emailDelivery = {},
    acceptedAt = null,
    acceptedByUserId = '',
    acceptedByUserName = '',
    acceptedByEmail = '',
    acceptedSource = '',
    acceptedNote = '',
    acceptedSnapshot = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.companyName = companyName;
    this.customerId = customerId;
    this.customerUserId = customerUserId;
    this.relationshipId = relationshipId;
    this.customerCompanyRelationshipId = customerCompanyRelationshipId || relationshipId;
    this.customerName = customerName;
    this.email = email;
    this.serviceLocationIds = serviceLocationIds;
    this.sourceType = sourceType;
    this.sourceId = sourceId;
    this.title = title;
    this.description = description;
    this.terms = terms;
    this.termsTemplateId = termsTemplateId;
    this.termsTemplateName = termsTemplateName;
    this.termsTemplateDescription = termsTemplateDescription;
    this.termsList = termsList;
    this.lineItems = lineItems;
    this.serviceLocationSnapshots = serviceLocationSnapshots;
    this.status = status;
    this.recurringServiceStopId = recurringServiceStopId;
    this.recurringRouteId = recurringRouteId;
    this.recurringRouteName = recurringRouteName;
    this.operationsSetupStatus = operationsSetupStatus;
    this.operationsSetupReason = operationsSetupReason;
    this.billingProfileId = billingProfileId;
    this.billingSubscriptionId = billingSubscriptionId;
    this.billingFlowStatus = billingFlowStatus;
    this.billingFlowNextAction = billingFlowNextAction;
    this.billingCollectionMethod = billingCollectionMethod;
    this.autopayStatus = autopayStatus;
    this.manualBillingEnabled = manualBillingEnabled;
    this.customerCanPayImmediately = customerCanPayImmediately;
    this.rateAmountCents = rateAmountCents;
    this.subtotalAmountCents = subtotalAmountCents;
    this.taxAmountCents = taxAmountCents;
    this.totalAmountCents = totalAmountCents;
    this.rateType = rateType;
    this.serviceCadence = serviceCadence;
    this.serviceCadenceCount = serviceCadenceCount;
    this.serviceDaysOfWeek = serviceDaysOfWeek;
    this.serviceFrequencyLabel = serviceFrequencyLabel;
    this.billingFrequency = billingFrequency;
    this.billingFrequencyCount = billingFrequencyCount;
    this.paymentTerms = paymentTerms;
    this.invoiceDeliveryMethod = invoiceDeliveryMethod;
    this.receiptDeliveryMethod = receiptDeliveryMethod;
    this.receiptsEnabled = receiptsEnabled;
    this.includedServices = includedServices;
    this.excludedServices = excludedServices;
    this.startDate = startDate;
    this.endDate = endDate;
    this.expiresAt = expiresAt;
    this.atWill = atWill;
    this.createdByUserId = createdByUserId;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.sentAt = sentAt;
    this.sentByUserId = sentByUserId;
    this.emailDelivery = emailDelivery;
    this.acceptedAt = acceptedAt;
    this.acceptedByUserId = acceptedByUserId;
    this.acceptedByUserName = acceptedByUserName;
    this.acceptedByEmail = acceptedByEmail;
    this.acceptedSource = acceptedSource;
    this.acceptedNote = acceptedNote;
    this.acceptedSnapshot = acceptedSnapshot;
  }

  toFirestore() {
    return {
      ...this,
      lineItems: Array.isArray(this.lineItems)
        ? this.lineItems.map((item) => ({ ...item }))
        : [],
      serviceLocationSnapshots: Array.isArray(this.serviceLocationSnapshots)
        ? this.serviceLocationSnapshots.map((location) => ({ ...location }))
        : [],
    };
  }

  static fromFirestore(snapshot) {
    return new SalesAgreement({
      id: snapshot.id,
      ...snapshot.data(),
    });
  }
}

export class SalesBillingSubscription {
  constructor({
    id = `sbs_${uuidv4()}`,
    companyId,
    customerId,
    customerUserId = null,
    relationshipId = '',
    customerCompanyRelationshipId = '',
    customerName = '',
    email = '',
    serviceLocationIds = [],
    agreementId = '',
    billingProfileId = '',
    stripeConnectedAccountId = '',
    stripeCustomerId = '',
    stripeProductId = '',
    stripePriceId = '',
    stripeSubscriptionId = '',
    stripeSubscriptionItemId = '',
    stripeLatestInvoiceId = '',
    stripeDefaultPaymentMethodId = '',
    billingMode = SalesBillingMode.connectedAccountDirectCharge,
    billingCollectionMethod = SalesBillingCollectionMethod.manualUntilAutopay,
    status = SalesBillingSubscriptionStatus.notStarted,
    stripeStatus = '',
    autopayStatus = SalesAutopayStatus.unavailable,
    autopayEnabled = false,
    amountCents = 0,
    currency = 'usd',
    interval = 'month',
    intervalCount = 1,
    billingFrequency = '',
    billingFrequencyCount = 1,
    serviceCadence = '',
    serviceCadenceCount = 1,
    serviceDaysOfWeek = [],
    serviceFrequencyLabel = '',
    recurringServiceStopId = '',
    recurringRouteId = '',
    recurringRouteName = '',
    operationsSetupStatus = '',
    operationsSetupReason = '',
    rateType = '',
    paymentTerms = 'dueOnReceipt',
    invoiceDeliveryMethod = SalesInvoiceDeliveryMethod.email,
    lineItems = [],
    agreementSnapshot = null,
    checkoutSessionId = '',
    checkoutUrl = '',
    checkoutStatus = 'notStarted',
    nextAction = 'collectPaymentMethod',
    customerCanPayImmediately = false,
    stripeReadiness = {},
    manualBillingEnabled = true,
    manualBillingStatus = 'readyToInvoice',
    manualBillingReason = '',
    receiptDeliveryMethod = SalesInvoiceDeliveryMethod.email,
    receiptsEnabled = true,
    lastBillingSource = '',
    currentPeriodStart = null,
    currentPeriodEnd = null,
    cancelAtPeriodEnd = false,
    canceledAt = null,
    applicationFeePercent = null,
    createdAt = null,
    updatedAt = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.customerId = customerId;
    this.customerUserId = customerUserId;
    this.relationshipId = relationshipId;
    this.customerCompanyRelationshipId = customerCompanyRelationshipId || relationshipId;
    this.customerName = customerName;
    this.email = email;
    this.serviceLocationIds = serviceLocationIds;
    this.agreementId = agreementId;
    this.billingProfileId = billingProfileId;
    this.stripeConnectedAccountId = stripeConnectedAccountId;
    this.stripeCustomerId = stripeCustomerId;
    this.stripeProductId = stripeProductId;
    this.stripePriceId = stripePriceId;
    this.stripeSubscriptionId = stripeSubscriptionId;
    this.stripeSubscriptionItemId = stripeSubscriptionItemId;
    this.stripeLatestInvoiceId = stripeLatestInvoiceId;
    this.stripeDefaultPaymentMethodId = stripeDefaultPaymentMethodId;
    this.billingMode = billingMode;
    this.billingCollectionMethod = billingCollectionMethod;
    this.status = status;
    this.stripeStatus = stripeStatus;
    this.autopayStatus = autopayStatus;
    this.autopayEnabled = autopayEnabled;
    this.amountCents = amountCents;
    this.currency = currency;
    this.interval = interval;
    this.intervalCount = intervalCount;
    this.billingFrequency = billingFrequency;
    this.billingFrequencyCount = billingFrequencyCount;
    this.serviceCadence = serviceCadence;
    this.serviceCadenceCount = serviceCadenceCount;
    this.serviceDaysOfWeek = serviceDaysOfWeek;
    this.serviceFrequencyLabel = serviceFrequencyLabel;
    this.recurringServiceStopId = recurringServiceStopId;
    this.recurringRouteId = recurringRouteId;
    this.recurringRouteName = recurringRouteName;
    this.operationsSetupStatus = operationsSetupStatus;
    this.operationsSetupReason = operationsSetupReason;
    this.rateType = rateType;
    this.paymentTerms = paymentTerms;
    this.invoiceDeliveryMethod = invoiceDeliveryMethod;
    this.lineItems = lineItems;
    this.agreementSnapshot = agreementSnapshot;
    this.checkoutSessionId = checkoutSessionId;
    this.checkoutUrl = checkoutUrl;
    this.checkoutStatus = checkoutStatus;
    this.nextAction = nextAction;
    this.customerCanPayImmediately = customerCanPayImmediately;
    this.stripeReadiness = stripeReadiness;
    this.manualBillingEnabled = manualBillingEnabled;
    this.manualBillingStatus = manualBillingStatus;
    this.manualBillingReason = manualBillingReason;
    this.receiptDeliveryMethod = receiptDeliveryMethod;
    this.receiptsEnabled = receiptsEnabled;
    this.lastBillingSource = lastBillingSource;
    this.currentPeriodStart = currentPeriodStart;
    this.currentPeriodEnd = currentPeriodEnd;
    this.cancelAtPeriodEnd = cancelAtPeriodEnd;
    this.canceledAt = canceledAt;
    this.applicationFeePercent = applicationFeePercent;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toFirestore() {
    return { ...this };
  }

  static fromFirestore(snapshot) {
    return new SalesBillingSubscription({
      id: snapshot.id,
      ...snapshot.data(),
    });
  }
}

export class SalesInvoiceLineItem {
  constructor({
    id = `sili_${uuidv4()}`,
    catalogItemId = '',
    sourceType = '',
    sourceId = '',
    description = '',
    name = '',
    quantity = 1,
    unitAmountCents = 0,
    totalAmountCents = 0,
    taxable = false,
    type = '',
    stripeProductId = '',
    stripePriceId = '',
    metadata = {},
  }) {
    this.id = id;
    this.catalogItemId = catalogItemId;
    this.sourceType = sourceType;
    this.sourceId = sourceId;
    this.description = description;
    this.name = name;
    this.quantity = quantity;
    this.unitAmountCents = unitAmountCents;
    this.totalAmountCents = totalAmountCents;
    this.taxable = taxable;
    this.type = type;
    this.stripeProductId = stripeProductId;
    this.stripePriceId = stripePriceId;
    this.metadata = metadata;
  }
}

export class SalesInvoice {
  constructor({
    id = `si_${uuidv4()}`,
    companyId,
    companyName = '',
    customerId,
    customerUserId = null,
    relationshipId = '',
    customerCompanyRelationshipId = '',
    customerName = '',
    email = '',
    serviceLocationIds = [],
    serviceLocationSnapshots = [],
    agreementId = '',
    jobId = '',
    billingSubscriptionId = '',
    stripeConnectedAccountId = '',
    stripeInvoiceId = '',
    stripePaymentIntentId = '',
    stripeHostedInvoiceUrl = '',
    stripeInvoicePdfUrl = '',
    invoiceNumber = '',
    type = SalesInvoiceType.manual,
    status = SalesInvoiceStatus.draft,
    deliveryMethod = SalesInvoiceDeliveryMethod.email,
    currency = 'usd',
    billingPeriodStart = null,
    billingPeriodEnd = null,
    dueDate = null,
    subtotalAmountCents = 0,
    discountAmountCents = 0,
    taxAmountCents = 0,
    totalAmountCents = 0,
    amountPaidCents = 0,
    amountDueCents = null,
    writeOffAmountCents = 0,
    memo = '',
    lineItems = [],
    createdAt = null,
    updatedAt = null,
    sentAt = null,
    paidAt = null,
    lastPaymentAt = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.companyName = companyName;
    this.customerId = customerId;
    this.customerUserId = customerUserId;
    this.relationshipId = relationshipId;
    this.customerCompanyRelationshipId = customerCompanyRelationshipId || relationshipId;
    this.customerName = customerName;
    this.email = email;
    this.serviceLocationIds = serviceLocationIds;
    this.serviceLocationSnapshots = serviceLocationSnapshots;
    this.agreementId = agreementId;
    this.jobId = jobId;
    this.billingSubscriptionId = billingSubscriptionId;
    this.stripeConnectedAccountId = stripeConnectedAccountId;
    this.stripeInvoiceId = stripeInvoiceId;
    this.stripePaymentIntentId = stripePaymentIntentId;
    this.stripeHostedInvoiceUrl = stripeHostedInvoiceUrl;
    this.stripeInvoicePdfUrl = stripeInvoicePdfUrl;
    this.invoiceNumber = invoiceNumber;
    this.type = type;
    this.status = status;
    this.deliveryMethod = deliveryMethod;
    this.currency = currency;
    this.billingPeriodStart = billingPeriodStart;
    this.billingPeriodEnd = billingPeriodEnd;
    this.dueDate = dueDate;
    this.subtotalAmountCents = subtotalAmountCents;
    this.discountAmountCents = discountAmountCents;
    this.taxAmountCents = taxAmountCents;
    this.totalAmountCents = totalAmountCents;
    this.amountPaidCents = amountPaidCents;
    this.amountDueCents = amountDueCents ?? Math.max(totalAmountCents - amountPaidCents - writeOffAmountCents, 0);
    this.writeOffAmountCents = writeOffAmountCents;
    this.memo = memo;
    this.lineItems = lineItems;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.sentAt = sentAt;
    this.paidAt = paidAt;
    this.lastPaymentAt = lastPaymentAt;
  }

  toFirestore() {
    return {
      ...this,
      lineItems: Array.isArray(this.lineItems)
        ? this.lineItems.map((item) => ({ ...item }))
        : [],
      serviceLocationSnapshots: Array.isArray(this.serviceLocationSnapshots)
        ? this.serviceLocationSnapshots.map((location) => ({ ...location }))
        : [],
    };
  }

  static fromFirestore(snapshot) {
    const data = snapshot.data();
    return new SalesInvoice({
      id: snapshot.id,
      ...data,
      lineItems: Array.isArray(data.lineItems)
        ? data.lineItems.map((item) => new SalesInvoiceLineItem(item))
        : [],
    });
  }
}

export class SalesPayment {
  constructor({
    id = `sp_${uuidv4()}`,
    companyId,
    customerId = '',
    customerUserId = null,
    relationshipId = '',
    customerCompanyRelationshipId = '',
    email = '',
    invoiceId = '',
    billingProfileId = '',
    billingSubscriptionId = '',
    stripeConnectedAccountId = '',
    stripePaymentIntentId = '',
    stripeChargeId = '',
    stripeInvoiceId = '',
    method = SalesPaymentMethod.other,
    status = SalesPaymentStatus.posted,
    amountCents = 0,
    currency = 'usd',
    referenceNumber = '',
    memo = '',
    receiptUrl = '',
    recordedByUserId = '',
    receivedAt = null,
    createdAt = null,
    updatedAt = null,
    voidedAt = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.customerId = customerId;
    this.customerUserId = customerUserId;
    this.relationshipId = relationshipId;
    this.customerCompanyRelationshipId = customerCompanyRelationshipId || relationshipId;
    this.email = email;
    this.invoiceId = invoiceId;
    this.billingProfileId = billingProfileId;
    this.billingSubscriptionId = billingSubscriptionId;
    this.stripeConnectedAccountId = stripeConnectedAccountId;
    this.stripePaymentIntentId = stripePaymentIntentId;
    this.stripeChargeId = stripeChargeId;
    this.stripeInvoiceId = stripeInvoiceId;
    this.method = method;
    this.status = status;
    this.amountCents = amountCents;
    this.currency = currency;
    this.referenceNumber = referenceNumber;
    this.memo = memo;
    this.receiptUrl = receiptUrl;
    this.recordedByUserId = recordedByUserId;
    this.receivedAt = receivedAt;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.voidedAt = voidedAt;
  }

  toFirestore() {
    return { ...this };
  }

  static fromFirestore(snapshot) {
    return new SalesPayment({
      id: snapshot.id,
      ...snapshot.data(),
    });
  }
}

export class SalesPaymentEvent {
  constructor({
    id = `spe_${uuidv4()}`,
    companyId,
    customerId = '',
    customerUserId = null,
    relationshipId = '',
    customerCompanyRelationshipId = '',
    email = '',
    invoiceId = '',
    billingSubscriptionId = '',
    stripeConnectedAccountId = '',
    stripeEventId = '',
    stripeObjectId = '',
    type = '',
    amountCents = 0,
    currency = 'usd',
    status = '',
    receivedAt = null,
    processedAt = null,
  }) {
    this.id = id;
    this.companyId = companyId;
    this.customerId = customerId;
    this.customerUserId = customerUserId;
    this.relationshipId = relationshipId;
    this.customerCompanyRelationshipId = customerCompanyRelationshipId || relationshipId;
    this.email = email;
    this.invoiceId = invoiceId;
    this.billingSubscriptionId = billingSubscriptionId;
    this.stripeConnectedAccountId = stripeConnectedAccountId;
    this.stripeEventId = stripeEventId;
    this.stripeObjectId = stripeObjectId;
    this.type = type;
    this.amountCents = amountCents;
    this.currency = currency;
    this.status = status;
    this.receivedAt = receivedAt;
    this.processedAt = processedAt;
  }

  toFirestore() {
    return { ...this };
  }

  static fromFirestore(snapshot) {
    return new SalesPaymentEvent({
      id: snapshot.id,
      ...snapshot.data(),
    });
  }
}
