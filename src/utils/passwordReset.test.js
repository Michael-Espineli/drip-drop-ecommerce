import { requestAccountEmail } from "./accountEmails";
import {
  PASSWORD_RESET_RECENTLY_SENT_CODE,
  clearPasswordResetRequestCache,
  getPasswordResetRecipientEmail,
  sendAccountPasswordResetEmail,
} from "./passwordReset";

jest.mock("./accountEmails", () => ({
  requestAccountEmail: jest.fn(),
}));

describe("password reset helpers", () => {
  beforeEach(() => {
    clearPasswordResetRequestCache();
    requestAccountEmail.mockReset();
  });

  it("uses the first non-empty trimmed email", () => {
    expect(getPasswordResetRecipientEmail("", "  user@example.com  ", "other@example.com"))
      .toBe("user@example.com");
  });

  it("requires an email address", async () => {
    await expect(sendAccountPasswordResetEmail({}, " "))
      .rejects
      .toMatchObject({ code: "auth/missing-email" });
  });

  it("shares an in-flight reset request for the same email", async () => {
    let resolveReset;
    requestAccountEmail.mockReturnValue(new Promise((resolve) => {
      resolveReset = resolve;
    }));

    const firstRequest = sendAccountPasswordResetEmail({}, "User@example.com");
    const secondRequest = sendAccountPasswordResetEmail({}, " user@example.com ");

    expect(requestAccountEmail).toHaveBeenCalledTimes(1);
    expect(requestAccountEmail).toHaveBeenCalledWith({}, { kind: "passwordReset", email: "User@example.com" });

    resolveReset();

    await expect(firstRequest).resolves.toBe("User@example.com");
    await expect(secondRequest).resolves.toBe("User@example.com");
  });

  it("blocks repeat sends shortly after a successful reset email", async () => {
    requestAccountEmail.mockResolvedValue();

    await sendAccountPasswordResetEmail({}, "user@example.com");

    await expect(sendAccountPasswordResetEmail({}, "USER@example.com"))
      .rejects
      .toMatchObject({ code: PASSWORD_RESET_RECENTLY_SENT_CODE });
    expect(requestAccountEmail).toHaveBeenCalledTimes(1);
  });

  it("allows retrying after Firebase rejects a reset request", async () => {
    const resetError = new Error("Firebase unavailable");
    requestAccountEmail
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce();

    await expect(sendAccountPasswordResetEmail({}, "user@example.com")).rejects.toBe(resetError);
    await expect(sendAccountPasswordResetEmail({}, "user@example.com")).resolves.toBe("user@example.com");

    expect(requestAccountEmail).toHaveBeenCalledTimes(2);
  });
});
