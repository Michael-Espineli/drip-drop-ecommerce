import { Address } from './Address';
import { Contact } from './Contact';

class ServiceLocation {
  constructor({
    id,
    nickName,
    address,
    gateCode,
    dogName,
    estimatedTime,
    mainContact,
    notes,
    bodiesOfWaterId,
    rateType,
    laborType,
    chemicalCost,
    laborCost,
    rate,
    customerId,
    customerName,
    backYardTree,
    backYardBushes,
    backYardOther,
    preText,
    verified,
    photoUrls,
  }) {
    this.id = id;
    this.nickName = nickName;
    this.address = address;
    this.gateCode = gateCode;
    this.dogName = dogName;
    this.estimatedTime = estimatedTime;
    this.mainContact = mainContact;
    this.notes = notes;
    this.bodiesOfWaterId = bodiesOfWaterId;
    this.rateType = rateType;
    this.laborType = laborType;
    this.chemicalCost = chemicalCost;
    this.laborCost = laborCost;
    this.rate = rate;
    this.customerId = customerId;
    this.customerName = customerName;
    this.backYardTree = backYardTree;
    this.backYardBushes = backYardBushes;
    this.backYardOther = backYardOther;
    this.preText = preText;
    this.verified = verified;
    this.photoUrls = photoUrls;
  }

  // You can add methods here if needed to mirror Swift functions
  // For example, a method to check equality
  isEqual(otherServiceLocation) {
    return (
      this.id === otherServiceLocation.id &&
      this.nickName === otherServiceLocation.nickName &&
      this.gateCode === otherServiceLocation.gateCode &&
      this.estimatedTime === otherServiceLocation.estimatedTime &&
      this.notes === otherServiceLocation.notes &&
      this.rate === otherServiceLocation.rate
    );
  }
}