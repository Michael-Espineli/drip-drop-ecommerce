import { Address } from './Address';

class Customer {
    constructor(
        id,
        firstName,
        lastName,
        email,
        billingAddress,
        phoneNumber = null,
        phoneLabel = null,
        active,
        company = null,
        displayAsCompany,
        hireDate,
        billingNotes,
        tags = null,
        linkedCustomerIds = null,
        linkedInviteId
    ) {
        this.id = id;
        this.firstName = firstName;
        this.lastName = lastName;
        this.email = email;
        this.billingAddress = new Address(billingAddress.streetAddress, billingAddress.city, billingAddress.state, billingAddress.zip, billingAddress.latitude, billingAddress.longitude); // Assuming Address needs to be instantiated
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
    }

    // In JavaScript, equality comparison for objects usually requires
    // iterating through properties or using a deep comparison library.
    // A direct equivalent to Swift's static func == is not idiomatic.
    // You would typically implement a method like this if needed:
    equals(otherCustomer) {
        if (!(otherCustomer instanceof Customer)) {
            return false;
        }
        return this.id === otherCustomer.id &&
               this.firstName === otherCustomer.firstName &&
               this.lastName === otherCustomer.lastName &&
               this.email === otherCustomer.email &&
               this.phoneNumber === otherCustomer.phoneNumber;
    }

    // Hashing is not a common concept in standard JavaScript objects
    // in the same way it is in Swift for collections.
    // If you need a unique identifier for use in sets or maps,
    // you would typically just use the `id` property.
}

export { Customer };