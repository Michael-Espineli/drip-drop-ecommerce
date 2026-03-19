import { Timestamp } from "firebase/firestore";

export class Address {
    constructor({ streetAddress = '', city = '', state = '', zip = '' }) {
        this.streetAddress = streetAddress;
        this.city = city;
        this.state = state;
        this.zip = zip;
    }
}

export class DripDropStoredImage {
    constructor({ url = '', caption = '' }) {
        this.url = url;
        this.caption = caption;
    }
}

export class ServiceStop {
    constructor({
        id,
        internalId = '',
        companyId = '',
        companyName = '',
        customerId = '',
        customerName = '',
        address = {},
        dateCreated = new Date(),
        serviceDate = new Date(),
        startTime = null,
        endTime = null,
        duration = 0,
        estimatedDuration = 0,
        tech = '',
        techId = '',
        recurringServiceStopId = '',
        description = '',
        serviceLocationId = '',
        typeId = '',
        type = '',
        typeImage = '',
        jobId = '',
        jobName = null,
        operationStatus = '', // Assuming string for ServiceStopOperationStatus
        billingStatus = '', // Assuming string for ServiceStopBillingStatus
        includeReadings = false,
        includeDosages = false,
        otherCompany = false,
        laborContractId = null,
        contractedCompanyId = null,
        photoUrls = [],
        mainCompanyId = null,
        isInvoiced = false
    }) {
        this.id = id;
        this.internalId = internalId;
        this.companyId = companyId;
        this.companyName = companyName;
        this.customerId = customerId;
        this.customerName = customerName;
        this.address = new Address(address);
        this.dateCreated = dateCreated instanceof Timestamp ? dateCreated.toDate() : dateCreated;
        this.serviceDate = serviceDate instanceof Timestamp ? serviceDate.toDate() : serviceDate;
        this.startTime = startTime instanceof Timestamp ? startTime.toDate() : startTime;
        this.endTime = endTime instanceof Timestamp ? endTime.toDate() : endTime;
        this.duration = duration;
        this.estimatedDuration = estimatedDuration;
        this.tech = tech;
        this.techId = techId;
        this.recurringServiceStopId = recurringServiceStopId;
        this.description = description;
        this.serviceLocationId = serviceLocationId;
        this.typeId = typeId;
        this.type = type;
        this.typeImage = typeImage;
        this.jobId = jobId;
        this.jobName = jobName;
        this.operationStatus = operationStatus;
        this.billingStatus = billingStatus;
        this.includeReadings = includeReadings;
        this.includeDosages = includeDosages;
        this.otherCompany = otherCompany;
        this.laborContractId = laborContractId;
        this.contractedCompanyId = contractedCompanyId;
        this.photoUrls = photoUrls.map(p => new DripDropStoredImage(p));
        this.mainCompanyId = mainCompanyId;
        this.isInvoiced = isInvoiced;
    }

    static fromFirestore(doc) {
        const data = doc.data();
        return new ServiceStop({
            id: doc.id,
            ...data
        });
    }
}
