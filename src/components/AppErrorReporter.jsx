import { useEffect, useRef } from 'react';
import { reportAppError } from '../utils/errorReporting';

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
    const handleWindowError = (event) => {
      reportAppError(event.error || event.message, {
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
      reportAppError(normalizeUnhandledReason(event.reason), {
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
