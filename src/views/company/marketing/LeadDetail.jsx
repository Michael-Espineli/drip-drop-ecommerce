import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    getFirestore,
    doc,
    getDoc,
    updateDoc,
    collection,
    setDoc,
    serverTimestamp,
    query,
    where,
    getDocs
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import { format } from 'date-fns';
import {
    FaBriefcase,
    FaCalendarAlt,
    FaCheckCircle,
    FaChevronDown,
    FaChevronRight,
    FaEnvelope,
    FaExternalLinkAlt,
    FaFileSignature,
} from 'react-icons/fa';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { SERVICE_STOP_TYPE_USE_CASES } from '../../../utils/serviceStopTypes/serviceStopTypeResolver';
import {
    DEFAULT_LEAD_SOURCES,
    LEAD_STAGE_OPTIONS,
    leadSourceId,
    normalizeLeadSourceItem,
    pipelineLeadSourcesRef,
} from '../../../utils/customerPipeline';
import LeadCancellationDialog from './LeadCancellationDialog';
import {
    cancelLeadWithOptions,
    normalizeLeadCancellationKey,
    previewLeadCancellationTargets,
} from '../../../utils/leads/leadCancellation';
import { functions } from '../../../utils/config';
import { getCallableAuthPayload } from '../../../utils/callableAuth';
import { SalesAgreementStatus, salesCollectionNames } from '../../../utils/models/Sales';
import ServiceAgreementSendDialog from '../sales/components/ServiceAgreementSendDialog';
import { appConfirm } from '../../../utils/appDialog';

const SERVICE_STOP_OPERATION_STATUS = {
    finished: 'Finished',
    notFinished: 'Not Finished',
    skipped: 'Skipped',
};

const SERVICE_ESTIMATE_VISIT_LABEL = 'Service Estimate';
const panelClass = 'rounded-lg border border-gray-200 bg-white p-5 shadow-sm';
const actionButtonClass = 'inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryActionButtonClass = 'inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const successActionButtonClass = 'inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50';
const leadStageButtonClasses = {
    Pending: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    'In Progress': 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    Cancelled: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
};

const terminalAgreementStatusKeys = new Set(['canceled', 'cancelled', 'rejected', 'expired', 'superseded']);

const normalizeAgreementStatusKey = (value = '') => (
    String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
);

const labelize = (value = '') => (
    String(value || 'Unknown')
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())
);

const formatCurrency = (amountCents = 0) => (
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
        .format((Number(amountCents) || 0) / 100)
);

const dateFromValue = (value) => {
    if (!value) return null;
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateValue = (value, pattern = 'PPP', fallback = 'N/A') => {
    const date = dateFromValue(value);
    return date ? format(date, pattern) : fallback;
};

const dateValueMillis = (value) => dateFromValue(value)?.getTime() || 0;

const formatAgreementDate = (value) => formatDateValue(value, 'MMM d, yyyy', '');

const formatServiceAddress = (address = {}) => {
    if (!address) return '';
    if (typeof address === 'string') return address;

    const lineOne = [
        address.streetAddress || address.address || address.line1 || '',
        address.unit || address.address2 || '',
    ].filter(Boolean).join(' ');
    const cityState = [address.city || '', address.state || ''].filter(Boolean).join(', ');
    const postal = address.zip || address.zipCode || address.postalCode || '';
    const lineTwo = [cityState, postal].filter(Boolean).join(' ');

    return [lineOne, lineTwo].filter(Boolean).join('\n');
};

const compactText = (...values) => values
    .map((value) => String(value || '').trim())
    .find(Boolean) || '';

const leadJobIds = (lead = {}) => {
    const ids = [
        lead.latestJobId,
        lead.convertedToJobId,
        lead.jobId,
        ...(Array.isArray(lead.jobIds) ? lead.jobIds : []),
    ];

    return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
};

const sortNewestRecords = (records = []) => [...records].sort((left, right) => (
    dateValueMillis(right.updatedAt || right.dateCreated || right.createdAt) -
    dateValueMillis(left.updatedAt || left.dateCreated || left.createdAt)
));

const estimateAmountCents = (estimate = {}) => {
    const rate = Number(estimate.rate || estimate.amount || 0);
    if (!rate) return 0;
    return estimate.leadId && !estimate.jobId ? Math.round(rate * 100) : rate;
};

const jobAmountCents = (job = {}) => (
    Number(
        job.estimateTotalCents ??
        job.totalAmountCents ??
        job.rate ??
        0
    ) || 0
);

const InfoList = ({ title, items }) => (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <dl className="mt-3 divide-y divide-slate-200">
            {items.map((item) => {
                const displayValue = item.value === null || item.value === undefined || item.value === ''
                    ? 'N/A'
                    : item.value;

                return (
                    <div key={item.label} className="py-3 first:pt-0 last:pb-0">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</dt>
                        <dd className={`mt-1 text-sm font-medium text-slate-900 ${item.className || ''}`}>
                            {displayValue}
                        </dd>
                    </div>
                );
            })}
        </dl>
    </div>
);

const PreviewFields = ({ items }) => {
    const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== '');
    if (!visibleItems.length) return null;

    return (
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            {visibleItems.map((item) => (
                <div key={item.label}>
                    <dt className="font-semibold uppercase tracking-wide text-slate-500">{item.label}</dt>
                    <dd className="mt-1 text-slate-800">{item.value}</dd>
                </div>
            ))}
        </dl>
    );
};

const WorkflowAction = ({ action }) => {
    const Icon = action.icon;
    const className = action.className || actionButtonClass;
    const content = (
        <>
            {Icon && <Icon className="text-xs" />}
            {action.label}
        </>
    );

    if (action.to) {
        return (
            <Link to={action.to} state={action.state} className={className} title={action.title}>
                {content}
            </Link>
        );
    }

    return (
        <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.title}
            className={className}
        >
            {content}
        </button>
    );
};

