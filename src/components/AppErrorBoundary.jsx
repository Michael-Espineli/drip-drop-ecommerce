import React from 'react';
import { reportAppError } from '../utils/errorReporting';
import { isChunkLoadError, recoverFromChunkLoadError } from '../utils/chunkLoadRecovery';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      hasChunkLoadError: false,
      isRecoveringChunkLoad: false,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      hasChunkLoadError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error, errorInfo) {
    const hasChunkLoadError = isChunkLoadError(error);
    const recoveryStarted = recoverFromChunkLoadError(error);

    if (recoveryStarted) {
      this.setState({ isRecoveringChunkLoad: true });
    }

    reportAppError(error, {
      context: this.props.context,
      source: 'react-error-boundary',
      where: hasChunkLoadError ? 'React lazy-loaded chunk' : 'React render tree',
      severity: hasChunkLoadError ? 'warning' : 'error',
      title: hasChunkLoadError
        ? 'ChunkLoadError: stale app bundle failed to load'
        : undefined,
      description: hasChunkLoadError
        ? 'The browser tried to load a JavaScript chunk that was no longer available. A one-time app reload was scheduled when possible.'
        : undefined,
      data: {
        componentStack: errorInfo?.componentStack || '',
        chunkLoadRecoveryStarted: recoveryStarted,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      const isRecoveringChunkLoad = this.state.hasChunkLoadError && this.state.isRecoveringChunkLoad;
      const hasUnrecoveredChunkLoad = this.state.hasChunkLoadError && !this.state.isRecoveringChunkLoad;

      return (
        <div className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100">
          <div className="mx-auto max-w-2xl rounded-xl border border-slate-800/60 bg-slate-950 p-6 shadow-2xl">
            <h1 className="text-2xl font-extrabold text-[#efb12f]">
              {isRecoveringChunkLoad ? 'Updating app' : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              {isRecoveringChunkLoad
                ? 'A fresh version of Drip Drop is available. The app is reloading now.'
                : hasUnrecoveredChunkLoad
                  ? 'The app could not load part of the latest update. Reloading usually fixes this.'
                  : 'The error was sent to the Admin Errors console with page, user, company, and stack details.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-md bg-[#efb12f] px-4 py-2 font-semibold text-slate-950 transition hover:bg-[#efb12f]/90"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
