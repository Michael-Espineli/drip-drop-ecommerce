import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  BeakerIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MapIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';
import { appConfirm } from '../../../utils/appDialog';

const POOL_LIST_COLLECTION = 'poolProspectLists';
const ADMIN_YELLOW = '#efb12f';
const MAX_BATCH_WRITES = 450;
const PANEL_CLASS = 'rounded-lg border border-slate-800/70 bg-slate-900/85 shadow-sm shadow-black/20';
const PANEL_HEADER_CLASS = 'border-b border-slate-800/70 p-5';
const INPUT_BASE_CLASS = 'mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 shadow-sm placeholder:text-slate-500 focus:border-[#efb12f] focus:outline-none focus:ring-2 focus:ring-[#efb12f]/20';
const TABLE_HEADER_CELL_CLASS = 'border-b border-slate-800 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400';
const TABLE_ROW_CLASS = 'border-slate-800 transition hover:bg-slate-800/50';

const SOURCE_OPTIONS = [
  { value: 'manualEntry', label: 'Manual entry' },
  { value: 'excelImport', label: 'Excel import' },
  { value: 'csvPaste', label: 'CSV paste' },
  { value: 'droneVerified', label: 'Drone/image verified' },
  { value: 'countyAssessor', label: 'County assessor import' },
  { value: 'other', label: 'Other manual source' },
];

const EMPTY_FORM = {
  name: '',
  city: '',
  state: '',
  zip: '',
  sourceType: 'csvPaste',
  providerName: '',
  totalProperties: '',
  residentialProperties: '',
  commercialProperties: '',
  minConfidence: '',
  notes: '',
  rowInput: '',
};

const EMPTY_MISSED_POOL_FORM = {
  streetAddress: '',
  city: '',
  state: '',
  zip: '',
  propertyType: 'Residential',
  poolConfidence: '',
  parcelId: '',
  latitude: '',
  longitude: '',
  notes: '',
};

const EMPTY_IMPORT_LIST_FORM = {
  name: '',
  city: '',
  state: '',
  zip: '',
  sourceType: 'excelImport',
  providerName: '',
  totalProperties: '',
  residentialProperties: '',
  commercialProperties: '',
  minConfidence: '',
  notes: '',
};

const EMPTY_FIND_FORM = {
  city: '',
  state: '',
  zip: '',
  sourceType: 'droneVerified',
  providerName: '',
  minConfidence: '',
  notes: '',
};

const DEFAULT_HEADERS = [
  'streetAddress',
  'city',
  'state',
  'zip',
  'propertyType',
  'poolConfidence',
  'source',
  'parcelId',
  'latitude',
  'longitude',
  'notes',
];

