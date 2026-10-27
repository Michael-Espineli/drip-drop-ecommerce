import { stageJobCreation } from "./createJobAtomically";

const ref = (path) => ({ path });
const counter = ref("settings/workOrders");
class Store {
  records = new Map();
  version = 0;
  failCommit = false;
  async create(jobId, build = async () => {}, creator = { userId: "creator-auth", userName: "Actual Creator" }) {
    const jobRef = ref(`workOrders/${jobId}`);
    for (let retry = 0; retry < 20; retry += 1) {
      const version = this.version;
      const snapshot = new Map(this.records);
      const staged = [];
      let writing = false;
      const tx = {
        get: async (r) => {
          if (writing) throw Error("Read after write");
          return { exists: () => snapshot.has(r.path), data: () => snapshot.get(r.path) };
        },
        set: (r, data) => { writing = true; staged.push([r.path, data]); },
        update: (r, data) => { writing = true; staged.push([r.path, { ...snapshot.get(r.path), ...data }]); },
      };
      const result = await stageJobCreation(tx, jobRef, async (writer) => {
        const number = ((await writer.get(counter)).data()?.increment || 0) + 1;
        writer.set(counter, { increment: number });
        writer.set(jobRef, { id: jobId, internalId: `J${number}` });
        writer.set(ref(`${jobRef.path}/tasks/task`), { name: "Task" });
        // Real scheduled creation reads another counter after preparing job scope.
        await writer.get(ref("settings/serviceStops"));
        await build(writer);
      }, { creator, companyId: "company", historyRef: ref(`${jobRef.path}/history/created`), createdAt: "server-time", createdAtMillis: 12345 });
      if (this.version !== version) continue;
      if (this.failCommit) throw Error("Commit rejected");
      if (staged.length) { staged.forEach(([path, value]) => this.records.set(path, value)); this.version += 1; }
      return result;
    }
    throw Error("Retries exhausted");
  }
}

test("a late scope failure saves no job, scope, or counter", async () => {
  const store = new Store();
  await expect(store.create("one", async () => { throw Error("Material invalid"); })).rejects.toThrow("Material invalid");
  expect(store.records.size).toBe(0);
});

test("a rejected commit saves no earlier records", async () => {
  const store = new Store(); store.failCommit = true;
  await expect(store.create("one")).rejects.toThrow("Commit rejected");
  expect(store.records.size).toBe(0);
});

test("concurrent creates receive unique consecutive numbers", async () => {
  const store = new Store();
  await Promise.all(["one", "two", "three"].map((id) => store.create(id)));
  expect(new Set(["one", "two", "three"].map((id) => store.records.get(`workOrders/${id}`).internalId))).toEqual(new Set(["J1", "J2", "J3"]));
  expect(store.records.get(counter.path).increment).toBe(3);
});

test("retrying the same job after commit does not duplicate scope or reserve another number", async () => {
  const store = new Store();
  await store.create("one");
  const builder = jest.fn();
  expect((await store.create("one", builder)).existing).toBe(true);
  expect(builder).not.toHaveBeenCalled();
  expect(store.records.size).toBe(4);
  expect(store.records.get(counter.path).increment).toBe(1);
});

test("oversized scope fails before any writes", async () => {
  const store = new Store();
  await expect(store.create("large", async (writer) => {
    for (let i = 0; i < 500; i += 1) writer.set(ref(`materials/${i}`), { id: i });
  })).rejects.toThrow("too many records");
  expect(store.records.size).toBe(0);
});


test("creating a job records its authenticated creator and time atomically", async () => {
  const store = new Store();
  await store.create("one");
  expect(store.records.get("workOrders/one")).toEqual(expect.objectContaining({
    createdByUserId: "creator-auth", createdByUserName: "Actual Creator", createdAt: "server-time", createdAtMillis: 12345,
  }));
  expect(store.records.get("workOrders/one/history/created")).toEqual(expect.objectContaining({
    eventType: "Created", actorUserId: "creator-auth", actorUserName: "Actual Creator", createdAt: "server-time", createdAtMillis: 12345,
  }));
});

test("the creator is separate from the assigned admin and detailed creation history remains intact", async () => {
  const store = new Store();
  await store.create("one", async (writer) => {
    writer.set(ref("workOrders/one/history/detailed"), { id: "detailed", eventType: "Created", title: "Basic job scheduled", actorUserId: "assigned-admin", actorUserName: "Admin", changes: [{ field: "adminId", after: "assigned-admin" }] });
  });
  expect(store.records.has("workOrders/one/history/created")).toBe(false);
  expect(store.records.get("workOrders/one/history/detailed")).toEqual(expect.objectContaining({
    title: "Basic job scheduled", actorUserId: "creator-auth", actorUserName: "Actual Creator", changes: [{ field: "adminId", after: "assigned-admin" }],
  }));
});

test("retrying under another session retains the original creator and initial event", async () => {
  const store = new Store();
  await store.create("one");
  await store.create("one", async () => {}, { userId: "other", userName: "Other User" });
  expect(store.records.get("workOrders/one/history/created").actorUserId).toBe("creator-auth");
  expect([...store.records.keys()].filter((key) => key.includes("/history/"))).toHaveLength(1);
});

test("a missing creator cannot leave an unattributed job behind", async () => {
  const store = new Store();
  await expect(store.create("one", async () => {}, {})).rejects.toThrow("Sign in");
  expect(store.records.size).toBe(0);
});
