import { listenForForegroundRefresh } from './firestoreCounts';

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  jest.useRealTimers();
});

const foreground = () => {
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
};
const advance = async () => {
  jest.advanceTimersByTime(250);
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

test('coalesces focus and visibility events, skips hidden tabs, and cancels pending work on disposal', async () => {
  const refresh = jest.fn();
  const dispose = listenForForegroundRefresh(refresh);
  foreground();
  await advance();
  expect(refresh).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  foreground();
  await advance();
  expect(refresh).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  foreground();
  dispose();
  await jest.runOnlyPendingTimers();
  foreground();
  await advance();
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('does not overlap slow refreshes and permits another refresh once they finish', async () => {
  let finish;
  const refresh = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const dispose = listenForForegroundRefresh(refresh);
  try {
    foreground();
    await advance();
    foreground();
    await advance();
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    foreground();
    await advance();
    expect(refresh).toHaveBeenCalledTimes(2);
    finish();
    await Promise.resolve();
  } finally { dispose(); }
});

test('handles a rejected refresh without creating an unhandled rejection', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  const error = new Error('Connection unavailable');
  const refresh = jest.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const dispose = listenForForegroundRefresh(refresh);
  try {
    foreground();
    await advance();
    await Promise.resolve();
    expect(errorLog).toHaveBeenCalledWith('Unable to refresh foreground counts:', error);
    foreground();
    await advance();
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally { dispose(); errorLog.mockRestore(); }
});
