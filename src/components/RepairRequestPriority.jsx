import React from 'react';
import { ISSUE_PRIORITY_OPTIONS, normalizeIssuePriority } from '../utils/models/JobPlan';

export default function RepairRequestPriority({ value, onChange, disabled = false, id = 'repair-request-priority' }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">Priority</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(normalizeIssuePriority(event.target.value))}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
      >
        {ISSUE_PRIORITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.value} - {option.label}</option>
        ))}
      </select>
    </div>
  );
}