const HEADER_ALIASES = {
  address: 'streetAddress',
  addressline1: 'streetAddress',
  fulladdress: 'streetAddress',
  line1: 'streetAddress',
  oneline: 'streetAddress',
  propertyaddress: 'streetAddress',
  propertyfulladdress: 'streetAddress',
  serviceaddress: 'streetAddress',
  street: 'streetAddress',
  streetaddress: 'streetAddress',
  situsaddress: 'streetAddress',
  siteaddress: 'streetAddress',
  city: 'city',
  locality: 'city',
  municipality: 'city',
  state: 'state',
  state2: 'state',
  region: 'state',
  zip: 'zip',
  zipcode: 'zip',
  postal: 'zip',
  postalcode: 'zip',
  lat: 'latitude',
  latitude: 'latitude',
  lng: 'longitude',
  lon: 'longitude',
  long: 'longitude',
  longitude: 'longitude',
  classification: 'propertyType',
  landuse: 'propertyType',
  proptype: 'propertyType',
  propertyclass: 'propertyType',
  propertytype: 'propertyType',
  use: 'propertyType',
  confidence: 'poolConfidence',
  poolconfidence: 'poolConfidence',
  poolscore: 'poolConfidence',
  probability: 'poolConfidence',
  provider: 'source',
  source: 'source',
  datasource: 'source',
  importsource: 'source',
  apn: 'parcelId',
  parcel: 'parcelId',
  parcelid: 'parcelId',
  parcelnumber: 'parcelId',
  propertyid: 'parcelId',
  lluuid: 'parcelId',
  notes: 'notes',
  note: 'notes',
};

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return 'Not saved';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number.parseFloat(String(value).replace(/[%,$\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace(/[%,$\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(line = '') {
  const tabCount = (line.match(/\t/g) || []).length;
  const commaCount = (line.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function parseDelimitedLine(line = '', delimiter = ',') {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
}

function classifyPropertyType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) return 'unknown';
  if (/(commercial|business|retail|office|hotel|motel|industrial|warehouse|municipal|school|club|recreation)/.test(normalized)) {
    return 'commercial';
  }
  if (/(residential|single|family|home|house|condo|townhouse|duplex|apartment|multifamily|multi-family)/.test(normalized)) {
    return 'residential';
  }

  return 'unknown';
}

function parseCoordinate(value) {
  const parsed = toOptionalNumber(value);
  return parsed === null ? null : parsed;
}

function buildFormattedAddress(row = {}) {
  return [
    row.streetAddress,
    row.city,
    row.state,
    row.zip,
  ].filter(Boolean).join(', ');
}

function normalizeProspectRow(row = {}, index = 0, fallbackSource = '') {
  const streetAddress = String(row.streetAddress || '').trim();
  const city = String(row.city || '').trim();
  const state = String(row.state || '').trim().toUpperCase();
  const zip = String(row.zip || '').trim();
  const propertyType = String(row.propertyType || '').trim();
  const poolConfidence = toOptionalNumber(row.poolConfidence);
  const propertyClass = classifyPropertyType(propertyType);
  const latitude = parseCoordinate(row.latitude);
  const longitude = parseCoordinate(row.longitude);
  const source = String(row.source || fallbackSource || '').trim();
  const parcelId = String(row.parcelId || '').trim();
  const notes = String(row.notes || '').trim();
  const formattedAddress = buildFormattedAddress({ streetAddress, city, state, zip });

  return {
    streetAddress,
    city,
    state,
    zip,
    formattedAddress,
    propertyType,
    propertyClass,
    poolConfidence,
    source,
    parcelId,
    latitude,
    longitude,
    notes,
    sortOrder: index,
    reviewed: false,
  };
}

function parseProspectRows(input = '', fallbackSource = '') {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const firstValues = parseDelimitedLine(lines[0], delimiter);
  const firstHeaders = firstValues.map((value) => HEADER_ALIASES[normalizeHeader(value)] || '');
  const hasHeader = firstHeaders.some(Boolean);
  const headers = hasHeader
    ? firstValues.map((value, index) => HEADER_ALIASES[normalizeHeader(value)] || DEFAULT_HEADERS[index] || `field${index}`)
    : DEFAULT_HEADERS;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line, rowIndex) => {
      const values = parseDelimitedLine(line, delimiter);
      const rawRow = headers.reduce((acc, header, index) => {
        acc[header] = values[index] || '';
        return acc;
      }, {});

      return normalizeProspectRow(rawRow, rowIndex, fallbackSource);
    })
    .filter((row) => row.streetAddress || row.formattedAddress || row.parcelId);
}

function parseWorkbookRows(sheetRows = [], fallbackSource = 'Excel import') {
  return sheetRows
    .map((sheetRow, rowIndex) => {
      const normalized = Object.entries(sheetRow || {}).reduce((acc, [rawHeader, value]) => {
        const header = HEADER_ALIASES[normalizeHeader(rawHeader)];
        if (header) acc[header] = value;
        return acc;
      }, {});

      return normalizeProspectRow(normalized, rowIndex, fallbackSource);
    })
    .filter((row) => row.streetAddress || row.formattedAddress || row.parcelId);
}

function filterRowsByConfidence(rows = [], minConfidenceValue = '') {
  const minConfidence = toOptionalNumber(minConfidenceValue);
  if (minConfidence === null) return rows;

  return rows.filter((row) => row.poolConfidence === null || row.poolConfidence >= minConfidence);
}

function calculateStats(rows = [], form = {}) {
  const addressCount = rows.length;
  const poolAddressCount = rows.length;
  const residentialPoolCount = rows.filter((row) => row.propertyClass === 'residential').length;
  const commercialPoolCount = rows.filter((row) => row.propertyClass === 'commercial').length;
  const unknownPoolCount = Math.max(poolAddressCount - residentialPoolCount - commercialPoolCount, 0);
  const totalProperties = toNumber(form.totalProperties);
  const totalResidentialProperties = toNumber(form.residentialProperties);
  const totalCommercialProperties = toNumber(form.commercialProperties);

  return {
    addressCount,
    poolAddressCount,
    residentialPoolCount,
    commercialPoolCount,
    unknownPoolCount,
    totalProperties,
    totalResidentialProperties,
    totalCommercialProperties,
    poolDensityRatio: totalProperties > 0 ? poolAddressCount / totalProperties : null,
    residentialPoolDensityRatio: totalResidentialProperties > 0 ? residentialPoolCount / totalResidentialProperties : null,
    commercialPoolDensityRatio: totalCommercialProperties > 0 ? commercialPoolCount / totalCommercialProperties : null,
  };
}

function recalculateRatios(stats = {}) {
  const totalProperties = Number(stats.totalProperties || 0);
  const totalResidentialProperties = Number(stats.totalResidentialProperties || 0);
  const totalCommercialProperties = Number(stats.totalCommercialProperties || 0);

  return {
    ...stats,
    addressCount: Number(stats.addressCount ?? stats.poolAddressCount ?? 0),
    poolDensityRatio: totalProperties > 0 ? Number(stats.poolAddressCount || 0) / totalProperties : null,
    residentialPoolDensityRatio: totalResidentialProperties > 0 ? Number(stats.residentialPoolCount || 0) / totalResidentialProperties : null,
    commercialPoolDensityRatio: totalCommercialProperties > 0 ? Number(stats.commercialPoolCount || 0) / totalCommercialProperties : null,
  };
}

function getListAddressCount(list = {}) {
  return Number(list.stats?.addressCount ?? list.stats?.poolAddressCount ?? 0);
}

function getListPoolCount(list = {}) {
  return Number(list.stats?.poolAddressCount || 0);
}

function applyPoolCountDelta(list = {}, propertyClass = 'unknown', delta = 0, addressDelta = 0) {
  const stats = list.stats || {};
  const nextStats = {
    addressCount: Math.max(0, getListAddressCount(list) + addressDelta),
    poolAddressCount: Math.max(0, Number(stats.poolAddressCount || 0) + delta),
    residentialPoolCount: Math.max(0, Number(stats.residentialPoolCount || 0) + (propertyClass === 'residential' ? delta : 0)),
    commercialPoolCount: Math.max(0, Number(stats.commercialPoolCount || 0) + (propertyClass === 'commercial' ? delta : 0)),
    unknownPoolCount: Math.max(0, Number(stats.unknownPoolCount || 0) + (propertyClass === 'unknown' ? delta : 0)),
    totalProperties: Number(stats.totalProperties || 0),
    totalResidentialProperties: Number(stats.totalResidentialProperties || 0),
    totalCommercialProperties: Number(stats.totalCommercialProperties || 0),
  };

  return recalculateRatios(nextStats);
}

function mergeStatsWithRows(list = {}, rows = []) {
  const stats = list.stats || {};
  const incomingStats = calculateStats(rows);
  const nextStats = {
    addressCount: getListAddressCount(list) + incomingStats.addressCount,
    poolAddressCount: getListPoolCount(list) + incomingStats.poolAddressCount,
    residentialPoolCount: Number(stats.residentialPoolCount || 0) + incomingStats.residentialPoolCount,
    commercialPoolCount: Number(stats.commercialPoolCount || 0) + incomingStats.commercialPoolCount,
    unknownPoolCount: Number(stats.unknownPoolCount || 0) + incomingStats.unknownPoolCount,
    totalProperties: Number(stats.totalProperties || 0),
    totalResidentialProperties: Number(stats.totalResidentialProperties || 0),
    totalCommercialProperties: Number(stats.totalCommercialProperties || 0),
  };

  return recalculateRatios(nextStats);
}

function buildDefaultListName({ city = '', state = '', zip = '' } = {}) {
  const area = [city, state].filter(Boolean).join(', ');
  const location = [area, zip].filter(Boolean).join(' ');
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  return `Pool prospects - ${location || 'new area'} - ${dateLabel}`;
}

function buildFinderRunName(location = {}) {
  return buildDefaultListName(location).replace('Pool prospects', 'Pool finder');
}

function escapeCsvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows = []) {
  const headers = [
    'Street Address',
    'City',
    'State',
    'Zip',
    'Property Type',
    'Property Class',
    'Pool Confidence',
    'Source',
    'Parcel ID',
    'Latitude',
    'Longitude',
    'Notes',
  ];
  const body = rows.map((row) => ([
    row.streetAddress,
    row.city,
    row.state,
    row.zip,
    row.propertyType,
    row.propertyClass,
    row.poolConfidence,
    row.source,
    row.parcelId,
    row.latitude,
    row.longitude,
    row.notes,
  ].map(escapeCsvValue).join(',')));
  const blob = new Blob([[headers.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function StatTile({ title, value, helper, Icon, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-200 ring-1 ring-slate-700',
    blue: 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/20',
    emerald: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-400/20',
    amber: 'bg-[#efb12f]/15 text-[#efb12f] ring-1 ring-[#efb12f]/30',
  };

  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-900/85 p-4 shadow-sm shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-50">{value}</p>
          {helper && <p className="mt-1 text-sm text-slate-400">{helper}</p>}
        </div>
        <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <label className="text-xs font-bold uppercase tracking-wide text-slate-400">
      {children}
    </label>
  );
}

function PoolProspectLists() {
  const { user, name } = useContext(Context);
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedRows, setSelectedRows] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [rowSearch, setRowSearch] = useState('');
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState('append');
  const [importTargetListId, setImportTargetListId] = useState('');
  const [importListForm, setImportListForm] = useState(EMPTY_IMPORT_LIST_FORM);
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [showFindModal, setShowFindModal] = useState(false);
  const [findForm, setFindForm] = useState(EMPTY_FIND_FORM);
  const [finding, setFinding] = useState(false);
  const [coverageMode, setCoverageMode] = useState('lists');
  const [showMissedPoolModal, setShowMissedPoolModal] = useState(false);
  const [missedPoolForm, setMissedPoolForm] = useState(EMPTY_MISSED_POOL_FORM);
  const [addingMissedPool, setAddingMissedPool] = useState(false);
  const [feedbackSavingId, setFeedbackSavingId] = useState('');

  const listsRef = useMemo(() => collection(db, POOL_LIST_COLLECTION), []);
  const parsedRows = useMemo(() => parseProspectRows(form.rowInput, form.providerName), [form.rowInput, form.providerName]);
  const rowsToSave = useMemo(() => filterRowsByConfidence(parsedRows, form.minConfidence), [parsedRows, form.minConfidence]);
  const excludedRowCount = Math.max(parsedRows.length - rowsToSave.length, 0);
  const previewStats = useMemo(() => calculateStats(rowsToSave, form), [rowsToSave, form]);
  const importPreviewStats = useMemo(() => calculateStats(importRows, importListForm), [importRows, importListForm]);
  const selectedList = useMemo(() => lists.find((list) => list.id === selectedListId) || null, [lists, selectedListId]);

  useEffect(() => {
    const listsQuery = query(listsRef, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      listsQuery,
      (snapshot) => {
        const nextLists = snapshot.docs.map((listDoc) => ({ id: listDoc.id, ...listDoc.data() }));
        setLists(nextLists);
        setLoadingLists(false);

        setSelectedListId((currentId) => {
          if (currentId && nextLists.some((list) => list.id === currentId)) return currentId;
          return nextLists[0]?.id || '';
        });
      },
      (error) => {
        console.error('Unable to load pool prospect lists:', error);
        toast.error('Could not load pool prospect lists.');
        setLoadingLists(false);
      }
    );

    return unsubscribe;
  }, [listsRef]);

  useEffect(() => {
    if (!selectedListId) {
      setSelectedRows([]);
      return undefined;
    }

    setLoadingRows(true);
    const propertiesRef = collection(db, POOL_LIST_COLLECTION, selectedListId, 'properties');
    const rowsQuery = query(propertiesRef, orderBy('sortOrder', 'asc'));
    const unsubscribe = onSnapshot(
      rowsQuery,
      (snapshot) => {
        setSelectedRows(snapshot.docs.map((rowDoc) => ({ id: rowDoc.id, ...rowDoc.data() })));
        setLoadingRows(false);
      },
      (error) => {
        console.error('Unable to load pool prospect rows:', error);
        toast.error('Could not load saved addresses.');
        setLoadingRows(false);
      }
    );

    return unsubscribe;
  }, [selectedListId]);

  useEffect(() => {
    if (!selectedListId) return;
    setImportTargetListId((currentId) => currentId || selectedListId);
  }, [selectedListId]);

  const summaryStats = useMemo(() => {
    const addressCount = lists.reduce((total, list) => total + getListAddressCount(list), 0);
    const poolAddressCount = lists.reduce((total, list) => total + getListPoolCount(list), 0);
    const listsWithDensity = lists.filter((list) => Number.isFinite(Number(list.stats?.poolDensityRatio)));
    const averageDensity = listsWithDensity.length
      ? listsWithDensity.reduce((total, list) => total + Number(list.stats.poolDensityRatio), 0) / listsWithDensity.length
      : null;

    return {
      listCount: lists.length,
      addressCount,
      poolAddressCount,
      averageDensity,
    };
  }, [lists]);

  const zipCoverage = useMemo(() => {
    const groups = lists.reduce((acc, list) => {
      const zip = String(list.zip || 'No ZIP').trim() || 'No ZIP';
      const current = acc[zip] || {
        zip,
        city: list.city || '',
        state: list.state || '',
        listCount: 0,
        addressCount: 0,
        poolAddressCount: 0,
        residentialPoolCount: 0,
        commercialPoolCount: 0,
        densityTotal: 0,
        densityCount: 0,
        firstListId: list.id,
      };

      current.city = current.city || list.city || '';
      current.state = current.state || list.state || '';
      current.listCount += 1;
      current.addressCount += getListAddressCount(list);
      current.poolAddressCount += getListPoolCount(list);
      current.residentialPoolCount += Number(list.stats?.residentialPoolCount || 0);
      current.commercialPoolCount += Number(list.stats?.commercialPoolCount || 0);

      if (Number.isFinite(Number(list.stats?.poolDensityRatio))) {
        current.densityTotal += Number(list.stats.poolDensityRatio);
        current.densityCount += 1;
      }

      acc[zip] = current;
      return acc;
    }, {});

    return Object.values(groups)
      .map((group) => ({
        ...group,
        averageDensity: group.densityCount ? group.densityTotal / group.densityCount : null,
      }))
      .sort((a, b) => {
        if (a.zip === 'No ZIP') return 1;
        if (b.zip === 'No ZIP') return -1;
        return a.zip.localeCompare(b.zip);
      });
  }, [lists]);

  const filteredSelectedRows = useMemo(() => {
    const term = rowSearch.trim().toLowerCase();
    if (!term) return selectedRows;

    return selectedRows.filter((row) => [
      row.streetAddress,
      row.city,
      row.state,
      row.zip,
      row.propertyType,
      row.propertyClass,
      row.source,
      row.parcelId,
      row.notes,
    ].some((value) => String(value || '').toLowerCase().includes(term)));
  }, [rowSearch, selectedRows]);

  const handleFieldChange = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleMissedPoolFieldChange = (field) => (event) => {
    setMissedPoolForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleFindFieldChange = (field) => (event) => {
    setFindForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const handleImportListFieldChange = (field) => (event) => {
    setImportListForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
  };

  const openImportModal = () => {
    setImportMode(selectedList ? 'append' : 'create');
    setImportTargetListId(selectedListId || '');
    setShowImportModal(true);
  };

  const openFindModal = () => {
    setFindForm((current) => ({
      ...current,
      city: current.city || selectedList?.city || '',
      state: current.state || selectedList?.state || '',
      zip: current.zip || selectedList?.zip || '',
    }));
    setShowFindModal(true);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportRows([]);
    setImportFileName('');
    setImportListForm(EMPTY_IMPORT_LIST_FORM);
    setImportMode(selectedListId ? 'append' : 'create');
    setImportTargetListId(selectedListId || '');
  };

  const handleImportFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        toast.error('That workbook does not have any sheets.');
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const sheetRows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
      const sourceName = importListForm.providerName.trim() || file.name || 'Excel import';
      const parsedWorkbookRows = filterRowsByConfidence(parseWorkbookRows(sheetRows, sourceName), importListForm.minConfidence);

      if (parsedWorkbookRows.length === 0) {
        toast.error('No address rows found. Use headers like streetAddress, city, state, zip, propertyType, poolConfidence.');
        setImportRows([]);
        setImportFileName(file.name);
        return;
      }

      const firstLocatedRow = parsedWorkbookRows.find((row) => row.city || row.state || row.zip);
      setImportRows(parsedWorkbookRows);
      setImportFileName(file.name);
      setImportListForm((current) => ({
        ...current,
        name: current.name || buildDefaultListName(firstLocatedRow || {}),
        city: current.city || firstLocatedRow?.city || '',
        state: current.state || firstLocatedRow?.state || '',
        zip: current.zip || firstLocatedRow?.zip || '',
        providerName: current.providerName || file.name,
      }));
      toast.success(`Read ${parsedWorkbookRows.length} row${parsedWorkbookRows.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (error) {
      console.error('Unable to parse pool prospect workbook:', error);
      toast.error('Could not read that Excel file.');
    }
  };

  const importWorkbookRows = async (event) => {
    event.preventDefault();

    if (importRows.length === 0) {
      toast.error('Choose an Excel file with pool address rows.');
      return;
    }

    const isCreatingList = importMode === 'create';
    const targetList = lists.find((list) => list.id === importTargetListId);
    const nameValue = importListForm.name.trim();
    const cityValue = importListForm.city.trim();
    const zipValue = importListForm.zip.trim();

    if (isCreatingList && !nameValue) {
      toast.error('List name is required.');
      return;
    }

    if (isCreatingList && !cityValue && !zipValue) {
      toast.error('Enter a city or zip code for the new list.');
      return;
    }

    if (!isCreatingList && !targetList) {
      toast.error('Choose the list you want to add the rows to.');
      return;
    }

    setImporting(true);

    try {
      const timestamp = serverTimestamp();
      const listRef = isCreatingList ? doc(listsRef) : doc(db, POOL_LIST_COLLECTION, targetList.id);
      const sourceLabel = SOURCE_OPTIONS.find((option) => option.value === importListForm.sourceType)?.label || importListForm.sourceType;
      const listId = listRef.id;
      const startSortOrder = isCreatingList
        ? 0
        : (targetList.id === selectedListId ? selectedRows.length : getListAddressCount(targetList));

      let batch = writeBatch(db);
      let operationCount = 0;
      const commitBatch = async () => {
        if (operationCount === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        operationCount = 0;
      };

      if (isCreatingList) {
        batch.set(listRef, {
          id: listId,
          name: nameValue,
          city: cityValue,
          state: importListForm.state.trim().toUpperCase(),
          zip: zipValue,
          sourceType: importListForm.sourceType,
          sourceLabel,
          providerName: importListForm.providerName.trim(),
          minConfidence: toOptionalNumber(importListForm.minConfidence),
          notes: importListForm.notes.trim(),
          stats: calculateStats(importRows, importListForm),
          corrections: {
            falsePositiveCount: 0,
            manualAddCount: 0,
          },
          status: 'Saved',
          createdBy: user?.uid || '',
          createdByName: name || user?.displayName || user?.email || '',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } else {
        batch.update(listRef, {
          stats: mergeStatsWithRows(targetList, importRows),
          status: 'Saved',
          lastImport: {
            fileName: importFileName,
            rowCount: importRows.length,
            importedAt: timestamp,
            importedBy: user?.uid || '',
            importedByName: name || user?.displayName || user?.email || '',
          },
          updatedAt: timestamp,
        });
      }

      operationCount += 1;

      for (let index = 0; index < importRows.length; index += 1) {
        if (operationCount >= MAX_BATCH_WRITES) {
          await commitBatch();
        }

        const row = importRows[index];
        const rowRef = doc(collection(listRef, 'properties'));
        batch.set(rowRef, {
          ...row,
          id: rowRef.id,
          listId,
          sortOrder: startSortOrder + index,
          reviewed: true,
          reviewStatus: 'confirmedPool',
          poolFound: true,
          importFileName,
          source: row.source || importListForm.providerName.trim() || sourceLabel,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        operationCount += 1;
      }

      await commitBatch();
      setSelectedListId(listId);
      closeImportModal();
      toast.success(`${isCreatingList ? 'Created list with' : 'Imported'} ${importRows.length} pool address${importRows.length === 1 ? '' : 'es'}.`);
    } catch (error) {
      console.error('Unable to import pool prospect workbook:', error);
      toast.error('Could not import those pool addresses.');
    } finally {
      setImporting(false);
    }
  };

  const saveList = async (event) => {
    event.preventDefault();

    const nameValue = form.name.trim();
    const cityValue = form.city.trim();
    const zipValue = form.zip.trim();

    if (!nameValue) {
      toast.error('List name is required.');
      return;
    }

    if (!cityValue && !zipValue) {
      toast.error('Enter a city or zip code.');
      return;
    }

    if (rowsToSave.length === 0) {
      toast.error('Add at least one verified pool address row.');
      return;
    }

    setSaving(true);

    try {
      const timestamp = serverTimestamp();
      const listRef = doc(listsRef);
      const stats = calculateStats(rowsToSave, form);
      const sourceLabel = SOURCE_OPTIONS.find((option) => option.value === form.sourceType)?.label || form.sourceType;
      const basePayload = {
        id: listRef.id,
        name: nameValue,
        city: cityValue,
        state: form.state.trim().toUpperCase(),
        zip: zipValue,
        sourceType: form.sourceType,
        sourceLabel,
        providerName: form.providerName.trim(),
        minConfidence: toOptionalNumber(form.minConfidence),
        notes: form.notes.trim(),
        stats,
        corrections: {
          falsePositiveCount: 0,
          manualAddCount: 0,
        },
        status: 'Saved',
        createdBy: user?.uid || '',
        createdByName: name || user?.displayName || user?.email || '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      let batch = writeBatch(db);
      let operationCount = 0;
      const commitBatch = async () => {
        if (operationCount === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        operationCount = 0;
      };

      batch.set(listRef, basePayload);
      operationCount += 1;

      for (let index = 0; index < rowsToSave.length; index += 1) {
        if (operationCount >= MAX_BATCH_WRITES) {
          await commitBatch();
        }

        const row = rowsToSave[index];
        const rowRef = doc(collection(listRef, 'properties'));
        batch.set(rowRef, {
          ...row,
          id: rowRef.id,
          listId: listRef.id,
          sortOrder: index,
          reviewed: true,
          reviewStatus: 'confirmedPool',
          poolFound: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        operationCount += 1;
      }

      await commitBatch();
      setForm(EMPTY_FORM);
      setSelectedListId(listRef.id);
      toast.success(`Saved ${rowsToSave.length} pool address${rowsToSave.length === 1 ? '' : 'es'}.`);
    } catch (error) {
      console.error('Unable to save pool prospect list:', error);
      toast.error('Could not save pool prospect list.');
    } finally {
      setSaving(false);
    }
  };

  const createFinderRun = async (event) => {
    event.preventDefault();

    const cityValue = findForm.city.trim();
    const stateValue = findForm.state.trim().toUpperCase();
    const zipValue = findForm.zip.trim();

    if (!cityValue && !zipValue) {
      toast.error('Enter a city or zip code for the finder run.');
      return;
    }

    setFinding(true);

    try {
      const timestamp = serverTimestamp();
      const listRef = doc(listsRef);
      const sourceLabel = SOURCE_OPTIONS.find((option) => option.value === findForm.sourceType)?.label || findForm.sourceType;
      const createdByName = name || user?.displayName || user?.email || '';
      const batch = writeBatch(db);

      batch.set(listRef, {
        id: listRef.id,
        name: buildFinderRunName({ city: cityValue, state: stateValue, zip: zipValue }),
        city: cityValue,
        state: stateValue,
        zip: zipValue,
        sourceType: findForm.sourceType,
        sourceLabel,
        providerName: findForm.providerName.trim(),
        minConfidence: toOptionalNumber(findForm.minConfidence),
        notes: findForm.notes.trim(),
        stats: calculateStats([], findForm),
        corrections: {
          falsePositiveCount: 0,
          manualAddCount: 0,
        },
        status: 'Finder queued',
        finderRun: {
          status: 'queued',
          requestedAt: timestamp,
          requestedBy: user?.uid || '',
          requestedByName: createdByName,
        },
        createdBy: user?.uid || '',
        createdByName,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      batch.set(doc(collection(listRef, 'listActivity')), {
        id: `finder_${Date.now()}`,
        activityType: 'finderQueued',
        status: 'queued',
        city: cityValue,
        state: stateValue,
        zip: zipValue,
        sourceType: findForm.sourceType,
        sourceLabel,
        providerName: findForm.providerName.trim(),
        minConfidence: toOptionalNumber(findForm.minConfidence),
        createdBy: user?.uid || '',
        createdByName,
        createdAt: timestamp,
      });

      await batch.commit();
      setSelectedListId(listRef.id);
      setFindForm(EMPTY_FIND_FORM);
      setShowFindModal(false);
      toast.success('Pool finder run queued.');
    } catch (error) {
      console.error('Unable to create pool finder run:', error);
      toast.error('Could not start pool finder.');
    } finally {
      setFinding(false);
    }
  };

  const deleteList = async (list) => {
    const confirmed = await appConfirm({
      title: 'Delete pool prospect list?',
      message: `Delete ${list.name || 'this saved list'} and its saved addresses?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep List',
      variant: 'danger',
    });

    if (!confirmed) return;

    setDeletingId(list.id);

    try {
      const listRef = doc(db, POOL_LIST_COLLECTION, list.id);
      const rowsSnapshot = await getDocs(collection(listRef, 'properties'));
      let batch = writeBatch(db);
      let operationCount = 0;

      const commitBatch = async () => {
        if (operationCount === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        operationCount = 0;
      };

      for (const rowDoc of rowsSnapshot.docs) {
        if (operationCount >= MAX_BATCH_WRITES) {
          await commitBatch();
        }

        batch.delete(rowDoc.ref);
        operationCount += 1;
      }

      await commitBatch();
      await deleteDoc(listRef);
      toast.success('Pool prospect list deleted.');
    } catch (error) {
      console.error('Unable to delete pool prospect list:', error);
      toast.error('Could not delete pool prospect list.');
    } finally {
      setDeletingId('');
    }
  };

  const markPropertyNoPool = async (row) => {
    if (!selectedList || !row?.id || row.reviewStatus === 'falsePositive') return;

    const confirmed = await appConfirm({
      title: 'Mark as no pool?',
      message: `Mark ${row.streetAddress || row.formattedAddress || 'this property'} as a false pool match?`,
      confirmLabel: 'Mark No Pool',
      cancelLabel: 'Keep Pool',
      variant: 'danger',
    });

    if (!confirmed) return;

    setFeedbackSavingId(row.id);

    try {
      const timestamp = serverTimestamp();
      const rowRef = doc(db, POOL_LIST_COLLECTION, selectedList.id, 'properties', row.id);
      const listRef = doc(db, POOL_LIST_COLLECTION, selectedList.id);
      const nextStats = applyPoolCountDelta(selectedList, row.propertyClass || 'unknown', -1);
      const nextCorrections = {
        ...(selectedList.corrections || {}),
        falsePositiveCount: Number(selectedList.corrections?.falsePositiveCount || 0) + 1,
      };
      const batch = writeBatch(db);

      batch.update(rowRef, {
        reviewed: true,
        reviewStatus: 'falsePositive',
        poolFound: false,
        correctionType: 'falsePositive',
        correctedAt: timestamp,
        correctedBy: user?.uid || '',
        correctedByName: name || user?.displayName || user?.email || '',
        updatedAt: timestamp,
      });
      batch.update(listRef, {
        stats: nextStats,
        corrections: nextCorrections,
        updatedAt: timestamp,
      });
      batch.set(doc(collection(listRef, 'listActivity')), {
        id: `feedback_${Date.now()}`,
        propertyId: row.id,
        feedbackType: 'falsePositive',
        streetAddress: row.streetAddress || '',
        formattedAddress: row.formattedAddress || '',
        propertyClass: row.propertyClass || 'unknown',
        poolConfidence: row.poolConfidence ?? null,
        createdBy: user?.uid || '',
        createdByName: name || user?.displayName || user?.email || '',
        createdAt: timestamp,
      });

      await batch.commit();
      toast.success('Marked as no pool.');
    } catch (error) {
      console.error('Unable to save pool feedback:', error);
      toast.error('Could not save feedback.');
    } finally {
      setFeedbackSavingId('');
    }
  };

  const addMissedPool = async (event) => {
    event.preventDefault();

    if (!selectedList) {
      toast.error('Select a list before adding a pool.');
      return;
    }

    if (!missedPoolForm.streetAddress.trim() && !missedPoolForm.parcelId.trim()) {
      toast.error('Enter an address or parcel ID.');
      return;
    }

    setAddingMissedPool(true);

    try {
      const timestamp = serverTimestamp();
      const listRef = doc(db, POOL_LIST_COLLECTION, selectedList.id);
      const rowRef = doc(collection(listRef, 'properties'));
      const normalizedRow = normalizeProspectRow({
        ...missedPoolForm,
        city: missedPoolForm.city || selectedList.city || '',
        state: missedPoolForm.state || selectedList.state || '',
        zip: missedPoolForm.zip || selectedList.zip || '',
        source: 'Manual entry',
      }, selectedRows.length, 'Manual entry');
      const nextStats = applyPoolCountDelta(selectedList, normalizedRow.propertyClass || 'unknown', 1, 1);
      const nextCorrections = {
        ...(selectedList.corrections || {}),
        manualAddCount: Number(selectedList.corrections?.manualAddCount || 0) + 1,
      };
      const batch = writeBatch(db);

      batch.set(rowRef, {
        ...normalizedRow,
        id: rowRef.id,
        listId: selectedList.id,
        reviewed: true,
        reviewStatus: 'confirmedPool',
        poolFound: true,
        correctionType: 'manualAdd',
        correctedAt: timestamp,
        correctedBy: user?.uid || '',
        correctedByName: name || user?.displayName || user?.email || '',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      batch.update(listRef, {
        stats: nextStats,
        corrections: nextCorrections,
        updatedAt: timestamp,
      });
      batch.set(doc(collection(listRef, 'listActivity')), {
        id: `feedback_${Date.now()}`,
        propertyId: rowRef.id,
        feedbackType: 'manualAdd',
        streetAddress: normalizedRow.streetAddress || '',
        formattedAddress: normalizedRow.formattedAddress || '',
        propertyClass: normalizedRow.propertyClass || 'unknown',
        poolConfidence: normalizedRow.poolConfidence ?? null,
        createdBy: user?.uid || '',
        createdByName: name || user?.displayName || user?.email || '',
        createdAt: timestamp,
      });

      await batch.commit();
      setMissedPoolForm(EMPTY_MISSED_POOL_FORM);
      setShowMissedPoolModal(false);
      toast.success('Pool address added.');
    } catch (error) {
      console.error('Unable to add missed pool:', error);
      toast.error('Could not add missed pool.');
    } finally {
      setAddingMissedPool(false);
    }
  };

  const exportSelectedRows = () => {
    if (!selectedList || selectedRows.length === 0) {
      toast.error('No saved addresses to export.');
      return;
    }

    const safeName = String(selectedList.name || 'pool-prospect-list')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    downloadCsv(`${safeName || 'pool-prospect-list'}.csv`, selectedRows);
  };

  const renderPropertyClass = (propertyClass = 'unknown') => {
    const styles = {
      residential: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-400/20',
      commercial: 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/20',
      unknown: 'bg-slate-800 text-slate-300 ring-1 ring-slate-700',
    };

    return (
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[propertyClass] || styles.unknown}`}>
        {propertyClass || 'unknown'}
      </span>
    );
  };

  const renderReviewStatus = (row = {}) => {
    if (row.reviewStatus === 'falsePositive') {
      return <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 ring-1 ring-red-400/20">No pool</span>;
    }

    if (row.correctionType === 'manualAdd') {
      return <span className="rounded-full bg-[#efb12f]/15 px-2.5 py-1 text-xs font-semibold text-[#efb12f] ring-1 ring-[#efb12f]/30">Manual</span>;
    }

    if (row.reviewStatus === 'missedPool') {
      return <span className="rounded-full bg-[#efb12f]/15 px-2.5 py-1 text-xs font-semibold text-[#efb12f] ring-1 ring-[#efb12f]/30">Added pool</span>;
    }

    if (row.reviewStatus === 'confirmedPool' || row.reviewed === true) {
      return <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/20">Reviewed</span>;
    }

    return <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 ring-1 ring-slate-700">Unreviewed</span>;
  };

  return (
    <div className="min-h-screen bg-slate-950 px-2 py-6 text-slate-100 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <div className={`${PANEL_CLASS} p-5`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: ADMIN_YELLOW }}>Admin growth</p>
              <h1 className="mt-1 text-3xl font-bold text-slate-50">Pool Prospect Lists</h1>
              <p className="mt-1 text-sm text-slate-400">Manual pool address lists, Excel imports, ZIP coverage, and correction tracking.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openFindModal}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[#efb12f] px-4 py-2 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-[#f6c65a]"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
                Find Pools
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedList) {
                    setMissedPoolForm((current) => ({
                      ...current,
                      city: selectedList.city || '',
                      state: selectedList.state || '',
                      zip: selectedList.zip || '',
                    }));
                  }
                  setShowMissedPoolModal(true);
                }}
                disabled={!selectedList}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[#efb12f] px-4 py-2 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-[#f6c65a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" />
                Add Pool
              </button>
              <button
                type="button"
                onClick={openImportModal}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-[#efb12f]/40 bg-[#efb12f]/10 px-4 py-2 text-sm font-bold text-[#efb12f] shadow-sm transition hover:bg-[#efb12f]/15"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                Import Excel
              </button>
              <button
                type="button"
                onClick={exportSelectedRows}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-[#efb12f]/40 bg-[#efb12f]/10 px-4 py-2 text-sm font-bold text-[#efb12f] shadow-sm transition hover:bg-[#efb12f]/15 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!selectedList || selectedRows.length === 0}
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile title="Saved Lists" value={formatInteger(summaryStats.listCount)} helper="Admin prospect batches" Icon={ClipboardDocumentListIcon} tone="slate" />
          <StatTile title="Pool Count" value={formatInteger(summaryStats.poolAddressCount)} helper="Rows currently marked as pools" Icon={MapPinIcon} tone="blue" />
          <StatTile title="Address Count" value={formatInteger(summaryStats.addressCount)} helper="Saved property rows" Icon={MapIcon} tone="slate" />
          <StatTile title="Average Density" value={formatPercent(summaryStats.averageDensity)} helper="Across lists with a denominator" Icon={BeakerIcon} tone="emerald" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
          <form onSubmit={saveList} className={PANEL_CLASS}>
            <div className={PANEL_HEADER_CLASS}>
              <h2 className="text-lg font-bold text-slate-50">Create Manual List</h2>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <FieldLabel>List Name</FieldLabel>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleFieldChange('name')}
                  className={`${INPUT_BASE_CLASS} text-sm`}
                  placeholder="Scottsdale 85255 pool prospects"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <FieldLabel>City</FieldLabel>
                  <input
                    type="text"
                    value={form.city}
                    onChange={handleFieldChange('city')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <input
                    type="text"
                    value={form.state}
                    onChange={handleFieldChange('state')}
                    maxLength={2}
                    className={`${INPUT_BASE_CLASS} text-sm uppercase`}
                  />
                </div>
                <div>
                  <FieldLabel>Zip</FieldLabel>
                  <input
                    type="text"
                    value={form.zip}
                    onChange={handleFieldChange('zip')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>Source Type</FieldLabel>
                  <select
                    value={form.sourceType}
                    onChange={handleFieldChange('sourceType')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  >
                    {SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Source Name</FieldLabel>
                  <input
                    type="text"
                    value={form.providerName}
                    onChange={handleFieldChange('providerName')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                    placeholder="Drone review, field notes, county sheet"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>Total Properties</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    value={form.totalProperties}
                    onChange={handleFieldChange('totalProperties')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>Minimum Confidence</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.minConfidence}
                    onChange={handleFieldChange('minConfidence')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>Residential Properties</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    value={form.residentialProperties}
                    onChange={handleFieldChange('residentialProperties')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>Commercial Properties</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    value={form.commercialProperties}
                    onChange={handleFieldChange('commercialProperties')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Address Rows</FieldLabel>
                <textarea
                  value={form.rowInput}
                  onChange={handleFieldChange('rowInput')}
                  rows={9}
                  className={`${INPUT_BASE_CLASS} font-mono text-xs`}
                  placeholder="streetAddress,city,state,zip,propertyType,poolConfidence,source,parcelId,latitude,longitude,notes"
                />
              </div>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  value={form.notes}
                  onChange={handleFieldChange('notes')}
                  rows={3}
                  className={`${INPUT_BASE_CLASS} text-sm`}
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Rows Ready</p>
                    <p className="mt-1 font-bold text-slate-50">{formatInteger(rowsToSave.length)}</p>
                    {excludedRowCount > 0 && <p className="mt-1 text-xs text-slate-500">{formatInteger(excludedRowCount)} below confidence</p>}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Pool Density</p>
                    <p className="mt-1 font-bold text-slate-50">{formatPercent(previewStats.poolDensityRatio)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Residential Pools</p>
                    <p className="mt-1 font-bold text-slate-50">{formatInteger(previewStats.residentialPoolCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Commercial Pools</p>
                    <p className="mt-1 font-bold text-slate-50">{formatInteger(previewStats.commercialPoolCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Unknown Class</p>
                    <p className="mt-1 font-bold text-slate-50">{formatInteger(previewStats.unknownPoolCount)}</p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#efb12f] px-4 py-2.5 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-[#f6c65a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save List'}
              </button>
            </div>
          </form>

          <div className="space-y-6">
            <section className={PANEL_CLASS}>
              <div className="flex flex-col gap-3 border-b border-slate-800/70 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-50">Saved Lists</h2>
                  <p className="mt-1 text-sm text-slate-400">{formatInteger(lists.length)} total lists across {formatInteger(zipCoverage.length)} ZIP code{zipCoverage.length === 1 ? '' : 's'}</p>
                </div>
                <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => setCoverageMode('lists')}
                    className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-bold transition ${
                      coverageMode === 'lists'
                        ? 'bg-[#efb12f] text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <ClipboardDocumentListIcon className="h-4 w-4" />
                    Lists
                  </button>
                  <button
                    type="button"
                    onClick={() => setCoverageMode('zip')}
                    className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-bold transition ${
                      coverageMode === 'zip'
                        ? 'bg-[#efb12f] text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <MapIcon className="h-4 w-4" />
                    ZIP Map
                  </button>
                </div>
              </div>

              {loadingLists ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading lists...</div>
              ) : lists.length === 0 ? (
                <div className="m-5 rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-10 text-center">
                  <h3 className="text-lg font-bold text-slate-100">No saved lists</h3>
                  <p className="mt-1 text-sm text-slate-400">Saved prospect lists will appear here.</p>
                </div>
              ) : coverageMode === 'zip' ? (
                <div className="grid gap-3 p-5 md:grid-cols-2 2xl:grid-cols-3">
                  {zipCoverage.map((zone) => (
                    <button
                      key={zone.zip}
                      type="button"
                      onClick={() => {
                        if (zone.firstListId) setSelectedListId(zone.firstListId);
                      }}
                      className={`min-h-[160px] rounded-lg border p-4 text-left transition ${
                        selectedList?.zip === zone.zip
                          ? 'border-[#efb12f]/50 bg-[#efb12f]/10'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{[zone.city, zone.state].filter(Boolean).join(', ') || 'Area'}</p>
                          <p className="mt-1 text-2xl font-black text-slate-50">{zone.zip}</p>
                        </div>
                        <span className="rounded-md bg-[#efb12f]/15 p-2 text-[#efb12f] ring-1 ring-[#efb12f]/30">
                          <MapPinIcon className="h-5 w-5" />
                        </span>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pools</p>
                          <p className="mt-1 font-bold text-slate-100">{formatInteger(zone.poolAddressCount)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Addresses</p>
                          <p className="mt-1 font-bold text-slate-100">{formatInteger(zone.addressCount)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Lists</p>
                          <p className="mt-1 font-bold text-slate-100">{formatInteger(zone.listCount)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Density</p>
                          <p className="mt-1 font-bold text-slate-100">{formatPercent(zone.averageDensity)}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-300 ring-1 ring-emerald-400/20">{formatInteger(zone.residentialPoolCount)} residential</span>
                        <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-cyan-300 ring-1 ring-cyan-400/20">{formatInteger(zone.commercialPoolCount)} commercial</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-slate-900/60">
                    <thead className="bg-slate-950/70">
                      <tr>
                        <th className={TABLE_HEADER_CELL_CLASS}>List</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Area</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Pools</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Addresses</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Density</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Saved</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {lists.map((list) => {
                        const isSelected = list.id === selectedListId;

                        return (
                          <tr
                            key={list.id}
                            onClick={() => setSelectedListId(list.id)}
                            className={`cursor-pointer ${TABLE_ROW_CLASS} ${isSelected ? 'bg-[#efb12f]/10 ring-1 ring-inset ring-[#efb12f]/30' : ''}`}
                          >
                            <td className="whitespace-nowrap px-5 py-3">
                              <div className="font-semibold text-slate-50">{list.name}</div>
                              <div className="text-xs text-slate-400">{list.providerName || list.sourceLabel || 'Manual source'}</div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-300">
                              {[list.city, list.state, list.zip].filter(Boolean).join(', ') || 'Area saved'}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-slate-50">
                              {formatInteger(getListPoolCount(list))}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-300">
                              {formatInteger(getListAddressCount(list))}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-300">
                              {formatPercent(list.stats?.poolDensityRatio)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-400">
                              {formatDate(list.createdAt)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deleteList(list);
                                }}
                                disabled={deletingId === list.id}
                                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                                {deletingId === list.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={PANEL_CLASS}>
              <div className="flex flex-col gap-4 border-b border-slate-800/70 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-50">{selectedList?.name || 'Saved Addresses'}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {selectedList ? `${formatInteger(selectedRows.length)} saved pool address${selectedRows.length === 1 ? '' : 'es'}` : 'Select a list to view saved addresses.'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedList) {
                        setMissedPoolForm((current) => ({
                          ...current,
                          city: selectedList.city || '',
                          state: selectedList.state || '',
                          zip: selectedList.zip || '',
                        }));
                      }
                      setShowMissedPoolModal(true);
                    }}
                    disabled={!selectedList}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-[#efb12f]/40 bg-[#efb12f]/10 px-3 py-2 text-sm font-bold text-[#efb12f] shadow-sm transition hover:bg-[#efb12f]/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Pool
                  </button>
                  <div className="relative lg:w-80">
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="search"
                      value={rowSearch}
                      onChange={(event) => setRowSearch(event.target.value)}
                      placeholder="Search saved addresses"
                      className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 shadow-sm placeholder:text-slate-500 focus:border-[#efb12f] focus:outline-none focus:ring-2 focus:ring-[#efb12f]/20"
                      disabled={!selectedList}
                    />
                  </div>
                </div>
              </div>

              {loadingRows ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading addresses...</div>
              ) : !selectedList ? (
                <div className="p-8 text-center text-sm text-slate-400">No list selected.</div>
              ) : filteredSelectedRows.length === 0 ? (
                <div className="m-5 rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-10 text-center">
                  <h3 className="text-lg font-bold text-slate-100">No matching addresses</h3>
                  <p className="mt-1 text-sm text-slate-400">Adjust the search or choose another list.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-slate-900/60">
                    <thead className="bg-slate-950/70">
                      <tr>
                        <th className={TABLE_HEADER_CELL_CLASS}>Address</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Type</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Confidence</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Review</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Source</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Parcel</th>
                        <th className={TABLE_HEADER_CELL_CLASS}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredSelectedRows.map((row) => (
                        <tr key={row.id} className={TABLE_ROW_CLASS}>
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-50">{row.streetAddress || row.formattedAddress || 'Saved address'}</div>
                            <div className="text-sm text-slate-400">{[row.city, row.state, row.zip].filter(Boolean).join(', ')}</div>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3">
                            {renderPropertyClass(row.propertyClass)}
                            {row.propertyType && <div className="mt-1 text-xs text-slate-400">{row.propertyType}</div>}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-300">
                            {row.poolConfidence === null || row.poolConfidence === undefined ? 'Verified' : `${row.poolConfidence}%`}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3">{renderReviewStatus(row)}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-300">{row.source || selectedList.providerName || selectedList.sourceLabel || 'Verified'}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-400">{row.parcelId || 'N/A'}</td>
                          <td className="whitespace-nowrap px-5 py-3">
                            <button
                              type="button"
                              onClick={() => markPropertyNoPool(row)}
                              disabled={feedbackSavingId === row.id || row.reviewStatus === 'falsePositive'}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                              {feedbackSavingId === row.id ? 'Saving...' : 'No Pool'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {showFindModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className={`${PANEL_CLASS} max-h-[90vh] w-full max-w-2xl overflow-y-auto`}>
            <div className={PANEL_HEADER_CLASS}>
              <h2 className="text-lg font-bold text-slate-50">Find Pools</h2>
            </div>

            <form onSubmit={createFinderRun} className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <FieldLabel>City</FieldLabel>
                  <input
                    type="text"
                    value={findForm.city}
                    onChange={handleFindFieldChange('city')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <input
                    type="text"
                    value={findForm.state}
                    onChange={handleFindFieldChange('state')}
                    maxLength={2}
                    className={`${INPUT_BASE_CLASS} text-sm uppercase`}
                  />
                </div>
                <div>
                  <FieldLabel>Zip</FieldLabel>
                  <input
                    type="text"
                    value={findForm.zip}
                    onChange={handleFindFieldChange('zip')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <FieldLabel>Source</FieldLabel>
                  <select
                    value={findForm.sourceType}
                    onChange={handleFindFieldChange('sourceType')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  >
                    {SOURCE_OPTIONS.filter((option) => option.value !== 'manualVerified').map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Provider</FieldLabel>
                  <input
                    type="text"
                    value={findForm.providerName}
                    onChange={handleFindFieldChange('providerName')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                    placeholder="ATTOM, Nearmap, Regrid"
                  />
                </div>
                <div>
                  <FieldLabel>Minimum Confidence</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={findForm.minConfidence}
                    onChange={handleFindFieldChange('minConfidence')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  value={findForm.notes}
                  onChange={handleFindFieldChange('notes')}
                  rows={3}
                  className={`${INPUT_BASE_CLASS} text-sm`}
                />
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowFindModal(false);
                    setFindForm(EMPTY_FIND_FORM);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={finding}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[#efb12f] px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-[#f6c65a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MagnifyingGlassIcon className="h-4 w-4" />
                  {finding ? 'Starting...' : 'Start Finder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMissedPoolModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6">
          <div className={`${PANEL_CLASS} max-h-[90vh] w-full max-w-2xl overflow-y-auto`}>
            <div className={PANEL_HEADER_CLASS}>
              <h2 className="text-lg font-bold text-slate-50">Missed Pool</h2>
            </div>

            <form onSubmit={addMissedPool} className="space-y-4 p-5">
              <div>
                <FieldLabel>Street Address</FieldLabel>
                <input
                  type="text"
                  value={missedPoolForm.streetAddress}
                  onChange={handleMissedPoolFieldChange('streetAddress')}
                  className={`${INPUT_BASE_CLASS} text-sm`}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <FieldLabel>City</FieldLabel>
                  <input
                    type="text"
                    value={missedPoolForm.city}
                    onChange={handleMissedPoolFieldChange('city')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <input
                    type="text"
                    value={missedPoolForm.state}
                    onChange={handleMissedPoolFieldChange('state')}
                    maxLength={2}
                    className={`${INPUT_BASE_CLASS} text-sm uppercase`}
                  />
                </div>
                <div>
                  <FieldLabel>Zip</FieldLabel>
                  <input
                    type="text"
                    value={missedPoolForm.zip}
                    onChange={handleMissedPoolFieldChange('zip')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <FieldLabel>Property Type</FieldLabel>
                  <input
                    type="text"
                    value={missedPoolForm.propertyType}
                    onChange={handleMissedPoolFieldChange('propertyType')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>Confidence</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={missedPoolForm.poolConfidence}
                    onChange={handleMissedPoolFieldChange('poolConfidence')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>Parcel ID</FieldLabel>
                  <input
                    type="text"
                    value={missedPoolForm.parcelId}
                    onChange={handleMissedPoolFieldChange('parcelId')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>Latitude</FieldLabel>
                  <input
                    type="number"
                    value={missedPoolForm.latitude}
                    onChange={handleMissedPoolFieldChange('latitude')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
                <div>
                  <FieldLabel>Longitude</FieldLabel>
                  <input
                    type="number"
                    value={missedPoolForm.longitude}
                    onChange={handleMissedPoolFieldChange('longitude')}
                    className={`${INPUT_BASE_CLASS} text-sm`}
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  value={missedPoolForm.notes}
                  onChange={handleMissedPoolFieldChange('notes')}
                  rows={3}
                  className={`${INPUT_BASE_CLASS} text-sm`}
                />
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowMissedPoolModal(false);
                    setMissedPoolForm(EMPTY_MISSED_POOL_FORM);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingMissedPool}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[#efb12f] px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-[#f6c65a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4" />
                  {addingMissedPool ? 'Saving...' : 'Add Pool'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PoolProspectLists;
