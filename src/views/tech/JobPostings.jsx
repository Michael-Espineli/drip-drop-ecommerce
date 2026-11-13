import React from 'react';
import { Link } from 'react-router-dom';
import WorkspaceHeader from '../../components/workspace/WorkspaceHeader';

export default function JobPostings() {
  return (
    <div className="workspace-screen space-y-6 p-4 sm:p-6">
      <WorkspaceHeader title="Job postings" description="Find opportunities in the pool industry." />
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-slate-900">
        <h2 className="text-xl font-bold">Hiring through Drip Drop is not available yet</h2>
        <p className="mt-2 text-sm text-slate-600">You can browse pool companies and contact them directly about opportunities.</p>
        <Link to="/browse-companies" className="mt-5 inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-blue-50 px-4 py-2 font-semibold text-blue-700">Browse companies</Link>
      </section>
    </div>
  );
}
