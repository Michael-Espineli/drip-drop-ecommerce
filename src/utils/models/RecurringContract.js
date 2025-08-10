import { v4 as uuidv4 } from 'uuid';

export class RecurringContract {
    constructor({
        id = "rc_" + uuidv4(),
        chemType,
        cleaningPlan,
        repairType,
        repairAmountMax,
        filterServiceType,
        companyId,
        companyName,
        internalCustomerId,
        internalCustomerName,
        clientId,
        email,
        dateSent,
        dateToAccept,
        laborRate,
        laborType,
        locationCount,
        internalNotes,
        rate,
        rateType,
        serviceLocationIds,
        status,
        terms,
        priceId,
        productId,
        stripeCustomerId,
        connectedAccountId,
        subscriptionId,
        serviceFrequency,
        serviceFrequencyAmount,
        companySetUp,
        atWill,
        externalNotes,
    }) {
        this.id = id;
        this.chemType = chemType;
        this.cleaningPlan = cleaningPlan;
        this.repairType = repairType;
        this.repairAmountMax = repairAmountMax;
        this.filterServiceType = filterServiceType;
        this.companyId = companyId;
        this.companyName = companyName;
        this.internalCustomerId = internalCustomerId;
        this.internalCustomerName = internalCustomerName;
        this.clientId = clientId;
        this.email = email;
        this.dateSent = dateSent;
        this.dateToAccept = dateToAccept;
        this.laborRate = laborRate;
        this.laborType = laborType;
        this.locationCount = locationCount;
        this.internalNotes = internalNotes;
        this.rate = rate;
        this.rateType = rateType;
        this.serviceLocationIds = serviceLocationIds;
        this.status = status;
        this.terms = terms;
        this.priceId = priceId;
        this.productId = productId;
        this.stripeCustomerId = stripeCustomerId;
        this.connectedAccountId = connectedAccountId;
        this.subscriptionId = subscriptionId;
        this.serviceFrequency = serviceFrequency;
        this.serviceFrequencyAmount = serviceFrequencyAmount;
        this.companySetUp = companySetUp;
        this.atWill = atWill;
        this.externalNotes = externalNotes;
    }

    toFirestore() {
        return {
            id: this.id,
            chemType: this.chemType,
            cleaningPlan: this.cleaningPlan,
            repairType: this.repairType,
            repairAmountMax: this.repairAmountMax,
            filterServiceType: this.filterServiceType,
            companyId: this.companyId,
            companyName: this.companyName,
            internalCustomerId: this.internalCustomerId,
            internalCustomerName: this.internalCustomerName,
            clientId: this.clientId,
            email: this.email,
            dateSent: this.dateSent,
            dateToAccept: this.dateToAccept,
            laborRate: this.laborRate,
            laborType: this.laborType,
            locationCount: this.locationCount,
            internalNotes: this.internalNotes,
            rate: this.rate,
            rateType: this.rateType,
            serviceLocationIds: this.serviceLocationIds,
            status: this.status,
            terms: this.terms,
            priceId: this.priceId,
            productId: this.productId,
            stripeCustomerId: this.stripeCustomerId,
            connectedAccountId: this.connectedAccountId,
            subscriptionId: this.subscriptionId,
            serviceFrequency: this.serviceFrequency,
            serviceFrequencyAmount: this.serviceFrequencyAmount,
            companySetUp: this.companySetUp,
            atWill: this.atWill,
            externalNotes: this.externalNotes,
        };
    }

    static fromFirestore(snapshot) {
        const data = snapshot.data();
        return new RecurringContract({
            id: snapshot.id,
            chemType: data.chemType,
            cleaningPlan: data.cleaningPlan,
            repairType: data.repairType,
            repairAmountMax: data.repairAmountMax,
            filterServiceType: data.filterServiceType,
            companyId: data.companyId,
            companyName: data.companyName,
            internalCustomerId: data.internalCustomerId,
            internalCustomerName: data.internalCustomerName,
            clientId: data.clientId,
            email: data.email,
            dateSent: data.dateSent,
            dateToAccept: data.dateToAccept,
            laborRate: data.laborRate,
            laborType: data.laborType,
            locationCount: data.locationCount,
            internalNotes: data.internalNotes,
            rate: data.rate,
            rateType: data.rateType,
            serviceLocationIds: data.serviceLocationIds,
            status: data.status,
            terms: data.terms,
            priceId: data.priceId,
            productId: data.productId,
            stripeCustomerId: data.stripeCustomerId,
            connectedAccountId: data.connectedAccountId,
            subscriptionId: data.subscriptionId,
            serviceFrequency: data.serviceFrequency,
            serviceFrequencyAmount: data.serviceFrequencyAmount,
            companySetUp: data.companySetUp,
            atWill: data.atWill,
            externalNotes: data.externalNotes,
        });
    }

    // Add other methods as needed, similar to ServiceLocation.js
    // For example, you might have methods for validation, updating properties, etc.

    // Example of a method similar to one you might find in ServiceLocation
    // async getServiceLocations() {
    //     // This would involve fetching the ServiceLocation documents
    //     // based on the serviceLocationIds array.
    //     // You would need access to your database instance here.
    //     // This is just a placeholder.
    //     console.log("Fetching associated service locations for contract:", this.id);
    //     // return fetchedServiceLocations;
    // }
}

