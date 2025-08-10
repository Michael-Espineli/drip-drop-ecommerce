import { Address } from './Address';
import { format } from 'date-fns/format'; 

export class Customer {
    constructor({
        id = "",
        firstName = "",
        lastName = "",
        email = "",
        billingAddress = {},
        phoneNumber = "",
        phoneLabel = null,
        active = false,
        company = "",
        displayAsCompany = "",
        hireDate,
        billingNotes = "",
        tags = null,
        linkedCustomerIds = null,
        linkedInviteId = "",
        label = "",
    } = {}) {
        this.id = id;
        this.firstName = firstName;
        this.lastName = lastName;
        this.email = email;
        this.billingAddress = billingAddress; //new Address(billingAddress.streetAddress, billingAddress.city, billingAddress.state, billingAddress.zip, billingAddress.latitude, billingAddress.longitude); // Assuming Address needs to be instantiated
        this.phoneNumber = phoneNumber;
        this.phoneLabel = phoneLabel;
        this.active = active;
        this.company = company;
        this.displayAsCompany = displayAsCompany;
        this.hireDate = hireDate; // Assuming hireDate is a Date object or can be converted to one
        this.billingNotes = billingNotes;
        this.tags = tags;
        this.linkedCustomerIds = linkedCustomerIds;
        this.linkedInviteId = linkedInviteId;
        this.label = label;
    }

    static fromFirestore(snapshot, options) {
        const data = snapshot.data(options);
        // console.log("data")
        // console.log(data)
        // console.log("snapshot")
        // console.log(snapshot.id)
        let displayName;
        if (data.displayAsCompany) {
            displayName = data.company
        } else {
            displayName = data.firstName + ' ' + data.lastName
        }
        console.log('Customer Data')
        console.log(data)
        return new Customer({
            id: snapshot.id,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            billingAddress: data.billingAddress,
            phoneNumber: data.phoneNumber || "",
            phoneLabel: data.phoneLabel || null,
            active: data.active,
            company: data.company || "",
            displayAsCompany: data.displayAsCompany,
            hireDate: data.hireDate ? data.hireDate.toDate() : null, // Convert Firestore Timestamp to Date
            billingNotes: data.billingNotes,
            tags: data.tags || null,
            linkedCustomerIds: data.linkedCustomerIds || null,
            linkedInviteId: data.linkedInviteId,
            label: displayName
        });
    }
}

