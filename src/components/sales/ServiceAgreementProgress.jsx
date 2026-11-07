import React from 'react';
import { Link } from 'react-router-dom';
import { ClockIcon } from '@heroicons/react/24/outline';
import { agreementServiceSetup } from '../../utils/sales/agreementServiceSetup';
import WorkspaceSectionHeader from '../workspace/WorkspaceSectionHeader';

export default function ServiceAgreementProgress({ agreements = [] }) {
  const pending = agreements.map(agreement => ({ agreement, setup: agreementServiceSetup(agreement) }))
    .filter(({ setup }) => setup.pending);
  if (!pending.length) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="service-progress-heading">
      <div className="px-4 pt-4">
        <WorkspaceSectionHeader headingId="service-progress-heading" title="In progress"
          subtitle="Your company is taking care of these next steps." icon={ClockIcon} />
      </div>
      {pending.map(({ agreement, setup }) => (
        <Link key={agreement.id} to={`/client/service-agreements/${agreement.id}`} className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-t px-4 py-4 hover:bg-slate-50">
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-semibold text-amber-700">{setup.label}</p>
            <p className="mt-1 break-words font-semibold">{agreement.title || 'Service agreement'}</p>
            <p className="mt-1 text-sm text-slate-500">{setup.message}</p>
          </div>
          <span className="text-sm font-bold text-blue-700">View agreement ›</span>
        </Link>
      ))}
    </section>
  );
}
