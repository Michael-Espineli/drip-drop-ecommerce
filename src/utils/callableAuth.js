import { auth } from './config';

export const getCallableAuthPayload = async () => {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('You must be signed in before sending.');
  }

  return {
    idToken: await currentUser.getIdToken(true),
  };
};
