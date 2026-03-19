export class AssociatedBusiness {
  constructor({
      id = "",
      companyId = "",
      companyName = "",
  } = {}) {
      this.id = id;
      this.companyId = companyId;
      this.companyName = companyName;
  }
    static fromFirestore(snapshot, options) {
      const data = snapshot.data(options);
      return new AssociatedBusiness({
          id: snapshot.id,
          companyId: data.companyId,
          companyName: data.companyName,
      });
  }
  }  