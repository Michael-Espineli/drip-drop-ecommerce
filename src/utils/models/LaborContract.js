// Define necessary enums or types if they exist in your project
// Example:
// const LaborContractStatus = {
//   Pending: 'pending',
//   Accepted: 'accepted',
//   Rejected: 'rejected',
// };

// const LaborContractType = {
//     OneTime: 'oneTime',
//     Recurring: 'recurring'
// }

// If IdInfo is a class/struct, you might need a corresponding Javascript class
// class IdInfo {
//   constructor({ id, name }) {
//     this.id = id;
//     this.name = name;
//   }
//   toFirestore() {
//     return {
//       id: this.id,
//       name: this.name,
//     };
//   }
// }

// If ContractTerms is a class/struct, you might need a corresponding Javascript class
// class ContractTerms {
//   constructor({ term, value }) {
//     this.term = term;
//     this.value = value;
//   }
//   toFirestore() {
//     return {
//       term: this.term,
//       value: this.value,
//     };
//   }
// }

class LaborContract {
  constructor({
    id,
    senderName,
    senderId,
    senderAcceptance,
    receiverName,
    receiverId,
    receiverAcceptance,
    type,
    dateSent,
    lastDateToAccept,
    dateAccepted,
    status,
    terms,
    notes,
    rate,
    senderJobId,
    customerId,
    customerName,
    serviceLocationId,
    serviceLocationName,
    jobTemplateId,
    jobTemplateName,
    isInvoiced,
    invoiceRef,
  }) {
    this.id = id || 'lc_' + this.generateUUID();
    this.senderName = senderName;
    this.senderId = senderId;
    this.senderAcceptance = senderAcceptance;
    this.receiverName = receiverName;
    this.receiverId = receiverId;
    this.receiverAcceptance = receiverAcceptance;
    this.type = type;
    this.dateSent = dateSent instanceof Date ? dateSent : (dateSent ? new Date(dateSent) : null);
    this.lastDateToAccept = lastDateToAccept instanceof Date ? lastDateToAccept : (lastDateToAccept ? new Date(lastDateToAccept) : null);
    this.dateAccepted = dateAccepted instanceof Date ? dateAccepted : (dateAccepted ? new Date(dateAccepted) : null);
    this.status = status;
    this.terms = terms || [];
    this.notes = notes;
    this.rate = rate;
    this.senderJobId = senderJobId; // Assuming IdInfo is handled as an object
    this.customerId = customerId;
    this.customerName = customerName;
    this.serviceLocationId = serviceLocationId;
    this.serviceLocationName = serviceLocationName;
    this.jobTemplateId = jobTemplateId;
    this.jobTemplateName = jobTemplateName;
    this.isInvoiced = isInvoiced;
    this.invoiceRef = invoiceRef; // Assuming IdInfo is handled as an object
  }

  // Helper to generate UUIDs (basic example)
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0,
        v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }


  toFirestore() {
    const firestoreData = {
      id: this.id,
      senderName: this.senderName,
      senderId: this.senderId,
      senderAcceptance: this.senderAcceptance,
      receiverName: this.receiverName,
      receiverId: this.receiverId,
      receiverAcceptance: this.receiverAcceptance,
      type: this.type,
      dateSent: this.dateSent,
      lastDateToAccept: this.lastDateToAccept,
      dateAccepted: this.dateAccepted,
      status: this.status,
      terms: this.terms.map(term => term.toFirestore ? term.toFirestore() : term), // Assuming ContractTerms has toFirestore
      notes: this.notes,
      rate: this.rate,
      senderJobId: this.senderJobId ? (this.senderJobId.toFirestore ? this.senderJobId.toFirestore() : this.senderJobId) : null, // Assuming IdInfo has toFirestore
      customerId: this.customerId,
      customerName: this.customerName,
      serviceLocationId: this.serviceLocationId,
      serviceLocationName: this.serviceLocationName,
      jobTemplateId: this.jobTemplateId,
      jobTemplateName: this.jobTemplateName,
      isInvoiced: this.isInvoiced,
      invoiceRef: this.invoiceRef ? (this.invoiceRef.toFirestore ? this.invoiceRef.toFirestore() : this.invoiceRef) : null, // Assuming IdInfo has toFirestore
    };
    return firestoreData;
  }
}