// Assuming Address and LaborContractFrequency are defined elsewhere and imported if necessary
import {
    Address
} from './Address'; // Example import, adjust as needed
import {
    LaborContractFrequency
} from './LaborContractFrequency'; // Example import, adjust as needed
import {
    Timestamp
} from 'firebase/firestore'; // Assuming you are using Firebase Firestore

class RecurringServiceStop {
    constructor({
        id,
        internalId,
        type,
        typeId,
        typeImage,
        customerName,
        customerId,
        address,
        tech,
        techId,
        dateCreated,
        startDate,
        endDate,
        noEndDate,
        frequency,
        daysOfWeek,
        description,
        lastCreated,
        serviceLocationId,
        estimatedTime,
        otherCompany,
        laborContractId = null,
        contractedCompanyId = null,
        mainCompanyId = null,
    }) {
        this.id = id;
        this.internalId = internalId;
        this.type = type;
        this.typeId = typeId;
        this.typeImage = typeImage;
        this.customerName = customerName;
        this.customerId = customerId;
        this.address = address;
        this.tech = tech;
        this.techId = techId;
        this.dateCreated = dateCreated;
        this.startDate = startDate;
        this.endDate = endDate;
        this.noEndDate = noEndDate;
        this.frequency = frequency;
        this.daysOfWeek = daysOfWeek;
        this.description = description;
        this.lastCreated = lastCreated;
        this.serviceLocationId = serviceLocationId;
        this.estimatedTime = estimatedTime;
        this.otherCompany = otherCompany;
        this.laborContractId = laborContractId;
        this.contractedCompanyId = contractedCompanyId;
        this.mainCompanyId = mainCompanyId;
    }

    toFirestore() {
        return {
            id: this.id,
            internalId: this.internalId,
            type: this.type,
            typeId: this.typeId,
            typeImage: this.typeImage,
            customerName: this.customerName,
            customerId: this.customerId,
            address: this.address ? .toFirestore() : null, // Assuming Address has toFirestore
            tech: this.tech,
            techId: this.techId,
            dateCreated: this.dateCreated ? Timestamp.fromDate(this.dateCreated) : null,
            startDate: this.startDate ? Timestamp.fromDate(this.startDate) : null,
            endDate: this.endDate ? Timestamp.fromDate(this.endDate) : null,
            noEndDate: this.noEndDate,
            frequency: this.frequency ? .toFirestore() : null, // Assuming LaborContractFrequency has toFirestore
            daysOfWeek: this.daysOfWeek,
            description: this.description,
            lastCreated: this.lastCreated ? Timestamp.fromDate(this.lastCreated) : null,
            serviceLocationId: this.serviceLocationId,
            estimatedTime: this.estimatedTime,
            otherCompany: this.otherCompany,
            laborContractId: this.laborContractId,
            contractedCompanyId: this.contractedCompanyId,
            mainCompanyId: this.mainCompanyId,
        };
    }

    static fromFirestore(snapshot, options) {
        const data = snapshot.data(options);
        return new RecurringServiceStop({
            id: snapshot.id,
            internalId: data.internalId,
            type: data.type,
            typeId: data.typeId,
            typeImage: data.typeImage,
            customerName: data.customerName,
            customerId: data.customerId,
            address: data.address ? .fromFirestore(data.address) : null, // Assuming Address has fromFirestore
            tech: data.tech,
            techId: data.techId,
            dateCreated: data.dateCreated ? data.dateCreated.toDate() : null,
            startDate: data.startDate ? data.startDate.toDate() : null,
            endDate: data.endDate ? data.endDate.toDate() : null,
            noEndDate: data.noEndDate,
            frequency: data.frequency ? .fromFirestore(data.frequency) : null, // Assuming LaborContractFrequency has fromFirestore
            daysOfWeek: data.daysOfWeek,
            description: data.description,
            lastCreated: data.lastCreated ? data.lastCreated.toDate() : null,
            serviceLocationId: data.serviceLocationId,
            estimatedTime: data.estimatedTime,
            otherCompany: data.otherCompany,
            laborContractId: data.laborContractId,
            contractedCompanyId: data.contractedCompanyId,
            mainCompanyId: data.mainCompanyId,
        });
    }

    static isEqual(lhs, rhs) {
        return lhs.id === rhs.id &&
            lhs.type === rhs.type &&
            lhs.typeId === rhs.typeId &&
            lhs.customerId === rhs.customerId &&
            lhs.serviceLocationId === rhs.serviceLocationId;
    }
}

export { RecurringServiceStop };