const WorkflowActionRow = ({ icon: Icon, title, badge, helper, children, actions = [] }) => (
    <div className="py-4 first:pt-0 last:pb-0">
        <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
                <Icon className="text-base" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-slate-900">{title}</p>
                    {badge && (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                            {badge.label}
                        </span>
                    )}
                </div>

                {helper && <p className="mt-1 text-sm text-slate-600">{helper}</p>}
                {children}

                {actions.length > 0 && (
                    <div className="mt-4 grid gap-2">
                        {actions.map((action) => (
                            <WorkflowAction key={action.label} action={action} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    </div>
);

const formatEstimateDate = (value) => {
    if (!value) return 'N/A';
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return format(date, 'PPP');
};

const agreementAmountCents = (agreement = {}) => (
    Number(
        agreement.totalAmountCents ??
        agreement.rateAmountCents ??
        agreement.subtotalAmountCents ??
        agreement.amountCents ??
        0
    ) || 0
);

const agreementHasTerms = (agreement = {}) => (
    Boolean(String(agreement.terms || '').trim()) ||
    (Array.isArray(agreement.termsList) && agreement.termsList.length > 0)
);

const agreementIsAccepted = (agreement = {}) => (
    normalizeAgreementStatusKey(agreement.status) === normalizeAgreementStatusKey(SalesAgreementStatus.accepted)
);

const agreementCanSend = (agreement = {}) => (
    Boolean(agreement?.id) &&
    !agreementIsAccepted(agreement) &&
    !terminalAgreementStatusKeys.has(normalizeAgreementStatusKey(agreement.status)) &&
    Array.isArray(agreement.lineItems) &&
    agreement.lineItems.length > 0 &&
    agreementHasTerms(agreement)
);

const agreementCanAccept = (agreement = {}) => (
    Boolean(agreement?.id) &&
    !agreementIsAccepted(agreement) &&
    !terminalAgreementStatusKeys.has(normalizeAgreementStatusKey(agreement.status))
);

const agreementWasSent = (agreement = {}) => (
    Boolean(
        agreement.sentAt ||
        agreement.emailDelivery?.lastSentAt ||
        agreement.emailDelivery?.sentAt ||
        ['sent', 'revised'].includes(normalizeAgreementStatusKey(agreement.status))
    )
);

const isLeadServiceEstimateVisit = (visit = {}) => {
    const useCase = String(visit.serviceStopTypeUseCaseRawValue || '').trim();
    const typeId = String(visit.typeId || '').trim();
    const normalizedType = String(visit.type || '').trim().toLowerCase();

    return (
        useCase === SERVICE_STOP_TYPE_USE_CASES.serviceEstimate ||
        useCase === 'serviceEstimate' ||
        useCase === 'serviceAgreementEstimate' ||
        useCase === 'estimate' ||
        typeId === 'initialEstimate' ||
        typeId === 'system_service_estimate_stop' ||
        typeId === 'system_service_agreement_estimate_service_stop' ||
        normalizedType.includes('service estimate') ||
        normalizedType.includes('service agreement estimate') ||
        normalizedType.includes('initial estimate') ||
        normalizedType.includes('pre estimate') ||
        normalizedType.includes('pre-estimate') ||
        normalizedType === 'estimate'
    );
};

const buildServiceAgreementDraftPath = ({
    lead = {},
    customerId = '',
    serviceLocationId = '',
    serviceStopId = '',
} = {}) => {
    const params = new URLSearchParams();
    if (lead.id) params.set('leadId', lead.id);
    if (customerId) params.set('customerId', customerId);
    if (serviceLocationId) params.set('serviceLocationId', serviceLocationId);
    if (serviceStopId) params.set('serviceStopId', serviceStopId);

    return `/company/sales/agreements/new${params.toString() ? `?${params.toString()}` : ''}`;
};

const getVisitBadge = (visit) => {
    if (!visit) return null;
    if (visit.operationStatus === SERVICE_STOP_OPERATION_STATUS.finished || visit.endTime) {
        return { label: 'Completed', className: 'bg-green-100 text-green-800' };
    }
    if (visit.startTime) {
        return { label: 'In Progress', className: 'bg-blue-100 text-blue-800' };
    }
    if (visit.operationStatus === SERVICE_STOP_OPERATION_STATUS.skipped) {
        return { label: 'Skipped', className: 'bg-gray-100 text-gray-800' };
    }
    return { label: 'Scheduled', className: 'bg-yellow-100 text-yellow-800' };
};

export default function LeadDetail() {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany, user, dataBaseUser } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [estimate, setEstimate] = useState(null);
    const [loading, setLoading] = useState(true);
    const [estimateVisit, setEstimateVisit] = useState(null);
    const [linkedAgreement, setLinkedAgreement] = useState(null);
    const [linkedJob, setLinkedJob] = useState(null);
    const [linkedJobCount, setLinkedJobCount] = useState(0);

    const [savingDescription, setSavingDescription] = useState(false);
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const [sharedDescriptionOpen, setSharedDescriptionOpen] = useState(true);
    const [savingPrivateNotes, setSavingPrivateNotes] = useState(false);
    const [privateNotesDraft, setPrivateNotesDraft] = useState('');
    const [privateNotesSavedValue, setPrivateNotesSavedValue] = useState('');
    const [privateNotesDocExists, setPrivateNotesDocExists] = useState(false);
    const [savingStatus, setSavingStatus] = useState(false);
    const [showCancelReason, setShowCancelReason] = useState(false);
    const [cancelReasonDraft, setCancelReasonDraft] = useState('');
    const [showCancelDialog, setShowCancelDialog] = useState(false);
    const [cancelDialogTargets, setCancelDialogTargets] = useState({});
    const [loadingCancelTargets, setLoadingCancelTargets] = useState(false);
    const [sendingAgreement, setSendingAgreement] = useState(false);
    const [showAgreementSendDialog, setShowAgreementSendDialog] = useState(false);
    const [acceptingAgreement, setAcceptingAgreement] = useState(false);
    const [leadSources, setLeadSources] = useState(DEFAULT_LEAD_SOURCES.map(normalizeLeadSourceItem));
    const [leadSourceDraft, setLeadSourceDraft] = useState('Manual');
    const [newLeadSourceDraft, setNewLeadSourceDraft] = useState('');
    const [savingLeadSource, setSavingLeadSource] = useState(false);

    useEffect(() => {
        if (!recentlySelectedCompany) return;

        const fetchLeadSources = async () => {
            try {
                const sourceSnap = await getDocs(pipelineLeadSourcesRef(recentlySelectedCompany));
                if (sourceSnap.empty) {
                    setLeadSources(DEFAULT_LEAD_SOURCES.map(normalizeLeadSourceItem));
                    return;
                }

                setLeadSources(
                    sourceSnap.docs
                        .map((sourceDoc, index) => normalizeLeadSourceItem({ id: sourceDoc.id, ...sourceDoc.data() }, index * 10))
                        .filter((source) => source.active !== false)
                        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name))
                );
            } catch (error) {
                console.error('Error loading lead source list:', error);
            }
        };

        fetchLeadSources();
    }, [recentlySelectedCompany]);

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchLeadDetails = async () => {
            setLoading(true);
            setEstimate(null);
            setEstimateVisit(null);
            setLinkedAgreement(null);
            setLinkedJob(null);
            setLinkedJobCount(0);
            try {
                const leadRef = doc(db, 'homeownerServiceRequests', leadId);
                const docSnap = await getDoc(leadRef);

                if (docSnap.exists() && docSnap.data().companyId === recentlySelectedCompany) {
                    const leadData = docSnap.data();
                    let ownerDetails = {};

                    if (leadData.userId) {
                        const userSnap = await getDoc(doc(db, 'users', leadData.userId));
                        ownerDetails = userSnap.exists() ? userSnap.data() : {};
                    }

                    const enhancedLead = { id: docSnap.id, ...leadData, ownerDetails };
                    const initialDescription = String(leadData.serviceDescription || '');
                    setLead(enhancedLead);
                    setDescriptionDraft(initialDescription);
                    setSharedDescriptionOpen(Boolean(initialDescription.trim()));
                    setLeadSourceDraft(leadData.leadSource || leadData.marketingSource || leadData.sourceLabel || leadData.source || 'Manual');
                    setCancelReasonDraft(leadData.lostReason || leadData.cancelReason || leadData.statusChangeReason || '');

                    const privateNotesSnap = await getDoc(
                        doc(
                            db,
                            'companies',
                            recentlySelectedCompany,
                            'leadPrivateNotes',
                            leadId
                        )
                    );
                    setPrivateNotesDocExists(privateNotesSnap.exists());
                    const privateNotes = privateNotesSnap.exists() ? privateNotesSnap.data().notes || '' : '';
                    setPrivateNotesDraft(privateNotes);
                    setPrivateNotesSavedValue(privateNotes);

                    if (leadData.estimateId) {
                        const estimateRef = doc(db, 'contracts', leadData.estimateId);
                        const estimateSnap = await getDoc(estimateRef);
                        if (estimateSnap.exists()) {
                            setEstimate({ id: estimateSnap.id, ...estimateSnap.data() });
                        }
                    }

                    const estimateStopId = leadData.serviceEstimateServiceStopId || leadData.initialEstimateServiceStopId || '';
                    let matchedEstimateVisit = null;

                    if (estimateStopId) {
                        const stopSnap = await getDoc(
                            doc(
                                db,
                                'companies',
                                recentlySelectedCompany,
                                'serviceStops',
                                estimateStopId
                            )
                        );

                        if (stopSnap.exists()) {
                            matchedEstimateVisit = { id: stopSnap.id, ...stopSnap.data() };
                        }
                    }

                    if (!matchedEstimateVisit) {
                        const visitQuery = query(
                            collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                            where('leadId', '==', leadId)
                        );
                        const visitSnap = await getDocs(visitQuery);

                        if (!visitSnap.empty) {
                            const visitDocs = visitSnap.docs.map((visitDoc) => ({
                                id: visitDoc.id,
                                ...visitDoc.data(),
                            }));
                            const firstVisit = visitDocs.find(isLeadServiceEstimateVisit) || visitDocs[0];
                            matchedEstimateVisit = firstVisit;
                        }
                    }

                    setEstimateVisit(matchedEstimateVisit);

                    try {
                        const jobRecordsById = new Map();
                        const addJobRecord = (jobSnap) => {
                            if (!jobSnap?.exists?.()) return;
                            jobRecordsById.set(jobSnap.id, { id: jobSnap.id, ...jobSnap.data() });
                        };

                        const explicitJobIds = leadJobIds(leadData);
                        if (explicitJobIds.length) {
                            const jobSnaps = await Promise.all(explicitJobIds.map((jobIdValue) => (
                                getDoc(doc(db, 'companies', recentlySelectedCompany, 'workOrders', jobIdValue))
                            )));
                            jobSnaps.forEach(addJobRecord);
                        }

                        const jobQueries = [
                            query(
                                collection(db, 'companies', recentlySelectedCompany, 'workOrders'),
                                where('leadId', '==', leadId)
                            ),
                            query(
                                collection(db, 'companies', recentlySelectedCompany, 'workOrders'),
                                where('sourceLeadId', '==', leadId)
                            ),
                        ];
                        const jobQuerySnaps = await Promise.all(jobQueries.map((jobQuery) => getDocs(jobQuery)));
                        jobQuerySnaps.forEach((jobSnap) => jobSnap.docs.forEach(addJobRecord));

                        const linkedJobs = sortNewestRecords(Array.from(jobRecordsById.values()));
                        setLinkedJob(linkedJobs[0] || null);
                        setLinkedJobCount(linkedJobs.length);
                    } catch (jobError) {
                        console.warn('Unable to load linked job for lead', jobError);
                        setLinkedJob(null);
                        setLinkedJobCount(0);
                    }

                    try {
                        const explicitAgreementId =
                            leadData.serviceAgreementId ||
                            leadData.salesAgreementId ||
                            leadData.agreementId ||
                            matchedEstimateVisit?.serviceAgreementId ||
                            matchedEstimateVisit?.salesAgreementId ||
                            matchedEstimateVisit?.agreementId ||
                            '';
                        let matchedAgreement = null;

                        if (explicitAgreementId) {
                            const agreementSnap = await getDoc(doc(db, salesCollectionNames.agreements, explicitAgreementId));
                            if (agreementSnap.exists()) {
                                const agreementData = agreementSnap.data();
                                if (!agreementData.companyId || agreementData.companyId === recentlySelectedCompany) {
                                    matchedAgreement = { id: agreementSnap.id, ...agreementData };
                                }
                            }
                        }

                        if (!matchedAgreement) {
                            const agreementSnap = await getDocs(query(
                                collection(db, salesCollectionNames.agreements),
                                where('companyId', '==', recentlySelectedCompany),
                                where('leadId', '==', leadId)
                            ));
                            const agreements = agreementSnap.docs
                                .map((agreementDoc) => ({ id: agreementDoc.id, ...agreementDoc.data() }));

                            matchedAgreement = agreements.find((agreement) => !terminalAgreementStatusKeys.has(normalizeAgreementStatusKey(agreement.status))) || agreements[0] || null;
                        }

                        setLinkedAgreement(matchedAgreement);
                    } catch (agreementError) {
                        console.warn('Unable to load linked service agreement for lead', agreementError);
                        setLinkedAgreement(null);
                    }
                } else {
                    toast.error('Lead not found or access denied.');
                    navigate('/company/leads');
                }
            } catch (error) {
                console.error('Error fetching lead details:', error);
                toast.error('Failed to fetch lead details.');
            } finally {
                setLoading(false);
            }
        };

        fetchLeadDetails();
    }, [leadId, recentlySelectedCompany, db, navigate]);

    const actorName = `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() ||
        user?.displayName ||
        user?.email ||
        '';

    const closeCancelDialog = () => {
        if (savingStatus) return;
        setShowCancelDialog(false);
        setCancelDialogTargets({});
        setLoadingCancelTargets(false);
    };

    const openLeadCancellationDialog = async () => {
        if (!requirePermission("614", "update leads")) return;
        if (!lead || !recentlySelectedCompany) return;

        setShowCancelReason(false);
        setShowCancelDialog(true);
        setCancelDialogTargets({});
        setLoadingCancelTargets(true);

        try {
            const targets = await previewLeadCancellationTargets({
                db,
                companyId: recentlySelectedCompany,
                lead,
            });
            setCancelDialogTargets(targets);
        } catch (error) {
            console.error('Unable to load lead cancellation targets', error);
            toast.error('Could not load linked cleanup options.');
        } finally {
            setLoadingCancelTargets(false);
        }
    };

    const sendLinkedAgreementEmail = async ({ primaryEmail, additionalEmails = [] } = {}) => {
        if (!linkedAgreement?.id) return;
        if (!can("400")) {
            toast.error('You do not have permission to send service agreements.');
            return;
        }
        if (!agreementCanSend(linkedAgreement)) {
            toast.error(agreementIsAccepted(linkedAgreement)
                ? 'Accepted agreements cannot be resent from this action.'
                : 'Add line items and terms before sending this service agreement.');
            return;
        }

        const recipientEmail = String(primaryEmail || linkedAgreement.email || '').trim();
        if (!recipientEmail) {
            toast.error('Add a recipient email before sending.');
            return;
        }

        setSendingAgreement(true);

        try {
            const sendCallable = httpsCallable(functions, 'sendServiceAgreementEmail');
            const authPayload = await getCallableAuthPayload();
            const result = await sendCallable({
                companyId: linkedAgreement.companyId || recentlySelectedCompany,
                agreementId: linkedAgreement.id,
                agreementBaseUrl: window.location.origin,
                includeInspectionReport: linkedAgreement.emailDelivery?.includeInspectionReport === true || linkedAgreement.includeInspectionReport === true,
                primaryEmail: recipientEmail,
                additionalEmails,
                ...authPayload,
            });

            setLinkedAgreement((current) => current?.id === linkedAgreement.id
                ? {
                    ...current,
                    status: agreementIsAccepted(current) ? current.status : SalesAgreementStatus.sent,
                    email: recipientEmail,
                    emailDelivery: {
                        ...(current.emailDelivery || {}),
                        lastSentAt: new Date(),
                    },
                }
                : current);
            setLead((current) => current
                ? {
                    ...current,
                    serviceAgreementId: linkedAgreement.id,
                    serviceAgreementTitle: linkedAgreement.title || 'Service Agreement',
                    serviceAgreementStatus: agreementIsAccepted(linkedAgreement) ? linkedAgreement.status : SalesAgreementStatus.sent,
                }
                : current);

            if (result.data?.testMode) {
                toast.success(`Test email sent to ${result.data.to}. Customer email saved as ${result.data.intendedTo}.`);
            } else if (result.data?.includeInspectionReport && !result.data?.hasInspectionReport) {
                toast.success('Service agreement sent. No linked inspection report was found yet.');
            } else {
                toast.success(result.data?.message || 'Service agreement email sent.');
            }
            setShowAgreementSendDialog(false);
        } catch (sendError) {
            console.error('Unable to send service agreement from lead', sendError);
            toast.error(sendError.message || 'Failed to send service agreement email.');
        } finally {
            setSendingAgreement(false);
        }
    };

    const markLinkedAgreementAccepted = async ({ completeLead = true, confirm = true } = {}) => {
        if (!linkedAgreement?.id) return false;
        if (!can("400")) {
            toast.error('You do not have permission to update service agreements.');
            return false;
        }
        if (agreementIsAccepted(linkedAgreement)) return true;
        if (!agreementCanAccept(linkedAgreement)) {
            toast.error(`Agreement status is ${labelize(linkedAgreement.status)}.`);
            return false;
        }

        if (confirm) {
            const confirmed = await appConfirm({
                title: 'Mark Service Agreement Accepted',
                message: `Mark "${linkedAgreement.title || 'Service Agreement'}" accepted${completeLead ? ' and complete this lead' : ''}?`,
                confirmLabel: 'Mark Accepted',
                cancelLabel: 'Keep Editing',
            });
            if (!confirmed) return false;
        }

        setAcceptingAgreement(true);

        try {
            const acceptancePayload = {
                status: SalesAgreementStatus.accepted,
                acceptedAt: serverTimestamp(),
                acceptedByUserId: user?.uid || user?.id || '',
                acceptedByUserName: actorName,
                acceptedByEmail: user?.email || dataBaseUser?.email || '',
                acceptedSource: 'customerOffline',
                acceptedNote: completeLead
                    ? 'Marked accepted from the linked lead.'
                    : 'Marked accepted while completing the linked lead.',
                statusChangedAt: serverTimestamp(),
                statusChangedByUserId: user?.uid || user?.id || '',
                statusChangedByUserName: actorName,
                statusChangeReason: 'Agreement manually accepted from the linked lead.',
                updatedAt: serverTimestamp(),
            };
            const updates = [
                updateDoc(doc(db, salesCollectionNames.agreements, linkedAgreement.id), acceptancePayload),
            ];

            if (estimateVisit?.id) {
                updates.push(updateDoc(doc(db, 'companies', recentlySelectedCompany, 'serviceStops', estimateVisit.id), {
                    serviceAgreementId: linkedAgreement.id,
                    serviceAgreementTitle: linkedAgreement.title || 'Service Agreement',
                    serviceAgreementStatus: SalesAgreementStatus.accepted,
                    serviceAgreementAcceptedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }));
            }

            if (completeLead) {
                updates.push(updateDoc(doc(db, 'homeownerServiceRequests', leadId), {
                    status: 'Completed',
                    leadStatus: 'Completed',
                    serviceAgreementId: linkedAgreement.id,
                    serviceAgreementTitle: linkedAgreement.title || 'Service Agreement',
                    serviceAgreementStatus: SalesAgreementStatus.accepted,
                    serviceAgreementAcceptedAt: serverTimestamp(),
                    dateCompleted: serverTimestamp(),
                    lostReason: '',
                    cancelReason: '',
                    statusChangeReason: '',
                    updatedAt: serverTimestamp(),
                }));
            }

            await Promise.all(updates);

            setLinkedAgreement((current) => current?.id === linkedAgreement.id
                ? {
                    ...current,
                    status: SalesAgreementStatus.accepted,
                    acceptedAt: new Date(),
                    acceptedByUserId: user?.uid || user?.id || '',
                    acceptedByUserName: actorName,
                    acceptedByEmail: user?.email || dataBaseUser?.email || '',
                    acceptedSource: 'customerOffline',
                }
                : current);
            setLead((current) => current
                ? {
                    ...current,
                    ...(completeLead ? { status: 'Completed', leadStatus: 'Completed' } : {}),
                    serviceAgreementId: linkedAgreement.id,
                    serviceAgreementTitle: linkedAgreement.title || 'Service Agreement',
                    serviceAgreementStatus: SalesAgreementStatus.accepted,
                    lostReason: completeLead ? '' : current.lostReason,
                    cancelReason: completeLead ? '' : current.cancelReason,
                }
                : current);

            if (completeLead) setCancelReasonDraft('');
            toast.success(completeLead
                ? 'Service agreement accepted and lead completed.'
                : 'Service agreement marked accepted.');
            return true;
        } catch (acceptError) {
            console.error('Unable to mark service agreement accepted from lead', acceptError);
            toast.error(acceptError.message || 'Failed to mark service agreement accepted.');
            return false;
        } finally {
            setAcceptingAgreement(false);
        }
    };

    const confirmLeadCancellation = async ({ reason, options }) => {
        if (!requirePermission("614", "update leads")) return;
        if (!lead || !recentlySelectedCompany) return;

        const originalLead = lead;
        setSavingStatus(true);
        setLead(prev => ({ ...prev, status: 'Cancelled', leadStatus: 'Cancelled' }));

        try {
            const result = await cancelLeadWithOptions({
                db,
                companyId: recentlySelectedCompany,
                lead,
                reason: reason || cancelReasonDraft || 'Marked cancelled from lead detail.',
                targets: cancelDialogTargets,
                options,
                actor: {
                    id: user?.uid || user?.id || '',
                    name: actorName,
                    email: user?.email || dataBaseUser?.email || '',
                },
            });

            setLead(prev => ({
                ...prev,
                status: 'Cancelled',
                leadStatus: 'Cancelled',
                lostReason: result.reason,
                cancelReason: result.reason,
                statusChangeReason: result.reason,
                serviceAgreementId: result.targets?.agreement?.id || prev.serviceAgreementId || '',
                serviceAgreementStatus: result.agreementRejected ? 'rejected' : prev.serviceAgreementStatus,
            }));
            setCancelReasonDraft(result.reason);
            setShowCancelReason(false);
            if (result.serviceStopDeleted) setEstimateVisit(null);

            const cleanupMessages = [
                result.serviceStopDeleted ? 'service stop deleted' : '',
                result.customerInactive ? 'customer made inactive' : '',
                result.agreementRejected ? 'agreement rejected' : '',
            ].filter(Boolean);
            toast.success(cleanupMessages.length
                ? `Lead cancelled; ${cleanupMessages.join(', ')}.`
                : 'Status updated to Cancelled');
            setShowCancelDialog(false);
            setCancelDialogTargets({});
        } catch (error) {
            setLead(originalLead);
            toast.error(error.message || 'Failed to update status.');
        } finally {
            setSavingStatus(false);
        }
    };

    const handleStatusChange = async (newStatus, options = {}) => {
        if (!requirePermission("614", "update leads")) return;
        if (newStatus === 'Cancelled' && !options.skipCancellationDialog) {
            if (normalizeLeadCancellationKey(status) === 'cancelled') {
                setShowCancelReason(true);
                return;
            }
            await openLeadCancellationDialog();
            return;
        }
        if (newStatus === 'Completed' && linkedAgreement?.id && !agreementIsAccepted(linkedAgreement)) {
            if (!agreementWasSent(linkedAgreement) && agreementCanSend(linkedAgreement)) {
                setShowAgreementSendDialog(true);
                toast('Send the service agreement first. Once the customer accepts, mark the lead completed.');
                return;
            }
            const accepted = await markLinkedAgreementAccepted({ completeLead: false, confirm: true });
            if (!accepted) return;
        }

        const leadRef = doc(db, 'homeownerServiceRequests', leadId);
        const originalStatus = lead.status;
        const originalReason = lead.lostReason || lead.cancelReason || lead.statusChangeReason || '';
        const reason = options.reason || cancelReasonDraft.trim();

        setSavingStatus(true);
        setLead(prev => ({ ...prev, status: newStatus }));

        try {
            const updates = {
                status: newStatus,
                leadStatus: newStatus,
                updatedAt: serverTimestamp(),
            };

            switch (newStatus) {
                case 'Pending':
                    updates.dateCompleted = null;
                    updates.lostReason = "";
                    updates.cancelReason = "";
                    break;
                case 'In Progress':
                    updates.dateCompleted = null;
                    updates.lostReason = "";
                    updates.cancelReason = "";
                    break;
                case 'Completed':
                    updates.dateCompleted = new Date();
                    updates.lostReason = "";
                    updates.cancelReason = "";
                    if (linkedAgreement?.id) {
                        updates.serviceAgreementId = linkedAgreement.id;
                        updates.serviceAgreementTitle = linkedAgreement.title || 'Service Agreement';
                        updates.serviceAgreementStatus = SalesAgreementStatus.accepted;
                        updates.serviceAgreementAcceptedAt = serverTimestamp();
                    }
                    break;
                case 'Cancelled':
                    updates.dateCompleted = new Date();
                    updates.lostReason = reason;
                    updates.cancelReason = reason;
                    updates.statusChangeReason = reason;
                    updates.lostAt = serverTimestamp();
                    break;
                default:
                    break;
            }
            await updateDoc(leadRef, updates);
            setLead(prev => ({ ...prev, ...updates, status: newStatus }));
            setCancelReasonDraft(newStatus === 'Cancelled' ? reason : '');
            setShowCancelReason(false);
            toast.success(`Status updated to ${newStatus}`);
        } catch (error) {
            setLead(prev => ({ ...prev, status: originalStatus, lostReason: originalReason }));
            toast.error('Failed to update status.');
        } finally {
            setSavingStatus(false);
        }
    };

    const saveLeadSource = async (nextSource = leadSourceDraft) => {
        if (!requirePermission("614", "update leads")) return;
        if (!lead || !recentlySelectedCompany) return;

        const cleanSource = String(nextSource || '').trim();
        if (!cleanSource || cleanSource === (lead.leadSource || lead.marketingSource || lead.sourceLabel || lead.source || '')) return;

        setSavingLeadSource(true);
        try {
            const sourceRef = doc(pipelineLeadSourcesRef(recentlySelectedCompany), leadSourceId(cleanSource));
            await setDoc(sourceRef, {
                id: leadSourceId(cleanSource),
                name: cleanSource,
                sortOrder: leadSources.length ? Math.max(...leadSources.map((source) => Number(source.sortOrder || 0))) + 10 : 10,
                active: true,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });
            await updateDoc(doc(db, 'homeownerServiceRequests', leadId), {
                leadSource: cleanSource,
                marketingSource: cleanSource,
                updatedAt: serverTimestamp(),
            });
            setLead((current) => ({ ...current, leadSource: cleanSource, marketingSource: cleanSource }));
            setLeadSourceDraft(cleanSource);
            setLeadSources((current) => {
                const id = leadSourceId(cleanSource);
                if (current.some((source) => source.id === id)) return current;
                return [...current, normalizeLeadSourceItem({ id, name: cleanSource, sortOrder: current.length * 10 + 10 })]
                    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name));
            });
            toast.success('Lead source saved.');
        } catch (error) {
            console.error('Error saving lead source:', error);
            toast.error('Could not save lead source.');
        } finally {
            setSavingLeadSource(false);
        }
    };

    const handleAddLeadSource = async () => {
        const nextSource = newLeadSourceDraft.trim();
        if (!nextSource) return;
        setNewLeadSourceDraft('');
        await saveLeadSource(nextSource);
    };

    const savePrivateNotes = async () => {
        if (!requirePermission("614", "update leads")) return;
        if (!lead || !recentlySelectedCompany) return;
        if (privateNotesDraft === privateNotesSavedValue) return;

        setSavingPrivateNotes(true);
        try {
            const privateNotesRef = doc(
                db,
                'companies',
                recentlySelectedCompany,
                'leadPrivateNotes',
                leadId
            );
            const payload = {
                id: leadId,
                leadId,
                companyId: recentlySelectedCompany,
                notes: privateNotesDraft,
                visibility: 'companyOnly',
                updatedAt: serverTimestamp(),
            };

            if (!privateNotesDocExists) {
                payload.createdAt = serverTimestamp();
            }

            await setDoc(privateNotesRef, payload, { merge: true });
            setPrivateNotesDocExists(true);
            setPrivateNotesSavedValue(privateNotesDraft);
            toast.success('Private notes saved.');
        } catch (error) {
            console.error('Error updating private lead notes:', error);
            toast.error('Failed to save private notes.');
        } finally {
            setSavingPrivateNotes(false);
        }
    };

    const saveDescription = async () => {
        if (!requirePermission("614", "update leads")) return;
        if (!lead) return;

        const nextDescription = descriptionDraft;
        const currentDescription = lead.serviceDescription || '';

        if (nextDescription === currentDescription) return;

        setSavingDescription(true);
        try {
            const leadRef = doc(db, 'homeownerServiceRequests', leadId);
            await updateDoc(leadRef, {
                serviceDescription: nextDescription,
            });

            setLead((prev) => ({
                ...prev,
                serviceDescription: nextDescription,
            }));
            setSharedDescriptionOpen(Boolean(String(nextDescription || '').trim()));

            toast.success('Description updated.');
        } catch (error) {
            console.error('Error updating description:', error);
            toast.error('Failed to update description.');
        } finally {
            setSavingDescription(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <ClipLoader size={50} />
            </div>
        );
    }

    if (!lead) {
        return (
            <div className="text-center p-12">
                <h2 className="text-xl font-semibold">Lead not found</h2>
                <Link to="/company/leads" className="text-blue-600 hover:underline">
                    Return to Leads
                </Link>
            </div>
        );
    }

    const {
        serviceName,
        createdAt,
        status,
        ownerDetails = {},
        serviceLocationAddress,
        source,
        customerId,
        customerName,
        creatorName,
        homeownerName,
        homeownerEmail,
        homeownerPhone
    } = lead;
    const activeLeadSource = lead.leadSource || lead.marketingSource || lead.sourceLabel || source || 'N/A';
    const contactName = compactText(customerName, ownerDetails.displayName, homeownerName);
    const contactEmail = compactText(ownerDetails.email, homeownerEmail);
    const contactPhone = compactText(ownerDetails.phoneNumber, ownerDetails.phone, homeownerPhone);
    const formattedServiceAddress = formatServiceAddress(serviceLocationAddress);
    const createdByDisplayName = compactText(creatorName, lead.createdByName, lead.createdByUserName, lead.creatorEmail);
    const hasSharedDescription = Boolean(String(descriptionDraft || '').trim());
    const publicIntake = lead.publicLeadIntake || lead.leadIntake || {};
    const publicBodiesOfWater = Array.isArray(publicIntake.bodiesOfWater) ? publicIntake.bodiesOfWater : [];
    const publicEquipment = [
        ...(Array.isArray(publicIntake.equipment) ? publicIntake.equipment : []),
        ...publicBodiesOfWater.flatMap((body) => Array.isArray(body.equipment) ? body.equipment : []),
    ];
    const hasPublicIntakeDetails = Boolean(
        lead.publicLead ||
        source === 'Public' ||
        publicIntake.preferredContactMethod ||
        publicIntake.serviceType ||
        publicBodiesOfWater.length ||
        publicEquipment.length
    );
    const linkedCustomerId = customerId || lead.companyCustomerId || '';
    const linkedServiceLocationId = lead.companyServiceLocationId || lead.serviceLocationId || '';
    const leadContextState = {
        leadContext: {
            id: lead.id,
            source: lead.source || '',
            status: lead.status || '',
            serviceName: lead.serviceName || '',
            serviceDescription: lead.serviceDescription || '',
            customerId: linkedCustomerId,
            customerName: lead.customerName || '',
            serviceLocationId: linkedServiceLocationId,
        },
    };
    const buildCreateJobPath = () => {
        const basePath = `/company/jobs/createNew/${linkedCustomerId}`;
        return linkedServiceLocationId ? `${basePath}/${linkedServiceLocationId}` : basePath;
    };
    const buildServiceStopSchedulerPath = (category = 'serviceAgreementEstimate') => {
        const params = new URLSearchParams({
            leadId: lead.id,
            category,
        });

        if (linkedCustomerId) params.set('customerId', linkedCustomerId);
        if (linkedServiceLocationId) params.set('serviceLocationId', linkedServiceLocationId);

        return `/company/serviceStops/createNew?${params.toString()}`;
    };
    const serviceEstimateSchedulerPath = buildServiceStopSchedulerPath('serviceAgreementEstimate');
    const serviceAgreementDraftPath = buildServiceAgreementDraftPath({
        lead,
        customerId: linkedCustomerId,
        serviceLocationId: linkedServiceLocationId,
        serviceStopId: estimateVisit?.id || '',
    });

    const handleCreateJobFromLead = () => {
        if (!linkedCustomerId) {
            toast.error('Create a customer before creating a job from this lead.');
            return;
        }

        navigate(buildCreateJobPath(), {
            state: leadContextState,
        });
    };

    const handleScheduleEstimateVisitFromLead = () => {
        if (!linkedCustomerId) {
            toast.error('Create a customer before scheduling a service stop from this lead.');
            return;
        }

        navigate(serviceEstimateSchedulerPath, { state: leadContextState });
    };

    const handleCreateServiceAgreementFromLead = () => {
        if (!linkedCustomerId) {
            toast.error('Create a customer before creating a service agreement from this lead.');
            return;
        }

        navigate(serviceAgreementDraftPath, { state: leadContextState });
    };

    const renderWorkflowActions = () => {
        if (!linkedCustomerId) {
            if (!can("612")) return null;

            return (
                <div className={panelClass}>
                    <h3 className="text-lg font-semibold text-gray-800">Linked Work</h3>
                    <div className="mt-4 divide-y divide-slate-200">
                        <WorkflowActionRow
                            icon={FaBriefcase}
                            title="Lead Conversion"
                            badge={{ label: 'Needed', className: 'bg-amber-100 text-amber-800' }}
                            helper="Convert this lead before creating a job, scheduling an estimate, or sending a service agreement."
                            actions={[
                                {
                                    label: 'Convert Lead to Customer',
                                    onClick: () => navigate(`/company/customers/create-from-lead/${lead.id}`),
                                },
                            ]}
                        />
                    </div>
                </div>
            );
        }

        const canViewJobs = can("20") || can("22") || can("24");
        const canViewServiceStops = can("240") || can("242") || can("244");
        const canViewServiceAgreements = can("400") || can("430") || can("612");
        const canShowJobRow = canViewJobs || can("22");
        const canShowEstimateRow = canViewServiceStops || can("242") || estimate?.id || estimateVisit?.id;
        const canShowAgreementRow = canViewServiceAgreements || can("612");

        if (!canShowJobRow && !canShowEstimateRow && !canShowAgreementRow) return null;

        const jobActions = linkedJob?.id
            ? canViewJobs
                ? [{
                    label: 'View Job',
                    to: `/company/jobs/detail/${linkedJob.id}`,
                    icon: FaExternalLinkAlt,
                    className: secondaryActionButtonClass,
                }]
                : []
            : can("22")
                ? [{
                    label: 'Create Job',
                    onClick: handleCreateJobFromLead,
                }]
                : [];

        const estimateActions = [];
        if (estimate?.id) {
            estimateActions.push({
                label: 'View Estimate',
                to: `/company/contract/detail/${estimate.id}`,
                icon: FaExternalLinkAlt,
                className: secondaryActionButtonClass,
            });
        }
        if (estimateVisit?.id && canViewServiceStops) {
            estimateActions.push({
                label: 'View Estimate Visit',
                to: `/company/serviceStops/detail/${estimateVisit.id}`,
                icon: FaExternalLinkAlt,
                className: secondaryActionButtonClass,
            });
        }
        if (!estimate?.id && !estimateVisit?.id && can("242")) {
            estimateActions.push({
                label: 'Schedule Estimate',
                onClick: handleScheduleEstimateVisitFromLead,
            });
        }

        const agreementActions = [];
        const statusKey = normalizeAgreementStatusKey(linkedAgreement?.status);
        const accepted = agreementIsAccepted(linkedAgreement || {});
        const sentAt = linkedAgreement?.sentAt || linkedAgreement?.emailDelivery?.lastSentAt || linkedAgreement?.emailDelivery?.sentAt;
        const acceptedAt = linkedAgreement?.acceptedAt;
        const sendDisabled = !agreementCanSend(linkedAgreement || {}) || sendingAgreement || acceptingAgreement;
        const acceptDisabled = !agreementCanAccept(linkedAgreement || {}) || sendingAgreement || acceptingAgreement;
        const sentBefore = agreementWasSent(linkedAgreement || {});

        if (linkedAgreement?.id) {
            if (canViewServiceAgreements) {
                agreementActions.push({
                    label: 'View Agreement',
                    to: `/company/sales/agreements/${linkedAgreement.id}`,
                    icon: FaExternalLinkAlt,
                    className: secondaryActionButtonClass,
                });
            }
            if (can("400")) {
                agreementActions.push({
                    label: sendingAgreement ? 'Sending...' : sentBefore ? 'Resend Agreement' : 'Send Agreement',
                    onClick: () => setShowAgreementSendDialog(true),
                    disabled: sendDisabled,
                    title: sendDisabled && !sendingAgreement ? 'Agreement must be active and include line items and terms before sending.' : undefined,
                    icon: FaEnvelope,
                    className: actionButtonClass,
                });
                agreementActions.push({
                    label: acceptingAgreement ? 'Accepting...' : accepted ? 'Accepted' : 'Mark Accepted',
                    onClick: () => markLinkedAgreementAccepted({ completeLead: true, confirm: true }),
                    disabled: acceptDisabled,
                    title: acceptDisabled && !acceptingAgreement ? 'Agreement is already final.' : undefined,
                    icon: FaCheckCircle,
                    className: successActionButtonClass,
                });
            }
        } else if (can("612")) {
            agreementActions.push({
                label: 'Send Service Agreement',
                onClick: handleCreateServiceAgreementFromLead,
            });
        }

        return (
            <div className={panelClass}>
                <h3 className="text-lg font-semibold text-gray-800">Linked Work</h3>
                <div className="mt-4 divide-y divide-slate-200">
                    {canShowJobRow && (
                        <WorkflowActionRow
                            icon={FaBriefcase}
                            title={linkedJob?.id ? `Job ${linkedJob.internalId || linkedJob.id}` : 'Job'}
                            badge={linkedJob?.id
                                ? { label: linkedJob.operationStatus || 'Open', className: 'bg-blue-100 text-blue-800' }
                                : { label: 'Not created', className: 'bg-slate-100 text-slate-700' }}
                            helper={linkedJob?.id && linkedJobCount > 1
                                ? `${linkedJobCount - 1} more linked job${linkedJobCount === 2 ? '' : 's'} on this lead.`
                                : linkedJob?.id
                                    ? linkedJob.description || ''
                                    : 'No linked job yet.'}
                            actions={jobActions}
                        >
                            {linkedJob?.id && (
                                <PreviewFields
                                    items={[
                                        { label: 'Billing', value: linkedJob.billingStatus || 'Draft' },
                                        { label: 'Created', value: formatDateValue(linkedJob.dateCreated || linkedJob.createdAt) },
                                        { label: 'Admin', value: linkedJob.adminName || 'Unassigned' },
                                        { label: 'Price', value: formatCurrency(jobAmountCents(linkedJob)) },
                                    ]}
                                />
                            )}
                        </WorkflowActionRow>
                    )}

                    {canShowEstimateRow && (
                        <WorkflowActionRow
                            icon={FaCalendarAlt}
                            title="Estimate"
                            badge={estimate?.id
                                ? { label: labelize(estimate.status || 'Pending'), className: 'bg-yellow-100 text-yellow-800' }
                                : estimateVisit?.id
                                    ? getVisitBadge(estimateVisit)
                                    : { label: 'Not scheduled', className: 'bg-slate-100 text-slate-700' }}
                            helper={estimate?.id
                                ? estimate.notes || ''
                                : estimateVisit?.id
                                    ? estimateVisit.description || ''
                                    : 'No estimate visit or estimate is linked yet.'}
                            actions={estimateActions}
                        >
                            {(estimate?.id || estimateVisit?.id) && (
                                <PreviewFields
                                    items={[
                                        estimate?.id ? { label: 'Amount', value: formatCurrency(estimateAmountCents(estimate)) } : null,
                                        estimate?.id ? { label: 'Accept By', value: formatEstimateDate(estimate.lastDateToAccept) } : null,
                                        estimateVisit?.id ? { label: 'Visit Type', value: estimateVisit.type || SERVICE_ESTIMATE_VISIT_LABEL } : null,
                                        estimateVisit?.id ? { label: 'Scheduled', value: formatDateValue(estimateVisit.serviceDate) } : null,
                                        estimateVisit?.id ? { label: 'Technician', value: estimateVisit.tech || 'Unassigned' } : null,
                                    ].filter(Boolean)}
                                />
                            )}
                        </WorkflowActionRow>
                    )}

                    {canShowAgreementRow && (
                        <WorkflowActionRow
                            icon={FaFileSignature}
                            title={linkedAgreement?.id ? linkedAgreement.title || 'Service Agreement' : 'Service Agreement'}
                            badge={linkedAgreement?.id
                                ? {
                                    label: labelize(linkedAgreement.status || 'Draft'),
                                    className: accepted
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : terminalAgreementStatusKeys.has(statusKey)
                                            ? 'bg-rose-100 text-rose-800'
                                            : 'bg-blue-100 text-blue-800',
                                }
                                : { label: 'Not created', className: 'bg-slate-100 text-slate-700' }}
                            helper={linkedAgreement?.id ? '' : 'No linked service agreement yet.'}
                            actions={agreementActions}
                        >
                            {linkedAgreement?.id && (
                                <PreviewFields
                                    items={[
                                        { label: 'Amount', value: formatCurrency(agreementAmountCents(linkedAgreement)) },
                                        { label: 'Sent', value: formatAgreementDate(sentAt) || 'Not sent' },
                                        { label: 'Accepted', value: formatAgreementDate(acceptedAt) || 'Not accepted' },
                                    ]}
                                />
                            )}
                        </WorkflowActionRow>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 px-2 py-6 sm:px-3 lg:px-4">
            <div className="w-full space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <Link to="/company/leads" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                            &larr; Back to Leads
                        </Link>

                        <h2 className="text-3xl font-bold text-gray-800">Lead Detail</h2>
                        <p className="text-gray-600 mt-1">View and manage lead details.</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        {can("614") && (
                            <button
                                type="button"
                                onClick={() => navigate(`/company/leads/${lead.id}/edit`)}
                                className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                                Edit
                            </button>
                        )}
                    </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="space-y-6 lg:col-span-2">
                        <div className={panelClass}>
                            <div className="flex items-center justify-between mb-6">
                                <h1 className="text-3xl font-bold text-gray-900">{serviceName}</h1>
                                <span className="px-3 py-1 text-sm font-semibold rounded-full bg-blue-100 text-blue-800">
                                    {status}
                                </span>
                            </div>

                            <div className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                Shared Description
                                            </p>
                                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                                                Visible to homeowner
                                            </span>
                                        </div>
                                        <p className="mt-1 text-sm text-gray-600">
                                            This text is saved on the homeowner service request and can be seen by the homeowner/client account.
                                        </p>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSharedDescriptionOpen((open) => !open)}
                                            aria-expanded={sharedDescriptionOpen}
                                            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
                                        >
                                            {sharedDescriptionOpen ? (
                                                <FaChevronDown className="text-xs" />
                                            ) : (
                                                <FaChevronRight className="text-xs" />
                                            )}
                                            {sharedDescriptionOpen ? 'Collapse' : hasSharedDescription ? 'Expand' : 'Add'}
                                        </button>

                                        {can("614") && sharedDescriptionOpen && (
                                            <button
                                                type="button"
                                                onClick={saveDescription}
                                                disabled={
                                                    savingDescription ||
                                                    descriptionDraft === String(lead.serviceDescription || '')
                                                }
                                                className={[
                                                    'px-3 py-1 rounded-lg text-sm font-semibold transition border',
                                                    savingDescription ||
                                                        descriptionDraft === String(lead.serviceDescription || '')
                                                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100',
                                                ].join(' ')}
                                            >
                                                {savingDescription ? 'Saving...' : 'Save'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {sharedDescriptionOpen ? (
                                    <textarea
                                        className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        placeholder="Add the shared request description..."
                                        value={descriptionDraft}
                                        onChange={(e) => setDescriptionDraft(e.target.value)}
                                        readOnly={!can("614")}
                                        onBlur={() => {
                                            if (can("614") && descriptionDraft !== String(lead.serviceDescription || '')) {
                                                saveDescription();
                                            }
                                        }}
                                    />
                                ) : (
                                    <p className="mt-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
                                        {hasSharedDescription ? descriptionDraft : 'No shared description yet.'}
                                    </p>
                                )}
                            </div>

                            <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                                                Company Private Notes
                                            </p>
                                            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                                                Company only
                                            </span>
                                        </div>
                                        <p className="mt-1 text-sm text-amber-800">
                                            Internal notes for your team. These are stored under the company account, not on the homeowner request.
                                        </p>
                                    </div>

                                    {can("614") && (
                                        <button
                                            type="button"
                                            onClick={savePrivateNotes}
                                            disabled={
                                                savingPrivateNotes ||
                                                privateNotesDraft === privateNotesSavedValue
                                            }
                                            className={[
                                                'px-3 py-1 rounded-lg text-sm font-semibold transition border',
                                                savingPrivateNotes ||
                                                    privateNotesDraft === privateNotesSavedValue
                                                    ? 'bg-amber-100 text-amber-400 border-amber-200 cursor-not-allowed'
                                                    : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100',
                                            ].join(' ')}
                                        >
                                            {savingPrivateNotes ? 'Saving...' : 'Save'}
                                        </button>
                                    )}
                                </div>

                                <textarea
                                    className="mt-2 w-full min-h-[240px] p-3 border border-amber-300 rounded-lg focus:ring-amber-500 focus:border-amber-500 bg-white"
                                    placeholder="Add internal follow-up notes, pricing thoughts, access details, or sales context..."
                                    value={privateNotesDraft}
                                    onChange={(e) => setPrivateNotesDraft(e.target.value)}
                                    readOnly={!can("614")}
                                    onBlur={() => {
                                        if (
                                            can("614") &&
                                            !savingPrivateNotes &&
                                            privateNotesDraft !== privateNotesSavedValue
                                        ) {
                                            savePrivateNotes();
                                        }
                                    }}
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <InfoList
                                    title="Contact Info"
                                    items={[
                                        { label: 'Name', value: contactName },
                                        { label: 'Email', value: contactEmail, className: 'break-words' },
                                        { label: 'Phone', value: contactPhone },
                                        { label: 'Service Address', value: formattedServiceAddress, className: 'whitespace-pre-line' },
                                    ]}
                                />
                                <InfoList
                                    title="Lead Info"
                                    items={[
                                        { label: 'Submitted', value: formatDateValue(createdAt) },
                                        { label: 'Lead Source', value: activeLeadSource },
                                        { label: 'Created By', value: createdByDisplayName },
                                    ]}
                                />
                            </div>
                        </div>

                        {hasPublicIntakeDetails && (
                            <div className={panelClass}>
                                <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-900">Public Intake Details</h3>
                                        <p className="mt-1 text-sm text-gray-600">
                                            Submitted through the public no-account service request form.
                                        </p>
                                    </div>
                                    <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">
                                        Public form
                                    </span>
                                </div>

                                <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    {publicIntake.serviceType && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Service Type</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.serviceType}</dd>
                                        </div>
                                    )}
                                    {publicIntake.urgency && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Urgency</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.urgency}</dd>
                                        </div>
                                    )}
                                    {publicIntake.preferredContactMethod && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Preferred Contact</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.preferredContactMethod}</dd>
                                        </div>
                                    )}
                                    {publicIntake.bestTimeToContact && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Best Time to Contact</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.bestTimeToContact}</dd>
                                        </div>
                                    )}
                                    {publicIntake.preferredStartDate && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Preferred Start</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.preferredStartDate}</dd>
                                        </div>
                                    )}
                                    {publicIntake.currentProvider && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Current Provider</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.currentProvider}</dd>
                                        </div>
                                    )}
                                    {publicIntake.propertyType && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Property Type</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.propertyType}</dd>
                                        </div>
                                    )}
                                    {publicIntake.treeTypes && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Trees Around Pool</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.treeTypes}</dd>
                                        </div>
                                    )}
                                    {publicIntake.treeDebrisLevel && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Tree Debris Level</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.treeDebrisLevel}</dd>
                                        </div>
                                    )}
                                    {publicIntake.overhangingTrees && (
                                        <div className="md:col-span-2">
                                            <dt className="text-sm font-medium text-gray-500">Overhanging Trees / Landscaping</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.overhangingTrees}</dd>
                                        </div>
                                    )}
                                    {publicIntake.gateCode && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Gate Code</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.gateCode}</dd>
                                        </div>
                                    )}
                                    {publicIntake.petsOnProperty && (
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Pets</dt>
                                            <dd className="mt-1 text-base text-gray-900">{publicIntake.petsOnProperty}</dd>
                                        </div>
                                    )}
                                    {publicIntake.accessNotes && (
                                        <div className="md:col-span-2">
                                            <dt className="text-sm font-medium text-gray-500">Access Notes</dt>
                                            <dd className="mt-1 whitespace-pre-wrap text-base text-gray-900">{publicIntake.accessNotes}</dd>
                                        </div>
                                    )}
                                </dl>

                                {publicBodiesOfWater.length > 0 && (
                                    <div className="mt-6">
                                        <h4 className="text-base font-semibold text-gray-900">Pools & Spas</h4>
                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                            {publicBodiesOfWater.map((body, index) => (
                                                <div key={body.id || `public-body-${index}`} className="rounded-md border border-gray-200 bg-gray-50 p-4">
                                                    <p className="font-semibold text-gray-900">{body.name || body.type || `Pool / Spa ${index + 1}`}</p>
                                                    <p className="mt-1 text-sm text-gray-600">
                                                        {[body.type, body.sizeCategory, body.gallons ? `${body.gallons} gal` : '', body.waterType, body.condition, body.material].filter(Boolean).join(' / ') || 'No pool details submitted'}
                                                    </p>
                                                    {[body.length, body.width, body.depth].filter(Boolean).length > 0 && (
                                                        <p className="mt-1 text-sm text-gray-600">
                                                            Dimensions: {[body.length ? `${body.length} L` : '', body.width ? `${body.width} W` : '', body.depth ? `${body.depth} D` : ''].filter(Boolean).join(' / ')}
                                                        </p>
                                                    )}
                                                    {body.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{body.notes}</p>}
                                                    {Array.isArray(body.equipment) && body.equipment.length > 0 && (
                                                        <div className="mt-3 space-y-2">
                                                            {body.equipment.map((equipment, equipmentIndex) => (
                                                                <div key={equipment.id || `public-equipment-${index}-${equipmentIndex}`} className="rounded-md bg-white px-3 py-2 text-sm text-gray-700">
                                                                    <span className="font-semibold">{equipment.name || equipment.type || 'Equipment'}</span>
                                                                    {[equipment.make, equipment.model].filter(Boolean).length > 0 && (
                                                                        <span> - {[equipment.make, equipment.model].filter(Boolean).join(' ')}</span>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>

                    <div className="space-y-6">
                        {can("614") && (
                            <div className={panelClass}>
                                <h3 className="text-lg font-semibold text-gray-800">Lead Stage</h3>
                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    {LEAD_STAGE_OPTIONS.map((option) => {
                                        const selected = status === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleStatusChange(option.value)}
                                                disabled={savingStatus}
                                                className={[
                                                    'min-h-[68px] rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                                                    selected
                                                        ? leadStageButtonClasses[option.value]
                                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                                                ].join(' ')}
                                            >
                                                <span className="block text-sm font-bold">{option.label}</span>
                                                <span className="mt-1 block text-xs opacity-80">{option.helper}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {showCancelReason || status === 'Cancelled' ? (
                                    <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3">
                                        <label className="block text-sm font-semibold text-rose-800">Lost / cancelled reason</label>
                                        <textarea
                                            value={cancelReasonDraft}
                                            onChange={(event) => setCancelReasonDraft(event.target.value)}
                                            rows={3}
                                            className="mt-2 w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                                            placeholder="Price, timing, no response, wrong fit..."
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleStatusChange('Cancelled', { reason: cancelReasonDraft.trim() || 'No reason provided', skipCancellationDialog: true })}
                                            disabled={savingStatus}
                                            className="mt-2 w-full rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {savingStatus ? 'Saving...' : 'Save Cancelled Stage'}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        )}

                        {can("614") && (
                            <div className={panelClass}>
                                <h3 className="text-lg font-semibold text-gray-800">Lead Source</h3>
                                <select
                                    value={leadSourceDraft}
                                    onChange={(event) => {
                                        setLeadSourceDraft(event.target.value);
                                        saveLeadSource(event.target.value);
                                    }}
                                    disabled={savingLeadSource}
                                    className="mt-4 w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                                >
                                    {leadSources.map((sourceItem) => (
                                        <option key={sourceItem.id || sourceItem.name} value={sourceItem.name}>{sourceItem.name}</option>
                                    ))}
                                </select>
                                <div className="mt-3 flex gap-2">
                                    <input
                                        type="text"
                                        value={newLeadSourceDraft}
                                        onChange={(event) => setNewLeadSourceDraft(event.target.value)}
                                        className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                        placeholder="Add new source"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddLeadSource}
                                        disabled={savingLeadSource}
                                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        )}

                        {linkedCustomerId && (
                            <div className={panelClass}>
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                    Associated Customer
                                </h3>
                                <p className="text-gray-800 mb-3">{customerName || contactName || 'Linked customer'}</p>
                                <Link
                                    to={`/company/customers/details/${linkedCustomerId}`}
                                    className={actionButtonClass}
                                >
                                    View Customer Profile
                                </Link>
                            </div>
                        )}

                        {renderWorkflowActions()}
                    </div>
                </div>
            </div>
            <LeadCancellationDialog
                lead={showCancelDialog ? lead : null}
                targets={cancelDialogTargets}
                loadingTargets={loadingCancelTargets}
                saving={savingStatus}
                permissions={{
                    canDeleteServiceStop: can("246"),
                    canDeactivateCustomer: can("14"),
                    canRejectAgreement: can("400"),
                }}
	                onClose={closeCancelDialog}
	                onConfirm={confirmLeadCancellation}
	            />
            <ServiceAgreementSendDialog
                agreement={linkedAgreement}
                open={showAgreementSendDialog}
                sending={sendingAgreement}
                includeInspectionReport={linkedAgreement?.emailDelivery?.includeInspectionReport === true || linkedAgreement?.includeInspectionReport === true}
                hasLinkedInspectionReport={Boolean(
                    linkedAgreement?.inspectionReportId ||
                    linkedAgreement?.inspectionReportUrl ||
                    linkedAgreement?.inspectionReportStoragePath ||
                    estimateVisit?.inspectionReportId ||
                    estimateVisit?.inspectionReportUrl
                )}
                onClose={() => {
                    if (!sendingAgreement) setShowAgreementSendDialog(false);
                }}
                onConfirm={sendLinkedAgreementEmail}
            />
	        </div>
	    );
}
