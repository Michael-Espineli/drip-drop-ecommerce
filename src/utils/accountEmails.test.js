import { getFunctions, httpsCallable } from "firebase/functions";
import { requestAccountEmail, sendClientEmailVerification } from "./accountEmails";

jest.mock("firebase/functions", () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));

test("account emails use the authenticated app's server routing without supplying a delivery address", async () => {
  const send = jest.fn().mockResolvedValue({ data: { accepted: true } });
  const auth = { app: { name: "test-app" } };
  getFunctions.mockReturnValue("functions");
  httpsCallable.mockReturnValue(send);
  await requestAccountEmail(auth, { kind: "passwordReset", email: "client@example.test" });
  await sendClientEmailVerification(auth, "/client/verify-email?redirect=%2Fclient%2Fdashboard");
  expect(getFunctions).toHaveBeenCalledWith(auth.app);
  expect(httpsCallable).toHaveBeenCalledWith("functions", "sendAccountEmail");
  expect(send.mock.calls).toEqual([
    [{ kind: "passwordReset", email: "client@example.test" }],
    [{ kind: "verifyEmail", continuePath: "/client/verify-email?redirect=%2Fclient%2Fdashboard" }],
  ]);
});
