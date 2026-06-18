import {
    getCustomerDisplayName,
    normalizeCustomerForFirestore,
    normalizeDateValue,
} from '../customerLocationData';

export class Customer {
    constructor(data = {}) {
        const normalized = normalizeCustomerForFirestore(data);

        this.id = normalized.id;
        this.firstName = normalized.firstName;
        this.lastName = normalized.lastName;
        this.email = normalized.email;
        this.billingAddress = normalized.billingAddress;
        this.phoneNumber = normalized.phoneNumber;
        this.phoneLabel = normalized.phoneLabel || null;
        this.active = normalized.active;
        this.isActive = normalized.isActive;
        this.company = normalized.company;
        this.displayAsCompany = normalized.displayAsCompany;
        this.hireDate = normalizeDateValue(data.hireDate, null);
        this.billingNotes = normalized.billingNotes;
        this.tags = normalized.tags;
        this.linkedCustomerIds = normalized.linkedCustomerIds;
        this.linkedCustomerUserId = normalized.linkedCustomerUserId;
        this.linkedHomeownerUserId = normalized.linkedHomeownerUserId;
        this.relationshipId = normalized.relationshipId;
        this.customerCompanyRelationshipId = normalized.customerCompanyRelationshipId;
        this.linkedStatus = normalized.linkedStatus;
        this.linkedEmail = normalized.linkedEmail;
        this.linkedAt = normalizeDateValue(data.linkedAt, null);
        this.linkedInviteId = normalized.linkedInviteId;
        this.duplicateKeys = Array.isArray(data.duplicateKeys) ? data.duplicateKeys : normalized.duplicateKeys;
        this.migrationSource = data.migrationSource || null;
        this.sourceContactFields = data.sourceContactFields || null;
        this.mergedCustomerIds = Array.isArray(data.mergedCustomerIds) ? data.mergedCustomerIds : [];
        this.mergeHistory = Array.isArray(data.mergeHistory) ? data.mergeHistory : [];
        this.label = data.label || getCustomerDisplayName(normalized);
    }

    static fromFirestore(snapshot, options) {
        const data = snapshot.data(options) || {};

        return new Customer({
            ...data,
            id: snapshot.id,
            hireDate: normalizeDateValue(data.hireDate, null),
            linkedAt: normalizeDateValue(data.linkedAt, null),
        });
    }

    toFirestore() {
        return normalizeCustomerForFirestore(this);
    }
}
