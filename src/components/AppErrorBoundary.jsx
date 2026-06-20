import React from 'react';
import { reportAppError } from '../utils/errorReporting';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    reportAppError(error, {
      context: this.props.context,
      source: 'react-error-boundary',
      where: 'React render tree',
      data: {
        componentStack: errorInfo?.componentStack || '',
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 px-6 py-10 text-slate-100">
          <div className="mx-auto max-w-2xl rounded-xl border border-slate-800/60 bg-slate-950 p-6 shadow-2xl">
            <h1 className="text-2xl font-extrabold text-[#efb12f]">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-400">
              The error was sent to the Admin Errors console with page, user, company, and stack details.
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
