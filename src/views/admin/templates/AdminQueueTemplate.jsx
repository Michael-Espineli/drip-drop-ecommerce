import React, { useMemo, useState } from 'react';

const ADMIN_YELLOW = '#debf44';

const baseRows = [];

const statusClassMap = {
  New: 'bg-yellow-500/15 text-yellow-200 ring-yellow-500/30',
  Open: 'bg-blue-500/15 text-blue-200 ring-blue-500/30',
  Pending: 'bg-orange-500/15 text-orange-200 ring-orange-500/30',
  Resolved: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
  Deactivated: 'bg-red-500/15 text-red-200 ring-red-500/30',
};

const formatCount = (value) => String(value ?? 0);

function StatusPill({ value }) {
  const classes = statusClassMap[value] || 'bg-slate-800 text-slate-200 ring-slate-700';

  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ring-1 ${classes}`}>
      {value || 'Open'}
    </span>
  );
}

function AdminQueueTemplate({
  title,
  subtitle,
  statCards,
  filters,
  columns,
  emptyTitle,
  emptyBody,
  rows = baseRows,
  primaryActionLabel,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState(filters?.[0]?.value || 'all');

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !search ||
        Object.values(row)
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search);

      const matchesFilter =
        selectedFilter === 'all' ||
        row.status === selectedFilter ||
        row.type === selectedFilter;

      return matchesSearch && matchesFilter;
    });
  }, [rows, searchTerm, selectedFilter]);

  return (
    <div className="min-h-screen bg-slate-900 px-2 md:px-7 py-5 text-slate-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>

        {primaryActionLabel && (
          <button
            type="button"
            className="px-4 py-2 rounded-md font-semibold bg-[#debf44] text-slate-950 hover:bg-[#debf44]/90 transition"
          >
            {primaryActionLabel}
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl p-4"
          >
            <p className="text-sm font-semibold text-slate-400">{card.label}</p>
            <p className="mt-2 text-3xl font-extrabold" style={{ color: card.accent || ADMIN_YELLOW }}>
              {formatCount(card.value)}
            </p>
            <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-slate-950 border border-slate-800/60 rounded-xl shadow-2xl">
        <div className="p-4 border-b border-slate-800/60 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search"
              className="w-full sm:w-72 px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            />

            <select
              value={selectedFilter}
              onChange={(event) => setSelectedFilter(event.target.value)}
              className="w-full sm:w-48 px-3 py-2 rounded-md bg-slate-900/70 border border-slate-800/60 text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#debf44]/30"
            >
              {(filters || [{ label: 'All', value: 'all' }]).map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-sm text-slate-400">{filteredRows.length} records</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-900/70">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-400"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {filteredRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-900/50">
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-4 text-sm text-slate-200">
                      {column.key === 'status' ? (
                        <StatusPill value={row[column.key]} />
                      ) : (
                        row[column.key] || '-'
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredRows.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-lg font-bold text-slate-100">{emptyTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{emptyBody}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminQueueTemplate;
