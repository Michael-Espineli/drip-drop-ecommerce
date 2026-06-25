export class ServiceStopTaskTemplate {
    constructor(id, description) {
        this.id = id;
        this.description = description;
    }

    static fromFirestore(snapshot = {}) {
        const data = typeof snapshot?.data === "function" ? snapshot.data() : snapshot;

        return new ServiceStopTaskTemplate(
            snapshot?.id || data?.id || '',
            data?.description || ''
        );
    }
}

export default ServiceStopTaskTemplate;
