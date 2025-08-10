class IdInfo {
    constructor({
        id,
        internalId
    }) {
        this.id = id;
        this.internalId = internalId;
    }

    static fromFirestore(snapshot) {
        const data = snapshot.data();
        return new IdInfo({
            id: snapshot.id,
            internalId: data.internalId || '',
        });
    }
}