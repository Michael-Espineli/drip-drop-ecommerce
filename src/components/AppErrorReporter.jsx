import { useEffect, useRef } from 'react';
import { reportAppError } from '../utils/errorReporting';
import { isFirebaseClientStorageError } from '../utils/firebaseNetwork';
import { isChunkLoadError, recoverFromChunkLoadError } from '../utils/chunkLoadRecovery';

const normalizeUnhandledReason = (reason) => {
  if (reason instanceof Error) return reason;
  if (reason?.reason instanceof Error) return reason.reason;
  if (reason?.message) return reason;
  return new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
};

const getFailedResourceUrl = (event) => {
  const target = event?.target || event?.srcElement;
  return target?.src || target?.href || event?.filename || '';
};

function AppErrorReporter({ context }) {
  const contextRef = useRef(context);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    const reportSafely = (error, options) => {
      reportAppError(error, options).catch((reportingError) => {
        console.warn('Unable to queue app error report:', reportingError);
      });
    };

    const handleWindowError = (event) => {
      const hasChunkLoadError = isChunkLoadError(event.error) || isChunkLoadError(event);
      const recoveryStarted = recoverFromChunkLoadError(hasChunkLoadError ? event : event.error || event);
      const error = event.error
        || event.message
        || (hasChunkLoadError ? new Error('Static app chunk failed to load') : 'Window error');

      if (isFirebaseClientStorageError(error)) {
        event.preventDefault();
      }

      if (hasChunkLoadError) {
        event.preventDefault();
      }

      reportSafely(error, {
        context: contextRef.current,
        source: hasChunkLoadError ? 'window-chunk-load-error' : 'window-error',
        where: hasChunkLoadError
          ? 'Static app asset'
          : event.filename
          ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
          : 'window',
        severity: hasChunkLoadError ? 'warning' : 'error',
        title: hasChunkLoadError
          ? 'ChunkLoadError: static app asset failed to load'
          : undefined,
        description: hasChunkLoadError
          ? 'The browser could not load a JavaScript or CSS asset. A one-time app reload was scheduled when possible.'
          : undefined,
        data: {
          filename: event.filename || '',
          lineNumber: event.lineno || '',
          columnNumber: event.colno || '',
          resourceUrl: getFailedResourceUrl(event),
          chunkLoadRecoveryStarted: recoveryStarted,
        },
      });
    };

    const handleUnhandledRejection = (event) => {
      const reason = normalizeUnhandledReason(event.reason);
      const hasChunkLoadError = isChunkLoadError(event.reason) || isChunkLoadError(reason);
      const recoveryStarted = recoverFromChunkLoadError(event.reason || reason);

      if (isFirebaseClientStorageError(event.reason) || isFirebaseClientStorageError(reason)) {
        event.preventDefault();
      }

      if (hasChunkLoadError) {
        event.preventDefault();
      }

      reportSafely(reason, {
        context: contextRef.current,
        source: hasChunkLoadError ? 'unhandled-chunk-load-rejection' : 'unhandled-rejection',
        where: hasChunkLoadError ? 'Unhandled chunk load rejection' : 'Unhandled promise rejection',
        severity: hasChunkLoadError ? 'warning' : 'error',
        title: hasChunkLoadError
          ? 'ChunkLoadError: lazy import rejected'
          : undefined,
        description: hasChunkLoadError
          ? 'A lazy-loaded route chunk could not be loaded. A one-time app reload was scheduled when possible.'
          : undefined,
        data: {
          reason: event.reason?.message || event.reason || '',
          chunkLoadRecoveryStarted: recoveryStarted,
        },
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}

export default AppErrorReporter;
