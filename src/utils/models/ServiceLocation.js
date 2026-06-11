
import { normalizeServiceLocationForFirestore } from '../customerLocationData';

export class ServiceLocation {
  constructor(data = {}) {
    const normalized = normalizeServiceLocationForFirestore(data);

    this.id = normalized.id;
    this.nickName = normalized.nickName;
    this.address = normalized.address;
    this.gateCode = normalized.gateCode;
    this.dogName = normalized.dogName;
    this.estimatedTime = normalized.estimatedTime;
    this.mainContact = normalized.mainContact;
    this.notes = normalized.notes;
    this.bodiesOfWaterId = normalized.bodiesOfWaterId;
    this.rateType = normalized.rateType;
    this.laborType = normalized.laborType;
    this.chemicalCost = normalized.chemicalCost;
    this.laborCost = normalized.laborCost;
    this.rate = normalized.rate;
    this.customerId = normalized.customerId;
    this.customerName = normalized.customerName;
    this.backYardTree = normalized.backYardTree;
    this.backYardBushes = normalized.backYardBushes;
    this.backYardOther = normalized.backYardOther;
    this.preText = normalized.preText;
    this.verified = normalized.verified;
    this.photoUrls = normalized.photoUrls;
    this.label = normalized.label;
    this.isActive = normalized.isActive;
    this.active = normalized.active;
  }

  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options) || {};

    return new ServiceLocation({
      id: snapshot.id,
      ...data,
    });
  }

  toFirestore() {
    return normalizeServiceLocationForFirestore(this);
  }

}
