import { getFunctions, httpsCallable } from "firebase/functions";

// The server resolves the recipient's saved account type and customer-email flag.
export const requestAccountEmail = (auth, data) => (
  httpsCallable(getFunctions(auth.app), "sendAccountEmail")(data)
);

export const sendClientEmailVerification = (auth, continuePath) => (
  requestAccountEmail(auth, { kind: "verifyEmail", continuePath })
);
