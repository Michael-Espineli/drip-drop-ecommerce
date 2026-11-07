import { addDoc } from 'firebase/firestore';
import { reportAppError } from './errorReporting';
import { isFirebaseClientStorageError } from './firebaseNetwork';

jest.mock('./config', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(async () => ({ id: 'report' })),
  collection: (_, name) => name,
  serverTimestamp: () => 'server-time',
}));

beforeEach(() => { addDoc.mockResolvedValue({ id: 'report' }); });

test('recognizes raw transaction aborts and wrapped Firestore assertions and skips remote error writes', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const message = 'The transaction was aborted, so the request cannot be fulfilled.';
  const errors = [
    new DOMException(message, 'AbortError'),
    new Error(`FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"hc":"${message}"}`),
  ];
  try {
    for (const error of errors) {
      expect(isFirebaseClientStorageError(error)).toBe(true);
      await expect(reportAppError(error)).resolves.toBeNull();
    }
    expect(addDoc).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
  } finally { warning.mockRestore(); }
});

test('still reports unrelated aborts and internal failures', async () => {
  const errors = [new DOMException('The fetch operation was aborted.', 'AbortError'), new Error('INTERNAL ASSERTION FAILED: unrelated app state')];
  for (const error of errors) {
    expect(isFirebaseClientStorageError(error)).toBe(false);
    await expect(reportAppError(error)).resolves.toEqual({ id: 'report' });
  }
  expect(addDoc).toHaveBeenCalledTimes(2);
});
