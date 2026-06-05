import React from 'react';
import { FaInfoCircle } from 'react-icons/fa';

const FeatureInfoButton = ({ label = 'Feature information', title, children, align = 'right' }) => (
  <details className="group relative inline-block">
    <summary
      aria-label={label}
      title={label}
      className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200 [&::-webkit-details-marker]:hidden"
      style={{ listStyle: 'none' }}
    >
      <FaInfoCircle className="text-sm" />
    </summary>
    <div
      className={[
        'absolute z-30 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 shadow-xl',
        align === 'left' ? 'left-0' : 'right-0',
      ].join(' ')}
    >
      {title && <p className="font-semibold text-slate-950">{title}</p>}
      <div className={title ? 'mt-2 space-y-2' : 'space-y-2'}>{children}</div>
    </div>
  </details>
);

export default FeatureInfoButton;
