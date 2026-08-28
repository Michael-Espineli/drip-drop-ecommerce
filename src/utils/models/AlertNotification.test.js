import {
  ALERT_STATUS,
  alertIsArchived,
  alertIsScheduled,
  alertIsUnread,
  alertNeedsAttention,
} from "./AlertNotification";

describe("AlertNotification status helpers", () => {
  it("treats archived alerts as hidden from unread, scheduled, and attention states", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const archivedAlert = {
      status: " Archived ",
      read: false,
      scheduledFor: future,
    };

    expect(alertIsArchived(archivedAlert)).toBe(true);
    expect(alertIsUnread(archivedAlert)).toBe(false);
    expect(alertIsScheduled(archivedAlert)).toBe(false);
    expect(alertNeedsAttention(archivedAlert)).toBe(false);
  });

  it("keeps active unread alerts visible", () => {
    const alert = {
      status: ALERT_STATUS.unread,
      read: false,
    };

    expect(alertIsArchived(alert)).toBe(false);
    expect(alertIsUnread(alert)).toBe(true);
    expect(alertNeedsAttention(alert)).toBe(true);
  });
});
