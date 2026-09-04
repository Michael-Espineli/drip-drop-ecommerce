import { sendPasswordResetEmail } from "firebase/auth";
import {
  PASSWORD_RESET_RECENTLY_SENT_CODE,
  clearPasswordResetRequestCache,
  getPasswordResetRecipientEmail,
  sendAccountPasswordResetEmail,
} from "./passwordReset";

jest.mock("firebase/auth", () => ({
  sendPasswordResetEmail: jest.fn(),
}));

describe("password reset helpers", () => {
  beforeEach(() => {
    clearPasswordResetRequestCache();
    sendPasswordResetEmail.mockReset();
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
    sendPasswordResetEmail.mockReturnValue(new Promise((resolve) => {
      resolveReset = resolve;
    }));

    const firstRequest = sendAccountPasswordResetEmail({}, "User@example.com");
    const secondRequest = sendAccountPasswordResetEmail({}, " user@example.com ");

    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({}, "User@example.com");

    resolveReset();

    await expect(firstRequest).resolves.toBe("User@example.com");
    await expect(secondRequest).resolves.toBe("User@example.com");
  });

  it("blocks repeat sends shortly after a successful reset email", async () => {
    sendPasswordResetEmail.mockResolvedValue();

    await sendAccountPasswordResetEmail({}, "user@example.com");

    await expect(sendAccountPasswordResetEmail({}, "USER@example.com"))
      .rejects
      .toMatchObject({ code: PASSWORD_RESET_RECENTLY_SENT_CODE });
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it("allows retrying after Firebase rejects a reset request", async () => {
    const resetError = new Error("Firebase unavailable");
    sendPasswordResetEmail
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce();

    await expect(sendAccountPasswordResetEmail({}, "user@example.com")).rejects.toBe(resetError);
    await expect(sendAccountPasswordResetEmail({}, "user@example.com")).resolves.toBe("user@example.com");

    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
  });
});
