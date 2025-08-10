import { v4 as uuidv4 } from 'uuid';
import ServiceLocation from './ServiceLocation'; // To ensure we have the same methods
import { format } from 'date-fns/format'; 
 
export class RecurringLaborContract {
    constructor({
        id = '',
        senderName = '',
        senderId = '',
        senderAcceptance = false,
        receiverName = '',
        receiverId = '',
        receiverAcceptance = false,
        dateSent = '',
        lastDateToAccept = '',
        dateAccepted = null,
        startDate = '',
        endDate = '',
        status = '',
        isActive = '',
        terms = [],
        notes = '',
        atWill = true,
        contractLengthInMonths = null,
    } = {}) {
        this.id = id;
        this.senderName = senderName;
        this.senderId = senderId;
        this.senderAcceptance = senderAcceptance;
        this.receiverName = receiverName;
        this.receiverId = receiverId;
        this.receiverAcceptance = receiverAcceptance;
        this.dateSent = dateSent;
        this.lastDateToAccept = lastDateToAccept;
        this.dateAccepted = dateAccepted;
        this.startDate = startDate;
        this.endDate = endDate;
        this.status = status;
        this.isActive = isActive;
        this.terms = terms;
        this.notes = notes;
        this.atWill = atWill;
        this.contractLengthInMonths = contractLengthInMonths;
    }

    // Example of a method similar to those in ServiceLocation (adjust as needed)
    async save() {
        try {
            const docRef = db.collection('recurringLaborContracts').doc(this.id);
            await docRef.set(this.toFirestore());
            console.log("RecurringLaborContract saved successfully with ID: ", this.id);
        } catch (error) {
            console.error("Error saving RecurringLaborContract: ", error);
            throw error;
        }
    }

    // Example of a method similar to those in ServiceLocation (adjust as needed)
    async delete() {
        try {
            const docRef = db.collection('recurringLaborContracts').doc(this.id);
            await docRef.delete();
            console.log("RecurringLaborContract deleted successfully with ID: ", this.id);
        } catch (error) {
            console.error("Error deleting RecurringLaborContract: ", error);
            throw error;
        }
    }

    // Example of a method similar to those in ServiceLocation (adjust as needed)
    async update(dataToUpdate) {
        try {
            const docRef = db.collection('recurringLaborContracts').doc(this.id);
            await docRef.update(dataToUpdate);
            console.log("RecurringLaborContract updated successfully with ID: ", this.id);
        } catch (error) {
            console.error("Error updating RecurringLaborContract: ", error);
            throw error;
        }
    }


    toFirestore() {
        return {
            id: this.id,
            senderName: this.senderName,
            senderId: this.senderId,
            senderAcceptance: this.senderAcceptance,
            receiverName: this.receiverName,
            receiverId: this.receiverId,
            receiverAcceptance: this.receiverAcceptance,
            dateSent: this.dateSent,
            lastDateToAccept: this.lastDateToAccept,
            dateAccepted: this.dateAccepted,
            startDate: this.startDate,
            endDate: this.endDate,
            status: this.status,
            isActive: this.isActive,
            terms: this.terms,
            notes: this.notes,
            atWill: this.atWill,
            contractLengthInMonths: this.contractLengthInMonths,
        };
    }

    static fromFirestore(snapshot,options) {
        const data = snapshot.data(options);
        return new RecurringLaborContract({
            id: snapshot.id,
            senderName: data.senderName,
            senderId: data.senderId,
            senderAcceptance: data.senderAcceptance,
            receiverName: data.receiverName,
            receiverId: data.receiverId,
            receiverAcceptance: data.receiverAcceptance,
            dateSent: data.dateSent ? data.dateSent.toDate() : null, // Assuming dateSent is a Firestore Timestamp
            lastDateToAccept: data.lastDateToAccept ? data.lastDateToAccept.toDate() : null, // Assuming lastDateToAccept is a Firestore Timestamp
            dateAccepted: data.dateAccepted ? data.dateAccepted.toDate() : null , // Assuming dateAccepted is a Firestore Timestamp
            startDate: data.startDate ? data.startDate.toDate() : null, // Assuming startDate is a Firestore Timestamp
            endDate: data.endDate ? data.endDate.toDate() : null, // Assuming endDate is a Firestore Timestamp
            status: data.status,
            isActive: data.isActive,
            terms: data.terms,
            notes: data.notes,
            atWill: data.atWill,
            contractLengthInMonths: data.contractLengthInMonths,
        });
    }
}

