
import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, deleteDoc, serverTimestamp, setDoc, onSnapshot, arrayUnion } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { v4 as uuidv4 } from 'uuid';
import {
    ArrowsPointingInIcon,
    ArrowsPointingOutIcon,
    BriefcaseIcon,
    ClipboardDocumentIcon,
    DocumentDuplicateIcon,
    EllipsisVerticalIcon,
    EnvelopeIcon,
    ListBulletIcon,
    PencilSquareIcon,
    PlusIcon,
    PresentationChartLineIcon,
    WrenchScrewdriverIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { Context } from '../../../context/AuthContext';
import { ClipLoader } from 'react-spinners';
import toast from 'react-hot-toast';
import { addDays, addMonths, addWeeks, addYears, format } from 'date-fns';

import { functions, storage } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { RepairRequest, displayRepairRequestStatus, isOpenRepairRequestStatus } from '../../../utils/models/RepairRequest';
import { loadCustomerTimeline } from '../../../utils/customerTimeline';
import { deleteCustomerCascade } from '../../../utils/customerCascadeDelete';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import CustomerTimelineGraph from './CustomerTimelineGraph';
import { salesCollectionNames } from '../../../utils/models/Sales';
import PartApprovalCreateModal from '../partApprovals/PartApprovalCreateModal';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import EquipmentCatalogPicker from '../../components/equipment/EquipmentCatalogPicker';
import {
    customerMatchesRegionalAccess,
    getCustomerRegionAccessTags,
    normalizeCustomerTag,
    normalizeCustomerTags,
} from '../../../utils/customerTags';
import {
    getCustomerDisplayName,
    normalizeAddress,
    normalizeContact,
    normalizeCustomerForFirestore,
    normalizeServiceLocationForFirestore,
} from '../../../utils/customerLocationData';
import {
    getSuggestedWorkTierLabel,
    getSuggestedWorkTierTone,
    isOpenSuggestedWorkStatus,
    normalizeSuggestedWorkTier,
} from '../../../utils/models/SuggestedWork';
import {
    EQUIPMENT_STATUS,
    EQUIPMENT_STATUS_OPTIONS,
    buildEquipmentNickname,
    displayEquipmentStatus,
    equipmentDefaultsToNeedsService,
    isFilterEquipment,
} from '../../../utils/models/Equipment';
import { appConfirm } from '../../../utils/appDialog';
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from '../../../utils/models/FeatureFlag';
import {
    queueUniversalEquipmentSuggestion,
    syncUniversalEquipmentSuggestionForEquipment,
} from '../../../utils/universalEquipmentSuggestions';
import {
    buildCompanyServiceLocationPhotoPath,
    getServiceLocationPhotoUrl,
    uploadServiceLocationPhoto,
    validateServiceLocationPhotoFile,
} from '../../../utils/serviceLocationPhotos';
import { deleteEquipmentWithSubcollections } from '../../../utils/equipmentDelete';
import { endCustomerPipelineRowsForInactiveCustomer } from '../../../utils/customerPipeline';
import ShareItemButton from '../../components/share/ShareItemButton';

const customerSections = [
    { id: 'profile', label: 'Profile', helper: 'Contact, billing, notes, and account status' },
    { id: 'locations', label: 'Service Locations', helper: 'Properties, bodies of water, equipment, and recent stops' },
    { id: 'operations', label: 'Operations', helper: 'Jobs, repair requests, recurring service, and part approvals' },
    { id: 'history', label: 'History', helper: 'Service, job, lead, chemistry, equipment, and notes timeline' },
];
const validCustomerTabs = customerSections.map((section) => section.id);
const WATER_TYPE_OPTIONS = ['Fresh Water', 'Salt Water'];

const getLinkedCustomerUserId = (customer = {}) => {
    const linkedIds = Array.isArray(customer.linkedCustomerIds) ? customer.linkedCustomerIds : [];

    return String(
        customer.customerUserId ||
        customer.userId ||
        customer.linkedCustomerUserId ||
        customer.linkedHomeownerUserId ||
        customer.homeownerUserId ||
        customer.homeownerId ||
        linkedIds[0] ||
        ''
    ).trim();
};

// Reusable Components
const InfoCard = ({ title, children, actions, compact = false, className = '' }) => (
    <div className={[
        "rounded-lg border border-slate-200 bg-white shadow-sm",
        compact ? "p-3 sm:p-4" : "p-5",
        className,
    ].filter(Boolean).join(" ")}>
        <div className={`${compact ? "mb-3" : "mb-4"} flex items-center justify-between gap-3`}>
            <h3 className={`${compact ? "text-base" : "text-lg"} font-bold text-slate-950`}>{title}</h3>
            {actions && <div className="flex-shrink-0">{actions}</div>}
        </div>
        <div className={compact ? "space-y-3" : "space-y-4"}>{children}</div>
    </div>
);

const formatCents = (value) => {
    const amount = Number(value || 0) / 100;
    return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "$0.00";
};

const formatCentsDelta = (value) => {
    const amount = Number(value || 0);
    if (!amount) return 'No change';
    return `${amount > 0 ? '+' : '-'}${formatCents(Math.abs(amount))}`;
};

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const startOfLocalDayMillis = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();

const endOfLocalDayMillis = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();

const getDefaultHistoryDateRange = () => {
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - 2);

    return {
        start: startOfLocalDayMillis(start),
        end: endOfLocalDayMillis(today),
        invalid: false,
    };
};

const isWithinDateRange = (value, range) => {
    if (range?.invalid) return false;
    const millis = toMillis(value);
    if (!millis) return false;
    return millis >= range.start && millis <= range.end;
};

const formatDateValue = (value) => {
    const millis = toMillis(value);
    return millis ? format(new Date(millis), 'MMM d, yyyy') : 'Not set';
};

const toDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'number') return new Date(value);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateInputValue = (value) => {
    const date = toDateValue(value);
    return date ? format(date, 'yyyy-MM-dd') : '';
};

const dateInputToLocalDate = (value) => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
};

const computeNextEquipmentServiceDate = (lastServiceDate, serviceFrequency, serviceFrequencyEvery) => {
    const base = toDateValue(lastServiceDate);
    if (!base) return null;

    const amount = Number(serviceFrequency);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    if (serviceFrequencyEvery === 'Day') return addDays(base, amount);
    if (serviceFrequencyEvery === 'Week') return addWeeks(base, amount);
    if (serviceFrequencyEvery === 'Month') return addMonths(base, amount);
    if (serviceFrequencyEvery === 'Year') return addYears(base, amount);

    return null;
};

const getEquipmentEditForm = (equipment = {}) => ({
    name: equipment.name || '',
    type: equipment.type || equipment.category || '',
    typeId: equipment.typeId || '',
    make: equipment.make || '',
    makeId: equipment.makeId || '',
    model: equipment.model || '',
    modelId: equipment.modelId || '',
    universalEquipmentId: equipment.universalEquipmentId || equipment.modelId || '',
    manualPdfLink: equipment.manualPdfLink || '',
    dateInstalled: toDateInputValue(equipment.dateInstalled),
    cleanFilterPressure: equipment.cleanFilterPressure ?? '',
    currentPressure: equipment.currentPressure ?? '',
    lastServiceDate: toDateInputValue(equipment.lastServiceDate),
    needsService: !!equipment.needsService,
    isActive: equipment.isActive ?? equipment.active ?? true,
    serviceFrequency: equipment.serviceFrequency !== undefined && equipment.serviceFrequency !== null
        ? String(equipment.serviceFrequency)
        : '',
    serviceFrequencyEvery: equipment.serviceFrequencyEvery || '',
    status: displayEquipmentStatus(equipment.status || '') || EQUIPMENT_STATUS.OPERATIONAL,
    notes: equipment.notes || '',
});

const getDefaultEquipmentCreateForm = (bodyOfWaterId = '') => ({
    name: '',
    type: '',
    category: '',
    typeId: '',
    make: '',
    makeId: '',
    model: '',
    modelId: '',
    universalEquipmentId: '',
    manualPdfLink: '',
    dateInstalled: '',
    cleanFilterPressure: '',
    lastServiceDate: '',
    needsService: false,
    serviceFrequency: '6',
    serviceFrequencyEvery: 'Month',
    notes: '',
    bodyOfWaterId,
});

const isActiveEquipment = (equipment = {}) => (
    (equipment.isActive ?? equipment.active ?? true) !== false
);

const applyEquipmentDefaults = (current = {}, next = {}) => {
    const merged = { ...current, ...next };
    const shouldDefaultNeedsService = equipmentDefaultsToNeedsService(merged);
    const shouldHaveServiceSchedule = shouldDefaultNeedsService || merged.needsService;

    return {
        ...merged,
        needsService: shouldDefaultNeedsService ? true : merged.needsService,
        serviceFrequency: shouldHaveServiceSchedule && !merged.serviceFrequency ? '6' : merged.serviceFrequency,
        serviceFrequencyEvery: shouldHaveServiceSchedule && !merged.serviceFrequencyEvery ? 'Month' : merged.serviceFrequencyEvery,
    };
};

const formatDateTimeValue = (value) => {
    const millis = toMillis(value);
    return millis ? format(new Date(millis), 'MMM d, h:mm a') : 'Not set';
};

const labelize = (value) => {
    if (!value) return 'Unknown';
    return String(value)
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getLocationLabel = (location = {}) => {
    const address = location.address || {};
    return [
        location.nickName || location.name || 'Service location',
        address.streetAddress,
        address.city,
        address.state,
        address.zip || address.zipCode,
    ]
        .filter(Boolean)
        .join(' - ');
};

const getBodyOfWaterLabel = (bodyOfWater = {}) => (
    bodyOfWater.name ||
    bodyOfWater.label ||
    [bodyOfWater.shape, bodyOfWater.material].filter(Boolean).join(' ') ||
    'Unnamed Body of Water'
);

const StatusBadge = ({ children, tone = 'slate' }) => {
    const tones = {
        blue: 'border-blue-200 bg-blue-50 text-blue-700',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        amber: 'border-amber-200 bg-amber-50 text-amber-700',
        rose: 'border-rose-200 bg-rose-50 text-rose-700',
        slate: 'border-slate-200 bg-slate-50 text-slate-700',
    };

    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
            {children}
        </span>
    );
};

