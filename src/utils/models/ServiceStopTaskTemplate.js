class ServiceStopTaskTemplate {
    constructor(id, description) {
        this.id = id;
        this.description = description;
    }

    static fromFirestore(snapshot) {
        const data = snapshot.data();
        return new ServiceStopTaskTemplate(
            snapshot.id,
            data.description || ''
        );
    }
}