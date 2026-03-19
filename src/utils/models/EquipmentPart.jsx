import { Timestamp } from "firebase/firestore";

export class EquipmentPart {
  constructor({
    id = "",
    name = "",
    createdAt = null,
  } = {}) {
    this.id = id;
    this.name = name;
    this.createdAt = createdAt; // JS Date or null
  }

  static fromFirestore(docSnap) {
    const data = docSnap.data();
    return new EquipmentPart({
      id: data.id || docSnap.id,
      name: data.name || "",
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt || null),
    });
  }

  static toFirestore(part) {
    return {
      id: part.id,
      name: part.name,
      createdAt: part.createdAt ? Timestamp.fromDate(part.createdAt) : Timestamp.now(),
    };
  }
}
