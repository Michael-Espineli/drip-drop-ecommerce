import { isChunkLoadError, recoverFromChunkLoadError } from './chunkLoadRecovery';

describe('chunkLoadRecovery', () => {
  let setTimeoutSpy;

  beforeEach(() => {
    window.sessionStorage.clear();
    setTimeoutSpy = jest.spyOn(window, 'setTimeout').mockImplementation(() => 1);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    window.sessionStorage.clear();
  });

  it('detects webpack chunk load failures', () => {
    const error = new Error('Loading chunk 123 failed.');
    error.name = 'ChunkLoadError';

    expect(isChunkLoadError(error)).toBe(true);
  });

  it('detects static script and stylesheet load events', () => {
    expect(isChunkLoadError({
      target: {
        src: 'https://dripdrop-poolapp.com/static/js/main.123.js',
      },
    })).toBe(true);

    expect(isChunkLoadError({
      target: {
        href: 'https://dripdrop-poolapp.com/static/css/main.123.css',
      },
    })).toBe(true);
  });

  it('detects syntax errors reported from static chunk filenames', () => {
    expect(isChunkLoadError({
      filename: 'https://dripdrop-poolapp.com/static/js/9919.c08ac525.chunk.js',
      lineNumber: 1,
      columnNumber: 1,
      error: {
        name: 'SyntaxError',
        message: "Unexpected token '<'",
      },
    })).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Permission denied'))).toBe(false);
  });

  it('schedules one reload for the same bundle and page', () => {
    const error = new Error('Loading chunk admin-errors failed.');
    error.name = 'ChunkLoadError';

    expect(recoverFromChunkLoadError(error, { reloadDelayMs: 25 })).toBe(true);
    expect(recoverFromChunkLoadError(error, { reloadDelayMs: 25 })).toBe(false);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25);
  });
});
