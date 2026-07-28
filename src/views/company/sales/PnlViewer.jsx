import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import {
  FaArrowLeft,
  FaChartLine,
  FaColumns,
  FaCompress,
  FaDownload,
  FaExpand,
  FaEye,
  FaFilter,
  FaMoneyBillWave,
  FaSearch,
  FaSyncAlt,
  FaSwimmingPool,
  FaTags,
  FaTimes,
  FaTools,
} from 'react-icons/fa';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { salesCollectionNames } from '../../../utils/models/Sales';
import {
  customerHasAnyTag,
  filterCustomersByRoleTagAccess,
  filterRecordsByCustomerTags,
  getCustomerTagOptions,
  getRoleCustomerTagAccess,
} from '../../../utils/customerTags';
import {
  buildPnlViewerMatrix,
  dateFromValue,
  moneyFromCents,
  normalizeDocs,
} from '../../../utils/sales/pnlViewerMetrics';

const emptyRawData = {
  customers: [],
  stopData: [],
  dosageTemplates: [],
  purchases: [],
  databaseItems: [],
  payrollLines: [],
  serviceStops: [],
  serviceAgreements: [],
  serviceLocations: [],
  bodiesOfWater: [],
  companyUsers: [],
  paySettings: null,
  companyServiceStopTypes: [],
  companyWorkTypes: [],
  workTypeMappings: [],
  technicianRates: [],
  serviceStopTasksById: new Map(),
};

const numberFormatter = new Intl.NumberFormat('en-US');

const dateInputValue = (date) => {
  const targetDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(targetDate.getTime())) return '';
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultYtdRange = () => {
  const today = new Date();
  return {
    start: dateInputValue(new Date(today.getFullYear(), 0, 1)),
    end: dateInputValue(today),
  };
};

const lastRaisedFilterOptions = [
  { value: 'all', label: 'All' },
  { value: 'never', label: 'Never Raised' },
  { value: 'last90', label: 'Last 90 Days' },
  { value: 'last180', label: 'Last 180 Days' },
  { value: 'selectedRange', label: 'Date Range' },
  { value: 'overYear', label: 'Over 1 Year' },
  { value: 'needsRaise', label: 'Below Target' },
];

