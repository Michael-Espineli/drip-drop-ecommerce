class Company {
    constructor(
        id,
        ownerId,
        ownerName,
        name,
        photoUrl = null,
        dateCreated,
        email,
        phoneNumber,
        verified,
        serviceZipCodes,
        services,
        websiteURL,
        yelpURL,
        exp,
        inBusinessSince,
        lastVerified,
        needToVerify
    ) {
        this.id = id;
        this.ownerId = ownerId;
        this.ownerName = ownerName;
        this.name = name;
        this.photoUrl = photoUrl;
        this.dateCreated = dateCreated;
        this.email = email;
        this.phoneNumber = phoneNumber;
        this.verified = verified;
        this.serviceZipCodes = serviceZipCodes;
        this.services = services;
        this.websiteURL = websiteURL;
        this.yelpURL = yelpURL;
        this.exp = exp;
        this.inBusinessSince = inBusinessSince;
        this.lastVerified = lastVerified;
        this.needToVerify = needToVerify;
    }

    static fromFirestore(doc) {
        const data = doc.data();
        return new Company(
            doc.id,
            data.ownerId,
            data.ownerName,
            data.name,
            data.photoUrl || null,
            data.dateCreated ? data.dateCreated.toDate() : null, // Convert Firestore Timestamp to Date
            data.email,
            data.phoneNumber,
            data.verified,
            data.serviceZipCodes || [],
            data.services || [],
            data.websiteURL,
            data.yelpURL,
            data.exp,
            data.inBusinessSince ? data.inBusinessSince.toDate() : null, // Convert Firestore Timestamp to Date
            data.lastVerified ? data.lastVerified.toDate() : null, // Convert Firestore Timestamp to Date
            data.needToVerify
        );
    }

}

export { Company };