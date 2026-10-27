import { buildJobCreatedHistory, resolveJobCreator, jobHistoryActorName, jobHistoryDate, formatJobHistoryDate } from "./jobHistory";

test("creator resolution prefers the authenticated identity and keeps a readable profile snapshot", () => {
  expect(resolveJobCreator({ user: { uid: "auth-user", displayName: "Auth Name" }, profile: { id: "auth-user", firstName: "Alex", lastName: "Rivera" } })).toEqual({ userId: "auth-user", userName: "Alex Rivera" });
});

test("a profile left from another session cannot mislabel the authenticated creator", () => {
  expect(resolveJobCreator({ user: { uid: "auth-user", displayName: "Current User" }, profile: { id: "other-user", firstName: "Someone Else" } })).toEqual({ userId: "auth-user", userName: "Current User" });
});

test("email or user ID identifies the creator when their display profile is unavailable", () => {
  expect(resolveJobCreator({ user: { uid: "auth-user", displayName: "Unknown", email: "alex@example.com" } }).userName).toBe("alex@example.com");
  expect(resolveJobCreator({ user: { uid: "auth-user" } }).userName).toBe("auth-user");
});

test("creation history carries the creator instead of the assigned admin and uses the supplied server time", () => {
  const event = buildJobCreatedHistory({ job: { id: "job", internalId: "J1", adminId: "admin", adminName: "Assigned Admin" }, creator: { userId: "creator", userName: "Creator" }, createdAt: "server-time", createdAtMillis: 50 });
  expect(event).toEqual(expect.objectContaining({ actorUserId: "creator", actorUserName: "Creator", createdAt: "server-time", createdAtMillis: 50, eventType: "Created" }));
  expect(event.actorUserName).not.toBe("Assigned Admin");
});

test("history presentation uses user IDs and legacy timestamps without inventing authors", () => {
  const time = new Date("2026-10-23T18:30:00Z");
  expect(jobHistoryActorName({ actorUserName: "Unknown", actorUserId: "auth-user" })).toBe("auth-user");
  expect(jobHistoryActorName({})).toBe("Creator not recorded");
  expect(jobHistoryDate({ createdAt: { toDate: () => time } })).toEqual(time);
  expect(jobHistoryDate({ createdAtMillis: time.getTime() })).toEqual(time);
  expect(formatJobHistoryDate({ createdAtMillis: time.getTime() })).toContain("2026");
  expect(formatJobHistoryDate({})).toBe("Time not recorded");
});
