export class PurchasedItem {
    constructor(id, receiptId, invoiceNum, venderId, venderName, techId, techName, itemId, name, price, quantityString, date, billable, invoiced, returned, customerId, customerName, sku, notes, jobId, billingRate, assignmentStatus = "unassigned", assignedToJob = false, assignedJobId = "", billingOwner = "purchasedItem", jobBillingStatus = "", jobBillable = false, jobBillingRate = 0) {
        this.id = id;
        this.receiptId = receiptId;
        this.invoiceNum = invoiceNum;
        this.venderId = venderId;
        this.venderName = venderName;
        this.techId = techId;
        this.techName = techName;
        this.itemId = itemId;
        this.name = name;
        this.price = price;
        this.quantityString = quantityString;
        this.date = date;
        this.billable = billable;
        this.invoiced = invoiced;
        this.returned = returned;
        this.customerId = customerId;
        this.customerName = customerName;
        this.sku = sku;
        this.notes = notes;
        this.jobId = jobId;
        this.billingRate = billingRate;
        this.assignmentStatus = assignmentStatus;
        this.assignedToJob = assignedToJob;
        this.assignedJobId = assignedJobId;
        this.billingOwner = billingOwner;
        this.jobBillingStatus = jobBillingStatus;
        this.jobBillable = jobBillable;
        this.jobBillingRate = jobBillingRate;
    }

    get quantity() {
        return parseFloat(this.quantityString) || 0.00;
    }

    static fromFirestore(snapshot, options) {
        const data = snapshot.data(options);
        return new PurchasedItem(
            snapshot.id,
            data.receiptId,
            data.invoiceNum,
            data.venderId,
            data.venderName,
            data.techId,
            data.techName,
            data.itemId,
            data.name,
            parseFloat(data.price) || 0.00, // Ensure price is a number
            data.quantityString,
            data.date ? data.date.toDate() : null, // Convert Firestore Timestamp to Date
            data.billable,
            data.invoiced,
            data.returned,
            data.customerId,
            data.customerName,
            data.sku,
            data.notes,
            data.jobId,
            data.billingRate,
            data.assignmentStatus || (data.jobId || data.workOrderId ? "assignedToJob" : "unassigned"),
            Boolean(data.assignedToJob || data.jobId || data.workOrderId),
            data.assignedJobId || data.jobId || data.workOrderId || "",
            data.billingOwner || (data.jobId || data.workOrderId ? "job" : "purchasedItem"),
            data.jobBillingStatus || (data.jobId || data.workOrderId ? "handledByJob" : ""),
            Boolean(data.jobBillable),
            data.jobBillingRate || 0
        );
    }

    get total() {
        return this.price * this.quantity;
    }

    get totalAfterTax() {
        return this.total * 1.085;
    }

    equals(otherItem) {
        if (!(otherItem instanceof PurchasedItem)) {
            return false;
        }
        return this.id === otherItem.id &&
            this.name === otherItem.name &&
            this.invoiceNum === otherItem.invoiceNum &&
            this.receiptId === otherItem.receiptId &&
            this.itemId === otherItem.itemId;
    }

    toFirestore() {
        return {
            receiptId: this.receiptId,
            invoiceNum: this.invoiceNum,
            venderId: this.venderId,
            venderName: this.venderName,
            techId: this.techId,
            techName: this.techName,
            itemId: this.itemId,
            name: this.name,
            price: this.price,
            quantityString: this.quantityString,
            date: this.date,
            billable: this.billable,
            invoiced: this.invoiced,
            returned: this.returned,
            customerId: this.customerId,
            customerName: this.customerName,
            sku: this.sku,
            notes: this.notes,
            jobId: this.jobId,
            billingRate: this.billingRate,
            assignmentStatus: this.assignmentStatus,
            assignedToJob: this.assignedToJob,
            assignedJobId: this.assignedJobId,
            billingOwner: this.billingOwner,
            jobBillingStatus: this.jobBillingStatus,
            jobBillable: this.jobBillable,
            jobBillingRate: this.jobBillingRate,
        };
    }
}
