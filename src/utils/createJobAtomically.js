import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { buildJobCreatedHistory } from "./jobHistory";

// Stage writes until every counter/source read has completed. Firestore requires
// all transaction reads before writes, even when scope builders read late.
export const stageJobCreation = async (transaction, jobRef, build, {
  creator, historyRef, companyId = "", createdAt = serverTimestamp(), createdAtMillis = Date.now(),
} = {}) => {
  const existing = await transaction.get(jobRef);
  if (existing.exists()) return { existing: true, job: existing.data() };
  const writes = [];
  const writer = {
    get: (ref) => transaction.get(ref),
    set: (...args) => { writes.push(["set", args]); },
    update: (...args) => { writes.push(["update", args]); },
  };
  const result = await build(writer);
  const rootWrite = writes.find(([method, args]) => method === "set" && args[0].path === jobRef.path);
  if (!rootWrite) throw new Error("Job creation did not include the job record.");
  const createdWrite = writes.find(([method, args]) => method === "set" &&
    args[0].path.startsWith(`${jobRef.path}/history/`) && args[1].eventType === "Created");
  const targetHistoryRef = createdWrite?.[1][0] || historyRef;
  if (!targetHistoryRef) throw new Error("Job creation did not include a history reference.");
  const event = buildJobCreatedHistory({ job: { ...rootWrite[1][1], companyId: rootWrite[1][1].companyId || companyId }, creator, createdAt, createdAtMillis,
    previous: createdWrite?.[1][1], id: targetHistoryRef.path.split("/").pop() });
  rootWrite[1][1] = { ...rootWrite[1][1], createdByUserId: event.actorUserId, createdByUserName: event.actorUserName,
    createdByCompanyUserId: event.actorCompanyUserId, createdAt, createdAtMillis,
    lastHistoryEventId: event.id, lastHistoryEventTitle: event.title, lastHistoryEventType: "Created" };
  if (createdWrite) createdWrite[1][1] = event;
  else writes.push(["set", [targetHistoryRef, event]]);
  if (writes.length > 500) {
    const error = new Error("This job has too many records to save together. Reduce its scope before creating it.");
    error.code = "job-scope-too-large";
    throw error;
  }
  writes.forEach(([method, args]) => transaction[method](...args));
  return { ...result, existing: false };
};

export const createJobAtomically = (db, { companyId, jobId, creator }, build) => {
  const jobRef = doc(db, "companies", companyId, "workOrders", jobId);
  return runTransaction(db, (transaction) => stageJobCreation(transaction, jobRef, build, {
    creator, companyId, historyRef: doc(jobRef, "history", "created"),
  }));
};
