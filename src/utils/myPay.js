import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "./config";
import { isCompanyAccessInactive } from "./invites";

export function canViewOwnPay({ user, recentlySelectedCompany, companyUserAccess, companyOwnerId, companyRoleLoading, companyRoleLoaded }) {
  return Boolean(user?.uid && recentlySelectedCompany && companyRoleLoaded && !companyRoleLoading &&
    (companyOwnerId === user.uid || (companyUserAccess && !isCompanyAccessInactive(companyUserAccess))));
}

const records = (snapshot, technicianId) => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }))
  .filter(item => item.technicianId === technicianId);

export async function loadMyPay(companyId, technicianId, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 365);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const [lineItems, statements] = await Promise.all([
    getDocs(query(collection(db, "companies", companyId, "technicianPayLineItems"),
      where("technicianId", "==", technicianId), where("completedDate", ">=", start), where("completedDate", "<=", end))),
    getDocs(query(collection(db, "companies", companyId, "technicianPayStatements"), where("technicianId", "==", technicianId))),
  ]);
  return { lineItems: records(lineItems, technicianId), statements: records(statements, technicianId) };
}

// Statements can include work outside the snapshot period. Every query still requires the current user.
export async function loadMyStatementLines(companyId, technicianId, statement) {
  if (statement.technicianId !== technicianId) throw new Error("This paysheet belongs to another technician.");
  const base = collection(db, "companies", companyId, "technicianPayLineItems");
  const ids = [...new Set((Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []).filter(id => typeof id === "string" && id))];
  const linked = await getDocs(query(base, where("technicianId", "==", technicianId), where("payStatementId", "==", statement.id)));
  const linkedIds = new Set(records(linked, technicianId).map(item => item.id));
  const missingIds = ids.filter(id => !linkedIds.has(id));
  const requests = [];
  for (let index = 0; index < missingIds.length; index += 10) {
    requests.push(getDocs(query(base, where("technicianId", "==", technicianId), where(documentId(), "in", missingIds.slice(index, index + 10)))));
  }
  const snapshots = [linked, ...await Promise.all(requests)];
  const byId = new Map(snapshots.flatMap(snapshot => records(snapshot, technicianId))
    .filter(item => item.payStatementId === statement.id || ids.includes(item.id)).map(item => [item.id, item]));
  return { lines: [...byId.values()], missingCount: ids.filter(id => !byId.has(id)).length };
}
