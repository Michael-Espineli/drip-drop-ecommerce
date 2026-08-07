import { useEffect, useRef } from 'react';
import { reportAppError } from '../utils/errorReporting';
import { isFirebaseClientStorageError } from '../utils/firebaseNetwork';

const normalizeUnhandledReason = (reason) => {
  if (reason instanceof Error) return reason;
  if (reason?.reason instanceof Error) return reason.reason;
  if (reason?.message) return reason;
  return new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection');
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
      const error = event.error || event.message;

      if (isFirebaseClientStorageError(error)) {
        event.preventDefault();
      }

      reportSafely(error, {
        context: contextRef.current,
        source: 'window-error',
        where: event.filename
          ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
          : 'window',
        data: {
          filename: event.filename || '',
          lineNumber: event.lineno || '',
          columnNumber: event.colno || '',
        },
      });
    };

    const handleUnhandledRejection = (event) => {
      const reason = normalizeUnhandledReason(event.reason);

      if (isFirebaseClientStorageError(event.reason) || isFirebaseClientStorageError(reason)) {
        event.preventDefault();
      }

      reportSafely(reason, {
        context: contextRef.current,
        source: 'unhandled-rejection',
        where: 'Unhandled promise rejection',
        data: {
          reason: event.reason?.message || event.reason || '',
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
