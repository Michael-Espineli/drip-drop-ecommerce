export class RepairHistory {
    constructor({
      id = "",
      name = "",
      type = "Repair",
      date = null,
      performedBy = "",
      description = "",
      techId = "",
      techName = "",
      jobId = "",
      partIds = [],
    } = {}) {
      this.id = id;
      this.name = name;
      this.type = type;
      this.date = date; // JS Date or null
      this.performedBy = performedBy;
      this.description = description;
      this.techId = techId;
      this.techName = techName;
      this.jobId = jobId;
      this.partIds = Array.isArray(partIds) ? partIds : [];
    }
  
    static fromFirestore(docSnap) {
      const data = docSnap.data();
      return new RepairHistory({
        id: data.id || docSnap.id,
        name: data.name || "",
        type: data.type || "Repair",
        date: data.date?.toDate ? data.date.toDate() : (data.date || null),
        performedBy: data.performedBy || "",
        description: data.description || "",
        techId: data.techId || "",
        techName: data.techName || "",
        jobId: data.jobId || "",
        partIds: Array.isArray(data.partIds) ? data.partIds : [],
      });
    }
  }
  