export class IdInfo {
    constructor({
        id,
        internalId
    }) {
        this.id = id;
        this.internalId = internalId;
    }

    static fromFirestore(snapshot = {}) {
        const data = typeof snapshot?.data === "function" ? snapshot.data() : snapshot;
        const id = typeof snapshot === "string" ? snapshot : (snapshot?.id || data?.id || "");

        return new IdInfo({
            id,
            internalId: data?.internalId || '',
        });
    }
}

export default IdInfo;