const QuickActionMenuItem = ({ label, icon: Icon, onClick, tone = 'slate', disabled = false }) => {
    const toneClasses = tone === 'amber'
        ? 'text-amber-700 hover:bg-amber-50 data-[focus]:bg-amber-50'
        : tone === 'rose'
            ? 'text-rose-700 hover:bg-rose-50 data-[focus]:bg-rose-50'
            : tone === 'emerald'
                ? 'text-emerald-700 hover:bg-emerald-50 data-[focus]:bg-emerald-50'
                : 'text-slate-700 hover:bg-slate-50 data-[focus]:bg-slate-50';

    return (
        <MenuItem disabled={disabled}>
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses}`}
            >
                {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="flex-1">{label}</span>
            </button>
        </MenuItem>
    );
};

const getBodyOfWaterEditForm = (bodyOfWater = {}) => ({
    name: bodyOfWater.name || '',
    gallons: bodyOfWater.gallons || '',
    material: bodyOfWater.material || '',
    waterType: bodyOfWater.waterType || '',
    notes: bodyOfWater.notes || '',
});

const normalizeWaterType = (value = '') => {
    const text = String(value || '').trim();
    if (/salt/i.test(text)) return 'Salt Water';
    if (/fresh/i.test(text)) return 'Fresh Water';
    return text;
};

const getNoteText = (note = {}) => note.note || note.comment || note.text || '';

const customerNoteAudienceOptions = [
    { value: 'all', label: 'All', tone: 'emerald' },
    { value: 'office', label: 'Office', tone: 'slate' },
    { value: 'field', label: 'Field', tone: 'blue' },
];

const getCustomerNoteAudience = (note = {}) => {
    const normalized = String(note.audience || note.visibility || 'all').trim().toLowerCase();
    return customerNoteAudienceOptions.find((option) => option.value === normalized) || customerNoteAudienceOptions[0];
};

const CustomerNotesSection = ({ customer, compact = false }) => {
    const [notes, setNotes] = useState([]);
    const [notesLoading, setNotesLoading] = useState(true);
    const [bodyOfWaterOptions, setBodyOfWaterOptions] = useState([]);
    const [selectedBodyOfWaterId, setSelectedBodyOfWaterId] = useState('');
    const [selectedAudience, setSelectedAudience] = useState('all');
    const [newNote, setNewNote] = useState('');
    const [addingNote, setAddingNote] = useState(false);
    const authCtx = useContext(Context);
    const { recentlySelectedCompany, user, dataBaseUser } = authCtx;
    const db = getFirestore();

    const getAuthorName = useCallback(() => (
        `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() ||
        dataBaseUser?.userName ||
        user?.displayName ||
        user?.email ||
        'Unknown'
    ), [dataBaseUser, user]);

    useEffect(() => {
        const fetchBodyOfWaterOptions = async () => {
            if (!recentlySelectedCompany || !customer?.id) {
                setBodyOfWaterOptions([]);
                return;
            }

            try {
                const bodySnap = await getDocs(query(
                    collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),
                    where('customerId', '==', customer.id)
                ));

                setBodyOfWaterOptions(
                    bodySnap.docs
                        .map((item) => ({ id: item.id, ...item.data() }))
                        .sort((left, right) => getBodyOfWaterLabel(left).localeCompare(getBodyOfWaterLabel(right)))
                );
            } catch (error) {
                console.error('Failed to load customer note pools:', error);
            }
        };

        fetchBodyOfWaterOptions();
    }, [customer?.id, recentlySelectedCompany, db]);

    useEffect(() => {
        if (!recentlySelectedCompany || !customer?.id) {
            setNotes([]);
            setNotesLoading(false);
            return undefined;
        }

        setNotesLoading(true);
        const notesQ = query(
            collection(db, 'companies', recentlySelectedCompany, 'customers', customer.id, 'notes'),
            orderBy('date', 'desc')
        );

        const unsubscribe = onSnapshot(
            notesQ,
            (snapshot) => {
                setNotes(snapshot.docs.map((noteDoc) => ({ id: noteDoc.id, ...noteDoc.data() })));
                setNotesLoading(false);
            },
            (error) => {
                console.error('Failed to load customer notes:', error);
                setNotesLoading(false);
                toast.error('Failed to load customer notes.');
            }
        );

        return () => unsubscribe();
    }, [customer?.id, recentlySelectedCompany, db]);

    const addCustomerNote = async () => {
        const trimmedNote = newNote.trim();
        if (!trimmedNote) {
            toast.error('Write a note first.');
            return;
        }

        if (!recentlySelectedCompany || !customer?.id) {
            toast.error('Select a customer before adding a note.');
            return;
        }

        const userId = user?.uid || dataBaseUser?.id || '';
        if (!userId) {
            toast.error('Missing signed-in user.');
            return;
        }

        const selectedBody = bodyOfWaterOptions.find((body) => body.id === selectedBodyOfWaterId) || null;
        const nowMillis = Date.now();
        const noteId = `comp_cus_note_${uuidv4()}`;
        const authorName = getAuthorName();

        try {
            setAddingNote(true);
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', customer.id, 'notes', noteId), {
                id: noteId,
                companyId: recentlySelectedCompany,
                customerId: customer.id,
                customerName: getCustomerName(customer) || '',
                bodyOfWaterId: selectedBody?.id || '',
                bodyOfWaterName: selectedBody ? getBodyOfWaterLabel(selectedBody) : '',
                serviceLocationId: selectedBody?.serviceLocationId || '',
                userId,
                userName: authorName,
                authorId: userId,
                authorName,
                note: trimmedNote,
                comment: trimmedNote,
                audience: selectedAudience,
                visibility: selectedAudience,
                resolved: false,
                date: serverTimestamp(),
                dateMillis: nowMillis,
                createdAt: serverTimestamp(),
                createdAtMillis: nowMillis,
                updatedAt: serverTimestamp(),
                updatedAtMillis: nowMillis,
            });

            setNewNote('');
            setSelectedAudience('all');
            toast.success('Customer note added.');
        } catch (error) {
            console.error('Failed to add customer note:', error);
            toast.error('Failed to add customer note.');
        } finally {
            setAddingNote(false);
        }
    };

    const setCustomerNoteResolved = async (noteId, resolved) => {
        if (!recentlySelectedCompany || !customer?.id || !noteId) return;

        try {
            const nowMillis = Date.now();
            await updateDoc(doc(db, 'companies', recentlySelectedCompany, 'customers', customer.id, 'notes', noteId), {
                resolved,
                resolvedAt: resolved ? serverTimestamp() : null,
                resolvedAtMillis: resolved ? nowMillis : null,
                resolvedByUserId: resolved ? (user?.uid || dataBaseUser?.id || '') : '',
                resolvedByUserName: resolved ? getAuthorName() : '',
                updatedAt: serverTimestamp(),
                updatedAtMillis: nowMillis,
            });
        } catch (error) {
            console.error('Failed to update customer note:', error);
            toast.error('Failed to update customer note.');
        }
    };

    const openNotesCount = notes.filter((note) => !note.resolved).length;

    const noteStats = (
        <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
            <StatusBadge tone={openNotesCount ? 'amber' : 'emerald'}>
                {openNotesCount} Open
            </StatusBadge>
            <StatusBadge>{notes.length} Total</StatusBadge>
        </div>
    );

    const composer = (
        <div className={compact ? "mt-3 space-y-2" : "grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]"}>
            <textarea
                value={newNote}
                onChange={(event) => setNewNote(event.target.value)}
                rows={compact ? 4 : 3}
                placeholder="Write a customer or pool note..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <div className="space-y-2">
                <select
                    value={selectedBodyOfWaterId}
                    onChange={(event) => setSelectedBodyOfWaterId(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                    <option value="">All customer pools</option>
                    {bodyOfWaterOptions.map((body) => (
                        <option key={body.id} value={body.id}>
                            {getBodyOfWaterLabel(body)}
                        </option>
                    ))}
                </select>
                <select
                    value={selectedAudience}
                    onChange={(event) => setSelectedAudience(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                    {customerNoteAudienceOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={addCustomerNote}
                    disabled={addingNote || !newNote.trim()}
                    className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                    {addingNote ? 'Adding...' : 'Add Note'}
                </button>
            </div>
        </div>
    );

    const notesList = (
        <div className={compact ? "mt-4 max-h-80 space-y-2 overflow-y-auto pr-1" : "max-h-96 space-y-3 overflow-y-auto pr-1"}>
            {notesLoading ? (
                <div className="text-sm text-slate-500">Loading customer notes...</div>
            ) : notes.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No customer notes yet.
                </div>
            ) : (
                notes.map((note) => (
                    <div key={note.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"}>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900">{note.userName || note.authorName || 'Unknown'}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    {formatDateTimeValue(note.date || note.createdAt || note.dateMillis || note.createdAtMillis)}
                                    {note.bodyOfWaterName ? ` - ${note.bodyOfWaterName}` : ''}
                                </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <StatusBadge tone={getCustomerNoteAudience(note).tone}>
                                    {getCustomerNoteAudience(note).label}
                                </StatusBadge>
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={!!note.resolved}
                                        onChange={(event) => setCustomerNoteResolved(note.id, event.target.checked)}
                                        className="h-3.5 w-3.5 rounded border-slate-300"
                                    />
                                    Resolved
                                </label>
                            </div>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{getNoteText(note)}</p>
                    </div>
                ))
            )}
        </div>
    );

    if (compact) {
        return (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Customer Notes</h2>
                    </div>
                </div>
                <div className="mt-2">
                    {noteStats}
                </div>
                {composer}
                {notesList}
            </div>
        );
    }

    return (
        <InfoCard title="Customer Notes" actions={noteStats}>
            {composer}
            {notesList}
        </InfoCard>
    );
};

const statusToneFor = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (['accepted', 'active', 'paid', 'posted'].includes(normalized)) return 'emerald';
    if (['sent', 'open', 'invoiced', 'viewed', 'estimate'].includes(normalized)) return 'blue';
    if (['draft', 'pending', 'pastdue', 'past due', 'overdue'].includes(normalized)) return 'amber';
    if (['superseded'].includes(normalized)) return 'slate';
    if (['rejected', 'canceled', 'cancelled', 'failed', 'void', 'expired'].includes(normalized)) return 'rose';
    return 'slate';
};

const suggestedWorkTierToneFor = (tier) => {
    const tone = getSuggestedWorkTierTone(tier);
    if (tone === 'red') return 'rose';
    return ['amber', 'blue', 'emerald'].includes(tone) ? tone : 'slate';
};

const normalizeStatusText = (value) => String(value || '').trim().toLowerCase();

const isCustomerOutstandingJob = (job = {}) => {
    const operationStatus = normalizeStatusText(job.operationStatus || job.status);
    const billingStatus = normalizeStatusText(job.billingStatus);

    if (operationStatus === 'finished') return false;
    if (['invoiced', 'paid', 'comped'].includes(billingStatus)) return false;

    return true;
};

const getOutstandingWorkMillis = (item = {}) => (
    toMillis(
        item.statusChangedAt ||
        item.updatedAt ||
        item.createdAt ||
        item.dateValue ||
        item.dateCreated ||
        item.date ||
        item.statusChangedAtMillis ||
        item.updatedAtMillis ||
        item.createdAtMillis
    )
);

const getCustomerName = getCustomerDisplayName;

const formatRecurringDays = (stop) => {
    const days = stop.daysOfWeek ?? stop.day;

    if (Array.isArray(days)) {
        return days.filter(Boolean).join(', ') || 'Unscheduled';
    }

    if (typeof days === 'string') {
        return days.split(',').map((day) => day.trim()).filter(Boolean).join(', ') || 'Unscheduled';
    }

    return 'Unscheduled';
};

const timelineTypeStyles = {
    serviceStop: {
        dot: 'bg-blue-600',
        chip: 'bg-blue-50 text-blue-700 border-blue-100',
    },
    chemistry: {
        dot: 'bg-cyan-600',
        chip: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    },
    equipmentMaintenance: {
        dot: 'bg-amber-500',
        chip: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    equipmentRepair: {
        dot: 'bg-red-500',
        chip: 'bg-red-50 text-red-700 border-red-100',
    },
    equipmentReading: {
        dot: 'bg-cyan-500',
        chip: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    },
    waterFill: {
        dot: 'bg-indigo-500',
        chip: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    },
    waterEmpty: {
        dot: 'bg-orange-500',
        chip: 'bg-orange-50 text-orange-700 border-orange-100',
    },
    workOrder: {
        dot: 'bg-violet-500',
        chip: 'bg-violet-50 text-violet-700 border-violet-100',
    },
    expiredJob: {
        dot: 'bg-rose-500',
        chip: 'bg-rose-50 text-rose-700 border-rose-100',
    },
    outstandingWork: {
        dot: 'bg-amber-500',
        chip: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    suggestedWork: {
        dot: 'bg-blue-500',
        chip: 'bg-blue-50 text-blue-700 border-blue-100',
    },
    repairRequest: {
        dot: 'bg-red-500',
        chip: 'bg-red-50 text-red-700 border-red-100',
    },
    purchase: {
        dot: 'bg-lime-600',
        chip: 'bg-lime-50 text-lime-700 border-lime-100',
    },
    salesAgreement: {
        dot: 'bg-sky-500',
        chip: 'bg-sky-50 text-sky-700 border-sky-100',
    },
    salesSubscription: {
        dot: 'bg-teal-500',
        chip: 'bg-teal-50 text-teal-700 border-teal-100',
    },
    salesInvoice: {
        dot: 'bg-fuchsia-500',
        chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
    },
    salesPayment: {
        dot: 'bg-emerald-500',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
    note: {
        dot: 'bg-emerald-500',
        chip: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
    toDo: {
        dot: 'bg-slate-500',
        chip: 'bg-slate-50 text-slate-700 border-slate-100',
    },
};

const timelineFilters = [
    { id: 'all', label: 'All', types: [] },
    { id: 'service', label: 'Service', types: ['serviceStop'] },
    { id: 'jobs', label: 'Jobs', types: ['workOrder', 'expiredJob', 'outstandingWork', 'suggestedWork', 'repairRequest'] },
    { id: 'billing', label: 'Billing', types: ['salesAgreement', 'salesSubscription', 'salesInvoice', 'salesPayment', 'purchase'] },
    { id: 'notes', label: 'Notes', types: ['note', 'toDo'] },
    { id: 'chemistry', label: 'Chemistry', types: ['chemistry'] },
    { id: 'equipment', label: 'Equipment', types: ['equipmentMaintenance', 'equipmentRepair', 'equipmentReading'] },
    { id: 'water', label: 'Water', types: ['waterFill', 'waterEmpty'] },
];

const TIMELINE_LIST_PAGE_SIZE = 10;

const timelineViewOptions = [
    { id: 'timeline', label: 'Timeline', Icon: PresentationChartLineIcon },
    { id: 'list', label: 'List', Icon: ListBulletIcon },
];

const formatTimelineDate = (value) => {
    const millis = toMillis(value);
    return millis ? format(new Date(millis), 'PPP p') : 'Date unavailable';
};

const buildCustomerProfileNoteEvent = (customer = {}) => {
    const detail = String(customer.notes || '').trim();
    if (!detail) return null;

    const dateMillis = toMillis(
        customer.updatedAt ||
        customer.updatedAtMillis ||
        customer.createdAt ||
        customer.createdAtMillis ||
        customer.dateCreated ||
        customer.dateCreatedMillis
    ) || Date.now();

    return {
        id: `customer-profile-note-${customer.id || 'profile'}`,
        type: 'note',
        label: 'Customer Note',
        title: 'Customer profile note',
        subtitle: [getCustomerName(customer), 'Profile notes'].filter(Boolean).join(' • '),
        detail,
        date: new Date(dateMillis),
        bodyOfWaterId: '',
        serviceLocationId: '',
    };
};

const timelineValueText = (...parts) => parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join(' ');

const formatTimelineMeasurement = (item = {}, fallbackLabel) => {
    const label = item.name || item.label || item.templateName || item.title || fallbackLabel;
    const amount = item.amount ?? item.value ?? item.reading ?? item.result ?? item.currentPressure ?? '';
    const amountText = timelineValueText(amount, item.UOM || item.unit || item.unitOfMeasure);
    return [label, amountText].filter(Boolean).join(': ');
};

const formatTimelineObservation = (item = {}) => {
    if (!item) return '';
    if (typeof item === 'string') return item;

    const label = item.name || item.label || item.title || 'Observation';
    const value = item.value || item.note || item.notes || item.description || item.comment || item.amount || '';
    return [label, value].filter(Boolean).join(': ');
};

const buildTimelineDatapointGroups = (event = {}) => {
    const groups = [];
    const readings = Array.isArray(event.readings)
        ? event.readings.map((item) => formatTimelineMeasurement(item, 'Reading')).filter(Boolean)
        : [];
    const dosages = Array.isArray(event.dosages)
        ? event.dosages.map((item) => formatTimelineMeasurement(item, 'Dosage')).filter(Boolean)
        : [];
    const observations = Array.isArray(event.observations)
        ? event.observations.map(formatTimelineObservation).filter(Boolean)
        : [];

    if (readings.length) groups.push({ label: 'Readings', items: readings });
    if (dosages.length) groups.push({ label: 'Dosages', items: dosages });
    if (observations.length) groups.push({ label: 'Observations', items: observations });

    const equipmentItems = [
        event.equipmentName ? `Equipment: ${event.equipmentName}` : '',
        event.equipmentType ? `Type: ${event.equipmentType}` : '',
    ].filter(Boolean);
    if (equipmentItems.length) groups.push({ label: 'Equipment', items: equipmentItems });

    if (event.gallons) {
        groups.push({ label: 'Water', items: [`Gallons: ${event.gallons}`] });
    }

    return groups;
};

const getTimelineDatapointSummary = (event = {}) => (
    buildTimelineDatapointGroups(event)
        .flatMap((group) => group.items.map((item) => `${group.label}: ${item}`))
        .join(' • ')
);

const TimelineEventCard = ({ event }) => {
    const styles = timelineTypeStyles[event.type] || timelineTypeStyles.serviceStop;
    const content = (
        <div className="relative flex gap-4">
            <span className={`mt-1 h-7 w-7 rounded-full border-4 border-white shadow-sm ${styles.dot}`} />
            <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                            {formatTimelineDate(event.date)}
                        </p>
                    </div>
                    <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.chip}`}>
                        {event.label}
                    </span>
                </div>

                {event.subtitle && (
                    <p className="mt-3 text-sm text-slate-600">{event.subtitle}</p>
                )}

                {event.detail && (
                    <p className="mt-2 text-sm text-slate-500 line-clamp-2">{event.detail}</p>
                )}
            </div>
        </div>
    );

    return event.target ? (
        <Link to={event.target} className="block transition hover:opacity-95">
            {content}
        </Link>
    ) : content;
};

const TimelineEventTable = ({ events }) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                    <th scope="col" className="w-44 px-4 py-3">Date</th>
                    <th scope="col" className="w-36 px-4 py-3">Type</th>
                    <th scope="col" className="min-w-[220px] px-4 py-3">Event</th>
                    <th scope="col" className="min-w-[320px] px-4 py-3">Details</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
                {events.map((event) => {
                    const styles = timelineTypeStyles[event.type] || timelineTypeStyles.serviceStop;
                    const datapointSummary = getTimelineDatapointSummary(event);
                    const detailText = [event.subtitle, datapointSummary || event.detail]
                        .filter(Boolean)
                        .join(' • ');

                    return (
                        <tr key={event.id} className="align-top transition hover:bg-slate-50">
                            <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500">
                                {formatTimelineDate(event.date)}
                            </td>
                            <td className="px-4 py-3">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.chip}`}>
                                    {event.label}
                                </span>
                            </td>
                            <td className="px-4 py-3">
                                {event.target ? (
                                    <Link to={event.target} className="font-semibold text-slate-900 hover:text-blue-700">
                                        {event.title}
                                    </Link>
                                ) : (
                                    <span className="font-semibold text-slate-900">{event.title}</span>
                                )}
                            </td>
                            <td className="px-4 py-3 text-sm leading-6 text-slate-700">
                                {detailText || <span className="text-slate-400">No details</span>}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);

// Profile Tab
const ProfileTab = ({ customer, onCustomerUpdate, onDeleteCustomer, onCustomerInactiveCascade }) => {
    const { recentlySelectedCompany, user, dataBaseUser } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState(customer);
    const [newTag, setNewTag] = useState('');

    useEffect(() => setFormData(customer), [customer]);

    const handleInputChange = e => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleCheckboxChange = e => setFormData(prev => ({ ...prev, [e.target.name]: e.target.checked }));
    const handleBillingAddressChange = e => setFormData(prev => ({ ...prev, billingAddress: { ...prev.billingAddress, [e.target.name]: e.target.value } }));

    const handleAddTag = () => {
        const tagToAdd = normalizeCustomerTag(newTag);
        if (!tagToAdd) return;

        setFormData((prev) => ({
            ...prev,
            tags: normalizeCustomerTags([...(prev.tags || []), tagToAdd]),
        }));
        setNewTag('');
    };

    const handleRemoveTag = (tagToRemove) => {
        setFormData((prev) => ({
            ...prev,
            tags: normalizeCustomerTags(prev.tags).filter((tag) => tag !== tagToRemove),
        }));
    };

    const handleSave = async () => {
        if (!requirePermission("14", "update customer details")) return;

        const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customer.id);
        const normalizedTags = normalizeCustomerTags(formData.tags);
        const normalizedCustomer = normalizeCustomerForFirestore({
            ...formData,
            tags: normalizedTags,
        });
        const payload = {
            ...formData,
            ...normalizedCustomer,
            tags: normalizedTags,
        };
        const customerDisplayName = getCustomerDisplayName(payload);
        payload.customerName = customerDisplayName;
        payload.name = customerDisplayName;
        const wasActive = (customer.active ?? customer.isActive ?? true) !== false;
        const nextActive = (payload.active ?? payload.isActive ?? true) !== false;
        const shouldCascadeInactive = wasActive && !nextActive;

        try {
            await updateDoc(customerRef, payload);
            const inactiveCascadeCounts = shouldCascadeInactive
                ? await onCustomerInactiveCascade?.()
                : null;
            const pipelineRowsEnded = shouldCascadeInactive
                ? await endCustomerPipelineRowsForInactiveCustomer({
                    companyId: recentlySelectedCompany,
                    customerId: customer.id,
                    reason: 'Customer marked inactive from customer profile',
                    actorId: user?.uid || '',
                    actorName: `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() || user?.displayName || user?.email || '',
                })
                : 0;

            toast.success(
                inactiveCascadeCounts
                    ? `Customer details updated. ${inactiveCascadeCounts.serviceLocations} service locations, ${inactiveCascadeCounts.bodiesOfWater} bodies of water, ${inactiveCascadeCounts.equipment} equipment records, and ${pipelineRowsEnded} pipeline row(s) were ended.`
                    : 'Customer details updated!'
            );
            onCustomerUpdate?.(payload);
            setIsEditing(false);
        } catch (error) {
            toast.error('Failed to update customer.');
        }
    };

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    <InfoCard
                        title="Contact Information"
                        actions={can("14") && (
                            isEditing ? (
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    {can("16") && (
                                        <button
                                            onClick={onDeleteCustomer}
                                            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-100"
                                            type="button"
                                        >
                                            Delete
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                                        type="button"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        className="rounded-md border border-transparent bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                                        type="button"
                                    >
                                        Save
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                                    type="button"
                                >
                                    Edit
                                </button>
                            )
                        )}
                    >
                        {isEditing ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input name="firstName" value={formData.firstName} onChange={handleInputChange} placeholder="First Name" className="w-full px-3 py-2 border rounded-md" />
                                    <input name="lastName" value={formData.lastName} onChange={handleInputChange} placeholder="Last Name" className="w-full px-3 py-2 border rounded-md" />
                                </div>
                                <input type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="Email" className="w-full px-3 py-2 border rounded-md" />
                                <input name="phoneNumber" value={formData.phoneNumber} onChange={handleInputChange} placeholder="Phone Number" className="w-full px-3 py-2 border rounded-md" />
                            </div>
                        ) : (
                            <dl className="space-y-2">
                                <div className="flex justify-between"><dt className="text-gray-500">Name</dt><dd className="text-gray-900 font-medium">{customer.firstName} {customer.lastName}</dd></div>
                                <div className="flex justify-between"><dt className="text-gray-500">Email</dt><dd className="text-gray-900">{customer.email}</dd></div>
                                <div className="flex justify-between"><dt className="text-gray-500">Phone</dt><dd className="text-gray-900">{customer.phoneNumber}</dd></div>
                            </dl>
                        )}
                    </InfoCard>
                    <InfoCard title="Notes">
                        <textarea name="notes" value={isEditing ? formData.notes : customer.notes} onChange={handleInputChange} rows="6" className="w-full px-3 py-2 border rounded-md" readOnly={!isEditing}></textarea>
                    </InfoCard>
                    <InfoCard title="Tags">
                        {isEditing ? (
                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <input
                                        value={newTag}
                                        onChange={(event) => setNewTag(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                handleAddTag();
                                            }
                                        }}
                                        placeholder="Add tag, e.g. R1"
                                        className="w-full rounded-md border px-3 py-2 text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddTag}
                                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                                    >
                                        Add
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {normalizeCustomerTags(formData.tags).map((tag) => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => handleRemoveTag(tag)}
                                            className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700"
                                        >
                                            {tag} x
                                        </button>
                                    ))}
                                    {normalizeCustomerTags(formData.tags).length === 0 && (
                                        <span className="text-sm text-slate-500">No tags added.</span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {normalizeCustomerTags(customer.tags).map((tag) => (
                                    <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                        {tag}
                                    </span>
                                ))}
                                {normalizeCustomerTags(customer.tags).length === 0 && (
                                    <span className="text-sm text-slate-500">No tags added.</span>
                                )}
                            </div>
                        )}
                    </InfoCard>
                </div>
                <div className="space-y-8">
                    <InfoCard title="Billing Address">
                        {isEditing ? (
                            <div className="space-y-4">
                                <input name="streetAddress" value={formData.billingAddress?.streetAddress} onChange={handleBillingAddressChange} placeholder="Street" className="w-full px-3 py-2 border rounded-md" />
                                <input name="city" value={formData.billingAddress?.city} onChange={handleBillingAddressChange} placeholder="City" className="w-full px-3 py-2 border rounded-md" />
                                <div className="grid grid-cols-2 gap-4">
                                    <input name="state" value={formData.billingAddress?.state} onChange={handleBillingAddressChange} placeholder="State" className="w-full px-3 py-2 border rounded-md" />
                                    <input name="zip" value={formData.billingAddress?.zip} onChange={handleBillingAddressChange} placeholder="ZIP Code" className="w-full px-3 py-2 border rounded-md" />
                                </div>
                            </div>
                        ) : (
                            <address className="not-italic text-gray-700">
                                {customer.billingAddress?.streetAddress}<br />
                                {customer.billingAddress?.city}, {customer.billingAddress?.state} {customer.billingAddress?.zip}
                            </address>
                        )}
                    </InfoCard>
                    <InfoCard title="Status">
                        {isEditing ? (
                            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    name="active"
                                    checked={formData.active === true}
                                    onChange={handleCheckboxChange}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                />
                                Active customer
                            </label>
                        ) : (
                            <div className="flex items-center">
                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${customer.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {customer.active ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        )}
                    </InfoCard>
                </div>
            </div>
            <SalesActivitySection customer={customer} />
        </div>
    );
};

// Locations Tab
const ServiceLocationsTab = ({ customer }) => {
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const [editingLocation, setEditingLocation] = useState(false);
    const [savingLocation, setSavingLocation] = useState(false);
    const [locationNotesDraft, setLocationNotesDraft] = useState('');
    const [savingLocationNotes, setSavingLocationNotes] = useState(false);
    const [locationPhotoFiles, setLocationPhotoFiles] = useState([]);
    const [uploadingLocationPhotos, setUploadingLocationPhotos] = useState(false);
    const [locationForm, setLocationForm] = useState({
        nickName: '',
        streetAddress: '',
        city: '',
        state: '',
        zip: '',
        latitude: 0,
        longitude: 0,
        gateCode: '',
        estimatedTime: '',
        notes: '',
        mainContactId: '',
        mainContactName: '',
        mainContactEmail: '',
        mainContactPhoneNumber: '',
        mainContactNotes: '',
        preText: false,
        isActive: true,
    });
    const [cleanupLinkedRecords, setCleanupLinkedRecords] = useState(false);
    const [customerContacts, setCustomerContacts] = useState([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactMode, setContactMode] = useState('new');
    const [selectedContactId, setSelectedContactId] = useState('');
    const { recentlySelectedCompany } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const db = getFirestore();

    useEffect(() => {
        const fetchLocations = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where("customerId", "==", customer.id));
                const snapshot = await getDocs(q);
                const fetchedLocations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setLocations(fetchedLocations);
                if (fetchedLocations.length > 0) {
                    setSelectedLocation(fetchedLocations[0]);
                }
            } catch (error) {
                toast.error("Failed to fetch service locations.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchLocations();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    useEffect(() => {
        setLocationNotesDraft(selectedLocation?.notes || '');
        setLocationPhotoFiles([]);
    }, [selectedLocation?.id, selectedLocation?.notes]);

    const getDefaultNewContact = () => ({
        id: "com_cus_con_" + uuidv4(),
        name: customer.displayAsCompany
            ? (customer.company || customer.companyName || '')
            : [customer.firstName, customer.lastName].filter(Boolean).join(' '),
        email: customer.email || '',
        phoneNumber: customer.phoneNumber || customer.phone || '',
        notes: '',
    });

    const populateContactFields = (contact = {}) => {
        setLocationForm((prev) => ({
            ...prev,
            mainContactId: contact.id || prev.mainContactId || "com_cus_con_" + uuidv4(),
            mainContactName: contact.name || '',
            mainContactEmail: contact.email || '',
            mainContactPhoneNumber: contact.phoneNumber || contact.phone || '',
            mainContactNotes: contact.notes || '',
        }));
    };

    const loadCustomerContacts = async (preferredContact = {}) => {
        if (!recentlySelectedCompany || !customer.id) return;

        setContactsLoading(true);
        try {
            const contactsSnap = await getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers', customer.id, 'contacts'));
            const contacts = contactsSnap.docs.map((contactDoc) => ({ id: contactDoc.id, ...contactDoc.data() }));
            setCustomerContacts(contacts);

            const preferredId = preferredContact?.id;
            const preferredHasDetails = Boolean(
                preferredContact?.id ||
                preferredContact?.name ||
                preferredContact?.email ||
                preferredContact?.phoneNumber ||
                preferredContact?.phone ||
                preferredContact?.notes
            );
            const matchedContact = contacts.find((contact) => contact.id === preferredId);

            if (matchedContact) {
                setContactMode('existing');
                setSelectedContactId(matchedContact.id);
                populateContactFields(matchedContact);
            } else if (!preferredHasDetails && contacts.length > 0) {
                setContactMode('existing');
                setSelectedContactId(contacts[0].id);
                populateContactFields(contacts[0]);
            } else {
                setContactMode('new');
                setSelectedContactId('');
                populateContactFields(preferredHasDetails ? preferredContact : getDefaultNewContact());
            }
        } catch (error) {
            console.error(error);
            toast.error('Failed to load customer contacts.');
        } finally {
            setContactsLoading(false);
        }
    };

    const startEditLocation = () => {
        if (!selectedLocation) return;
        setLocationForm({
            nickName: selectedLocation.nickName || '',
            streetAddress: selectedLocation.address?.streetAddress || '',
            city: selectedLocation.address?.city || '',
            state: selectedLocation.address?.state || '',
            zip: selectedLocation.address?.zip || selectedLocation.address?.zipCode || '',
            latitude: selectedLocation.address?.latitude || 0,
            longitude: selectedLocation.address?.longitude || 0,
            gateCode: selectedLocation.gateCode || '',
            estimatedTime: selectedLocation.estimatedTime ?? '',
            notes: selectedLocation.notes || '',
            mainContactId: selectedLocation.mainContact?.id || "com_cus_con_" + uuidv4(),
            mainContactName: selectedLocation.mainContact?.name || '',
            mainContactEmail: selectedLocation.mainContact?.email || '',
            mainContactPhoneNumber: selectedLocation.mainContact?.phoneNumber || '',
            mainContactNotes: selectedLocation.mainContact?.notes || '',
            preText: Boolean(selectedLocation.preText),
            isActive: selectedLocation.isActive ?? selectedLocation.active ?? true,
        });
        setCleanupLinkedRecords(false);
        setEditingLocation(true);
        loadCustomerContacts(selectedLocation.mainContact || {});
    };

    const updateSelectedLocationState = (updatedLocation) => {
        setSelectedLocation(updatedLocation);
        setLocations((current) => current.map((loc) => (
            loc.id === updatedLocation.id ? updatedLocation : loc
        )));
    };

    const handleLocationFormChange = (event) => {
        const { name, value, type, checked } = event.target;
        setLocationForm((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleLocationAddressSelect = (place) => {
        if (!place) return;
        setLocationForm((prev) => ({
            ...prev,
            streetAddress: place.streetAddress || prev.streetAddress,
            city: place.city || prev.city,
            state: place.state || prev.state,
            zip: place.zipCode || place.zip || prev.zip,
            latitude: place.latitude ?? prev.latitude ?? 0,
            longitude: place.longitude ?? prev.longitude ?? 0,
        }));
    };

    const handleContactModeChange = (nextMode) => {
        setContactMode(nextMode);

        if (nextMode === 'existing') {
            const nextContact = customerContacts.find((contact) => contact.id === selectedContactId) || customerContacts[0];
            if (nextContact) {
                setSelectedContactId(nextContact.id);
                populateContactFields(nextContact);
            }
            return;
        }

        setSelectedContactId('');
        populateContactFields(getDefaultNewContact());
    };

    const handleSelectedContactChange = (event) => {
        const nextContactId = event.target.value;
        setSelectedContactId(nextContactId);
        const nextContact = customerContacts.find((contact) => contact.id === nextContactId);
        if (nextContact) {
            populateContactFields(nextContact);
        }
    };

    const locationRelatedCollections = [
        { collectionName: 'equipment', mode: 'equipment' },
        { collectionName: 'bodiesOfWater', mode: 'bodyOfWater' },
        { collectionName: 'recurringServiceStop', mode: 'delete' },
        { collectionName: 'serviceStops', mode: 'delete' },
    ];

    const fetchLocationRelatedDocs = async (locationId) => {
        const snapshots = await Promise.all(
            locationRelatedCollections.map(({ collectionName }) => (
                getDocs(query(
                    collection(db, 'companies', recentlySelectedCompany, collectionName),
                    where('serviceLocationId', '==', locationId)
                ))
            ))
        );

        return locationRelatedCollections.map((definition, index) => ({
            ...definition,
            docs: snapshots[index].docs,
        }));
    };

    const deleteLocationRelations = async (locationId) => {
        const relatedDocs = await fetchLocationRelatedDocs(locationId);
        await Promise.all(
            relatedDocs.flatMap(({ docs }) => docs.map((relatedDoc) => deleteDoc(relatedDoc.ref)))
        );
    };

    const deactivateLocationRelations = async (locationId) => {
        const relatedDocs = await fetchLocationRelatedDocs(locationId);
        await Promise.all(
            relatedDocs.flatMap(({ mode, docs }) => {
                if (mode === 'equipment') {
                    return docs.map((relatedDoc) => updateDoc(relatedDoc.ref, { isActive: false, active: false }));
                }
                if (mode === 'bodyOfWater') {
                    return docs.map((relatedDoc) => updateDoc(relatedDoc.ref, { isActive: false }));
                }
                return docs.map((relatedDoc) => deleteDoc(relatedDoc.ref));
            })
        );
    };

    const handleSaveLocation = async (event) => {
        event.preventDefault();
        if (!selectedLocation?.id || !recentlySelectedCompany) return;

        setSavingLocation(true);
        try {
            const normalizedAddress = normalizeAddress({
                ...(selectedLocation.address || {}),
                streetAddress: locationForm.streetAddress,
                city: locationForm.city,
                state: locationForm.state,
                zip: locationForm.zip,
                latitude: locationForm.latitude,
                longitude: locationForm.longitude,
            });
            const selectedContact = customerContacts.find((contact) => contact.id === selectedContactId);
            let normalizedMainContact = normalizeContact(
                contactMode === 'existing' && selectedContact
                    ? selectedContact
                    : {
                        id: locationForm.mainContactId || "com_cus_con_" + uuidv4(),
                        name: locationForm.mainContactName,
                        email: locationForm.mainContactEmail,
                        phoneNumber: locationForm.mainContactPhoneNumber,
                        notes: locationForm.mainContactNotes,
                    }
            );
            if (!normalizedMainContact.id) {
                normalizedMainContact = {
                    ...normalizedMainContact,
                    id: "com_cus_con_" + uuidv4(),
                };
            }
            const normalizedLocation = normalizeServiceLocationForFirestore({
                ...selectedLocation,
                nickName: locationForm.nickName,
                address: normalizedAddress,
                gateCode: locationForm.gateCode,
                estimatedTime: locationForm.estimatedTime === '' ? 0 : Number(locationForm.estimatedTime),
                notes: locationForm.notes,
                preText: locationForm.preText,
                isActive: locationForm.isActive,
                active: locationForm.isActive,
                mainContact: normalizedMainContact,
            });
            const updatedLocation = {
                ...selectedLocation,
                ...normalizedLocation,
            };

            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', selectedLocation.id),
                {
                    nickName: updatedLocation.nickName,
                    address: updatedLocation.address,
                    gateCode: updatedLocation.gateCode,
                    estimatedTime: updatedLocation.estimatedTime,
                    notes: updatedLocation.notes,
                    preText: updatedLocation.preText,
                    isActive: updatedLocation.isActive,
                    active: updatedLocation.isActive,
                    mainContact: updatedLocation.mainContact,
                }
            );

            await setDoc(
                doc(db, 'companies', recentlySelectedCompany, 'customers', customer.id, 'contacts', normalizedMainContact.id),
                normalizedMainContact,
                { merge: true }
            );

            if (updatedLocation.isActive === false && cleanupLinkedRecords) {
                await deactivateLocationRelations(selectedLocation.id);
            }

            setCustomerContacts((currentContacts) => {
                const exists = currentContacts.some((contact) => contact.id === normalizedMainContact.id);
                return exists
                    ? currentContacts.map((contact) => contact.id === normalizedMainContact.id ? normalizedMainContact : contact)
                    : [...currentContacts, normalizedMainContact];
            });
            updateSelectedLocationState(updatedLocation);
            setEditingLocation(false);
            setCleanupLinkedRecords(false);
            toast.success('Service location updated.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to update service location.');
        } finally {
            setSavingLocation(false);
        }
    };

    const handleDeleteLocation = async () => {
        if (!selectedLocation?.id || !recentlySelectedCompany) return;
        const confirmed = await appConfirm({
            title: 'Delete Service Location',
            message: 'Delete this service location and all linked bodies of water, equipment, recurring service stops, and service stops?',
            confirmLabel: 'Delete Location',
            variant: 'danger',
        });
        if (!confirmed) return;

        setSavingLocation(true);
        try {
            await deleteLocationRelations(selectedLocation.id);
            await deleteDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', selectedLocation.id));
            const remainingLocations = locations.filter((loc) => loc.id !== selectedLocation.id);
            setLocations(remainingLocations);
            setSelectedLocation(remainingLocations[0] || null);
            setEditingLocation(false);
            setCleanupLinkedRecords(false);
            toast.success('Service location deleted.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete service location.');
        } finally {
            setSavingLocation(false);
        }
    };

    const handleSaveLocationNotes = async () => {
        if (!selectedLocation?.id || !recentlySelectedCompany) return;
        if (!requirePermission("44", "update service locations")) return;

        setSavingLocationNotes(true);
        try {
            const notesValue = locationNotesDraft;
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', selectedLocation.id),
                {
                    notes: notesValue,
                    updatedAt: serverTimestamp(),
                }
            );
            updateSelectedLocationState({ ...selectedLocation, notes: notesValue });
            toast.success('Location notes saved.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to save location notes.');
        } finally {
            setSavingLocationNotes(false);
        }
    };

    const handleLocationPhotoSelection = (event) => {
        const files = Array.from(event.target.files || []);
        const validationMessage = files.map(validateServiceLocationPhotoFile).find(Boolean);

        if (validationMessage) {
            toast.error(validationMessage);
            setLocationPhotoFiles([]);
        } else {
            setLocationPhotoFiles(files);
        }

        event.target.value = '';
    };

    const handleUploadLocationPhotos = async () => {
        if (!selectedLocation?.id || !recentlySelectedCompany || !locationPhotoFiles.length || uploadingLocationPhotos) return;
        if (!requirePermission("44", "update service locations")) return;

        setUploadingLocationPhotos(true);
        try {
            const uploadedPhotos = await Promise.all(
                locationPhotoFiles.map((file) => uploadServiceLocationPhoto({
                    storage,
                    file,
                    path: buildCompanyServiceLocationPhotoPath({
                        companyId: recentlySelectedCompany,
                        serviceLocationId: selectedLocation.id,
                        file,
                    }),
                    description: file.name,
                }))
            );

            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, 'serviceLocations', selectedLocation.id),
                {
                    photoUrls: arrayUnion(...uploadedPhotos),
                    updatedAt: serverTimestamp(),
                }
            );

            updateSelectedLocationState({
                ...selectedLocation,
                photoUrls: [
                    ...(Array.isArray(selectedLocation.photoUrls) ? selectedLocation.photoUrls : []),
                    ...uploadedPhotos,
                ],
            });
            setLocationPhotoFiles([]);
            toast.success('Location photos uploaded.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to upload location photos.');
        } finally {
            setUploadingLocationPhotos(false);
        }
    };

    const selectedLocationPhotos = Array.isArray(selectedLocation?.photoUrls) ? selectedLocation.photoUrls : [];

    return (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(440px,560px)_minmax(0,1fr)] lg:items-start lg:gap-5">
            <div className="space-y-3 sm:space-y-4">
                <InfoCard
                    title="Service Locations"
                    compact
                    actions={
                        <Link
                            to={`/company/serviceLocations/createNew/${customer.id}`}
                            className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm"
                        >
                            + Add
                        </Link>
                    }
                >
                    {loading ? <ClipLoader size={30} /> : (
                        <ul className="divide-y divide-gray-200">
                            {locations.map(loc => (
                                <li
                                    key={loc.id}
                                    onClick={() => setSelectedLocation(loc)}
                                    className={`cursor-pointer rounded-lg border px-2.5 py-2 transition
                                        ${selectedLocation?.id === loc.id ? 'bg-blue-50 border-blue-200' : 'hover:bg-slate-50 border-transparent'}
                                    `}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="truncate text-sm font-semibold text-gray-800">{loc.nickName || 'Service location'}</p>
                                        {(loc.isActive ?? loc.active ?? true) === false && (
                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 truncate text-xs text-gray-600">{loc.address?.streetAddress}, {loc.address?.city}</p>
                                </li>
                            ))}
                            {locations.length === 0 && <p className="text-gray-500">No locations found.</p>}
                        </ul>
                    )}
                </InfoCard>
                {selectedLocation !== null &&
                    <InfoCard
                        title="Service Location"
                        compact
                        actions={
                            editingLocation ? (
                                <button
                                    onClick={() => {
                                        setEditingLocation(false);
                                        setCleanupLinkedRecords(false);
                                    }}
                                    className="text-sm font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-md hover:bg-slate-200 shadow-sm transition"
                                    type="button"
                                >
                                    Cancel
                                </button>
                            ) : (
                                <button
                                    onClick={startEditLocation}
                                    className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm transition"
                                    type="button"
                                >
                                    Edit
                                </button>
                            )
                        }
                    >
                        {editingLocation ? (
                            <form onSubmit={handleSaveLocation} className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1 text-sm font-semibold text-slate-700">
                                        Nickname
                                        <input name="nickName" value={locationForm.nickName} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700">
                                        Estimated Time
                                        <input name="estimatedTime" type="number" value={locationForm.estimatedTime} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                                        Address Search
                                        <AddressAutocomplete
                                            initialValue={locationForm.streetAddress}
                                            placeholder="Search service address"
                                            onAddressSelect={handleLocationAddressSelect}
                                            onInputChange={(value) => setLocationForm((prev) => ({ ...prev, streetAddress: value }))}
                                            customClasses="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 font-normal text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            iconClasses="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-slate-400"
                                        />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                                        Street Address
                                        <input name="streetAddress" value={locationForm.streetAddress} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700">
                                        City
                                        <input name="city" value={locationForm.city} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700">
                                        State
                                        <input name="state" value={locationForm.state} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700">
                                        Zip
                                        <input name="zip" value={locationForm.zip} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700">
                                        Gate Code
                                        <input name="gateCode" value={locationForm.gateCode} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                        <input name="preText" type="checkbox" checked={locationForm.preText} onChange={handleLocationFormChange} className="h-4 w-4 rounded border-slate-300" />
                                        Requires pre-text
                                    </label>
                                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                        <input name="isActive" type="checkbox" checked={locationForm.isActive} onChange={handleLocationFormChange} className="h-4 w-4 rounded border-slate-300" />
                                        Active service location
                                    </label>
                                    {!locationForm.isActive && (
                                        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 sm:col-span-2">
                                            <input
                                                type="checkbox"
                                                checked={cleanupLinkedRecords}
                                                onChange={(event) => setCleanupLinkedRecords(event.target.checked)}
                                                className="mt-0.5 h-4 w-4 rounded border-amber-300"
                                            />
                                            <span>
                                                Clean up linked records now
                                                <span className="block text-xs font-medium text-amber-800">
                                                    Marks bodies of water and equipment inactive, and deletes recurring service stops and service stops for this location.
                                                </span>
                                            </span>
                                        </label>
                                    )}
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <p className="text-sm font-semibold text-slate-800">Main Contact</p>
                                            {contactsLoading && <span className="text-xs font-medium text-slate-500">Loading contacts...</span>}
                                        </div>
                                        <div className="flex flex-wrap gap-4">
                                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                                <input
                                                    type="radio"
                                                    checked={contactMode === 'existing'}
                                                    onChange={() => handleContactModeChange('existing')}
                                                    disabled={customerContacts.length === 0}
                                                    className="h-4 w-4 border-slate-300 text-blue-600"
                                                />
                                                Select existing contact
                                            </label>
                                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                                <input
                                                    type="radio"
                                                    checked={contactMode === 'new'}
                                                    onChange={() => handleContactModeChange('new')}
                                                    className="h-4 w-4 border-slate-300 text-blue-600"
                                                />
                                                Create new contact
                                            </label>
                                        </div>

                                        {contactMode === 'existing' && customerContacts.length > 0 ? (
                                            <div className="space-y-2">
                                                <label className="space-y-1 text-sm font-semibold text-slate-700">
                                                    Customer Contact
                                                    <select
                                                        value={selectedContactId}
                                                        onChange={handleSelectedContactChange}
                                                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                                                    >
                                                        {customerContacts.map((contact) => (
                                                            <option key={contact.id} value={contact.id}>
                                                                {contact.name || 'Unnamed Contact'}{contact.phoneNumber ? ` - ${contact.phoneNumber}` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 sm:grid-cols-2">
                                                    <span>{locationForm.mainContactEmail || 'No email saved'}</span>
                                                    <span>{locationForm.mainContactPhoneNumber || 'No phone saved'}</span>
                                                    {locationForm.mainContactNotes && (
                                                        <span className="sm:col-span-2">{locationForm.mainContactNotes}</span>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {customerContacts.length === 0 && !contactsLoading && (
                                                    <p className="text-xs font-medium text-slate-500 sm:col-span-2">
                                                        No saved customer contacts found. Add one here and it will be saved to this customer.
                                                    </p>
                                                )}
                                                <label className="space-y-1 text-sm font-semibold text-slate-700">
                                                    Contact Name
                                                    <input name="mainContactName" value={locationForm.mainContactName} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" />
                                                </label>
                                                <label className="space-y-1 text-sm font-semibold text-slate-700">
                                                    Contact Email
                                                    <input name="mainContactEmail" value={locationForm.mainContactEmail} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" />
                                                </label>
                                                <label className="space-y-1 text-sm font-semibold text-slate-700">
                                                    Contact Phone
                                                    <input name="mainContactPhoneNumber" value={locationForm.mainContactPhoneNumber} onChange={handleLocationFormChange} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" />
                                                </label>
                                                <label className="space-y-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                                                    Contact Notes
                                                    <textarea name="mainContactNotes" value={locationForm.mainContactNotes} onChange={handleLocationFormChange} rows="2" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" />
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                    <label className="space-y-1 text-sm font-semibold text-slate-700 sm:col-span-2">
                                        Location Notes
                                        <textarea name="notes" value={locationForm.notes} onChange={handleLocationFormChange} rows="3" className="w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
                                    </label>
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    <button disabled={savingLocation} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60" type="submit">
                                        {savingLocation ? 'Saving...' : 'Save'}
                                    </button>
                                    <button disabled={savingLocation} onClick={handleDeleteLocation} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60" type="button">
                                        Delete
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Main Contact
                                        </p>
                                        <p className="text-sm text-slate-900">{selectedLocation.mainContact?.name || "—"}</p>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Email
                                        </p>
                                        <p className="break-all text-sm text-slate-900">{selectedLocation.mainContact?.email || "—"}</p>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Phone Number
                                        </p>
                                        <p className="text-sm text-slate-900">{selectedLocation.mainContact?.phoneNumber || "—"}</p>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Gate Code
                                        </p>
                                        <p className="text-sm text-slate-900">{selectedLocation.gateCode || "—"}</p>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                                        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Status
                                        </p>
                                        <p className="text-sm text-slate-900">
                                            {(selectedLocation.isActive ?? selectedLocation.active ?? true) ? 'Active' : 'Inactive'}
                                        </p>
                                    </div>
                                </div>


                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Contact Notes
                                        </p>
                                        <p className="line-clamp-4 whitespace-pre-wrap text-sm text-slate-700">
                                            {selectedLocation.mainContact?.notes || "No contact notes added."}
                                        </p>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Dogs on Property
                                        </p>

                                        {selectedLocation.dogName?.length > 0 ? (
                                            <ul className="flex flex-wrap gap-1.5">
                                                {selectedLocation.dogName.map((dog) => (
                                                    <li
                                                        key={dog}
                                                        className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-100"
                                                    >
                                                        {dog}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-sm text-slate-500">None found.</p>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        {!editingLocation && (
                            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        Location Notes
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleSaveLocationNotes}
                                        disabled={savingLocationNotes}
                                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {savingLocationNotes ? 'Saving...' : 'Save Notes'}
                                    </button>
                                </div>
                                <textarea
                                    value={locationNotesDraft}
                                    onChange={(event) => setLocationNotesDraft(event.target.value)}
                                    rows="3"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    placeholder="Add service location notes..."
                                />
                            </div>
                        )}

                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Location Photos
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <label
                                        htmlFor={`location-photo-upload-${selectedLocation.id}`}
                                        className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                                    >
                                        Select Photos
                                        <input
                                            id={`location-photo-upload-${selectedLocation.id}`}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="sr-only"
                                            onChange={handleLocationPhotoSelection}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleUploadLocationPhotos}
                                        disabled={!locationPhotoFiles.length || uploadingLocationPhotos}
                                        className={[
                                            "rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition",
                                            locationPhotoFiles.length && !uploadingLocationPhotos
                                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                                : "cursor-not-allowed bg-slate-100 text-slate-400",
                                        ].join(" ")}
                                    >
                                        {uploadingLocationPhotos ? 'Uploading...' : 'Upload'}
                                    </button>
                                </div>
                            </div>
                            {locationPhotoFiles.length > 0 && (
                                <p className="mb-2 text-xs font-semibold text-slate-500">
                                    {locationPhotoFiles.length} file{locationPhotoFiles.length > 1 ? 's' : ''} selected
                                </p>
                            )}
                            {selectedLocationPhotos.length > 0 ? (
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                    {selectedLocationPhotos.map((photo, index) => {
                                        const photoSrc = getServiceLocationPhotoUrl(photo);
                                        const photoAlt = photo?.description || photo?.name || `Location photo ${index + 1}`;

                                        return photoSrc ? (
                                            <a
                                                key={`${photoSrc}-${index}`}
                                                href={photoSrc}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm transition hover:border-blue-200"
                                            >
                                                <img
                                                    src={photoSrc}
                                                    alt={photoAlt}
                                                    className="aspect-square w-full object-cover transition duration-200 group-hover:scale-105"
                                                />
                                            </a>
                                        ) : null;
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">No location photos uploaded.</p>
                            )}
                        </div>

                    </InfoCard>
                }
                {selectedLocation && <RecentServiceHistoryCard location={selectedLocation} />}

            </div>
            <div className="min-w-0 space-y-3 sm:space-y-4">
                {selectedLocation && <LocationDetails location={selectedLocation} customer={customer} customerId={customer.id} />}
            </div>


        </div>
    );
};

const RecentServiceHistoryCard = ({ location }) => {
    const [serviceHistory, setServiceHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchHistory = async () => {
            setLoading(true);
            try {
                const throughToday = new Date();
                throughToday.setHours(23, 59, 59, 999);

                const historyQ = query(
                    collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                    where("serviceLocationId", "==", location.id),
                    where("serviceDate", "<=", throughToday),
                    orderBy("serviceDate", "desc"),
                    limit(5)
                );
                const historySnap = await getDocs(historyQ);
                setServiceHistory(historySnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                toast.error("Failed to load recent service history.");
                console.log(err);
            } finally {
                setLoading(false);
            }
        };

        if (location?.id && recentlySelectedCompany) {
            fetchHistory();
        } else {
            setServiceHistory([]);
            setLoading(false);
        }
    }, [location?.id, recentlySelectedCompany, db]);

    return (
        <InfoCard compact title="Recent Service History">
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <ul className="divide-y divide-slate-200">
                    {serviceHistory.map((stop) => (
                        <li key={stop.id} className="py-2.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">
                                        {formatDateValue(stop.serviceDate)}
                                    </p>
                                    <p className="mt-0.5 truncate text-xs text-slate-500">
                                        {[stop.type || stop.jobName, stop.tech].filter(Boolean).join(" • ") || "Service stop"}
                                    </p>
                                </div>
                                {stop.operationStatus && (
                                    <StatusBadge tone={statusToneFor(stop.operationStatus)}>
                                        {stop.operationStatus}
                                    </StatusBadge>
                                )}
                            </div>
                        </li>
                    ))}
                    {serviceHistory.length === 0 && (
                        <p className="text-sm text-slate-500">No recent stops through today.</p>
                    )}
                </ul>
            )}
        </InfoCard>
    );
};

const LocationDetails = ({ location, customer = {}, customerId }) => {
    const [bodiesOfWater, setBodiesOfWater] = useState([]);
    const [customerServiceLocations, setCustomerServiceLocations] = useState([]);
    const [customerBodiesOfWater, setCustomerBodiesOfWater] = useState([]);
    const [equipment, setEquipment] = useState([]);
    const [showPastEquipment, setShowPastEquipment] = useState(false);
    const [loading, setLoading] = useState(true);
    const [editingBodyOfWaterId, setEditingBodyOfWaterId] = useState('');
    const [bodyOfWaterEditForm, setBodyOfWaterEditForm] = useState(getBodyOfWaterEditForm());
    const [savingBodyOfWaterEdit, setSavingBodyOfWaterEdit] = useState(false);
    const [movingEquipmentId, setMovingEquipmentId] = useState('');
    const [equipmentMoveForm, setEquipmentMoveForm] = useState({ serviceLocationId: '', bodyOfWaterId: '' });
    const [movingEquipment, setMovingEquipment] = useState(false);
    const [editingEquipmentId, setEditingEquipmentId] = useState('');
    const [equipmentEditForm, setEquipmentEditForm] = useState(getEquipmentEditForm());
    const [savingEquipmentEdit, setSavingEquipmentEdit] = useState(false);
    const [showEquipmentCreate, setShowEquipmentCreate] = useState(false);
    const [equipmentCreateForm, setEquipmentCreateForm] = useState(getDefaultEquipmentCreateForm());
    const [savingEquipmentCreate, setSavingEquipmentCreate] = useState(false);
    const { recentlySelectedCompany, recentlySelectedCompanyName, user } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchDetails = async () => {
            setLoading(true);
            try {
                const serviceLocationQ = query(collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'), where("customerId", "==", customerId));
                const customerBowQ = query(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'), where("customerId", "==", customerId));
                const locationBowQ = query(collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'), where("serviceLocationId", "==", location.id));
                const equipmentQ = query(collection(db, 'companies', recentlySelectedCompany, 'equipment'), where("serviceLocationId", "==", location.id));
                const [serviceLocationSnap, customerBowSnap, locationBowSnap, equipSnap] = await Promise.all([
                    getDocs(serviceLocationQ),
                    getDocs(customerBowQ),
                    getDocs(locationBowQ),
                    getDocs(equipmentQ),
                ]);
                const locationsById = new Map(serviceLocationSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
                locationsById.set(location.id, { ...location, id: location.id });
                const nextCustomerLocations = Array.from(locationsById.values())
                    .sort((left, right) => getLocationLabel(left).localeCompare(getLocationLabel(right)));
                const bodiesById = new Map([
                    ...customerBowSnap.docs,
                    ...locationBowSnap.docs,
                ].map(d => [d.id, { id: d.id, ...d.data() }]));
                const nextCustomerBodiesOfWater = Array.from(bodiesById.values())
                    .sort((left, right) => getBodyOfWaterLabel(left).localeCompare(getBodyOfWaterLabel(right)));

                setCustomerServiceLocations(nextCustomerLocations);
                setCustomerBodiesOfWater(nextCustomerBodiesOfWater);
                setBodiesOfWater(nextCustomerBodiesOfWater.filter((bow) => bow.serviceLocationId === location.id));
                setEquipment(equipSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            } catch (err) {
                toast.error("Failed to load location details.");
                console.log(err)
            } finally {
                setLoading(false);
            }
        };
        if (location.id && recentlySelectedCompany) {
            fetchDetails();
        }
    }, [location, location.id, customerId, recentlySelectedCompany, db]);

    useEffect(() => {
        setMovingEquipmentId('');
        setEquipmentMoveForm({ serviceLocationId: '', bodyOfWaterId: '' });
        setMovingEquipment(false);
        setShowPastEquipment(false);
        setEditingBodyOfWaterId('');
        setBodyOfWaterEditForm(getBodyOfWaterEditForm());
        setSavingBodyOfWaterEdit(false);
        setEditingEquipmentId('');
        setEquipmentEditForm(getEquipmentEditForm());
        setSavingEquipmentEdit(false);
        setShowEquipmentCreate(false);
        setEquipmentCreateForm(getDefaultEquipmentCreateForm());
        setSavingEquipmentCreate(false);
    }, [location.id]);

    const bodyOfWaterNameById = useMemo(
        () => new Map(customerBodiesOfWater.map((bow) => [bow.id, getBodyOfWaterLabel(bow)])),
        [customerBodiesOfWater]
    );
    const selectedMovingEquipment = useMemo(
        () => equipment.find((item) => item.id === movingEquipmentId) || null,
        [equipment, movingEquipmentId]
    );
    const selectedEditingEquipment = useMemo(
        () => equipment.find((item) => item.id === editingEquipmentId) || null,
        [equipment, editingEquipmentId]
    );
    const selectedEditingBodyOfWater = useMemo(
        () => customerBodiesOfWater.find((item) => item.id === editingBodyOfWaterId) || null,
        [customerBodiesOfWater, editingBodyOfWaterId]
    );
    const activeEquipment = useMemo(
        () => equipment.filter(isActiveEquipment),
        [equipment]
    );
    const pastEquipment = useMemo(
        () => equipment.filter((item) => !isActiveEquipment(item)),
        [equipment]
    );
    const visibleEquipment = showPastEquipment ? pastEquipment : activeEquipment;
    const targetBodiesOfWater = useMemo(
        () => customerBodiesOfWater.filter((bow) => bow.serviceLocationId === equipmentMoveForm.serviceLocationId),
        [customerBodiesOfWater, equipmentMoveForm.serviceLocationId]
    );
    const locationBodiesOfWater = useMemo(
        () => customerBodiesOfWater.filter((bow) => bow.serviceLocationId === location.id),
        [customerBodiesOfWater, location.id]
    );
    const equipmentEditNextServiceDate = useMemo(() => {
        if (!equipmentEditForm.needsService) return '';

        return toDateInputValue(computeNextEquipmentServiceDate(
            dateInputToLocalDate(equipmentEditForm.lastServiceDate),
            equipmentEditForm.serviceFrequency,
            equipmentEditForm.serviceFrequencyEvery
        ));
    }, [equipmentEditForm]);
    const equipmentCreateNextServiceDate = useMemo(() => {
        if (!equipmentCreateForm.needsService) return '';

        return toDateInputValue(computeNextEquipmentServiceDate(
            dateInputToLocalDate(equipmentCreateForm.lastServiceDate),
            equipmentCreateForm.serviceFrequency,
            equipmentCreateForm.serviceFrequencyEvery
        ));
    }, [equipmentCreateForm]);
    const equipmentCreateIsFilter = useMemo(
        () => isFilterEquipment(equipmentCreateForm),
        [equipmentCreateForm]
    );
    const equipmentEditIsFilter = useMemo(
        () => isFilterEquipment(equipmentEditForm),
        [equipmentEditForm]
    );
    const standaloneServiceStopLinks = [
        {
            category: 'serviceAgreementEstimate',
            label: 'Service Agreement Estimate',
            helper: 'Gather location, pool, and equipment details before recurring service.',
        },
        {
            category: 'jobEstimate',
            label: 'Job Estimate',
            helper: 'Visit the property to scope requested work before creating a quote.',
        },
        {
            category: 'customerRelationship',
            label: 'Customer Relationship',
            helper: 'Schedule an open-ended customer visit, follow-up, or correction.',
        },
    ];
    const buildStandaloneServiceStopPath = (category) => {
        const params = new URLSearchParams({
            customerId,
            serviceLocationId: location.id,
            category,
        });

        return `/company/serviceStops/createNew?${params.toString()}`;
    };

    const startBodyOfWaterEdit = (bodyOfWater) => {
        setEditingBodyOfWaterId(bodyOfWater.id);
        setBodyOfWaterEditForm({
            ...getBodyOfWaterEditForm(bodyOfWater),
            waterType: normalizeWaterType(bodyOfWater.waterType),
        });
    };

    const closeBodyOfWaterEdit = () => {
        if (savingBodyOfWaterEdit) return;
        setEditingBodyOfWaterId('');
        setBodyOfWaterEditForm(getBodyOfWaterEditForm());
    };

    const updateBodyOfWaterEditField = (field, value) => {
        setBodyOfWaterEditForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const handleSaveBodyOfWaterEdit = async (event) => {
        event.preventDefault();

        if (!requirePermission("54", "update bodies of water")) return;
        if (!selectedEditingBodyOfWater?.id || !recentlySelectedCompany) return;

        const updates = {
            name: bodyOfWaterEditForm.name,
            gallons: bodyOfWaterEditForm.gallons,
            material: bodyOfWaterEditForm.material,
            waterType: bodyOfWaterEditForm.waterType,
            notes: bodyOfWaterEditForm.notes,
            updatedAt: serverTimestamp(),
        };

        setSavingBodyOfWaterEdit(true);
        try {
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, 'bodiesOfWater', selectedEditingBodyOfWater.id),
                updates
            );
            setBodiesOfWater((current) => current.map((item) => (
                item.id === selectedEditingBodyOfWater.id ? { ...item, ...updates } : item
            )));
            setCustomerBodiesOfWater((current) => current.map((item) => (
                item.id === selectedEditingBodyOfWater.id ? { ...item, ...updates } : item
            )));
            setEditingBodyOfWaterId('');
            setBodyOfWaterEditForm(getBodyOfWaterEditForm());
            toast.success('Body of water updated.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to update body of water.');
        } finally {
            setSavingBodyOfWaterEdit(false);
        }
    };

    const openEquipmentCreate = () => {
        setMovingEquipmentId('');
        setEditingEquipmentId('');
        setEquipmentMoveForm({ serviceLocationId: '', bodyOfWaterId: '' });
        setEquipmentCreateForm(getDefaultEquipmentCreateForm(locationBodiesOfWater[0]?.id || ''));
        setShowEquipmentCreate(true);
    };

    const closeEquipmentCreate = () => {
        if (savingEquipmentCreate) return;
        setShowEquipmentCreate(false);
        setEquipmentCreateForm(getDefaultEquipmentCreateForm());
    };

    const updateEquipmentCreateField = (field, value) => {
        setEquipmentCreateForm((current) => applyEquipmentDefaults(current, { [field]: value }));
    };

    const copyCatalogPartsToEquipment = async (equipmentId, catalogEquipmentId, equipmentData) => {
        if (!catalogEquipmentId || !recentlySelectedCompany) return;

        const partsSnapshot = await getDocs(
            collection(db, 'universal', 'equipment', 'equipment', catalogEquipmentId, 'parts')
        );

        await Promise.all(partsSnapshot.docs.map((partDoc) => {
            const part = partDoc.data();
            const partId = 'com_equ_par_' + uuidv4();

            return setDoc(
                doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId, 'parts', partId),
                {
                    id: partId,
                    name: part.name || '',
                    sku: part.sku || '',
                    make: part.make || equipmentData.make || '',
                    model: part.model || equipmentData.model || '',
                    manualPdfLink: part.manualPdfLink || '',
                    universalPartId: part.id || partDoc.id,
                    universalEquipmentId: catalogEquipmentId,
                    createdAt: new Date(),
                }
            );
        }));
    };

    const createCustomEquipmentSuggestion = async (equipmentId, equipmentData, flags) => {
        await queueUniversalEquipmentSuggestion({
            db,
            companyId: recentlySelectedCompany,
            companyName: recentlySelectedCompanyName || '',
            user,
            equipment: { ...equipmentData, id: equipmentId },
            source: 'companyEquipmentCreate',
            flags,
        });
    };

    const handleCreateEquipment = async (event) => {
        event.preventDefault();

        if (!requirePermission("62", "create equipment")) return;
        if (!recentlySelectedCompany || !customerId || !location.id) {
            toast.error('Missing customer or service location.');
            return;
        }

        const equipmentName = equipmentCreateForm.name.trim();
        if (!equipmentName) {
            toast.error('Add an equipment nickname.');
            return;
        }

        const numericCleanFilterPressure = Number(equipmentCreateForm.cleanFilterPressure);
        const numericServiceFrequency = Number(equipmentCreateForm.serviceFrequency);
        const isCustomType = Boolean(equipmentCreateForm.type && !equipmentCreateForm.typeId);
        const isCustomMake = Boolean(equipmentCreateForm.make && !equipmentCreateForm.makeId);
        const catalogEquipmentId = equipmentCreateForm.universalEquipmentId || equipmentCreateForm.modelId || '';
        const isCustomModel = Boolean(equipmentCreateForm.model && !catalogEquipmentId);
        const selectedBodyOfWater = locationBodiesOfWater.find((bow) => bow.id === equipmentCreateForm.bodyOfWaterId) || null;
        const createdAt = new Date();
        const customerName = getCustomerName(customer) || location.customerName || '';
        const finalNeedsService = equipmentCreateForm.needsService || equipmentDefaultsToNeedsService(equipmentCreateForm);
        const finalIsFilter = isFilterEquipment(equipmentCreateForm);
        const lastServiceDate = finalNeedsService ? dateInputToLocalDate(equipmentCreateForm.lastServiceDate) : null;
        const nextServiceDate = finalNeedsService
            ? computeNextEquipmentServiceDate(
                lastServiceDate,
                equipmentCreateForm.serviceFrequency,
                equipmentCreateForm.serviceFrequencyEvery
            )
            : null;

        if (finalNeedsService && !lastServiceDate) {
            toast.error('Add a last service date before saving equipment that needs service.');
            return;
        }

        if (finalNeedsService && (!Number.isFinite(numericServiceFrequency) || numericServiceFrequency <= 0 || !equipmentCreateForm.serviceFrequencyEvery || !nextServiceDate)) {
            toast.error('Add a valid service frequency so the next service date can be calculated.');
            return;
        }

        const equipmentId = "com_equ_" + uuidv4();
        const newEquipment = {
            id: equipmentId,
            name: equipmentName,
            type: equipmentCreateForm.type || '',
            typeId: isCustomType ? '' : equipmentCreateForm.typeId || '',
            make: equipmentCreateForm.make || '',
            makeId: isCustomMake ? '' : equipmentCreateForm.makeId || '',
            model: equipmentCreateForm.model || '',
            modelId: isCustomModel ? '' : catalogEquipmentId,
            universalEquipmentId: isCustomModel ? '' : catalogEquipmentId,
            manualPdfLink: isCustomModel ? '' : equipmentCreateForm.manualPdfLink || '',
            createdAt,
            createdAtMillis: createdAt.getTime(),
            dateInstalled: dateInputToLocalDate(equipmentCreateForm.dateInstalled),
            cleanFilterPressure: !finalIsFilter || equipmentCreateForm.cleanFilterPressure === '' || !Number.isFinite(numericCleanFilterPressure)
                ? null
                : numericCleanFilterPressure,
            serviceFrequency: finalNeedsService ? numericServiceFrequency : null,
            serviceFrequencyEvery: finalNeedsService ? equipmentCreateForm.serviceFrequencyEvery || 'Month' : null,
            notes: equipmentCreateForm.notes,
            customerId,
            customerName,
            serviceLocationId: location.id,
            bodyOfWaterId: selectedBodyOfWater?.id || '',
            lastServiceDate,
            nextServiceDate,
            isActive: true,
            active: true,
            dateUninstalled: null,
            needsService: finalNeedsService,
            status: EQUIPMENT_STATUS.OPERATIONAL,
            currentPressure: null,
        };

        setSavingEquipmentCreate(true);
        try {
            await setDoc(doc(db, 'companies', recentlySelectedCompany, 'equipment', equipmentId), newEquipment);
            try {
                await createCustomEquipmentSuggestion(equipmentId, newEquipment, { isCustomType, isCustomMake, isCustomModel });
            } catch (suggestionError) {
                console.error("Error creating custom equipment suggestion: ", suggestionError);
            }
            await copyCatalogPartsToEquipment(equipmentId, catalogEquipmentId, newEquipment);

            setEquipment((currentEquipment) => [...currentEquipment, newEquipment]);
            setShowEquipmentCreate(false);
            setEquipmentCreateForm(getDefaultEquipmentCreateForm(locationBodiesOfWater[0]?.id || ''));
            toast.success('Equipment created.');
        } catch (error) {
            console.error("Error creating new equipment: ", error);
            toast.error('Failed to create equipment.');
        } finally {
            setSavingEquipmentCreate(false);
        }
    };

    const startEquipmentMove = (eq) => {
        setEditingEquipmentId('');
        setMovingEquipmentId(eq.id);
        setEquipmentMoveForm({
            serviceLocationId: eq.serviceLocationId || location.id,
            bodyOfWaterId: eq.bodyOfWaterId || '',
        });
    };

    const startEquipmentEdit = (eq) => {
        setMovingEquipmentId('');
        setEquipmentMoveForm({ serviceLocationId: '', bodyOfWaterId: '' });
        setEditingEquipmentId(eq.id);
        setEquipmentEditForm(getEquipmentEditForm(eq));
    };

    const closeEquipmentEdit = () => {
        if (savingEquipmentEdit) return;
        setEditingEquipmentId('');
        setEquipmentEditForm(getEquipmentEditForm());
    };

    const updateEquipmentEditField = (field, value) => {
        setEquipmentEditForm((current) => applyEquipmentDefaults(current, { [field]: value }));
    };

    const handleSaveEquipmentEdit = async (event) => {
        event.preventDefault();

        if (!requirePermission("64", "update equipment")) return;
        if (!selectedEditingEquipment?.id || !recentlySelectedCompany) return;

        const dateInstalled = dateInputToLocalDate(equipmentEditForm.dateInstalled);
        const lastServiceDate = dateInputToLocalDate(equipmentEditForm.lastServiceDate);
        const finalNeedsService = equipmentEditForm.needsService || equipmentDefaultsToNeedsService(equipmentEditForm);
        const finalIsFilter = isFilterEquipment(equipmentEditForm);
        const numericServiceFrequency = Number(equipmentEditForm.serviceFrequency);
        const nextServiceDate = finalNeedsService
            ? computeNextEquipmentServiceDate(
                lastServiceDate,
                numericServiceFrequency,
                equipmentEditForm.serviceFrequencyEvery
            )
            : null;

        if (finalNeedsService && !lastServiceDate) {
            toast.error('Add a last service date before saving equipment that needs service.');
            return;
        }

        if (finalNeedsService && (!Number.isFinite(numericServiceFrequency) || numericServiceFrequency <= 0 || !equipmentEditForm.serviceFrequencyEvery || !nextServiceDate)) {
            toast.error('Add a valid service frequency so the next service date can be calculated.');
            return;
        }

        const equipmentUpdates = {
            type: equipmentEditForm.type,
            typeId: equipmentEditForm.typeId,
            cleanFilterPressure: finalIsFilter ? equipmentEditForm.cleanFilterPressure : null,
            currentPressure: finalIsFilter ? equipmentEditForm.currentPressure : null,
            dateInstalled,
            lastServiceDate: finalNeedsService ? lastServiceDate : null,
            nextServiceDate,
            make: equipmentEditForm.make,
            makeId: equipmentEditForm.makeId,
            model: equipmentEditForm.model,
            modelId: equipmentEditForm.modelId,
            universalEquipmentId: equipmentEditForm.universalEquipmentId,
            manualPdfLink: equipmentEditForm.manualPdfLink,
            name: equipmentEditForm.name,
            createdAt: selectedEditingEquipment.createdAt || serverTimestamp(),
            createdAtMillis: selectedEditingEquipment.createdAtMillis || Date.now(),
            isActive: equipmentEditForm.isActive,
            active: equipmentEditForm.isActive,
            needsService: finalNeedsService,
            serviceFrequency: finalNeedsService ? numericServiceFrequency : null,
            serviceFrequencyEvery: finalNeedsService ? equipmentEditForm.serviceFrequencyEvery || '' : '',
            status: equipmentEditForm.status,
            notes: equipmentEditForm.notes,
        };

        setSavingEquipmentEdit(true);
        try {
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, 'equipment', selectedEditingEquipment.id),
                {
                    ...equipmentUpdates,
                    updatedAt: serverTimestamp(),
                }
            );
            try {
                await syncUniversalEquipmentSuggestionForEquipment({
                    db,
                    companyId: recentlySelectedCompany,
                    companyName: recentlySelectedCompanyName || '',
                    user,
                    equipment: {
                        ...selectedEditingEquipment,
                        ...equipmentUpdates,
                        id: selectedEditingEquipment.id,
                    },
                    source: 'companyEquipmentEdit',
                });
            } catch (suggestionError) {
                console.error('Error syncing universal equipment suggestion:', suggestionError);
            }

            setEquipment((currentEquipment) => currentEquipment.map((item) => (
                item.id === selectedEditingEquipment.id ? { ...item, ...equipmentUpdates } : item
            )));
            setEditingEquipmentId('');
            setEquipmentEditForm(getEquipmentEditForm());
            toast.success('Equipment updated.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to update equipment.');
        } finally {
            setSavingEquipmentEdit(false);
        }
    };

    const handleDeleteEquipmentEdit = async () => {
        if (!requirePermission("66", "delete equipment")) return;
        if (!selectedEditingEquipment?.id || !recentlySelectedCompany) return;

        const confirmed = await appConfirm({
            title: 'Delete Equipment',
            message: `Delete ${selectedEditingEquipment.name || selectedEditingEquipment.model || selectedEditingEquipment.type || 'this equipment'} and its saved history/parts?`,
            confirmLabel: 'Delete Equipment',
            variant: 'danger',
        });
        if (!confirmed) return;

        setSavingEquipmentEdit(true);
        try {
            await deleteEquipmentWithSubcollections(db, recentlySelectedCompany, selectedEditingEquipment.id);
            setEquipment((currentEquipment) => currentEquipment.filter((item) => item.id !== selectedEditingEquipment.id));
            setEditingEquipmentId('');
            setEquipmentEditForm(getEquipmentEditForm());
            toast.success('Equipment deleted.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete equipment.');
        } finally {
            setSavingEquipmentEdit(false);
        }
    };

    const handleMoveServiceLocationChange = (event) => {
        const nextServiceLocationId = event.target.value;
        const bodyStillFits = customerBodiesOfWater.some((bow) => (
            bow.id === equipmentMoveForm.bodyOfWaterId && bow.serviceLocationId === nextServiceLocationId
        ));

        setEquipmentMoveForm((current) => ({
            ...current,
            serviceLocationId: nextServiceLocationId,
            bodyOfWaterId: bodyStillFits ? current.bodyOfWaterId : '',
        }));
    };

    const handleSaveEquipmentMove = async (event) => {
        event.preventDefault();

        if (!selectedMovingEquipment?.id || !recentlySelectedCompany) return;
        if (!equipmentMoveForm.serviceLocationId) {
            toast.error('Choose a destination service location.');
            return;
        }

        const targetLocation = customerServiceLocations.find((item) => item.id === equipmentMoveForm.serviceLocationId);
        const targetBodyOfWater = equipmentMoveForm.bodyOfWaterId
            ? customerBodiesOfWater.find((item) => item.id === equipmentMoveForm.bodyOfWaterId)
            : null;

        if (!targetLocation) {
            toast.error('Choose a valid destination service location.');
            return;
        }

        if (targetBodyOfWater && targetBodyOfWater.serviceLocationId !== targetLocation.id) {
            toast.error('Choose a body of water at the selected service location.');
            return;
        }

        setMovingEquipment(true);
        try {
            const updates = {
                customerId,
                customerName: selectedMovingEquipment.customerName || targetLocation.customerName || '',
                serviceLocationId: targetLocation.id,
                bodyOfWaterId: targetBodyOfWater?.id || '',
                updatedAt: serverTimestamp(),
            };
            await updateDoc(
                doc(db, 'companies', recentlySelectedCompany, 'equipment', selectedMovingEquipment.id),
                updates
            );

            setEquipment((currentEquipment) => (
                targetLocation.id === location.id
                    ? currentEquipment.map((item) => (
                        item.id === selectedMovingEquipment.id ? { ...item, ...updates } : item
                    ))
                    : currentEquipment.filter((item) => item.id !== selectedMovingEquipment.id)
            ));
            setMovingEquipmentId('');
            setEquipmentMoveForm({ serviceLocationId: '', bodyOfWaterId: '' });
            toast.success('Equipment reassigned.');
        } catch (error) {
            console.error(error);
            toast.error('Failed to reassign equipment.');
        } finally {
            setMovingEquipment(false);
        }
    };

    const getEquipmentDisplayName = (eq = {}) => (
        [eq.name, eq.make, eq.model].filter(Boolean).join(' ') || eq.type || 'Equipment'
    );

    const buildEquipmentContext = (eq = {}, jobIntent = '') => ({
        equipmentId: eq.id,
        equipmentName: getEquipmentDisplayName(eq),
        equipmentType: eq.type || '',
        equipmentMake: eq.make || '',
        equipmentModel: eq.model || '',
        customerId,
        customerName: getCustomerName(customer) || eq.customerName || '',
        serviceLocationId: eq.serviceLocationId || location.id,
        bodyOfWaterId: eq.bodyOfWaterId || '',
        jobIntent,
    });

    const createEquipmentJobFromCard = (eq, jobIntent) => {
        navigate('/company/jobs/createNew', {
            state: {
                equipmentContext: buildEquipmentContext(eq, jobIntent),
                jobIntent,
            },
        });
    };

    const createEquipmentRepairRequestFromCard = (eq) => {
        const basePath = eq.customerId
            ? `/company/repair-requests/create/${eq.customerId}${eq.serviceLocationId ? `/${eq.serviceLocationId}` : ''}`
            : '/company/repair-requests/create';

        navigate(basePath, {
            state: {
                equipmentContext: buildEquipmentContext(eq, 'repairRequest'),
                defaultDescription: `Repair request for ${getEquipmentDisplayName(eq)}`,
            },
        });
    };

    return (<div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
            <InfoCard compact title="Schedule Service Stop">
                <div className="grid gap-2 md:grid-cols-3">
                    {standaloneServiceStopLinks.map((item) => (
                        <Link
                            key={item.category}
                            to={buildStandaloneServiceStopPath(item.category)}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-200 hover:bg-blue-50"
                        >
                            <span className="block text-sm font-bold text-slate-900">{item.label}</span>
                            <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{item.helper}</span>
                        </Link>
                    ))}
                </div>
            </InfoCard>
        </div>

        <InfoCard
            title="Bodies of Water"
            compact
            actions={
                <Link
                    to={`/company/bodiesOfWater/createNew/${customerId}/${location.id}`}
                    className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm transition"
                >
                    + Add
                </Link>
            }
        >
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <ul className="space-y-2">
                    {bodiesOfWater.map((bow) => (
                        <li key={bow.id}>
                            <div className="rounded-lg border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-semibold text-slate-900">
                                            {bow.name || "Unnamed Body of Water"}
                                        </h3>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            Body of water profile
                                        </p>
                                    </div>

                                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-100 whitespace-nowrap">
                                        {bow.gallons ? `${Number(bow.gallons).toLocaleString()} gal` : "No volume"}
                                    </span>
                                </div>

                                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Material
                                        </p>
                                        <p className="mt-0.5 text-sm text-slate-800">
                                            {bow.material || "Not specified"}
                                        </p>
                                    </div>

                                    <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Last Filled
                                        </p>
                                        <p className="mt-0.5 text-sm text-slate-800">
                                            {bow.lastFilled
                                                ? format(bow.lastFilled.toDate(), "PPP")
                                                : "Not recorded"}
                                        </p>
                                    </div>

                                    <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            Water Type
                                        </p>
                                        <p className="mt-0.5 text-sm text-slate-800">
                                            {normalizeWaterType(bow.waterType) || "Not specified"}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                        Notes
                                    </p>
                                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-slate-700">
                                        {bow.notes || "No notes added."}
                                    </p>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2.5">
                                    {can("54") && (
                                        <button
                                            type="button"
                                            onClick={() => startBodyOfWaterEdit(bow)}
                                            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                                        >
                                            Edit
                                        </button>
                                    )}
                                    <Link
                                        to={`/company/bodiesOfWater/detail/${bow.id}`}
                                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                        View Details
                                    </Link>
                                </div>
                            </div>
                        </li>
                    ))}

                    {bodiesOfWater.length === 0 && (
                        <p className="text-sm text-slate-500">None found.</p>
                    )}
                </ul>
            )}
        </InfoCard>

	        <InfoCard
		            title={`Equipment (${visibleEquipment.length})`}
                    compact
		            actions={
                        <div className="flex flex-wrap justify-end gap-2">
                            {pastEquipment.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setShowPastEquipment((current) => !current)}
                                    className="text-sm font-semibold text-slate-700 bg-white border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-50 shadow-sm transition"
                                >
                                    {showPastEquipment ? `Active (${activeEquipment.length})` : `Past (${pastEquipment.length})`}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={openEquipmentCreate}
                                className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm transition"
                            >
                                + Add
                            </button>
                        </div>
		            }
		        >
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <ul className="grid gap-2">
	                    {visibleEquipment.map((eq) => (
                        <li key={eq.id}>
                            <div className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-slate-50">
                                <Link
                                    to={`/company/equipment/detail/${eq.id}`}
                                    className="block"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="truncate text-sm font-semibold text-slate-900">
                                                {eq.name || "Unnamed Equipment"}
                                            </h3>
                                            <p className="mt-0.5 truncate text-xs text-slate-500">
                                                {[eq.type, eq.make, eq.model].filter(Boolean).join(" • ") || "Unknown type"}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                                            <span
                                                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${eq.status === "Operational"
                                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                                    : "bg-amber-50 text-amber-700 border-amber-100"
                                                    }`}
                                            >
                                                {eq.status || "Unknown"}
                                            </span>

                                            {eq.needsService && (
                                                <span className="rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                                    Needs Service
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-2 flex flex-wrap gap-1.5">
	                                        <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
	                                            {bodyOfWaterNameById.get(eq.bodyOfWaterId) || (eq.bodyOfWaterId ? "Linked water" : "Unassigned")}
	                                        </span>
	                                        {isFilterEquipment(eq) && (
	                                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
	                                                {eq.currentPressure ?? "—"} PSI
	                                            </span>
	                                        )}
                                        {eq.needsService && (
                                            <>
                                                <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                                    Last {formatDateValue(eq.lastServiceDate)}
                                                </span>
                                                {eq.nextServiceDate && (
                                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                                        Next {formatDateValue(eq.nextServiceDate)}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    {eq.notes && (
                                        <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                                            {eq.notes}
                                        </p>
                                    )}
                                </Link>

                                <div className="mt-2 border-t border-slate-100 pt-2">
                                    {movingEquipmentId === eq.id ? (
                                        <form onSubmit={handleSaveEquipmentMove} className="space-y-3">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <label className="space-y-1 text-xs font-semibold text-slate-600">
                                                    Service Location
                                                    <select
                                                        value={equipmentMoveForm.serviceLocationId}
                                                        onChange={handleMoveServiceLocationChange}
                                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                    >
                                                        <option value="">Choose location</option>
                                                        {customerServiceLocations.map((serviceLocation) => (
                                                            <option key={serviceLocation.id} value={serviceLocation.id}>
                                                                {getLocationLabel(serviceLocation)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className="space-y-1 text-xs font-semibold text-slate-600">
                                                    Body of Water
                                                    <select
                                                        value={equipmentMoveForm.bodyOfWaterId}
                                                        onChange={(event) => setEquipmentMoveForm((current) => ({ ...current, bodyOfWaterId: event.target.value }))}
                                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                    >
                                                        <option value="">Unassigned</option>
                                                        {targetBodiesOfWater.map((bow) => (
                                                            <option key={bow.id} value={bow.id}>
                                                                {getBodyOfWaterLabel(bow)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                            </div>
                                            {equipmentMoveForm.serviceLocationId && targetBodiesOfWater.length === 0 && (
                                                <p className="text-xs text-amber-700">
                                                    No bodies of water are saved at this service location yet. Equipment can still move there unassigned.
                                                </p>
                                            )}
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="submit"
                                                    disabled={movingEquipment}
                                                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                                                >
                                                    {movingEquipment ? 'Moving...' : 'Save Move'}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={movingEquipment}
                                                    onClick={() => {
                                                        setMovingEquipmentId('');
                                                        setEquipmentMoveForm({ serviceLocationId: '', bodyOfWaterId: '' });
                                                    }}
                                                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </form>
                                        ) : (
	                                            <div className="flex flex-wrap gap-2">
                                                    <Menu as="div" className="relative inline-block text-left">
                                                        <MenuButton className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
                                                            <EllipsisVerticalIcon className="h-4 w-4" aria-hidden="true" />
                                                            Actions
                                                        </MenuButton>
                                                        <MenuItems className="absolute right-0 z-30 mt-2 w-56 origin-top-right overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg focus:outline-none">
                                                            {can("64") && (
                                                                <>
                                                                    <QuickActionMenuItem
                                                                        label="Edit Equipment"
                                                                        icon={PencilSquareIcon}
                                                                        onClick={() => startEquipmentEdit(eq)}
                                                                    />
                                                                    <QuickActionMenuItem
                                                                        label="Move Equipment"
                                                                        icon={ArrowsPointingOutIcon}
                                                                        onClick={() => startEquipmentMove(eq)}
                                                                    />
                                                                </>
                                                            )}
                                                            {can("32") && (
                                                                <QuickActionMenuItem
                                                                    label="Add Repair Request"
                                                                    icon={WrenchScrewdriverIcon}
                                                                    tone="amber"
                                                                    onClick={() => createEquipmentRepairRequestFromCard(eq)}
                                                                />
                                                            )}
                                                            {can("22") && (
                                                                <>
                                                                    <QuickActionMenuItem
                                                                        label="Create Maintenance Job"
                                                                        icon={BriefcaseIcon}
                                                                        tone="emerald"
                                                                        onClick={() => createEquipmentJobFromCard(eq, 'maintenance')}
                                                                    />
                                                                    <QuickActionMenuItem
                                                                        label="Create Repair Job"
                                                                        icon={BriefcaseIcon}
                                                                        tone="amber"
                                                                        onClick={() => createEquipmentJobFromCard(eq, 'repair')}
                                                                    />
                                                                </>
                                                            )}
                                                        </MenuItems>
                                                    </Menu>
	                                            </div>
	                                        )}
                                    </div>
                                </div>
                            </li>
                        ))}

	                    {visibleEquipment.length === 0 && (
	                        <p className="text-sm text-slate-500">
                                {showPastEquipment ? 'No past equipment found.' : 'No active equipment found.'}
                            </p>
	                    )}
                    </ul>
	            )}
	        </InfoCard>

                {editingBodyOfWaterId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
                            <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                                <div className="min-w-0">
                                    <h3 className="text-lg font-bold text-slate-950">Edit Body of Water</h3>
                                    <p className="mt-1 truncate text-sm text-slate-500">
                                        {selectedEditingBodyOfWater?.name || 'Body of water'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeBodyOfWaterEdit}
                                    disabled={savingBodyOfWaterEdit}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                >
                                    Close
                                </button>
                            </div>

                            <form onSubmit={handleSaveBodyOfWaterEdit} className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="space-y-1 text-xs font-semibold text-slate-600">
                                        Name
                                        <input
                                            value={bodyOfWaterEditForm.name}
                                            onChange={(event) => updateBodyOfWaterEditField('name', event.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="space-y-1 text-xs font-semibold text-slate-600">
                                        Gallons
                                        <input
                                            value={bodyOfWaterEditForm.gallons}
                                            onChange={(event) => updateBodyOfWaterEditField('gallons', event.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="space-y-1 text-xs font-semibold text-slate-600">
                                        Water Type
                                        <select
                                            value={bodyOfWaterEditForm.waterType}
                                            onChange={(event) => updateBodyOfWaterEditField('waterType', event.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        >
                                            <option value="">Select water type</option>
                                            {bodyOfWaterEditForm.waterType && !WATER_TYPE_OPTIONS.includes(bodyOfWaterEditForm.waterType) && (
                                                <option value={bodyOfWaterEditForm.waterType}>{bodyOfWaterEditForm.waterType}</option>
                                            )}
                                            {WATER_TYPE_OPTIONS.map((option) => (
                                                <option key={option} value={option}>{option}</option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="space-y-1 text-xs font-semibold text-slate-600">
                                        Material
                                        <input
                                            value={bodyOfWaterEditForm.material}
                                            onChange={(event) => updateBodyOfWaterEditField('material', event.target.value)}
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>

                                    <label className="space-y-1 text-xs font-semibold text-slate-600 md:col-span-2">
                                        Notes
                                        <textarea
                                            value={bodyOfWaterEditForm.notes}
                                            onChange={(event) => updateBodyOfWaterEditField('notes', event.target.value)}
                                            rows={4}
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        />
                                    </label>
                                </div>

                                <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                                    <button
                                        type="button"
                                        onClick={closeBodyOfWaterEdit}
                                        disabled={savingBodyOfWaterEdit}
                                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingBodyOfWaterEdit}
                                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                                    >
                                        {savingBodyOfWaterEdit ? 'Saving...' : 'Save'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

		        {showEquipmentCreate && (
	            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
	                <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
	                    <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
	                        <div className="min-w-0">
	                            <h3 className="text-lg font-bold text-slate-950">Add Equipment</h3>
	                            <p className="mt-1 truncate text-sm text-slate-500">
	                                {getLocationLabel(location)}
	                            </p>
	                        </div>
	                        <button
	                            type="button"
	                            onClick={closeEquipmentCreate}
	                            disabled={savingEquipmentCreate}
	                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
	                        >
	                            Close
	                        </button>
	                    </div>

	                    <form onSubmit={handleCreateEquipment} className="space-y-5">
	                        <section className="space-y-3 border-b border-slate-200 pb-5">
	                            <h4 className="text-sm font-bold text-slate-800">Owner Details</h4>
	                            <div className="grid gap-4 md:grid-cols-3">
	                                <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                    Customer
	                                    <input
	                                        value={getCustomerName(customer) || location.customerName || ''}
	                                        readOnly
	                                        className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
	                                    />
	                                </label>

	                                <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                    Service Location
	                                    <input
	                                        value={getLocationLabel(location)}
	                                        readOnly
	                                        className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
	                                    />
	                                </label>

	                                <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                    Body of Water
	                                    <select
	                                        value={equipmentCreateForm.bodyOfWaterId}
	                                        onChange={(event) => updateEquipmentCreateField('bodyOfWaterId', event.target.value)}
	                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                    >
	                                        <option value="">Unassigned</option>
	                                        {locationBodiesOfWater.map((bow) => (
	                                            <option key={bow.id} value={bow.id}>
	                                                {getBodyOfWaterLabel(bow)}
	                                            </option>
	                                        ))}
	                                    </select>
	                                </label>
	                            </div>
	                        </section>

	                        <section className="space-y-3 border-b border-slate-200 pb-5">
	                            <h4 className="text-sm font-bold text-slate-800">Equipment Specifications</h4>
	                            <EquipmentCatalogPicker
	                                value={equipmentCreateForm}
	                                preferCustom
	                                onChange={(nextEquipment) => setEquipmentCreateForm((current) => {
	                                    const nextForm = applyEquipmentDefaults(current, nextEquipment);
	                                    return {
	                                        ...nextForm,
	                                        name: current.name.trim()
	                                            ? current.name
	                                            : buildEquipmentNickname(nextForm),
	                                    };
	                                })}
	                                onModelSelected={(selectedModel) => setEquipmentCreateForm((current) => {
	                                    const nextForm = applyEquipmentDefaults(current, {
	                                        ...current,
	                                        model: selectedModel?.model || selectedModel?.name || current.model,
	                                        modelId: selectedModel?.id || current.modelId,
	                                        universalEquipmentId: selectedModel?.id || current.universalEquipmentId,
	                                        manualPdfLink: selectedModel?.manualPdfLink || current.manualPdfLink,
	                                    });
	                                    return {
	                                        ...nextForm,
	                                        name: current.name.trim() ? current.name : buildEquipmentNickname(nextForm),
	                                    };
	                                })}
	                                inputClassName="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                labelClassName="block text-xs font-semibold text-slate-600 mb-1"
	                            />
	                        </section>

	                        <section className="space-y-3">
	                            <h4 className="text-sm font-bold text-slate-800">Service & Installation</h4>
	                            <div className="grid gap-4 md:grid-cols-3">
	                                <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                    Equipment Nickname
	                                    <input
	                                        required
	                                        value={equipmentCreateForm.name}
	                                        onChange={(event) => updateEquipmentCreateField('name', event.target.value)}
	                                        placeholder="e.g., Main Pool Pump"
	                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                    />
	                                </label>

	                                <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                    Date Installed
	                                    <input
	                                        type="date"
	                                        value={equipmentCreateForm.dateInstalled}
	                                        onChange={(event) => updateEquipmentCreateField('dateInstalled', event.target.value)}
	                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                    />
	                                </label>

	                                {equipmentCreateIsFilter && (
	                                    <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                        Clean Filter Pressure (PSI)
	                                        <input
	                                            value={equipmentCreateForm.cleanFilterPressure}
	                                            onChange={(event) => updateEquipmentCreateField('cleanFilterPressure', event.target.value)}
	                                            placeholder="e.g., 25"
	                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                        />
	                                    </label>
	                                )}

	                                <label className="space-y-1 text-xs font-semibold text-slate-600">
	                                    Will This Equipment Need Service?
	                                    <select
	                                        value={equipmentCreateForm.needsService ? 'yes' : 'no'}
	                                        onChange={(event) => updateEquipmentCreateField('needsService', event.target.value === 'yes')}
	                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                    >
	                                        <option value="no">No</option>
	                                        <option value="yes">Yes</option>
	                                    </select>
	                                </label>

	                                {equipmentCreateForm.needsService && (
		                                    <>
		                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
		                                            Last Service Date
		                                            <input
		                                                type="date"
		                                                value={equipmentCreateForm.lastServiceDate}
		                                                onChange={(event) => updateEquipmentCreateField('lastServiceDate', event.target.value)}
		                                                required
		                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
		                                            />
		                                        </label>

		                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
		                                            Next Service Date
		                                            <input
		                                                type="date"
		                                                value={equipmentCreateNextServiceDate}
		                                                readOnly
		                                                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
		                                            />
		                                        </label>

		                                        <label className="space-y-1 text-xs font-semibold text-slate-600 md:col-span-2">
		                                            Service Frequency
		                                            <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
		                                                <input
		                                                    type="number"
		                                                    min="1"
		                                                    value={equipmentCreateForm.serviceFrequency}
		                                                    onChange={(event) => updateEquipmentCreateField('serviceFrequency', event.target.value)}
		                                                    required
		                                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
		                                                />
		                                                <select
		                                                    value={equipmentCreateForm.serviceFrequencyEvery}
		                                                    onChange={(event) => updateEquipmentCreateField('serviceFrequencyEvery', event.target.value)}
		                                                    required
		                                                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
		                                                >
		                                                    <option value="Day">Days</option>
		                                                    <option value="Week">Weeks</option>
		                                                    <option value="Month">Months</option>
		                                                    <option value="Year">Years</option>
		                                                </select>
		                                            </div>
		                                        </label>
		                                    </>
		                                )}

	                                <label className="space-y-1 text-xs font-semibold text-slate-600 md:col-span-3">
	                                    Notes
	                                    <textarea
	                                        value={equipmentCreateForm.notes}
	                                        onChange={(event) => updateEquipmentCreateField('notes', event.target.value)}
	                                        rows={4}
	                                        placeholder="Add any relevant notes here..."
	                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
	                                    />
	                                </label>
	                            </div>
	                        </section>

	                        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
	                            <button
	                                type="button"
	                                onClick={closeEquipmentCreate}
	                                disabled={savingEquipmentCreate}
	                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
	                            >
	                                Cancel
	                            </button>
	                            <button
	                                type="submit"
	                                disabled={savingEquipmentCreate}
	                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
	                            >
	                                {savingEquipmentCreate ? 'Creating...' : 'Create Equipment'}
	                            </button>
	                        </div>
	                    </form>
	                </div>
	            </div>
	        )}

	        {editingEquipmentId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
                        <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                            <div className="min-w-0">
                                <h3 className="text-lg font-bold text-slate-950">Edit Equipment</h3>
                                <p className="mt-1 truncate text-sm text-slate-500">
                                    {selectedEditingEquipment?.name || selectedEditingEquipment?.type || 'Equipment'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEquipmentEdit}
                                disabled={savingEquipmentEdit}
                                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                            >
                                Close
                            </button>
                        </div>

                        <form onSubmit={handleSaveEquipmentEdit} className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="space-y-1 text-xs font-semibold text-slate-600">
                                    Name
                                    <input
                                        value={equipmentEditForm.name}
                                        onChange={(event) => updateEquipmentEditField('name', event.target.value)}
                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>

                                <div className="md:col-span-2">
                                    <EquipmentCatalogPicker
                                        value={equipmentEditForm}
                                        preferCustom
                                        onChange={(nextEquipment) => setEquipmentEditForm((current) => (
                                            applyEquipmentDefaults(current, nextEquipment)
                                        ))}
                                        onModelSelected={(selectedModel) => setEquipmentEditForm((current) => {
                                            const nextForm = applyEquipmentDefaults(current, {
                                                ...current,
                                                model: selectedModel?.model || selectedModel?.name || current.model,
                                                modelId: selectedModel?.id || current.modelId,
                                                universalEquipmentId: selectedModel?.id || current.universalEquipmentId,
                                                manualPdfLink: selectedModel?.manualPdfLink || current.manualPdfLink,
                                            });
                                            return {
                                                ...nextForm,
                                                name: current.name.trim() ? current.name : buildEquipmentNickname(nextForm),
                                            };
                                        })}
                                        inputClassName="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        labelClassName="block text-xs font-semibold text-slate-600 mb-1"
                                    />
                                </div>

                                <label className="space-y-1 text-xs font-semibold text-slate-600">
                                    Date Installed
                                    <input
                                        type="date"
                                        value={equipmentEditForm.dateInstalled}
                                        onChange={(event) => updateEquipmentEditField('dateInstalled', event.target.value)}
                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>

                                <label className="space-y-1 text-xs font-semibold text-slate-600">
                                    Status
                                    <select
                                        value={equipmentEditForm.status}
                                        onChange={(event) => updateEquipmentEditField('status', event.target.value)}
                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    >
                                        {equipmentEditForm.status === EQUIPMENT_STATUS.REPLACED && (
                                            <option value={EQUIPMENT_STATUS.REPLACED}>{EQUIPMENT_STATUS.REPLACED}</option>
                                        )}
                                        {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                                            <option key={statusOption} value={statusOption}>
                                                {statusOption}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={equipmentEditForm.needsService}
                                        onChange={(event) => updateEquipmentEditField('needsService', event.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    Needs Service
                                </label>

                                <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={equipmentEditForm.isActive}
                                        onChange={(event) => updateEquipmentEditField('isActive', event.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    Active
                                </label>

                                {equipmentEditIsFilter && (
                                    <>
                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
                                            Clean Filter Pressure
                                            <input
                                                value={equipmentEditForm.cleanFilterPressure}
                                                onChange={(event) => updateEquipmentEditField('cleanFilterPressure', event.target.value)}
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </label>

                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
                                            Current Pressure
                                            <input
                                                value={equipmentEditForm.currentPressure}
                                                onChange={(event) => updateEquipmentEditField('currentPressure', event.target.value)}
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </label>
                                    </>
                                )}

                                {equipmentEditForm.needsService && (
                                    <>
                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
                                            Last Service Date
                                            <input
                                                type="date"
                                                value={equipmentEditForm.lastServiceDate}
                                                onChange={(event) => updateEquipmentEditField('lastServiceDate', event.target.value)}
                                                required
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </label>

                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
                                            Next Service Date
                                            <input
                                                type="date"
                                                value={equipmentEditNextServiceDate}
                                                readOnly
                                                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
                                            />
                                        </label>

                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
                                            Service Frequency
                                            <input
                                                type="number"
                                                min="1"
                                                value={equipmentEditForm.serviceFrequency}
                                                onChange={(event) => updateEquipmentEditField('serviceFrequency', event.target.value)}
                                                required
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            />
                                        </label>

                                        <label className="space-y-1 text-xs font-semibold text-slate-600">
                                            Frequency Unit
                                            <select
                                                value={equipmentEditForm.serviceFrequencyEvery}
                                                onChange={(event) => updateEquipmentEditField('serviceFrequencyEvery', event.target.value)}
                                                required
                                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value="">Select</option>
                                                <option value="Day">Day</option>
                                                <option value="Week">Week</option>
                                                <option value="Month">Month</option>
                                                <option value="Year">Year</option>
                                            </select>
                                        </label>
                                    </>
                                )}

                                <label className="space-y-1 text-xs font-semibold text-slate-600 md:col-span-2">
                                    Notes
                                    <textarea
                                        value={equipmentEditForm.notes}
                                        onChange={(event) => updateEquipmentEditField('notes', event.target.value)}
                                        rows={4}
                                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    />
                                </label>
                            </div>

	                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
                                    {can("66") ? (
                                        <button
                                            type="button"
                                            onClick={handleDeleteEquipmentEdit}
                                            disabled={savingEquipmentEdit}
                                            className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                        >
                                            Delete
                                        </button>
                                    ) : <span />}
                                    <div className="flex justify-end gap-2">
	                                    <button
	                                        type="button"
	                                        onClick={closeEquipmentEdit}
	                                        disabled={savingEquipmentEdit}
	                                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
	                                    >
	                                        Cancel
	                                    </button>
	                                    <button
	                                        type="submit"
	                                        disabled={savingEquipmentEdit}
	                                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
	                                    >
	                                        {savingEquipmentEdit ? 'Saving...' : 'Save'}
	                                    </button>
                                    </div>
	                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
        );
    };

// Leads Tab
const LeadsTab = ({ customer }) => {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchLeads = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'homeownerServiceRequests'), where("customerId", "==", customer.id));
                const snapshot = await getDocs(q);
                setLeads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                toast.error("Failed to fetch leads.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchLeads();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <InfoCard title="Lead History">
            {loading ? <ClipLoader size={30} /> : (
                <ul className="divide-y divide-gray-200">
                    {leads.map(lead => (
                        <li key={lead.id} className="py-4 flex justify-between items-center">
                            <div className="min-w-0">
                                <p className="font-semibold text-gray-800 truncate">{lead.serviceName}</p>
                                <p className="text-sm text-gray-600">Status: {lead.status}</p>
                            </div>
                            <Link to={`/company/leads/${lead.id}`} className="text-sm font-semibold text-blue-600 hover:underline">View Details</Link>
                        </li>
                    ))}
                    {leads.length === 0 && <p className="text-gray-500">No leads found.</p>}
                </ul>
            )}
        </InfoCard>
    );
};

// Recurring Tab
const RecurringTab = ({ customer }) => {
    const [recurringStops, setRecurringStops] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    const getRecurringStopAddress = (stop) => {
        const address = stop.address || {};
        return [
            address.streetAddress || stop.streetAddress,
            address.city || stop.city,
            address.state || stop.state,
            address.zip || stop.zip,
        ].filter(Boolean).join(', ') || 'No address';
    };

    const getRecurringStopStatus = (stop) => {
        const endMillis = toMillis(stop.endDate);

        if (!stop.noEndDate && endMillis && endMillis < Date.now()) {
            return { label: 'Ended', tone: 'slate' };
        }

        if (!stop.noEndDate && endMillis) {
            return { label: `Ends ${formatDateValue(stop.endDate)}`, tone: 'amber' };
        }

        return { label: 'Active', tone: 'emerald' };
    };

    useEffect(() => {
        const fetchRecurring = async () => {
            setLoading(true);
            try {
                const stopQ = query(collection(db, 'companies', recentlySelectedCompany, 'recurringServiceStop'), where("customerId", "==", customer.id));
                const stopSnap = await getDocs(stopQ);
                const stops = stopSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .sort((left, right) => (
                        String(left.internalId || left.id || '').localeCompare(
                            String(right.internalId || right.id || ''),
                            undefined,
                            { numeric: true, sensitivity: 'base' }
                        )
                    ));
                setRecurringStops(stops);
            } catch (e) {
                toast.error("Could not fetch recurring items.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchRecurring();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <InfoCard compact title="Recurring Service Stops" actions={<Link to={`/company/recurring-service-stops/create/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm">+ Add</Link>}>
            {loading ? <ClipLoader size={20} /> : (
                <ul className="space-y-2">
                    {recurringStops.map(rs => {
                        const status = getRecurringStopStatus(rs);
                        return (
                            <li key={rs.id}>
                                <Link
                                    to={`/company/recurringServiceStop/details/${rs.id}?edit=1`}
                                    className="group block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-bold text-slate-900">{rs.internalId || 'RSS'}</p>
                                                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                                            </div>
                                            <p className="mt-1 truncate text-sm font-medium text-slate-700">
                                                {rs.type || 'Recurring service stop'}
                                            </p>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                                                {getRecurringStopAddress(rs)}
                                            </p>
                                        </div>

                                        <div className="shrink-0 text-left sm:text-right">
                                            <p className="text-sm font-semibold text-slate-900">{rs.frequency || '—'}</p>
                                            <p className="mt-1 text-xs text-slate-500">{formatRecurringDays(rs)}</p>
                                        </div>
                                    </div>

                                    <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-2 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-xs text-slate-500">
                                            <span className="font-semibold text-slate-600">Tech:</span> {rs.tech || 'Unassigned'}
                                            {rs.startDate ? ` • Starts ${formatDateValue(rs.startDate)}` : ''}
                                        </p>
                                        <span className="inline-flex items-center gap-1 self-start rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition group-hover:bg-blue-700 sm:self-auto">
                                            <PencilSquareIcon className="h-4 w-4" />
                                            Edit RSS
                                        </span>
                                    </div>
                                </Link>
                            </li>
                        );
                    })}
                    {recurringStops.length === 0 && <p className="text-gray-500">None found.</p>}
                </ul>
            )}
        </InfoCard>
    );
};

const WorkOrdersTab = ({ customer }) => {
    const [workOrders, setWorkOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchWorkOrders = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, 'companies', recentlySelectedCompany, 'workOrders'), where("customerId", "==", customer.id));
                const snapshot = await getDocs(q);
                setWorkOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                toast.error("Failed to fetch work orders.");
            } finally {
                setLoading(false);
            }
        };
        if (customer.id && recentlySelectedCompany) {
            fetchWorkOrders();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    return (
        <InfoCard compact title="Jobs" actions={<Link to={`/company/jobs/createNew/${customer.id}`} className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm">+ Add</Link>}>
            {loading ? <ClipLoader size={20} /> : (
                <ul className="divide-y divide-gray-200">
                    {workOrders.map(order => (
                        <li key={order.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-800">{order.description || order.type || 'Job'}</p>
                                <p className="text-xs text-gray-600">Status: {order.operationStatus || 'Open'}</p>
                            </div>
                            <Link to={`/company/jobs/detail/${order.id}`} className="shrink-0 text-xs font-semibold text-blue-600 hover:underline">View Details</Link>
                        </li>
                    ))}
                    {workOrders.length === 0 && <p className="text-gray-500">No jobs found.</p>}
                </ul>
            )}
        </InfoCard>
    );
};

const RepairRequestsSection = ({ customer }) => {
    const [internalRepairRequests, setInternalRepairRequests] = useState([]);
    const [externalRepairRequests, setExternalRepairRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchRepairRequests = async () => {
            setLoading(true);
            try {
                const internalResults = await fetchInternalRepairRequests();
                const externalResults = await fetchExternalRepairRequests();

                setInternalRepairRequests(internalResults || []);
                setExternalRepairRequests(externalResults || []);
            } catch (error) {
                toast.error('Failed to fetch repair requests.');
            } finally {
                setLoading(false);
            }
        };

        if (customer.id && recentlySelectedCompany) {
            fetchRepairRequests();
        }
    }, [customer.id, recentlySelectedCompany, db]);

    const fetchInternalRepairRequests = async () => {

        const requestsQuery = query(collection(db, 'companies', recentlySelectedCompany, 'repairRequests'), where("customerId", "==", customer.id));
        const requestsSnapshot = await getDocs(requestsQuery);

        const allRequests = requestsSnapshot.docs.map((requestDoc) => {
            const request = RepairRequest.fromFirestore(requestDoc);
            return { ...request, id: request.id || requestDoc.id };
        });

        // TODO: add your internal repair request query here
        return allRequests;
    };

    const fetchExternalRepairRequests = async () => {
        const requests = [
            getDocs(query(
                collection(db, 'homeownerRepairRequests'),
                where("companyId", "==", recentlySelectedCompany),
                where("customerId", "==", customer.id)
            )),
            customer.userId
                ? getDocs(query(
                    collection(db, 'homeownerRepairRequests'),
                    where("companyId", "==", recentlySelectedCompany),
                    where("userId", "==", customer.userId)
                ))
                : Promise.resolve({ docs: [] }),
            customer.userId
                ? getDocs(query(
                    collection(db, 'homeownerRepairRequests'),
                    where("companyId", "==", recentlySelectedCompany),
                    where("requesterId", "==", customer.userId)
                ))
                : Promise.resolve({ docs: [] }),
        ];

        const snapshots = await Promise.all(requests);

        const customerRequests = uniqueById(
            snapshots
                .flatMap((snapshot) => snapshot.docs)
                .map((requestDoc) => {
                    const request = RepairRequest.fromFirestore(requestDoc);
                    return { ...request, id: request.id || requestDoc.id };
                })
        );

        return customerRequests;
    };

    const renderRequestRow = request => (
        <li key={request.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-800">{request.title || request.description || 'Repair Request'}</p>
                <p className="text-xs text-gray-600">
                    Status: {displayRepairRequestStatus(request.status)}
                </p>
            </div>
            {request.id && (
                <Link
                    to={`/company/repair-requests/detail/${request.id}`}
                    className="shrink-0 text-xs font-semibold text-blue-600 hover:underline"
                >
                    View Details
                </Link>
            )}
        </li>
    );

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <InfoCard
                title="Internal Repair Requests"
                compact
                actions={
                    <Link
                        to={`/company/repair-requests/internal/create/${customer.id}`}
                        className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm"
                    >
                        + Add
                    </Link>
                }
            >
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {internalRepairRequests.map(renderRequestRow)}
                        {internalRepairRequests.length === 0 && <p className="text-gray-500">No internal repair requests found.</p>}
                    </ul>
                )}
            </InfoCard>

            <InfoCard
                title="External Repair Requests"
                compact
                actions={
                    <Link
                        to={`/company/repair-requests/external/create/${customer.id}`}
                        className="text-sm font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-md hover:bg-blue-700 shadow-sm"
                    >
                        + Add
                    </Link>
                }
            >
                {loading ? <ClipLoader size={20} /> : (
                    <ul className="divide-y divide-gray-200">
                        {externalRepairRequests.map(renderRequestRow)}
                        {externalRepairRequests.length === 0 && <p className="text-gray-500">No external repair requests found.</p>}
                    </ul>
                )}
            </InfoCard>
        </div>
    );
};

const OutstandingWorkSection = ({ customer }) => {
    const [outstandingRecords, setOutstandingRecords] = useState([]);
    const [customerJobs, setCustomerJobs] = useState([]);
    const [repairRequests, setRepairRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchOutstandingWork = async () => {
            if (!recentlySelectedCompany || !customer?.id) return;

            setLoading(true);
            try {
                const [recordsSnap, jobsSnap, repairSnap] = await Promise.all([
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'suggestedWork'),
                        where('customerId', '==', customer.id)
                    )),
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'workOrders'),
                        where('customerId', '==', customer.id)
                    )),
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'repairRequests'),
                        where('customerId', '==', customer.id)
                    )),
                ]);

                setOutstandingRecords(recordsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
                setCustomerJobs(jobsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
                setRepairRequests(
                    repairSnap.docs.map((requestDoc) => {
                        const request = RepairRequest.fromFirestore(requestDoc);
                        return { ...request, id: request.id || requestDoc.id };
                    })
                );
            } catch (error) {
                console.error('Failed to fetch outstanding customer work:', error);
                toast.error('Failed to fetch outstanding work.');
                setOutstandingRecords([]);
                setCustomerJobs([]);
                setRepairRequests([]);
            } finally {
                setLoading(false);
            }
        };

        fetchOutstandingWork();
    }, [customer?.id, recentlySelectedCompany, db]);

    const outstandingItems = useMemo(() => {
        const jobsById = new Map(customerJobs.map((job) => [job.id, job]));
        const persistedJobIds = new Set();

        const persistedItems = outstandingRecords
            .filter((record) => isOpenSuggestedWorkStatus(record.status || record.suggestionStatus))
            .filter((record) => {
                const sourceJobId = record.jobId || record.sourceId || record.id;
                if (record.sourceType === 'job' && sourceJobId) persistedJobIds.add(sourceJobId);

                const sourceJob = jobsById.get(sourceJobId);
                return !sourceJob || isCustomerOutstandingJob(sourceJob);
            })
            .map((record) => ({
                id: `suggested-${record.id}`,
                sourceKind: 'suggestedWork',
                sourceLabel: 'Suggested Work',
                title: record.title || record.jobType || record.jobInternalId || 'Suggested work',
                description: record.description || record.note || record.jobDescription || '',
                status: record.status || record.suggestionStatus || 'Open',
                secondaryStatus: `${normalizeSuggestedWorkTier(record.priorityLevel || record.solutionTier)} - ${getSuggestedWorkTierLabel(record.priorityLevel || record.solutionTier)}`,
                secondaryTone: suggestedWorkTierToneFor(record.priorityLevel || record.solutionTier),
                dateValue: record.statusChangedAt || record.updatedAt || record.createdAt || record.statusChangedAtMillis,
                target: record.jobId ? `/company/jobs/detail/${record.jobId}` : '/company/suggested-work',
                bodyOfWaterName: record.bodyOfWaterName || '',
                serviceLocationName: record.serviceLocationName || record.serviceLocationAddress || '',
                raw: record,
            }));

        const liveJobItems = customerJobs
            .filter(isCustomerOutstandingJob)
            .filter((job) => !persistedJobIds.has(job.id))
            .map((job) => ({
                id: `job-${job.id}`,
                sourceKind: 'job',
                sourceLabel: 'Unfinished Job',
                title: job.internalId || job.type || 'Job',
                description: job.description || job.type || '',
                status: job.billingStatus || 'Open',
                secondaryStatus: job.operationStatus || '',
                dateValue: job.dateCreated || job.createdAt || job.updatedAt,
                target: `/company/jobs/detail/${job.id}`,
                bodyOfWaterName: job.bodyOfWaterName || '',
                serviceLocationName: job.serviceLocationName || job.serviceLocationAddress || '',
                raw: job,
            }));

        const repairRequestItems = repairRequests
            .filter((request) => isOpenRepairRequestStatus(request.status))
            .map((request) => ({
                id: `repair-${request.id}`,
                sourceKind: 'repairRequest',
                sourceLabel: 'Repair Request',
                title: request.title || request.description || 'Repair request',
                description: request.description || request.notes || '',
                status: displayRepairRequestStatus(request.status),
                secondaryStatus: '',
                dateValue: request.date || request.createdAt || request.updatedAt,
                target: request.id ? `/company/repair-requests/detail/${request.id}` : '',
                bodyOfWaterName: request.bodyOfWaterName || '',
                serviceLocationName: request.serviceLocationName || '',
                raw: request,
            }));

        return [...persistedItems, ...liveJobItems, ...repairRequestItems]
            .sort((left, right) => getOutstandingWorkMillis(right) - getOutstandingWorkMillis(left));
    }, [customerJobs, outstandingRecords, repairRequests]);

    const sourceCounts = outstandingItems.reduce((counts, item) => {
        counts[item.sourceKind] = (counts[item.sourceKind] || 0) + 1;
        return counts;
    }, {});

    const renderOutstandingItem = (item) => {
        const content = (
            <div className="rounded-md border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-slate-50">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={item.sourceKind === 'repairRequest' ? 'amber' : statusToneFor(item.status)}>
                                {item.sourceLabel}
                            </StatusBadge>
                            <StatusBadge tone={statusToneFor(item.status)}>{item.status || 'Open'}</StatusBadge>
                            {item.secondaryStatus && (
                                <StatusBadge tone={item.secondaryTone || statusToneFor(item.secondaryStatus)}>{item.secondaryStatus}</StatusBadge>
                            )}
                        </div>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{item.title}</p>
                        {(item.bodyOfWaterName || item.serviceLocationName) && (
                            <p className="mt-1 text-xs font-medium text-slate-500">
                                {[item.bodyOfWaterName, item.serviceLocationName].filter(Boolean).join(' - ')}
                            </p>
                        )}
                        {item.description && (
                            <p className="mt-1.5 whitespace-pre-line text-xs text-slate-600 line-clamp-2 sm:text-sm">{item.description}</p>
                        )}
                    </div>
                    <div className="shrink-0 text-left lg:text-right">
                        <p className="text-xs font-semibold text-slate-500">{formatDateValue(item.dateValue)}</p>
                        {item.target && (
                            <span className="mt-2 inline-flex rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                                View
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );

        return (
            <li key={item.id}>
                {item.target ? (
                    <Link to={item.target} className="block">
                        {content}
                    </Link>
                ) : content}
            </li>
        );
    };

    return (
        <InfoCard
            title="Suggested & Outstanding Work"
            compact
            actions={
                <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={outstandingItems.length ? 'amber' : 'emerald'}>
                        {outstandingItems.length} Open
                    </StatusBadge>
                    <StatusBadge>{sourceCounts.suggestedWork || 0} Suggested</StatusBadge>
                    <StatusBadge>{sourceCounts.job || 0} Jobs</StatusBadge>
                    <StatusBadge>{sourceCounts.repairRequest || 0} Repairs</StatusBadge>
                </div>
            }
        >
            {loading ? (
                <div className="flex justify-center py-6">
                    <ClipLoader size={24} />
                </div>
            ) : outstandingItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No suggested or outstanding work is listed for this customer.
                </div>
            ) : (
                <ul className="space-y-2">
                    {outstandingItems.map(renderOutstandingItem)}
                </ul>
            )}
        </InfoCard>
    );
};

const uniqueById = (items) => {
    const records = new Map();
    items.forEach((item) => {
        if (item?.id) records.set(item.id, item);
    });
    return [...records.values()];
};

const fetchCustomerSalesRecords = async ({ db, collectionName, companyId, customer }) => {
    const snapshots = await Promise.all([
        getDocs(query(
            collection(db, collectionName),
            where("companyId", "==", companyId),
            where("customerId", "==", customer.id)
        )),
        customer.userId
            ? getDocs(query(
                collection(db, collectionName),
                where("companyId", "==", companyId),
                where("customerUserId", "==", customer.userId)
            ))
            : Promise.resolve({ docs: [] }),
    ]);

    return uniqueById(
        snapshots
            .flatMap((snapshot) => snapshot.docs)
            .map((record) => ({ id: record.id, ...record.data() }))
    ).sort((left, right) => toMillis(right.updatedAt || right.createdAt || right.sentAt || right.dueDate) - toMillis(left.updatedAt || left.createdAt || left.sentAt || left.dueDate));
};

const SalesRecordList = ({ title, children, empty }) => {
    const visibleChildren = React.Children.toArray(children).filter(Boolean);

    return (
        <div>
            <h4 className="mb-2 text-sm font-bold text-slate-900">{title}</h4>
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {visibleChildren.length > 0 ? visibleChildren : <div className="p-4 text-sm text-slate-500">{empty}</div>}
            </div>
        </div>
    );
};

const SalesActivitySection = ({ customer }) => {
    const [salesData, setSalesData] = useState({
        billingProfiles: [],
        agreements: [],
        invoices: [],
        payments: [],
        subscriptions: [],
    });
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();

    useEffect(() => {
        const fetchSalesActivity = async () => {
            setLoading(true);
            try {
                const [billingProfiles, agreements, invoices, payments, subscriptions] = await Promise.all([
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.billingProfiles, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.agreements, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.invoices, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.payments, companyId: recentlySelectedCompany, customer }),
                    fetchCustomerSalesRecords({ db, collectionName: salesCollectionNames.billingSubscriptions, companyId: recentlySelectedCompany, customer }),
                ]);

                setSalesData({ billingProfiles, agreements, invoices, payments, subscriptions });
            } catch (error) {
                console.error('Failed to fetch customer sales activity', error);
                toast.error('Failed to fetch customer sales activity.');
            } finally {
                setLoading(false);
            }
        };

        if (customer.id && recentlySelectedCompany) fetchSalesActivity();
    }, [customer, recentlySelectedCompany, db]);

    const openInvoiceTotalCents = salesData.invoices
        .filter((invoice) => ['open', 'partiallypaid', 'overdue'].includes(String(invoice.status || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()))
        .reduce((total, invoice) => total + Number(invoice.amountDueCents ?? invoice.totalAmountCents ?? 0), 0);
    const postedPaymentCents = salesData.payments
        .filter((payment) => String(payment.status || '').toLowerCase() === 'posted')
        .reduce((total, payment) => total + Number(payment.amountCents || 0), 0);
    const primaryBillingProfile = salesData.billingProfiles[0];
    const latestAgreements = salesData.agreements.slice(0, 4);
    const latestInvoices = salesData.invoices.slice(0, 4);
    const latestSubscriptions = salesData.subscriptions.slice(0, 3);
    const latestPayments = salesData.payments.slice(0, 4);
    const agreementHistory = useMemo(() => {
        const groupedAgreements = new Map();

        salesData.agreements.forEach((agreement) => {
            const groupId = agreement.agreementHistoryGroupId
                || agreement.supersedesAgreementId
                || agreement.previousAgreementId
                || agreement.id;

            if (!groupedAgreements.has(groupId)) groupedAgreements.set(groupId, []);
            groupedAgreements.get(groupId).push(agreement);
        });

        const history = [];

        groupedAgreements.forEach((groupAgreements) => {
            const sortedAgreements = [...groupAgreements].sort((left, right) => {
                const leftDate = toMillis(left.startDate || left.acceptedAt || left.sentAt || left.createdAt || left.updatedAt);
                const rightDate = toMillis(right.startDate || right.acceptedAt || right.sentAt || right.createdAt || right.updatedAt);
                return leftDate - rightDate;
            });

            sortedAgreements.forEach((agreement, index) => {
                const amountCents = Number(agreement.totalAmountCents ?? agreement.rateAmountCents ?? 0);
                const previousAmountCents = index > 0
                    ? Number(sortedAgreements[index - 1].totalAmountCents ?? sortedAgreements[index - 1].rateAmountCents ?? 0)
                    : null;

                history.push({
                    agreement,
                    amountCents,
                    effectiveAt: agreement.startDate || agreement.acceptedAt || agreement.sentAt || agreement.createdAt || agreement.updatedAt,
                    rateDeltaCents: previousAmountCents === null ? null : amountCents - previousAmountCents,
                });
            });
        });

        return history.sort((left, right) => toMillis(right.effectiveAt) - toMillis(left.effectiveAt));
    }, [salesData.agreements]);

    return (
        <InfoCard title="Sales & Billing">
            {loading ? (
                <ClipLoader size={20} />
            ) : (
                <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Billing Profiles</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{salesData.billingProfiles.length}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agreements</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{salesData.agreements.length}</p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Subscriptions</p>
                            <p className="mt-1 text-base font-bold text-slate-900">{salesData.subscriptions.length}</p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Open AR</p>
                            <p className="mt-1 text-base font-bold">{formatCents(openInvoiceTotalCents)}</p>
                        </div>
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">Posted Payments</p>
                            <p className="mt-1 text-base font-bold">{formatCents(postedPaymentCents)}</p>
                        </div>
                    </div>

                    {primaryBillingProfile && (
                        <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Billing Profile</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{labelize(primaryBillingProfile.status)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Delivery</p>
                                <p className="mt-1 text-sm text-slate-700">{labelize(primaryBillingProfile.invoiceDeliveryMethod)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment Terms</p>
                                <p className="mt-1 text-sm text-slate-700">{labelize(primaryBillingProfile.paymentTerms)}</p>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stripe Customer</p>
                                <p className="mt-1 truncate text-sm text-slate-700">{primaryBillingProfile.stripeCustomerId || 'Not linked'}</p>
                            </div>
                        </div>
                    )}

                    <SalesRecordList title="Service Agreement History" empty="No service agreement history found.">
                        {agreementHistory.map(({ agreement, amountCents, effectiveAt, rateDeltaCents }) => {
                            const statusKey = String(agreement.status || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                            const endLabel = agreement.endDate
                                ? formatDateValue(agreement.endDate)
                                : statusKey === 'accepted'
                                    ? 'Current'
                                    : 'Open';
                            const deltaTone = rateDeltaCents > 0
                                ? 'text-amber-700'
                                : rateDeltaCents < 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-500';

                            return (
                                <Link
                                    key={agreement.id}
                                    to={`/company/sales/agreements/${agreement.id}`}
                                    className="flex flex-col gap-3 p-3 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {agreement.title || 'Service Agreement'}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {formatDateValue(effectiveAt)} - {endLabel} • v{agreement.agreementVersion || 1}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                                        <div className="min-w-[7rem] sm:text-right">
                                            <p className="text-sm font-semibold text-slate-900">{formatCents(amountCents)}</p>
                                            <p className={`mt-0.5 text-xs font-semibold ${deltaTone}`}>
                                                {rateDeltaCents === null ? 'Starting rate' : formatCentsDelta(rateDeltaCents)}
                                            </p>
                                        </div>
                                        <StatusBadge tone={statusToneFor(agreement.status)}>{labelize(agreement.status)}</StatusBadge>
                                    </div>
                                </Link>
                            );
                        })}
                    </SalesRecordList>

                    <div className="grid gap-5 xl:grid-cols-2">
                        <SalesRecordList title="Service Agreements" empty="No service agreements found.">
                            {latestAgreements.length > 0 && <div className="mb-2 flex items-center justify-between gap-3 p-3">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest</span>
                                <Link to="/company/sales/agreements" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                                    View all
                                </Link>
                            </div>}
                            {latestAgreements.length > 0 && latestAgreements.map((agreement) => (
                                <Link
                                    key={agreement.id}
                                    to={`/company/sales/agreements/${agreement.id}`}
                                    className="flex items-center justify-between gap-3 p-3 transition hover:bg-slate-50"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">{agreement.title || 'Service Agreement'}</p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {formatDateValue(agreement.updatedAt || agreement.sentAt || agreement.createdAt)}
                                            {agreement.totalAmountCents ? ` • ${formatCents(agreement.totalAmountCents)}` : ''}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusToneFor(agreement.status)}>{labelize(agreement.status)}</StatusBadge>
                                </Link>
                            ))}
                        </SalesRecordList>

                        <SalesRecordList title="Invoices" empty="No invoices found.">
                            {latestInvoices.length > 0 && latestInvoices.map((invoice) => (
                                <div key={invoice.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {invoice.invoiceNumber || "Invoice"}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            Due {formatDateValue(invoice.dueDate || invoice.dueAt)}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-slate-900">{formatCents(invoice.amountDueCents ?? invoice.totalAmountCents)}</p>
                                        <StatusBadge tone={statusToneFor(invoice.status)}>{labelize(invoice.status)}</StatusBadge>
                                    </div>
                                </div>
                            ))}
                        </SalesRecordList>

                        <SalesRecordList title="Subscriptions" empty="No billing subscriptions found.">
                            {latestSubscriptions.length > 0 && latestSubscriptions.map((subscription) => (
                                <div key={subscription.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {formatCents(subscription.amountCents)} / {subscription.intervalCount > 1 ? `${subscription.intervalCount} ` : ''}{subscription.interval || 'month'}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            Period ends {formatDateValue(subscription.currentPeriodEnd)}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusToneFor(subscription.status)}>{labelize(subscription.status)}</StatusBadge>
                                </div>
                            ))}
                        </SalesRecordList>

                        <SalesRecordList title="Payments" empty="No payments found.">
                            {latestPayments.length > 0 && latestPayments.map((payment) => (
                                <div key={payment.id} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {formatCents(payment.amountCents)} via {labelize(payment.method)}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {formatDateValue(payment.receivedAt || payment.createdAt)}
                                            {payment.referenceNumber ? ` • Ref ${payment.referenceNumber}` : ''}
                                        </p>
                                    </div>
                                    <StatusBadge tone={statusToneFor(payment.status)}>{labelize(payment.status)}</StatusBadge>
                                </div>
                            ))}
                        </SalesRecordList>
                    </div>
                </div>
            )}
        </InfoCard>
    );
};

// Operations Tab
const OperationsTab = ({ customer, onNewPartApproval }) => {
    return (
        <div className="space-y-4 sm:space-y-6">
            <OutstandingWorkSection customer={customer} />
            <InfoCard
                title="Part Approvals"
                compact
                actions={
                    <button
                        type="button"
                        onClick={onNewPartApproval}
                        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                        <PlusIcon className="h-4 w-4" />
                        New Part Approval
                    </button>
                }
            >
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="rounded-md bg-white p-1.5 text-slate-600 shadow-sm">
                            <WrenchScrewdriverIcon className="h-4 w-4" />
                        </span>
                        <div>
                            <p className="text-sm font-semibold text-slate-950">Customer part requests</p>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-600 sm:text-sm">
                                Approved parts move into the shopping list, then can be installed and invoiced from the part approvals queue.
                            </p>
                        </div>
                    </div>
                    <Link
                        to="/company/part-approvals"
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                        Open Queue
                    </Link>
                </div>
            </InfoCard>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <RecurringTab customer={customer} />
                <WorkOrdersTab customer={customer} />
            </div>
            <RepairRequestsSection customer={customer} />
        </div>
    );
};

// History Tab
const HistoryTab = ({ customer }) => {
    const defaultHistoryDateRange = useMemo(() => getDefaultHistoryDateRange(), []);
    const [timeline, setTimeline] = useState([]);
    const [expiredJobs, setExpiredJobs] = useState([]);
    const [bodyOfWaterOptions, setBodyOfWaterOptions] = useState([]);
    const [activeBodyOfWaterId, setActiveBodyOfWaterId] = useState('all');
    const [activeTimelineFilter, setActiveTimelineFilter] = useState('all');
    const [timelineViewMode, setTimelineViewMode] = useState('timeline');
    const [showAllTimelineEvents, setShowAllTimelineEvents] = useState(false);
    const [timelineListLimit, setTimelineListLimit] = useState(TIMELINE_LIST_PAGE_SIZE);
    const [timelineExpanded, setTimelineExpanded] = useState(false);
    const [timelineRange, setTimelineRange] = useState(defaultHistoryDateRange);
    const [loading, setLoading] = useState(true);
    const { recentlySelectedCompany } = useContext(Context);
    const db = getFirestore();
    const selectedFilter = timelineFilters.find((filter) => filter.id === activeTimelineFilter) || timelineFilters[0];
    const selectedBodyOfWater = bodyOfWaterOptions.find((body) => body.id === activeBodyOfWaterId);
    const bodyOfWaterScopedTimeline = activeBodyOfWaterId === 'all'
        ? timeline
        : timeline.filter((event) => (
            event.bodyOfWaterId === activeBodyOfWaterId ||
            (event.type === 'note' && !event.bodyOfWaterId)
        ));
    const dateScopedTimeline = bodyOfWaterScopedTimeline.filter((event) => isWithinDateRange(event.date, timelineRange));
    const timelineEventsForView = timelineViewMode === 'list' ? bodyOfWaterScopedTimeline : dateScopedTimeline;
    const visibleTimeline = selectedFilter.id === 'all'
        ? timelineEventsForView
        : timelineEventsForView.filter((event) => selectedFilter.types.includes(event.type));
    const equipmentReadingTimeline = dateScopedTimeline.filter((event) => event.type === 'equipmentReading');
    const dateScopedExpiredJobs = expiredJobs.filter((expiredJob) => (
        isWithinDateRange(expiredJob.expiredAt || expiredJob.updatedAt || expiredJob.expiredAtMillis, timelineRange)
    ));

    useEffect(() => {
        const fetchTimeline = async () => {
            setLoading(true);
            try {
                const [events, bodyOfWaterSnapshot, expiredJobsSnapshot] = await Promise.all([
                    loadCustomerTimeline({
                        db,
                        companyId: recentlySelectedCompany,
                        customerId: customer.id,
                    }),
                    getDocs(query(
                        collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),
                        where("customerId", "==", customer.id)
                    )),
                    getDocs(collection(db, 'companies', recentlySelectedCompany, 'customers', customer.id, 'expiredJobs')),
                ]);
                const profileNoteEvent = buildCustomerProfileNoteEvent(customer);
                setTimeline(
                    [...events, profileNoteEvent]
                        .filter(Boolean)
                        .sort((left, right) => toMillis(right.date) - toMillis(left.date))
                );
                setBodyOfWaterOptions(bodyOfWaterSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                setExpiredJobs(
                    expiredJobsSnapshot.docs
                        .map((item) => ({ id: item.id, ...item.data() }))
                        .sort((a, b) => toMillis(b.expiredAt || b.updatedAt || b.expiredAtMillis) - toMillis(a.expiredAt || a.updatedAt || a.expiredAtMillis))
                );
            } catch (error) {
                console.error(error);
                toast.error("Failed to fetch customer timeline.");
            } finally {
                setLoading(false);
            }
        };
        if (customer && recentlySelectedCompany) {
            fetchTimeline();
        }
    }, [customer, recentlySelectedCompany, db]);

    useEffect(() => {
        setShowAllTimelineEvents(false);
        setTimelineListLimit(TIMELINE_LIST_PAGE_SIZE);
    }, [
        activeTimelineFilter,
        activeBodyOfWaterId,
        timeline.length,
        timelineRange.end,
        timelineRange.invalid,
        timelineRange.start,
        timelineViewMode,
    ]);

    useEffect(() => {
        if (activeBodyOfWaterId !== 'all' && !bodyOfWaterOptions.some((body) => body.id === activeBodyOfWaterId)) {
            setActiveBodyOfWaterId('all');
        }
    }, [activeBodyOfWaterId, bodyOfWaterOptions]);

    useEffect(() => {
        if (!timelineExpanded) return undefined;

        const originalOverflow = document.body.style.overflow;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') setTimelineExpanded(false);
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', closeOnEscape);

        return () => {
            document.body.style.overflow = originalOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [timelineExpanded]);

    const renderTimelineControls = () => (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex w-fit overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                {timelineViewOptions.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTimelineViewMode(id)}
                        className={[
                            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                            timelineViewMode === id
                                ? "bg-slate-900 text-white shadow-sm"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                        ].join(" ")}
                    >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {label}
                    </button>
                ))}
            </div>

            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                {timelineFilters.map((filter) => (
                    <button
                        key={filter.id}
                        type="button"
                        onClick={() => setActiveTimelineFilter(filter.id)}
                        className={[
                            "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                            activeTimelineFilter === filter.id
                                ? "bg-slate-100 text-slate-900 shadow-sm"
                                : "text-slate-600 hover:text-slate-900",
                        ].join(" ")}
                    >
                        {filter.label}
                    </button>
                ))}
            </div>
        </div>
    );

    const renderTimelineEvents = (isExpanded = false) => {
        if (visibleTimeline.length === 0) {
            const rangeText = timelineViewMode === 'timeline' ? ' in this date range' : '';

            return (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    No {selectedFilter.label.toLowerCase()} timeline events found{rangeText}{selectedBodyOfWater ? ` for ${selectedBodyOfWater.name || "this body of water"}` : ""}.
                </div>
            );
        }

        if (timelineViewMode === 'list') {
            const eventsToDisplay = visibleTimeline.slice(0, timelineListLimit);
            const hiddenCount = visibleTimeline.length - eventsToDisplay.length;

            return (
                <div className={isExpanded ? "space-y-3 pb-6" : "space-y-3"}>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Showing {eventsToDisplay.length} of {visibleTimeline.length} events
                        </p>
                    </div>
                    <TimelineEventTable events={eventsToDisplay} />
                    {hiddenCount > 0 && (
                        <div className="flex justify-center">
                            <button
                                type="button"
                                onClick={() => setTimelineListLimit((current) => current + TIMELINE_LIST_PAGE_SIZE)}
                                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                                Show more
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        const eventsToDisplay = isExpanded || showAllTimelineEvents ? visibleTimeline : visibleTimeline.slice(0, 5);
        const hiddenCount = visibleTimeline.length - eventsToDisplay.length;

        return (
            <div className="space-y-4">
                <ol className="relative space-y-5 before:absolute before:left-[13px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200">
                    {eventsToDisplay.map((event) => (
                        <li key={event.id}>
                            <TimelineEventCard event={event} />
                        </li>
                    ))}
                </ol>
                {hiddenCount > 0 && (
                    <div className="flex justify-center">
                        <button
                            type="button"
                            onClick={() => setShowAllTimelineEvents(true)}
                            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            Show more
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderTimelineContent = (isExpanded = false) => {
        if (loading) {
            return (
                <div className="flex justify-center py-8">
                    <ClipLoader size={30} />
                </div>
            );
        }

        if (timeline.length === 0) {
            return (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                    No service, job, note, chemistry, equipment, or water history found yet.
                </div>
            );
        }

        return (
            <div className="space-y-6">
                {renderTimelineControls()}
                {timelineViewMode === 'timeline' && (
                    <CustomerTimelineGraph
                        timeline={bodyOfWaterScopedTimeline}
                        defaultRange={defaultHistoryDateRange}
                        onRangeChange={setTimelineRange}
                    />
                )}
                {renderTimelineEvents(isExpanded)}
            </div>
        );
    };

    const timelineCardActions = !loading && timeline.length > 0 ? (
        <button
            type="button"
            onClick={() => setTimelineExpanded(true)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
            <ArrowsPointingOutIcon className="h-4 w-4" aria-hidden="true" />
            Expand Timeline
        </button>
    ) : null;

    return (
        <div className="space-y-8">
            {!loading && bodyOfWaterOptions.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <label htmlFor="customer-history-body-water" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        History Scope
                    </label>
                    <select
                        id="customer-history-body-water"
                        value={activeBodyOfWaterId}
                        onChange={(event) => setActiveBodyOfWaterId(event.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 sm:w-64"
                    >
                        <option value="all">All customer information</option>
                        {bodyOfWaterOptions.map((body) => (
                            <option key={body.id} value={body.id}>
                                {body.name || body.type || "Unnamed Body of Water"}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {!loading && equipmentReadingTimeline.length > 0 && (
                <InfoCard title="Equipment Readings">
                    <ul className="divide-y divide-slate-200">
                        {equipmentReadingTimeline.slice(0, 8).map((event) => (
                            <li key={event.id} className="py-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-900">{event.equipmentName || event.title}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {[event.detail || "Reading captured", event.subtitle].filter(Boolean).join(" • ")}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                                        {format(event.date, 'MMM d, yyyy')}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </InfoCard>
            )}

            <InfoCard
                title="Customer Timeline"
                actions={timelineCardActions}
            >
                {renderTimelineContent(false)}
            </InfoCard>

            {timelineExpanded && (
                <section className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white p-4">
                    <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-slate-950">Customer Timeline</h2>
                            <p className="mt-1 truncate text-sm text-slate-500">{getCustomerName(customer) || 'Customer'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setTimelineExpanded(false)}
                                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                                <ArrowsPointingInIcon className="h-4 w-4" aria-hidden="true" />
                                Exit Full Screen
                            </button>
                            <button
                                type="button"
                                onClick={() => setTimelineExpanded(false)}
                                aria-label="Close customer timeline"
                                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                            >
                                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto py-5 pr-1">
                        {renderTimelineContent(true)}
                    </div>
                </section>
            )}
            <InfoCard title="Expired Jobs">
                {loading ? (
                    <div className="flex justify-center py-6">
                        <ClipLoader size={24} />
                    </div>
                ) : dateScopedExpiredJobs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                        No expired jobs recorded in this date range.
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-200">
                        {dateScopedExpiredJobs.map((expiredJob) => {
                            const title = expiredJob.title || `Expired job: ${expiredJob.jobInternalId || expiredJob.jobType || expiredJob.jobId || 'Work order'}`;
                            const details = [
                                expiredJob.jobInternalId,
                                expiredJob.serviceLocationName || expiredJob.serviceLocationAddress,
                                expiredJob.previousBillingStatus ? `${expiredJob.previousBillingStatus} -> Expired` : 'Expired',
                                expiredJob.jobRateCents ? formatCents(expiredJob.jobRateCents) : '',
                            ].filter(Boolean);

                            return (
                                <li key={expiredJob.id || expiredJob.jobId} className="py-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-semibold text-slate-900">{title}</p>
                                                <StatusBadge tone="rose">Expired</StatusBadge>
                                            </div>
                                            {details.length > 0 && (
                                                <p className="mt-1 text-xs font-medium text-slate-500">{details.join(' • ')}</p>
                                            )}
                                            {expiredJob.note && (
                                                <p className="mt-2 whitespace-pre-line text-sm text-slate-600 line-clamp-4">{expiredJob.note}</p>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 flex-col gap-2 text-left lg:items-end lg:text-right">
                                            <span className="text-xs font-semibold text-slate-500">
                                                {formatDateValue(expiredJob.expiredAt || expiredJob.updatedAt || expiredJob.expiredAtMillis)}
                                            </span>
                                            {expiredJob.jobId && (
                                                <Link
                                                    to={`/company/jobs/detail/${expiredJob.jobId}`}
                                                    className="inline-flex justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                                >
                                                    View Job
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </InfoCard>
            <LeadsTab customer={customer} />
        </div>
    );
};

// Main Component
export default function CustomerDetails() {
    const { customerId, tab } = useParams();
    const navigate = useNavigate();
    const {
        recentlySelectedCompany,
        companyRole,
        companyUserAccess,
        selectedCustomerRegionTag,
        companyRoleLoading,
        featureFlagsLoaded,
        isFeatureEnabled,
        user,
        dataBaseUser,
    } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();

    const getInitialTab = useCallback((tabValue) => {
        return validCustomerTabs.includes(tabValue) ? tabValue : 'profile';
    }, []);

    const [customer, setCustomer] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(getInitialTab(tab));
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showInactiveModal, setShowInactiveModal] = useState(false);
    const [showPartApprovalModal, setShowPartApprovalModal] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [customerInviteLink, setCustomerInviteLink] = useState('');
    const [creatingInviteLink, setCreatingInviteLink] = useState(false);
    const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);

    useEffect(() => {
        setActiveTab(getInitialTab(tab));
    }, [tab, getInitialTab]);

    useEffect(() => {
        if (!customerId || !recentlySelectedCompany || companyRoleLoading) return;
        const fetchCustomer = async () => {
            setLoading(true);
            setAccessDenied(false);
            try {
                console.debug('[CustomerDetails] Fetching customer detail', {
                    companyId: recentlySelectedCompany,
                    customerId,
                });

                const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customerId);
                const docSnap = await getDoc(customerRef);
                if (docSnap.exists()) {
                    const customerData = docSnap.data();
                    const nextCustomer = {
                        ...customerData,
                        ...normalizeCustomerForFirestore({ id: docSnap.id, ...customerData }),
                        id: docSnap.id,
                    };
                    const linkedCustomerUserId = getLinkedCustomerUserId(customerData);
                    if (linkedCustomerUserId) {
                        nextCustomer.userId = linkedCustomerUserId;
                    }

                    if (!customerMatchesRegionalAccess(nextCustomer, {
                        userAccess: companyUserAccess,
                        role: companyRole,
                        selectedRegionTag: selectedCustomerRegionTag,
                        regionalAccessEnabled: customerAreaFilteringEnabled,
                    })) {
                        console.warn('[CustomerDetails] Customer hidden by regional customer tag access', {
                            companyId: recentlySelectedCompany,
                            customerId,
                            customerTags: nextCustomer.tags || [],
                            regionalCustomerTags: companyUserAccess?.customerRegionTags || companyRole?.customerTags || companyRole?.allowedCustomerTags || [],
                            selectedCustomerRegionTag,
                        });
                        setCustomer(null);
                        setAccessDenied(true);
                        return;
                    }

                    // Top-level users are self-readable only in Firestore rules; use link fields stored on the customer instead.
                    setCustomer(nextCustomer);
                    setCustomerInviteLink(nextCustomer.customerAccountInviteUrl || '');
                } else {
                    console.warn('[CustomerDetails] Customer document not found', {
                        companyId: recentlySelectedCompany,
                        customerId,
                    });
                    toast.error('Customer not found.');
                }
            } catch (error) {
                console.error('[CustomerDetails] Failed to fetch customer data', {
                    companyId: recentlySelectedCompany,
                    customerId,
                    code: error?.code,
                    message: error?.message,
                }, error);
                toast.error("Failed to fetch customer data.");
            } finally {
                setLoading(false);
            }
        };
        fetchCustomer();
    }, [customerId, recentlySelectedCompany, db, companyUserAccess, companyRole, selectedCustomerRegionTag, customerAreaFilteringEnabled, companyRoleLoading]);

    useEffect(() => {
        if (!tab || !validCustomerTabs.includes(tab)) {
            navigate(`/company/customers/details/${customerId}/profile`, { replace: true });
        }
    }, [tab, customerId, navigate]);

    const handleTabChange = (nextTab) => {
        setActiveTab(nextTab);
        navigate(`/company/customers/details/${customerId}/${nextTab}`);
    };

    const uniqueDocsByPath = (docs) => Array.from(
        new Map(docs.map((documentSnapshot) => [documentSnapshot.ref.path, documentSnapshot])).values()
    );

    const deactivateCustomerRelations = async () => {
        if (!recentlySelectedCompany || !customerId) {
            return { serviceLocations: 0, bodiesOfWater: 0, equipment: 0 };
        }

        const serviceLocationsSnapshot = await getDocs(query(
            collection(db, 'companies', recentlySelectedCompany, 'serviceLocations'),
            where('customerId', '==', customerId)
        ));
        const serviceLocationDocs = serviceLocationsSnapshot.docs;
        const serviceLocationIds = serviceLocationDocs.map((locationDoc) => locationDoc.id);

        const [bodiesByCustomerSnapshot, equipmentByCustomerSnapshot] = await Promise.all([
            getDocs(query(
                collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),
                where('customerId', '==', customerId)
            )),
            getDocs(query(
                collection(db, 'companies', recentlySelectedCompany, 'equipment'),
                where('customerId', '==', customerId)
            )),
        ]);

        const [bodiesByLocationSnapshots, equipmentByLocationSnapshots] = await Promise.all([
            Promise.all(serviceLocationIds.map((locationId) => getDocs(query(
                collection(db, 'companies', recentlySelectedCompany, 'bodiesOfWater'),
                where('serviceLocationId', '==', locationId)
            )))),
            Promise.all(serviceLocationIds.map((locationId) => getDocs(query(
                collection(db, 'companies', recentlySelectedCompany, 'equipment'),
                where('serviceLocationId', '==', locationId)
            )))),
        ]);

        const bodyOfWaterDocs = uniqueDocsByPath([
            ...bodiesByCustomerSnapshot.docs,
            ...bodiesByLocationSnapshots.flatMap((snapshot) => snapshot.docs),
        ]);
        const equipmentDocs = uniqueDocsByPath([
            ...equipmentByCustomerSnapshot.docs,
            ...equipmentByLocationSnapshots.flatMap((snapshot) => snapshot.docs),
        ]);

        await Promise.all([
            ...serviceLocationDocs.map((locationDoc) => updateDoc(locationDoc.ref, { isActive: false, active: false })),
            ...bodyOfWaterDocs.map((bodyDoc) => updateDoc(bodyDoc.ref, { isActive: false })),
            ...equipmentDocs.map((equipmentDoc) => updateDoc(equipmentDoc.ref, { isActive: false, active: false })),
        ]);

        return {
            serviceLocations: serviceLocationDocs.length,
            bodiesOfWater: bodyOfWaterDocs.length,
            equipment: equipmentDocs.length,
        };
    };

    const handleDeleteCustomer = async () => {
        if (!requirePermission("16", "delete customers")) return;

        try {
            const result = await deleteCustomerCascade({
                db,
                companyId: recentlySelectedCompany,
                customerId,
            });

            toast.success(`Customer and ${Math.max(result.totalDeleted - 1, 0)} associated record(s) deleted.`);
            navigate('/company/customers');
        } catch (error) {
            toast.error('Failed to delete customer.');
            console.error("Deletion error: ", error);
        } finally {
            setShowDeleteModal(false);
        }
    };

    const handleUpdateCustomerStatus = async (nextActive) => {
        if (!requirePermission("14", "update customers")) return;
        if (!recentlySelectedCompany || !customerId) return;

        try {
            const customerRef = doc(db, 'companies', recentlySelectedCompany, 'customers', customerId);
            await updateDoc(customerRef, { active: nextActive, isActive: nextActive });

            const inactiveCascadeCounts = !nextActive ? await deactivateCustomerRelations() : null;
            const pipelineRowsEnded = !nextActive
                ? await endCustomerPipelineRowsForInactiveCustomer({
                    companyId: recentlySelectedCompany,
                    customerId,
                    reason: 'Customer marked inactive',
                    actorId: user?.uid || '',
                    actorName: `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() || user?.displayName || user?.email || '',
                })
                : 0;

            toast.success(
                inactiveCascadeCounts
                    ? `Customer marked inactive. ${inactiveCascadeCounts.serviceLocations} service locations, ${inactiveCascadeCounts.bodiesOfWater} bodies of water, ${inactiveCascadeCounts.equipment} equipment records, and ${pipelineRowsEnded} pipeline row(s) were ended.`
                    : `Customer has been marked as ${nextActive ? 'active' : 'inactive'}.`
            );
            setCustomer(prev => ({ ...prev, active: nextActive, isActive: nextActive })); // Update local state
        } catch (error) {
            toast.error('Failed to update customer status.');
        } finally {
            setShowInactiveModal(false);
        }
    };

    const handleCreateCustomerInviteLink = async () => {
        if (!requirePermission("14", "create customer invite links")) return;
        if (!recentlySelectedCompany || !customerId) return;

        setCreatingInviteLink(true);

        try {
            const callable = httpsCallable(functions, 'createCustomerAccountInvite');
            const authPayload = await getCallableAuthPayload();
            const result = await callable({
                ...authPayload,
                auth: authPayload,
                companyId: recentlySelectedCompany,
                customerId,
                baseUrl: window.location.origin,
                email: customer.email || '',
            });
            const response = result.data || {};

            if (response.status !== 200) {
                throw new Error(response.error || 'Could not create customer invite link.');
            }

            const inviteUrl = response.inviteUrl || response.claimAccountUrl || '';
            setCustomerInviteLink(inviteUrl);
            setCustomer((prev) => ({
                ...prev,
                linkedInviteId: response.inviteId || prev.linkedInviteId || '',
                customerAccountInviteId: response.inviteId || prev.customerAccountInviteId || '',
                customerAccountInviteUrl: inviteUrl,
                customerAccountInviteStatus: 'pending',
            }));

            if (inviteUrl) {
                await navigator.clipboard.writeText(inviteUrl);
                toast.success('Client invite link copied.');
            } else {
                toast.success('Client invite link created.');
            }
        } catch (error) {
            console.error('Failed to create customer invite link', error);
            toast.error(error.message || 'Could not create customer invite link.');
        } finally {
            setCreatingInviteLink(false);
        }
    };

    if (loading || companyRoleLoading) {
        return <div className="flex justify-center items-center h-screen"><ClipLoader size={50} /></div>;
    }

    if (accessDenied) {
        const allowedTags = getCustomerRegionAccessTags({ userAccess: companyUserAccess, role: companyRole });
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
                    <h1 className="text-lg font-bold text-slate-900">Customer access restricted</h1>
                    <p className="mt-2 text-sm text-slate-600">
                        Your access can only view customers tagged {allowedTags.join(', ') || 'by your assigned customer areas'}.
                        {selectedCustomerRegionTag ? ` The current header area filter is ${selectedCustomerRegionTag}.` : ''}
                    </p>
                    <Link
                        to="/company/customers"
                        className="mt-4 inline-flex text-sm font-semibold text-slate-600 hover:text-slate-900"
                    >
                        &larr; Back to Customers
                    </Link>
                </div>
            </div>
        );
    }

    if (!customer) {
        return <div className="text-center p-12">Customer not found.</div>;
    }

    const customerName = getCustomerName(customer) || 'Customer';
    const selectedSection = customerSections.find((section) => section.id === activeTab) || customerSections[0];
    const billingAddress = [
        customer.billingAddress?.streetAddress || customer.billingStreetAddress,
        customer.billingAddress?.city || customer.billingCity,
        customer.billingAddress?.state || customer.billingState,
        customer.billingAddress?.zip || customer.billingZip,
    ].filter(Boolean).join(', ');

    const ModalShell = ({ title, children, onClose, footer }) => (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-xl">
                <div className="flex items-start justify-between gap-3 mb-5">
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">{title}</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="h-10 w-10 rounded-xl bg-gray-100 hover:bg-gray-200 transition flex items-center justify-center text-gray-700"
                        aria-label="Close"
                        type="button"
                    >
                        ✕
                    </button>
                </div>
                <div className="text-gray-700">{children}</div>
                {footer && <div className="mt-6 pt-6 border-t border-gray-200">{footer}</div>}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 px-2 py-4 text-slate-900 sm:px-3 sm:py-6 lg:px-4">
            <div className="w-full space-y-4 sm:space-y-6">
                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Link
                                    to="/company/customers"
                                    className="app-back-link"
                                >
                                    &larr; Back to Customers
                                </Link>
                                <StatusBadge tone={customer.active ? 'emerald' : 'rose'}>
                                    {customer.active ? 'Active' : 'Inactive'}
                                </StatusBadge>
                                {customer.userId ? (
                                    <StatusBadge tone="blue">Homeowner Account Linked</StatusBadge>
                                ) : (
                                    <StatusBadge>No Homeowner Account</StatusBadge>
                                )}
                                {normalizeCustomerTags(customer.tags).map((tag) => (
                                    <StatusBadge key={tag}>{tag}</StatusBadge>
                                ))}
                            </div>
                            <h1 className="mt-3 text-2xl font-bold text-slate-950 sm:text-3xl">{customerName}</h1>
                            <p className="mt-2 max-w-3xl text-sm text-slate-600">
                                {[customer.email, customer.phoneNumber].filter(Boolean).join(' · ') || 'No contact details saved'}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <ShareItemButton
                                type="customer"
                                recordId={customerId}
                                title={customerName}
                                subtitle={[customer.email, customer.phoneNumber].filter(Boolean).join(' - ')}
                                companyId={recentlySelectedCompany}
                                customerId={customerId}
                                customerUserId={customer.userId}
                                collectionPath={`companies/${recentlySelectedCompany}/customers`}
                                webPath={`/company/customers/details/${customerId}`}
                            />
                            {can("12") && (
                                <Link
                                    to={`/company/customers/duplicate/${customer.id}`}
                                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                    <DocumentDuplicateIcon className="h-4 w-4" />
                                    Duplicate
                                </Link>
                            )}
                            {can("14") && !customer.userId && (
                                <button
                                    onClick={handleCreateCustomerInviteLink}
                                    disabled={creatingInviteLink}
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <ClipboardDocumentIcon className="h-4 w-4" />
                                    {creatingInviteLink
                                        ? 'Creating...'
                                        : customerInviteLink
                                            ? 'Copy Client Invite'
                                            : 'Create Client Invite'}
                                </button>
                            )}
                            {can("14") && (
                                <button
                                    onClick={() => setShowInactiveModal(true)}
                                    type="button"
                                    className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${customer.active
                                        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                        }`}
                                >
                                    {customer.active ? 'Make Inactive' : 'Make Active'}
                                </button>
                            )}

                        </div>
                    </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
                    <aside className="space-y-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Sections</h2>
                            <div className="mt-3 space-y-2">
                                {customerSections.map((section) => {
                                    const active = section.id === activeTab;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => handleTabChange(section.id)}
                                            className={[
                                                "w-full rounded-md border px-3 py-2 text-left transition",
                                                active
                                                    ? "border-blue-200 bg-blue-50 text-blue-800"
                                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                            ].join(" ")}
                                        >
                                            <span className="text-sm font-semibold">{section.label}</span>
                                            <span className="mt-1 block text-xs text-slate-500">{section.helper}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm sm:p-4">
                            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Customer Snapshot</h2>
                            <dl className="mt-3 space-y-3">
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Reference</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">
                                        {customer.internalId || customer.company || customer.displayName || customer.email || "Customer"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
                                    <dd className="mt-1 break-all text-slate-700">{customer.email || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client Invite</dt>
                                    <dd className="mt-1">
                                        {customerInviteLink ? (
                                            <a
                                                href={customerInviteLink}
                                                className="inline-flex max-w-full items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                <EnvelopeIcon className="h-4 w-4 flex-none" />
                                                <span className="truncate">Open invite landing page</span>
                                            </a>
                                        ) : (
                                            <span className="text-slate-500">Not created</span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
                                    <dd className="mt-1 text-slate-700">{customer.phoneNumber || "Not set"}</dd>
                                </div>
                                <div className="border-t border-slate-200 pt-3">
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Address</dt>
                                    <dd className="mt-1 text-slate-700">{billingAddress || "Not set"}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tags</dt>
                                    <dd className="mt-1 flex flex-wrap gap-1.5">
                                        {normalizeCustomerTags(customer.tags).length > 0 ? (
                                            normalizeCustomerTags(customer.tags).map((tag) => (
                                                <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                                    {tag}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-slate-500">No tags</span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current View</dt>
                                    <dd className="mt-1 font-semibold text-slate-900">{selectedSection.label}</dd>
                                </div>
                            </dl>
                        </div>

                        <CustomerNotesSection customer={customer} compact />
                    </aside>

                    <main className="min-w-0 space-y-4 sm:space-y-6">
                        {activeTab === 'profile' && (
                            <ProfileTab
                                customer={customer}
                                onCustomerUpdate={(updates) => setCustomer((prev) => ({ ...prev, ...updates }))}
                                onDeleteCustomer={() => setShowDeleteModal(true)}
                                onCustomerInactiveCascade={deactivateCustomerRelations}
                            />
                        )}
                        {activeTab === 'locations' && <ServiceLocationsTab customer={customer} />}
                        {activeTab === 'operations' && (
                            <OperationsTab
                                customer={customer}
                                onNewPartApproval={() => setShowPartApprovalModal(true)}
                            />
                        )}
                        {activeTab === 'history' && <HistoryTab customer={customer} />}
                    </main>
                </section>
            </div>

            <PartApprovalCreateModal
                open={showPartApprovalModal}
                onClose={() => setShowPartApprovalModal(false)}
                fixedCustomer={customer}
            />

            {showDeleteModal && (
                <ModalShell
                    title="Delete Customer"
                    onClose={() => setShowDeleteModal(false)}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowDeleteModal(false)} className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition" type="button">
                                Cancel
                            </button>
                            <button onClick={handleDeleteCustomer} className="py-2 px-5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition" type="button">
                                Delete
                            </button>
                        </div>
                    }
                >
                    <p>Are you sure you want to permanently delete this customer and all of their associated data? This action cannot be undone.</p>
                </ModalShell>
            )}

            {showInactiveModal && (
                <ModalShell
                    title={customer.active ? 'Make Customer Inactive' : 'Make Customer Active'}
                    onClose={() => setShowInactiveModal(false)}
                    footer={
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowInactiveModal(false)} className="py-2 px-5 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition" type="button">
                                Cancel
                            </button>
                            <button
                                onClick={() => handleUpdateCustomerStatus(!customer.active)}
                                className={`py-2 px-5 text-white font-semibold rounded-lg transition ${customer.active
                                    ? 'bg-amber-600 hover:bg-amber-700'
                                    : 'bg-emerald-600 hover:bg-emerald-700'
                                    }`}
                                type="button"
                            >
                                Confirm
                            </button>
                        </div>
                    }
                >
                    <p>
                        Are you sure you want to mark this customer as {customer.active ? 'inactive' : 'active'}?
                        {customer.active ? ' This will not delete their data. Linked service locations, bodies of water, and equipment will also be marked inactive.' : ' They will appear in active customer views again.'}
                    </p>
                </ModalShell>
            )}
        </div>
    );
}
