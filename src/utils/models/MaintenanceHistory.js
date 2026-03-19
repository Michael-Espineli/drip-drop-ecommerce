export class MaintenanceHistory {
    constructor({
      id = "",
      name = "",
      type = "Maintenance",
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
      return new MaintenanceHistory({
        id: data.id || docSnap.id,
        name: data.name || "",
        type: data.type || "Maintenance",
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
  