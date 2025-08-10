
export class ServiceLocation {
  constructor({
    id = "",
    nickName = "",
    address = {},
    gateCode = "",
    dogName = "",
    estimatedTime = "",
    mainContact = {},
    notes = "",
    bodiesOfWaterId = "",
    rateType = "",
    laborType = "",
    chemicalCost = "",
    laborCost = 0,
    rate = 0,
    customerId = "",
    customerName = "",
    backYardTree = "",
    backYardBushes = "",
    backYardOther = "",
    preText = false,
    verified = false,
    photoUrls = [],
    label = "",
  } = {}) {
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
    this.label = label;
  }

  static fromFirestore(snapshot, options) {
    const data = snapshot.data(options);

    return new ServiceLocation({
      id: snapshot.id,
      nickName: data.nickName,
      address: data.address,
      gateCode: data.gateCode,
      dogName: data.dogName || null,
      estimatedTime: data.estimatedTime || null,
      mainContact: data.mainContact,
      notes: data.notes || null,
      bodiesOfWaterId: data.bodiesOfWaterId,
      rateType: data.rateType,
      laborType: data.laborType,
      chemicalCost: data.chemicalCost,
      laborCost: data.laborCost,
      rate: data.rate,
      customerId: data.customerId,
      customerName: data.customerName,
      backYardTree: data.backYardTree || null,
      backYardBushes: data.backYardBushes || null,
      backYardOther: data.backYardOther || null,
      preText: data.preText,
      verified: data.verified,
      photoUrls: data.photoUrls || [], // Assuming photoUrls is an array and can be empty
      label: data.address.streetAddress + ' ' + data.address.city + ' ' +  data.address.state + ' ' + data.address.zip 
    });
  }

  toFirestore() {
    return {
    nickName: this.nickName,
    address: this.address, // Assuming Address has its own toFirestore or is a plain object
    gateCode: this.gateCode,
    dogName: this.dogName,
    estimatedTime: this.estimatedTime,
    mainContact: this.mainContact, // Assuming Contact has its own toFirestore or is a plain object
    notes: this.notes,
    bodiesOfWaterId: this.bodiesOfWaterId,
    rateType: this.rateType,
    laborType: this.laborType,
    chemicalCost: this.chemicalCost,
    laborCost: this.laborCost,
    rate: this.rate,
    customerId: this.customerId,
    customerName: this.customerName,
    backYardTree: this.backYardTree,
    backYardBushes: this.backYardBushes,
    backYardOther: this.backYardOther,
    preText: this.preText,
    verified: this.verified,
    photoUrls: this.photoUrls,
    label: this.label,
    };
  }

}