const dateDisplay = (value, fallback = '-') => {
  const date = dateFromValue(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const itemDate = (item, fields) => {
  for (const field of fields) {
    const date = dateFromValue(item?.[field]);
    if (date) return date;
  }
  return null;
};

const inRange = (item, startDate, endDate, fields) => {
  const date = itemDate(item, fields);
  if (!date) return true;
  return date >= startDate && date <= endDate;
};

const parseMoneyFilter = (value) => {
  const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed * 100 : null;
};

const getCollectionRecords = async (companyId, collectionName) => {
  const snapshot = await getDocs(collection(db, 'companies', companyId, collectionName));
  return normalizeDocs(snapshot);
};

const getDatabaseItems = async (companyId) => {
  const snapshot = await getDocs(collection(db, 'companies', companyId, 'settings', 'dataBase', 'dataBase'));
  return normalizeDocs(snapshot);
};

const lowerText = (...values) => values.filter(Boolean).join(' ').toLowerCase();

const rowMatchesLastRaised = (row, filter, rangeStart, rangeEnd) => {
  if (filter === 'all') return true;
  if (filter === 'needsRaise') return row.currentRateCents > 0 && row.targetRateCents > row.currentRateCents;

  const raisedAt = dateFromValue(row.lastRaisedAt);
  if (filter === 'never') return !raisedAt;
  if (!raisedAt) return filter === 'overYear';

  const now = new Date();
  const daysAgo = (days) => new Date(now.getTime() - (days * 86400000));
  if (filter === 'last90') return raisedAt >= daysAgo(90);
  if (filter === 'last180') return raisedAt >= daysAgo(180);
  if (filter === 'overYear') return raisedAt < daysAgo(365);
  if (filter === 'selectedRange') {
    return raisedAt >= rangeStart && raisedAt <= rangeEnd;
  }

  return true;
};

const moneyTone = (value) => {
  if (Number(value || 0) < 0) return 'text-rose-700';
  if (Number(value || 0) > 0) return 'text-emerald-700';
  return 'text-slate-500';
};

const MoneyText = ({ value, className = '' }) => (
  <span className={`font-semibold ${moneyTone(value)} ${className}`.trim()}>
    {moneyFromCents(value)}
  </span>
);

const StatTile = ({ icon: Icon, label, value, helper }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 truncate text-2xl font-bold text-slate-950">{value}</p>
      </div>
      <span className="rounded-md bg-slate-100 p-2 text-slate-600">
        <Icon />
      </span>
    </div>
    {helper && <p className="mt-3 truncate text-sm text-slate-500">{helper}</p>}
  </div>
);

const DetailMiniMatrix = ({ rows = [], months = [] }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200">
    <table className="min-w-[980px] divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-4 py-3">Pool</th>
          <th className="px-4 py-3">Type</th>
          <th className="px-4 py-3 text-right">Rate</th>
          <th className="px-4 py-3 text-right">Annual Avg</th>
          {months.map((month) => (
            <th key={month.key} className="px-4 py-3 text-right">{month.label}</th>
          ))}
          <th className="px-4 py-3 text-right">Net</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-semibold text-slate-900">{row.pool}</td>
            <td className="px-4 py-3 text-slate-600">{row.poolType}</td>
            <td className="px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(row.currentRateCents)}</td>
            <td className="px-4 py-3 text-right"><MoneyText value={row.annualAverageCents} /></td>
            {row.monthly.map((month) => (
              <td key={month.key || month.index} className="px-4 py-3 text-right">
                <MoneyText value={month.netCents} />
              </td>
            ))}
            <td className="px-4 py-3 text-right"><MoneyText value={row.netCents} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const RowDetailModal = ({ row, customerRows, months, onClose }) => {
  if (!row) return null;

  const customerTotals = customerRows.reduce((result, item) => {
    result.currentRateCents += item.currentRateCents;
    result.revenueCents += item.revenueCents;
    result.directCostCents += item.directCostCents;
    result.netCents += item.netCents;
    result.visits += item.visits;
    return result;
  }, {
    currentRateCents: 0,
    revenueCents: 0,
    directCostCents: 0,
    netCents: 0,
    visits: 0,
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PNL Detail</p>
            <h2 className="mt-1 truncate text-2xl font-bold text-slate-950">{row.customerName}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">{row.pool} - {row.serviceLocation}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50"
            aria-label="Close detail"
          >
            <FaTimes />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile icon={FaSwimmingPool} label="Pools" value={numberFormatter.format(customerRows.length)} helper={`${numberFormatter.format(customerTotals.visits)} visits`} />
            <StatTile icon={FaMoneyBillWave} label="Current Rate" value={moneyFromCents(customerTotals.currentRateCents)} helper="Monthly agreement rate" />
            <StatTile icon={FaChartLine} label="Revenue" value={moneyFromCents(customerTotals.revenueCents)} helper="Selected range" />
            <StatTile icon={FaTools} label="Direct Costs" value={moneyFromCents(customerTotals.directCostCents)} helper="Labor and chemicals" />
            <StatTile icon={FaMoneyBillWave} label="Net" value={moneyFromCents(customerTotals.netCents)} helper="Selected range" />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Selected Pool</h3>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Pool Type</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{row.poolType}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Current Rate</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{moneyFromCents(row.currentRateCents)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Last Raised</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{dateDisplay(row.lastRaisedAt, 'Never')}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Target Rate</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{moneyFromCents(row.targetRateCents)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Water Levels</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{row.waterLevels || '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Agreement</dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    {row.currentAgreementId ? (
                      <Link to={`/company/sales/agreements/${row.currentAgreementId}`} className="text-blue-700 hover:text-blue-900">
                        {row.currentAgreementTitle || 'Open Agreement'}
                      </Link>
                    ) : '-'}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Agreement Notes</h3>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{row.notes || '-'}</p>
              <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-slate-600">Raise History</h3>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{row.raiseHistory || 'No prior rate changes'}</p>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-slate-950">Customer Matrix</h3>
              <span className="text-sm font-semibold text-slate-500">{customerRows.length} row{customerRows.length === 1 ? '' : 's'}</span>
            </div>
            <DetailMiniMatrix rows={customerRows} months={months} />
          </section>
        </div>
      </div>
    </div>
  );
};

const PnlViewer = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, companyRole } = useContext(Context);
  const [dateRange, setDateRange] = useState(() => defaultYtdRange());
  const [rawData, setRawData] = useState(emptyRawData);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastRaisedFilter, setLastRaisedFilter] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState({});
  const [columnWidths, setColumnWidths] = useState({});
  const [resizingColumnId, setResizingColumnId] = useState('');
  const [detailRowId, setDetailRowId] = useState('');
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const resizeStateRef = useRef(null);

  const dateRangeBounds = useMemo(() => {
    const ytd = defaultYtdRange();
    const startValue = dateRange.start || ytd.start;
    const endValue = dateRange.end || ytd.end;
    const start = new Date(`${startValue}T00:00:00`);
    const end = new Date(`${endValue}T23:59:59`);
    const safeStart = Number.isNaN(start.getTime()) ? new Date(`${ytd.start}T00:00:00`) : start;
    const safeEnd = Number.isNaN(end.getTime()) ? new Date(`${ytd.end}T23:59:59`) : end;

    if (safeEnd < safeStart) {
      return {
        start: new Date(safeEnd.getFullYear(), safeEnd.getMonth(), safeEnd.getDate(), 0, 0, 0, 0),
        end: new Date(safeStart.getFullYear(), safeStart.getMonth(), safeStart.getDate(), 23, 59, 59, 999),
      };
    }

    return { start: safeStart, end: safeEnd };
  }, [dateRange.end, dateRange.start]);
  const selectedYear = dateRangeBounds.start.getFullYear();
  const rangeLabel = `${dateDisplay(dateRangeBounds.start)} - ${dateDisplay(dateRangeBounds.end)}`;

  const roleTagAccess = useMemo(() => getRoleCustomerTagAccess(companyRole), [companyRole]);

  const visibleCustomers = useMemo(
    () => filterCustomersByRoleTagAccess(rawData.customers, companyRole),
    [rawData.customers, companyRole]
  );

  const availableTags = useMemo(() => getCustomerTagOptions(visibleCustomers), [visibleCustomers]);

  useEffect(() => {
    setSelectedTags((currentTags) => currentTags.filter((tag) => availableTags.includes(tag)));
  }, [availableTags]);

  const fetchPnlData = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setRawData(emptyRawData);
      setErrors([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrors([]);

    const startDate = dateRangeBounds.start;
    const endDate = dateRangeBounds.end;

    try {
      const [
        stopDataSnap,
        dosageTemplatesSnap,
        customersRaw,
        purchasesRaw,
        databaseItemsRaw,
        payrollLinesRaw,
        serviceStopsRaw,
        serviceAgreementsRaw,
        serviceLocationsRaw,
        bodiesOfWaterRaw,
        companyUsersRaw,
        paySettingsRaw,
        companyServiceStopTypesRaw,
        companyWorkTypesRaw,
        workTypeMappingsRaw,
        technicianRatesRaw,
      ] = await Promise.all([
        getDocs(query(
          collection(db, 'companies', recentlySelectedCompany, 'stopData'),
          where('date', '>=', startDate),
          where('date', '<=', endDate)
        )),
        getDocs(collection(db, 'companies', recentlySelectedCompany, 'settings', 'dosages', 'dosages')),
        getCollectionRecords(recentlySelectedCompany, 'customers'),
        getCollectionRecords(recentlySelectedCompany, 'purchasedItems'),
        getDatabaseItems(recentlySelectedCompany),
        getCollectionRecords(recentlySelectedCompany, 'technicianPayLineItems'),
        getCollectionRecords(recentlySelectedCompany, 'serviceStops'),
        getDocs(query(
          collection(db, salesCollectionNames.agreements),
          where('companyId', '==', recentlySelectedCompany)
        )).then(normalizeDocs),
        getCollectionRecords(recentlySelectedCompany, 'serviceLocations'),
        getCollectionRecords(recentlySelectedCompany, 'bodiesOfWater'),
        getCollectionRecords(recentlySelectedCompany, 'companyUsers'),
        getDoc(doc(db, 'companies', recentlySelectedCompany, 'paySettings', 'main')).then((snapshot) => (
          snapshot.exists() ? snapshot.data() : null
        )),
        getCollectionRecords(recentlySelectedCompany, 'companyServiceStopTypes'),
        getCollectionRecords(recentlySelectedCompany, 'companyWorkTypes'),
        getCollectionRecords(recentlySelectedCompany, 'workTypeMappings'),
        getCollectionRecords(recentlySelectedCompany, 'technicianRates'),
      ]);

      const serviceStopsInRange = serviceStopsRaw.filter((item) =>
        inRange(item, startDate, endDate, ['completedDate', 'serviceDate', 'date', 'createdAt'])
      );
      const serviceStopTasksById = new Map();
      const taskEntries = await Promise.all(
        serviceStopsInRange.map(async (serviceStop) => {
          const serviceStopId = String(serviceStop.id || serviceStop.serviceStopId || '').trim();
          if (!serviceStopId) return ['', []];
          const tasksSnap = await getDocs(collection(
            db,
            'companies',
            recentlySelectedCompany,
            'serviceStops',
            serviceStopId,
            'tasks'
          ));
          return [serviceStopId, normalizeDocs(tasksSnap)];
        })
      );
      taskEntries.forEach(([serviceStopId, tasks]) => {
        if (serviceStopId) serviceStopTasksById.set(serviceStopId, tasks);
      });

      setRawData({
        customers: customersRaw,
        stopData: normalizeDocs(stopDataSnap),
        dosageTemplates: normalizeDocs(dosageTemplatesSnap),
        purchases: purchasesRaw.filter((item) => inRange(item, startDate, endDate, ['date', 'createdAt', 'dateCreated'])),
        databaseItems: databaseItemsRaw,
        payrollLines: payrollLinesRaw.filter((item) =>
          inRange(item, startDate, endDate, ['completedDate', 'createdAt', 'paidAt'])
        ),
        serviceStops: serviceStopsInRange,
        serviceAgreements: serviceAgreementsRaw,
        serviceLocations: serviceLocationsRaw,
        bodiesOfWater: bodiesOfWaterRaw,
        companyUsers: companyUsersRaw,
        paySettings: paySettingsRaw,
        companyServiceStopTypes: companyServiceStopTypesRaw,
        companyWorkTypes: companyWorkTypesRaw,
        workTypeMappings: workTypeMappingsRaw,
        technicianRates: technicianRatesRaw,
        serviceStopTasksById,
      });
    } catch (error) {
      console.error('Unable to load PNL viewer data', error);
      setErrors([error.message || 'Unable to load PNL viewer data.']);
      toast.error('PNL viewer data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [dateRangeBounds, recentlySelectedCompany]);

  useEffect(() => {
    fetchPnlData();
  }, [fetchPnlData]);

  const reportCustomers = useMemo(
    () => (
      selectedTags.length
        ? visibleCustomers.filter((customer) => customerHasAnyTag(customer, selectedTags))
        : visibleCustomers
    ),
    [selectedTags, visibleCustomers]
  );

  const customersById = useMemo(
    () => new Map(reportCustomers.map((customer) => [customer.id, customer])),
    [reportCustomers]
  );

  const matrixInput = useMemo(() => {
    const serviceLocationsById = new Map(rawData.serviceLocations.map((location) => [location.id, location]));
    const serviceStopsById = new Map(rawData.serviceStops.flatMap((stop) => (
      [stop.id, stop.serviceStopId].filter(Boolean).map((id) => [String(id), stop])
    )));
    const locationCustomerId = (serviceLocationId) => (
      serviceLocationsById.get(serviceLocationId)?.customerId || ''
    );
    const tagFilterContext = { customersById, role: companyRole, selectedTags };

    const enrichStopData = rawData.stopData.map((stop) => {
      const linkedStop = serviceStopsById.get(String(stop.serviceStopId || '')) || {};
      const serviceLocationId = stop.serviceLocationId || linkedStop.serviceLocationId || '';
      return {
        ...stop,
        customerId: stop.customerId || linkedStop.customerId || locationCustomerId(serviceLocationId),
        customerName: stop.customerName || linkedStop.customerName,
        serviceLocationId,
      };
    });

    const enrichPayrollLines = rawData.payrollLines.map((line) => {
      const linkedStop = serviceStopsById.get(String(line.serviceStopId || line.serviceStopID || line.stopId || '')) || {};
      const serviceLocationId = line.serviceLocationId || linkedStop.serviceLocationId || '';
      return {
        ...line,
        customerId: line.customerId || linkedStop.customerId || locationCustomerId(serviceLocationId),
        customerName: line.customerName || linkedStop.customerName,
        serviceLocationId,
      };
    });

    const enrichBodiesOfWater = rawData.bodiesOfWater.map((body) => ({
      ...body,
      customerId: body.customerId || locationCustomerId(body.serviceLocationId),
    }));

    const stopData = filterRecordsByCustomerTags({
      records: enrichStopData,
      ...tagFilterContext,
    });
    const payrollLines = filterRecordsByCustomerTags({
      records: enrichPayrollLines,
      ...tagFilterContext,
    });
    const serviceStops = filterRecordsByCustomerTags({
      records: rawData.serviceStops,
      ...tagFilterContext,
    });
    const serviceAgreements = filterRecordsByCustomerTags({
      records: rawData.serviceAgreements,
      ...tagFilterContext,
    });
    const serviceLocations = filterRecordsByCustomerTags({
      records: rawData.serviceLocations,
      ...tagFilterContext,
    });
    const bodiesOfWater = filterRecordsByCustomerTags({
      records: enrichBodiesOfWater,
      ...tagFilterContext,
    });

    return {
      stopData,
      payrollLines,
      serviceStops,
      serviceAgreements,
      serviceLocations,
      bodiesOfWater,
      databaseItemById: new Map(rawData.databaseItems.map((item) => [item.id, item])),
    };
  }, [companyRole, customersById, rawData, selectedTags]);

  const matrixData = useMemo(() => buildPnlViewerMatrix({
    companyId: recentlySelectedCompany,
    selectedYear,
    dateRangeStart: dateRangeBounds.start,
    dateRangeEnd: dateRangeBounds.end,
    stopData: matrixInput.stopData,
    serviceStops: matrixInput.serviceStops,
    payrollLines: matrixInput.payrollLines,
    paySettings: rawData.paySettings,
    companyUsers: rawData.companyUsers,
    companyServiceStopTypes: rawData.companyServiceStopTypes,
    companyWorkTypes: rawData.companyWorkTypes,
    workTypeMappings: rawData.workTypeMappings,
    technicianRates: rawData.technicianRates,
    serviceStopTasksById: rawData.serviceStopTasksById,
    dosageTemplates: rawData.dosageTemplates,
    serviceAgreements: matrixInput.serviceAgreements,
    serviceLocations: matrixInput.serviceLocations,
    bodiesOfWater: matrixInput.bodiesOfWater,
    customersById,
    purchases: rawData.purchases,
    databaseItemById: matrixInput.databaseItemById,
  }), [customersById, dateRangeBounds, matrixInput, rawData, recentlySelectedCompany, selectedYear]);

  const filteredRows = useMemo(() => {
    const minRateCents = parseMoneyFilter(minPrice);
    const maxRateCents = parseMoneyFilter(maxPrice);
    const search = searchTerm.trim().toLowerCase();

    return matrixData.rows.filter((row) => {
      if (minRateCents !== null && row.currentRateCents < minRateCents) return false;
      if (maxRateCents !== null && row.currentRateCents > maxRateCents) return false;
      if (!rowMatchesLastRaised(row, lastRaisedFilter, dateRangeBounds.start, dateRangeBounds.end)) return false;
      if (!search) return true;

      return lowerText(
        row.customerName,
        row.pool,
        row.poolType,
        row.serviceLocation,
        row.notes,
        row.raiseHistory,
        row.waterLevels,
        row.status
      ).includes(search);
    });
  }, [dateRangeBounds, lastRaisedFilter, matrixData.rows, maxPrice, minPrice, searchTerm]);

  const summary = useMemo(() => filteredRows.reduce((result, row) => {
    result.revenueCents += row.revenueCents;
    result.directCostCents += row.directCostCents;
    result.netCents += row.netCents;
    result.currentRateCents += row.currentRateCents;
    result.visits += row.visits;
    return result;
  }, {
    revenueCents: 0,
    directCostCents: 0,
    netCents: 0,
    currentRateCents: 0,
    visits: 0,
  }), [filteredRows]);

  const watchlistRows = useMemo(
    () => filteredRows
      .filter((row) => row.annualAverageCents < 0 || (row.currentRateCents > 0 && row.targetRateCents > row.currentRateCents))
      .sort((left, right) => left.annualAverageCents - right.annualAverageCents)
      .slice(0, 8),
    [filteredRows]
  );
  const detailRow = useMemo(
    () => filteredRows.find((row) => row.id === detailRowId) || null,
    [detailRowId, filteredRows]
  );
  const detailCustomerRows = useMemo(() => {
    if (!detailRow) return [];
    return filteredRows.filter((row) => (
      (detailRow.customerId && row.customerId === detailRow.customerId) ||
      (!detailRow.customerId && row.customerName === detailRow.customerName)
    ));
  }, [detailRow, filteredRows]);

  const allColumns = useMemo(() => {
    const staticColumns = [
      {
        id: 'customer',
        label: 'Customer List',
        defaultWidth: 280,
        required: true,
        sticky: true,
        render: (row) => (
          <div className="min-w-0">
            {row.currentAgreementId ? (
              <Link
                to={`/company/sales/agreements/${row.currentAgreementId}`}
                className="block truncate font-bold text-slate-950 hover:text-blue-700"
              >
                {row.customerName}
              </Link>
            ) : (
              <p className="truncate font-bold text-slate-950">{row.customerName}</p>
            )}
            <p className="mt-1 truncate text-xs text-slate-500">{row.pool}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{row.serviceLocation}</p>
          </div>
        ),
      },
      {
        id: 'detail',
        label: 'Detail',
        defaultWidth: 92,
        render: (row) => (
          <button
            type="button"
            onClick={() => setDetailRowId(row.id)}
            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            <FaEye className="text-[10px]" />
            View
          </button>
        ),
      },
      { id: 'poolType', label: 'Pool Type', defaultWidth: 130, render: (row) => row.poolType },
      { id: 'price', label: 'Price', defaultWidth: 120, align: 'right', render: (row) => moneyFromCents(row.currentRateCents) },
      { id: 'startDate', label: 'Start Date', defaultWidth: 145, render: (row) => dateDisplay(row.startDate) },
      { id: 'lastRaised', label: 'Last Raised', defaultWidth: 145, render: (row) => dateDisplay(row.lastRaisedAt, 'Never') },
      { id: 'raiseHistory', label: 'Raise History', defaultWidth: 280, wrap: true, render: (row) => row.raiseHistory || 'No prior rate changes' },
      { id: 'notes', label: 'Notes', defaultWidth: 300, wrap: true, render: (row) => row.notes || '-' },
      { id: 'waterLevels', label: 'Water Levels', defaultWidth: 190, render: (row) => row.waterLevels || '-' },
      { id: 'annualAverage', label: '1 Year Avg', defaultWidth: 130, align: 'right', render: (row) => <MoneyText value={row.annualAverageCents} /> },
      { id: 'summerAverage', label: 'Summer Avg', defaultWidth: 130, align: 'right', render: (row) => <MoneyText value={row.summerAverageCents} /> },
      { id: 'winterAverage', label: 'Winter Avg', defaultWidth: 130, align: 'right', render: (row) => <MoneyText value={row.winterAverageCents} /> },
    ];
    const monthColumns = matrixData.months.map((month, index) => ({
      id: `month-${month.key}`,
      label: month.label,
      defaultWidth: 112,
      align: 'right',
      render: (row) => <MoneyText value={row.monthly[index]?.netCents || 0} />,
    }));

    return [
      ...staticColumns,
      ...monthColumns,
      {
        id: 'latestNet',
        label: 'Latest Net',
        defaultWidth: 130,
        align: 'right',
        render: (row) => (
          <div className="whitespace-nowrap">
            <MoneyText value={row.latestMonthNetCents} />
            <p className="text-xs font-semibold text-slate-400">{row.latestMonthLabel}</p>
          </div>
        ),
      },
      { id: 'target', label: 'Target', defaultWidth: 120, align: 'right', render: (row) => moneyFromCents(row.targetRateCents) },
    ];
  }, [matrixData.months]);
  const visibleColumns = useMemo(
    () => allColumns.filter((column) => column.required || !hiddenColumns[column.id]),
    [allColumns, hiddenColumns]
  );
  const getColumnWidth = useCallback(
    (column) => Number(columnWidths[column.id] || column.defaultWidth || 120),
    [columnWidths]
  );
  const tableWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + getColumnWidth(column), 0),
    [getColumnWidth, visibleColumns]
  );

  useEffect(() => {
    if (!resizingColumnId) return undefined;

    const handleMouseMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const nextWidth = Math.max(76, resizeState.startWidth + event.clientX - resizeState.startX);
      setColumnWidths((currentWidths) => ({
        ...currentWidths,
        [resizeState.id]: nextWidth,
      }));
    };

    const handleMouseUp = () => {
      resizeStateRef.current = null;
      setResizingColumnId('');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumnId]);

  const startColumnResize = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      id: column.id,
      startX: event.clientX,
      startWidth: getColumnWidth(column),
    };
    setResizingColumnId(column.id);
  };

  const syncHorizontalScroll = (source) => {
    const topScroller = topScrollRef.current;
    const tableScroller = tableScrollRef.current;
    if (!topScroller || !tableScroller) return;

    if (source === 'top' && tableScroller.scrollLeft !== topScroller.scrollLeft) {
      tableScroller.scrollLeft = topScroller.scrollLeft;
    }
    if (source === 'table' && topScroller.scrollLeft !== tableScroller.scrollLeft) {
      topScroller.scrollLeft = tableScroller.scrollLeft;
    }
  };

  const toggleTag = (tag) => {
    setSelectedTags((currentTags) => (
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    ));
  };

  const setDateRangeField = (field, value) => {
    setDateRange((currentRange) => ({
      ...currentRange,
      [field]: value,
    }));
  };

  const resetDateRangeToYtd = () => {
    setDateRange(defaultYtdRange());
  };

  const clearFilters = () => {
    setSelectedTags([]);
    setSearchTerm('');
    setLastRaisedFilter('all');
    setMinPrice('');
    setMaxPrice('');
    resetDateRangeToYtd();
  };

  const exportMatrix = () => {
    if (!filteredRows.length) {
      toast.error('No PNL rows to export.');
      return;
    }

    const rows = filteredRows.map((row) => {
      const monthValues = matrixData.months.reduce((result, month, index) => ({
        ...result,
        [month.label]: (row.monthly[index]?.netCents || 0) / 100,
      }), {});

      return {
        'Customer List': row.customerName,
        Pool: row.pool,
        'Pool Type': row.poolType,
        Price: row.currentRateCents / 100,
        'Start Date': dateDisplay(row.startDate),
        'Last Raised': dateDisplay(row.lastRaisedAt, 'Never'),
        'Raise History': row.raiseHistory || '',
        Notes: row.notes || '',
        'Water Levels (hardness / CYA)': row.waterLevels || '',
        '1 Year Average': row.annualAverageCents / 100,
        'Summer Average': row.summerAverageCents / 100,
        'Winter Average': row.winterAverageCents / 100,
        ...monthValues,
        'Latest Month': row.latestMonthLabel,
        'Latest Net': row.latestMonthNetCents / 100,
        'Target Rate': row.targetRateCents / 100,
        Agreement: row.currentAgreementTitle || row.currentAgreementId,
        Status: row.status,
      };
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Profit');
    XLSX.writeFile(workbook, `pnl_viewer_${dateInputValue(dateRangeBounds.start)}_${dateInputValue(dateRangeBounds.end)}.xlsx`);
  };

  const toggleColumn = (columnId) => {
    setHiddenColumns((currentHidden) => ({
      ...currentHidden,
      [columnId]: !currentHidden[columnId],
    }));
  };

  const hasActiveFilters = Boolean(
    selectedTags.length ||
    searchTerm ||
    lastRaisedFilter !== 'all' ||
    minPrice ||
    maxPrice ||
    dateRange.start !== defaultYtdRange().start ||
    dateRange.end !== defaultYtdRange().end
  );

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-[60] overflow-y-auto' : 'min-h-screen'} bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5`}>
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/company/sales"
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <FaArrowLeft className="text-xs" />
                  Sales
                </Link>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {recentlySelectedCompanyName || 'Selected Company'}
                </span>
                {roleTagAccess.length > 0 && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {roleTagAccess.join(', ')}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-950">PNL Viewer</h1>
                <FaChartLine className="text-slate-400" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowColumnMenu((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <FaColumns className="text-xs" />
                  Columns
                </button>
                {showColumnMenu && (
                  <div className="absolute right-0 z-30 mt-2 max-h-96 w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2">
                      <p className="text-sm font-bold text-slate-950">Columns</p>
                      <button
                        type="button"
                        onClick={() => setHiddenColumns({})}
                        className="text-xs font-semibold text-blue-700 hover:text-blue-900"
                      >
                        Show All
                      </button>
                    </div>
                    <div className="mt-2 space-y-1">
                      {allColumns.map((column) => (
                        <label
                          key={column.id}
                          className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${column.required ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700 hover:bg-slate-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={column.required || !hiddenColumns[column.id]}
                            disabled={column.required}
                            onChange={() => toggleColumn(column.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="truncate font-semibold">{column.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsFullscreen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                {isFullscreen ? <FaCompress className="text-xs" /> : <FaExpand className="text-xs" />}
                {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
              </button>
              <button
                type="button"
                onClick={fetchPnlData}
                disabled={loading || !recentlySelectedCompany}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaSyncAlt className={`text-xs ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={exportMatrix}
                disabled={!filteredRows.length}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaDownload className="text-xs" />
                Export
              </button>
            </div>
          </div>
        </section>

        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            {errors.join(' ')}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile icon={FaSwimmingPool} label="Pools" value={numberFormatter.format(filteredRows.length)} helper={`${numberFormatter.format(matrixData.rows.length)} total`} />
          <StatTile icon={FaMoneyBillWave} label="Current Rate" value={moneyFromCents(summary.currentRateCents)} helper="Monthly agreement rate" />
          <StatTile icon={FaChartLine} label="Revenue" value={moneyFromCents(summary.revenueCents)} helper={rangeLabel} />
          <StatTile icon={FaTools} label="Direct Costs" value={moneyFromCents(summary.directCostCents)} helper="Labor and chemicals" />
          <StatTile icon={FaMoneyBillWave} label="Net" value={moneyFromCents(summary.netCents)} helper={`${numberFormatter.format(summary.visits)} visits`} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_150px_150px_90px_190px_130px_130px_auto]">
            <label className="relative block">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search pools, notes, agreements"
              />
            </label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(event) => setDateRangeField('start', event.target.value)}
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Start date"
            />
            <input
              type="date"
              value={dateRange.end}
              onChange={(event) => setDateRangeField('end', event.target.value)}
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="End date"
            />
            <button
              type="button"
              onClick={resetDateRangeToYtd}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              YTD
            </button>
            <label className="flex h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700">
              <FaFilter className="text-xs text-slate-400" />
              <select
                value={lastRaisedFilter}
                onChange={(event) => setLastRaisedFilter(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              >
                {lastRaisedFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="number"
              value={minPrice}
              onChange={(event) => setMinPrice(event.target.value)}
              className="h-10 rounded-md border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Min price"
            />
            <input
              type="number"
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
              className="h-10 rounded-md border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Max price"
            />
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>

          {availableTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <FaTags className="text-[10px]" />
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {watchlistRows.length > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900">Rate Watchlist</h2>
              <span className="text-xs font-semibold text-amber-700">{watchlistRows.length}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {watchlistRows.map((row) => (
                <Link
                  key={row.id}
                  to={row.currentAgreementId ? `/company/sales/agreements/${row.currentAgreementId}` : '/company/sales/agreements'}
                  className="rounded-md border border-amber-200 bg-white p-3 text-sm transition hover:border-amber-300 hover:bg-amber-50"
                >
                  <p className="truncate font-bold text-slate-950">{row.customerName}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{row.pool}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-slate-600">Avg</span>
                    <MoneyText value={row.annualAverageCents} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-slate-600">Target</span>
                    <span className="font-semibold text-slate-900">{moneyFromCents(row.targetRateCents)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <h2 className="text-lg font-bold text-slate-950">Profit Matrix</h2>
            <span className="text-sm font-semibold text-slate-500">
              {loading ? 'Loading...' : `${numberFormatter.format(filteredRows.length)} row${filteredRows.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {recentlySelectedCompany && !loading && filteredRows.length > 0 && (
            <div
              ref={topScrollRef}
              onScroll={() => syncHorizontalScroll('top')}
              className="overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-2"
            >
              <div style={{ width: `${tableWidth}px`, height: 1 }} />
            </div>
          )}

          <div
            ref={tableScrollRef}
            onScroll={() => syncHorizontalScroll('table')}
            className="overflow-x-auto"
          >
            {!recentlySelectedCompany ? (
              <div className="p-6 text-sm font-semibold text-slate-500">Select a company to load PNL.</div>
            ) : loading ? (
              <div className="p-6 text-sm font-semibold text-slate-500">Loading PNL...</div>
            ) : filteredRows.length === 0 ? (
              <div className="p-6 text-sm font-semibold text-slate-500">No pools match the current filters.</div>
            ) : (
              <table
                className="divide-y divide-slate-200 text-sm"
                style={{ width: `${tableWidth}px`, tableLayout: 'fixed' }}
              >
                <colgroup>
                  {visibleColumns.map((column) => (
                    <col key={column.id} style={{ width: `${getColumnWidth(column)}px` }} />
                  ))}
                </colgroup>
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    {visibleColumns.map((column) => {
                      const width = getColumnWidth(column);
                      return (
                        <th
                          key={column.id}
                          className={`relative px-4 py-3 ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.sticky ? 'sticky left-0 z-20 bg-slate-50' : ''}`}
                          style={{ width: `${width}px`, minWidth: `${width}px` }}
                        >
                          <span className="block truncate pr-2">{column.label}</span>
                          <button
                            type="button"
                            onMouseDown={(event) => startColumnResize(event, column)}
                            className={`absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-slate-300 transition hover:bg-blue-100 ${resizingColumnId === column.id ? 'bg-blue-100' : ''}`}
                            aria-label={`Resize ${column.label}`}
                          />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="group transition hover:bg-slate-50">
                      {visibleColumns.map((column) => {
                        const width = getColumnWidth(column);
                        return (
                          <td
                            key={`${row.id}-${column.id}`}
                            className={`${column.sticky ? 'sticky left-0 z-10 bg-white group-hover:bg-slate-50' : ''} ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.wrap ? 'whitespace-normal text-xs' : 'truncate'} px-4 py-3 text-slate-600`}
                            style={{ width: `${width}px`, minWidth: `${width}px` }}
                          >
                            {column.render(row)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
      <RowDetailModal
        row={detailRow}
        customerRows={detailCustomerRows}
        months={matrixData.months}
        onClose={() => setDetailRowId('')}
      />
    </div>
  );
};

export default PnlViewer;
