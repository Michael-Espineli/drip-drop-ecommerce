import {
  IdInfo
} from "./IdInfo";

export class Contract {
  constructor({
    id,
    internalId,
    companyName,
    companyId,
    companyAcceptance,
    customerName,
    customerId,
    customerAcceptance,
    userId,
    userName,
    jobId,
    invoiceId,
    dateSent,
    lastDateToAccept,
    dateAccepted,
    status,
    acceptanceType,
    accountingTerms,
    terms,
    notes,
    rate,
    lineItems,
  }) {
    this.id = id;
    this.internalId = internalId;
    this.companyName = companyName;
    this.companyId = companyId;
    this.companyAcceptance = companyAcceptance;
    this.customerName = customerName;
    this.customerId = customerId;
    this.customerAcceptance = customerAcceptance;
    this.userId = userId;
    this.userName = userName;
    this.jobId = jobId;
    this.invoiceId = invoiceId;
    this.dateSent = dateSent;
    this.lastDateToAccept = lastDateToAccept;
    this.dateAccepted = dateAccepted;
    this.status = status;
    this.acceptanceType = acceptanceType;
    this.accountingTerms = accountingTerms;
    this.terms = terms;
    this.notes = notes;
    this.rate = rate;
    this.lineItems = lineItems;
  }

  toFirestore() {
    return {
      id: this.id,
      internalId: this.internalId,
      companyName: this.companyName,
      companyId: this.companyId,
      companyAcceptance: this.companyAcceptance,
      customerName: this.customerName,
      customerId: this.customerId,
      customerAcceptance: this.customerAcceptance,
      userId: this.userId,
      userName: this.userName,
      jobId: this.jobId,
      invoiceId: this.invoiceId,
      dateSent: this.dateSent,
      lastDateToAccept: this.lastDateToAccept,
      dateAccepted: this.dateAccepted,
      status: this.status,
      acceptanceType: this.acceptanceType,
      accountingTerms: this.accountingTerms,
      terms: this.terms,
      notes: this.notes,
      rate: this.rate,
      lineItems: this.lineItems,
    };
  }

  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options);
    return new Contract({
      id: snapshot.id,
      internalId: data.internalId,
      companyName: data.companyName,
      companyId: data.companyId,
      companyAcceptance: data.companyAcceptance,
      customerName: data.customerName,
      customerId: data.customerId,
      customerAcceptance: data.customerAcceptance,
      userId: data.userId,
      userName: data.userName,
      jobId: data.jobId,
      invoiceId: data.invoiceId,
      dateSent: data.dateSent ? data.dateSent.toDate() : null,
      lastDateToAccept: data.lastDateToAccept ?
        data.lastDateToAccept.toDate() :
        null,
      dateAccepted: data.dateAccepted ? data.dateAccepted.toDate() : null,
      status: data.status,
      acceptanceType: data.acceptanceType,
      accountingTerms: data.accountingTerms,
      terms: data.terms,
      notes: data.notes,
      rate: data.rate,
      lineItems: data.lineItems,
    });
  }
}

export const ContractStatus = {
  pending: "pending",
  accepted: "accepted",
  rejected: "rejected",
  expired: "expired",
};

export const JobEstiamteAcceptanceType = {
  electronicSignature: "electronicSignature",
  physicalSignature: "physicalSignature",
  verbal: "verbal",
  email: "email",
};

export const AcountingTermsTypes = {
  dueOnReceipt: "dueOnReceipt",
  net7: "net7",
  net14: "net14",
  net30: "net30",
  net60: "net60",
};

export class ContractTerms {
  constructor({
    title,
    description
  }) {
    this.title = title;
    this.description = description;
  }
}

export class StripeInvoiceLineItems {
  constructor({
    description,
    quantity,
    price
  }) {
    this.description = description;
    this.quantity = quantity;
    this.price = price;
  }
}



