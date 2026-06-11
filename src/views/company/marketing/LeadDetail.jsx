import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    getFirestore,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    setDoc,
    serverTimestamp,
    query,
    where,
    getDocs
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { Context } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ClipLoader } from 'react-spinners';
import { format } from 'date-fns';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import {
    debugServiceStopTypeWrite,
    resolveServiceStopTypeFields,
    SERVICE_STOP_TYPE_USE_CASES,
} from '../../../utils/serviceStopTypes/serviceStopTypeResolver';

const SERVICE_STOP_OPERATION_STATUS = {
    finished: 'Finished',
    notFinished: 'Not Finished',
    skipped: 'Skipped',
};

const SERVICE_ESTIMATE_VISIT_LABEL = 'Service Estimate';
const SERVICE_ESTIMATE_SCHEDULED_STATUS = 'Service Estimate Scheduled';

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

const EstimateSnapshot = ({ estimate }) => {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Estimate Details</h3>
            <dl className="space-y-2">
                <div>
                    <dt className="text-sm font-medium text-gray-500">Rate</dt>
                    <dd className="text-lg font-semibold text-gray-900">
                        ${estimate.rate?.toFixed ? estimate.rate.toFixed(2) : '0.00'}
                    </dd>
                </div>
                <div>
                    <dt className="text-sm font-medium text-gray-500">Status</dt>
                    <dd>
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                            {estimate.status}
                        </span>
                    </dd>
                </div>
                <div>
                    <dt className="text-sm font-medium text-gray-500">Last Date to Accept</dt>
                    <dd className="text-sm text-gray-600">
                        {estimate.lastDateToAccept ? format(estimate.lastDateToAccept.toDate(), 'PPP') : 'N/A'}
                    </dd>
                </div>
            </dl>

            <Link
                to={`/company/contract/detail/${estimate.id}`}
                className="block w-full text-center mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
                View Estimate
            </Link>
        </div>
    );
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

const PreEstimateVisitCard = ({
    lead,
    companyId,
    technicians,
    existingVisit,
    onVisitCreated
}) => {
    const { recentlySelectedCompany } = useContext(Context);
    const { requirePermission } = useCompanyPermissions();
    const db = getFirestore();
    const [serviceDate, setServiceDate] = useState('');
    const [techId, setTechId] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [companyServiceStopTypes, setCompanyServiceStopTypes] = useState([]);

    const badge = getVisitBadge(existingVisit);

    const defaultPreEstimateTasks = [
        {
            name: 'Verify service location details',
            description: 'Confirm address, access instructions, gate code, pets, bodies of water, and any missing property details.',
            estimatedTime: 15,
            rate: 0,
            status: 'Scheduled',
            priority: 'Normal',
        },
        {
            name: 'Get equipment information',
            description: 'Document equipment type, model, condition, and any visible issues.',
            estimatedTime: 15,
            rate: 0,
            status: 'Scheduled',
            priority: 'Normal',
        },
        {
            name: 'Test the water',
            description: 'Collect water readings and note any water quality concerns.',
            estimatedTime: 15,
            rate: 0,
            status: 'Scheduled',
            priority: 'Normal',
        },
        {
            name: 'Get yard access information',
            description: 'Find out how to access the yard, gate codes, pets, lock details, and entry restrictions.',
            estimatedTime: 10,
            rate: 0,
            status: 'Scheduled',
            priority: 'Normal',
        },
        {
            name: 'Note site-specific concerns',
            description: 'Record any special instructions, hazards, obstacles, or customer-specific requests.',
            estimatedTime: 10,
            rate: 0,
            status: 'Scheduled',
            priority: 'Normal',
        },
    ];

    useEffect(() => {
        if (!companyId) return;

        const fetchServiceStopTypes = async () => {
            try {
                const snapshot = await getDocs(collection(db, 'companies', companyId, 'companyServiceStopTypes'));
                setCompanyServiceStopTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (error) {
                console.warn('[LeadDetail][serviceStopTypesLoadFailed]', {
                    companyId,
                    error: error?.message || String(error),
                });
            }
        };

        fetchServiceStopTypes();
    }, [companyId, db]);

    const handleCreateVisit = async () => {
        if (!requirePermission("612", "respond to leads")) return;

        if (!companyId) {
            toast.error('No company selected.');
            return;
        }

        if (!lead?.customerId) {
            toast.error('Create a customer before scheduling a service estimate.');
            return;
        }

        if (!serviceDate) {
            toast.error('Please select a date for the visit.');
            return;
        }

        setSaving(true);
        try {
            const selectedTech = technicians.find(t => t.userId === techId || t.id === techId);

            const serviceStopId = 'comp_ss_' + uuidv4();

            let serviceStopCount = 0;

            const ref = doc(db, 'companies', recentlySelectedCompany, 'settings', 'recurringServiceStops');
            const snap = await getDoc(ref);

            if (snap.exists()) {
                const data = snap.data();
                serviceStopCount = typeof data.increment === 'number' ? data.increment : 0;
            }

            const updatedRecurringServiceStopCount = serviceStopCount + 1;
            await updateDoc(ref, { increment: updatedRecurringServiceStopCount });

            const serviceStopInternalId = 'SS' + String(serviceStopCount);
            const serviceStopRef = doc(db, 'companies', companyId, 'serviceStops', serviceStopId);

            const totalEstimatedDuration = defaultPreEstimateTasks.reduce(
                (sum, task) => sum + (task.estimatedTime || 0),
                0
            );
            const resolvedTypeFields = resolveServiceStopTypeFields({
                companyServiceStopTypes,
                fallbackName: SERVICE_ESTIMATE_VISIT_LABEL,
                useCase: SERVICE_STOP_TYPE_USE_CASES.serviceEstimate,
                context: 'LeadDetail.PreEstimateVisitCard.createVisit',
            });

            const resolvedCustomerName =
                lead.customerName ||
                lead.ownerDetails?.displayName ||
                lead.homeownerName ||
                '';

            const stopPayload = {
                id: serviceStopId,
                internalId: serviceStopInternalId,

                companyId,
                mainCompanyId: companyId,
                companyName: lead.companyName || '',

                customerId: lead.customerId || '',
                customerName: resolvedCustomerName,

                address: lead.serviceLocationAddress || null,
                serviceLocationId: lead.serviceLocationId || '',

                dateCreated: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),

                serviceDate: new Date(serviceDate),
                startTime: null,
                endTime: null,

                duration: 0,
                estimatedDuration: totalEstimatedDuration,

                tech: selectedTech?.userName || selectedTech?.displayName || selectedTech?.name || '',
                techId: selectedTech?.userId || selectedTech?.id || '',

                recurringServiceStopId: '',

                description: notes || lead.serviceDescription || 'Service estimate visit',

                typeId: resolvedTypeFields.typeId,
                type: resolvedTypeFields.type,
                typeImage: resolvedTypeFields.typeImage,
                category: resolvedTypeFields.category,
                serviceStopTypeUseCaseRawValue: resolvedTypeFields.serviceStopTypeUseCaseRawValue,

                jobId: '',
                jobName: lead.serviceName || 'Lead Visit',

                operationStatus: SERVICE_STOP_OPERATION_STATUS.notFinished,
                billingStatus: 'Non Billable',

                includeReadings: false,
                includeDosages: false,
                otherCompany: false,

                laborContractId: '',
                contractedCompanyId: '',

                photoUrls: [],
                isInvoiced: false,
                rate: 0,

                leadId: lead.id,
                estimateId: lead.estimateId || '',
                source: 'LeadDetail',

                isCompleted: false,
                isSkipped: false,
            };

            debugServiceStopTypeWrite({
                context: 'LeadDetail.PreEstimateVisitCard.createVisit',
                payload: stopPayload,
            });
            await setDoc(serviceStopRef, stopPayload);

            for (const task of defaultPreEstimateTasks) {
                const taskId = 'comp_ss_tas_' + uuidv4();
                const taskInternalId = uuidv4();

                const taskRef = doc(
                    db,
                    'companies',
                    companyId,
                    'serviceStops',
                    serviceStopId,
                    'tasks',
                    taskId
                );

                await setDoc(taskRef, {
                    id: taskId,
                    internalId: taskInternalId,

                    name: task.name,
                    description: task.description,
                    estimatedTime: task.estimatedTime,
                    rate: task.rate,
                    status: task.status,
                    priority: task.priority,

                    companyId,
                    customerId: lead.customerId || '',
                    customerName: resolvedCustomerName,

                    serviceStopId,
                    serviceStopInternalId,

                    workerId: selectedTech?.userId || selectedTech?.id || '',
                    workerName: selectedTech?.userName || selectedTech?.displayName || selectedTech?.name || '',

                    workOrderTaskId: '',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),

                    source: 'LeadDetailServiceEstimate',
                    type: 'serviceEstimateTask',
                    operationStatus: SERVICE_STOP_OPERATION_STATUS.notFinished,
                    billingStatus: 'Non Billable',
                    isCompleted: false,
                    isSkipped: false,
                });
            }

            await updateDoc(doc(db, 'homeownerServiceRequests', lead.id), {
                serviceEstimateServiceStopId: serviceStopId,
                initialEstimateServiceStopId: serviceStopId
            });

            const leadRef = doc(db, 'homeownerServiceRequests', lead.id);
            const newStatus = SERVICE_ESTIMATE_SCHEDULED_STATUS;
            await updateDoc(leadRef, { status: newStatus });
            toast.success(`Status updated to ${newStatus}`);

            toast.success('Service estimate created.');
            onVisitCreated?.({
                id: serviceStopId,
                ...stopPayload
            });
        } catch (error) {
            console.error('Error creating estimate visit:', error);
            toast.error('Failed to create estimate visit.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Service Estimate</h3>
                {badge && (
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${badge.className}`}>
                        {badge.label}
                    </span>
                )}
            </div>

            {existingVisit ? (
                <div className="space-y-3">
                    <div>
                        <p className="text-sm font-medium text-gray-500">Type</p>
                        <p className="text-gray-900">{existingVisit.type || SERVICE_ESTIMATE_VISIT_LABEL}</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Scheduled For</p>
                        <p className="text-gray-900">
                            {existingVisit.serviceDate?.toDate
                                ? format(existingVisit.serviceDate.toDate(), 'PPP')
                                : existingVisit.serviceDate
                                    ? format(new Date(existingVisit.serviceDate), 'PPP')
                                    : 'N/A'}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Technician</p>
                        <p className="text-gray-900">{existingVisit.tech || 'Unassigned'}</p>
                    </div>

                    <Link
                        to={`/company/serviceStops/detail/${existingVisit.id}`}
                        className="block w-full text-center py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium"
                    >
                        View Visit
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Schedule a fact-finding service estimate before sending pricing.
                    </p>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Visit Type</label>
                        <input
                            value={SERVICE_ESTIMATE_VISIT_LABEL}
                            disabled
                            className="w-full p-2 border rounded-md bg-gray-50 text-gray-700"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Service Date</label>
                        <input
                            type="date"
                            value={serviceDate}
                            onChange={(e) => setServiceDate(e.target.value)}
                            className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Technician</label>
                        <select
                            value={techId}
                            onChange={(e) => setTechId(e.target.value)}
                            className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">Unassigned</option>
                            {technicians.map(tech => (
                                <option key={tech.userId || tech.id} value={tech.userId || tech.id}>
                                    {tech.userName || tech.displayName || tech.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea
                            rows={4}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Scope, access notes, homeowner concerns, what to inspect..."
                            className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    <button
                        onClick={handleCreateVisit}
                        disabled={saving}
                        className="w-full py-2.5 px-4 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 font-medium disabled:opacity-60"
                    >
                        {saving ? 'Creating Visit...' : 'Create Service Estimate'}
                    </button>
                </div>
            )}
        </div>
    );
};

const PreEstimateVisitLockedCard = ({ lead }) => {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Service Estimate</h3>
                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
                    Locked
                </span>
            </div>

            <div className="space-y-4">
                <p className="text-sm text-gray-600">
                    Create the customer first before scheduling a fact-finding service estimate.
                </p>

                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-sm font-medium text-amber-800">
                        A company customer profile is required before this visit can be created. Use the Lead Conversion action on this page to create and link the customer from the homeowner request.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default function LeadDetail() {
    const { leadId } = useParams();
    const navigate = useNavigate();
    const { recentlySelectedCompany } = useContext(Context);
    const { can, requirePermission } = useCompanyPermissions();
    const db = getFirestore();

    const [lead, setLead] = useState(null);
    const [estimate, setEstimate] = useState(null);
    const [loading, setLoading] = useState(true);
    const [technicians, setTechnicians] = useState([]);
    const [estimateVisit, setEstimateVisit] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletingLead, setDeletingLead] = useState(false);

    const [savingDescription, setSavingDescription] = useState(false);
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const [savingPrivateNotes, setSavingPrivateNotes] = useState(false);
    const [privateNotesDraft, setPrivateNotesDraft] = useState('');
    const [privateNotesSavedValue, setPrivateNotesSavedValue] = useState('');
    const [privateNotesDocExists, setPrivateNotesDocExists] = useState(false);

    useEffect(() => {
        if (!leadId || !recentlySelectedCompany) {
            setLoading(false);
            return;
        }

        const fetchLeadDetails = async () => {
            setLoading(true);
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
                    setLead(enhancedLead);
                    setDescriptionDraft(leadData.serviceDescription || '');

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

                    const techSnap = await getDocs(
                        collection(db, 'companies', recentlySelectedCompany, 'companyUsers')
                    );
                    setTechnicians(techSnap.docs.map(d => ({ id: d.id, ...d.data() })));

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

    const handleStatusChange = async (newStatus) => {
        if (!requirePermission("614", "update leads")) return;

        const leadRef = doc(db, 'homeownerServiceRequests', leadId);
        const originalStatus = lead.status;

        setLead(prev => ({ ...prev, status: newStatus }));

        try {
            switch (newStatus) {
                case 'Pending':
                    await updateDoc(leadRef, { dateCompleted: null });
                    break;
                case 'In Progress':
                    await updateDoc(leadRef, { dateCompleted: null });
                    break;
                case 'Completed':

                    await updateDoc(leadRef, { dateCompleted: new Date() });
                    break;
                case 'Cancelled':
                    await updateDoc(leadRef, { dateCompleted: new Date() });
                    break;
                default:
                    break;
            }
            await updateDoc(leadRef, { status: newStatus });
            toast.success(`Status updated to ${newStatus}`);
        } catch (error) {
            setLead(prev => ({ ...prev, status: originalStatus }));
            toast.error('Failed to update status.');
        }
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

            toast.success('Description updated.');
        } catch (error) {
            console.error('Error updating description:', error);
            toast.error('Failed to update description.');
        } finally {
            setSavingDescription(false);
        }
    };

    const handleDeleteLead = async () => {
        if (!requirePermission("616", "delete leads")) return;

        setDeletingLead(true);
        try {
            await deleteDoc(doc(db, 'homeownerServiceRequests', leadId));
            toast.success('Lead deleted.');
            navigate('/company/leads');
        } catch (error) {
            console.error('Error deleting lead:', error);
            toast.error('Failed to delete lead.');
            setDeletingLead(false);
            setShowDeleteModal(false);
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
        ownerDetails,
        serviceLocationAddress,
        source,
        customerId,
        customerName,
        creatorName,
        homeownerName,
        homeownerEmail,
        homeownerPhone
    } = lead;
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
    const linkedServiceLocationId = lead.serviceLocationId || lead.companyServiceLocationId || '';
    const buildCreateJobPath = () => {
        const basePath = `/company/jobs/createNew/${lead.customerId}`;
        return linkedServiceLocationId ? `${basePath}/${linkedServiceLocationId}` : basePath;
    };

    const handleCreateJobFromLead = () => {
        if (!lead.customerId) {
            toast.error('Create a customer before creating a job from this lead.');
            return;
        }

        navigate(buildCreateJobPath(), {
            state: {
                leadContext: {
                    id: lead.id,
                    source: lead.source || '',
                    status: lead.status || '',
                    serviceName: lead.serviceName || '',
                    serviceDescription: lead.serviceDescription || '',
                    customerId: lead.customerId || '',
                    customerName: lead.customerName || '',
                    serviceLocationId: linkedServiceLocationId,
                },
            },
        });
    };

    const renderActions = () => {
        if (!customerId) {
            if (!can("612")) return null;

            return (
                <button
                    onClick={() => navigate(`/company/customers/create-from-lead/${lead.id}`)}
                    className="w-full py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium"
                >
                    Convert Lead to Customer
                </button>
            );
        }

        if (customerId) {
            if (!can("22") && !can("612")) return null;

            return (
                <>
                    {can("22") && (
                        <button
                            onClick={handleCreateJobFromLead}
                            className="w-full py-2.5 px-4 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 font-medium"
                        >
                            Create Job
                        </button>
                    )}
                    {can("612") && (
                        <button
                            onClick={() => navigate(`/company/recurring-contracts/createNew/${lead.customerId}`)}
                            className="w-full py-2.5 px-4 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium"
                        >
                            Send Estimate
                        </button>
                    )}
                </>
            );
        }

        return null;
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="mx-auto">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
                        {can("616") && (
                            <button
                                type="button"
                                onClick={() => setShowDeleteModal(true)}
                                className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                            >
                                Delete
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white p-8 rounded-2xl shadow-lg">
                            <div className="flex items-center justify-between mb-6">
                                <h1 className="text-3xl font-bold text-gray-900">{serviceName}</h1>
                                <span className="px-3 py-1 text-sm font-semibold rounded-full bg-blue-100 text-blue-800">
                                    {status}
                                </span>
                            </div>

                            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 mb-6">
                                <div className="flex items-center justify-between gap-3">
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

                                    {can("614") && (
                                        <button
                                            type="button"
                                            onClick={saveDescription}
                                            disabled={
                                                savingDescription ||
                                                descriptionDraft === (lead.serviceDescription || '')
                                            }
                                            className={[
                                                'px-3 py-1 rounded-lg text-sm font-semibold transition border',
                                                savingDescription ||
                                                    descriptionDraft === (lead.serviceDescription || '')
                                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100',
                                            ].join(' ')}
                                        >
                                            {savingDescription ? 'Saving...' : 'Save'}
                                        </button>
                                    )}
                                </div>

                                <textarea
                                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                                    placeholder="Add the shared request description..."
                                    value={descriptionDraft}
                                    onChange={(e) => setDescriptionDraft(e.target.value)}
                                    readOnly={!can("614")}
                                    onBlur={() => {
                                        if (can("614") && descriptionDraft !== (lead.serviceDescription || '')) {
                                            saveDescription();
                                        }
                                    }}
                                />
                            </div>

                            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 mb-6">
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
                                    className="mt-2 w-full min-h-[120px] p-3 border border-amber-300 rounded-lg focus:ring-amber-500 focus:border-amber-500 bg-white"
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

                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-4">
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Submitted On</dt>
                                    <dd className="mt-1 text-lg text-gray-900">
                                        {createdAt ? format(createdAt.toDate(), 'PPP') : 'N/A'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500">Lead Source</dt>
                                    <dd className="mt-1 text-lg text-gray-900">{source || 'N/A'}</dd>
                                </div>
                                {creatorName && (
                                    <div>
                                        <dt className="text-sm font-medium text-gray-500">Created By</dt>
                                        <dd className="mt-1 text-lg text-gray-900">{creatorName}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>

                        {hasPublicIntakeDetails && (
                            <div className="bg-white p-8 rounded-2xl shadow-lg">
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
                                                <div key={body.id || `public-body-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
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

                        <div className="bg-white p-8 rounded-2xl shadow-lg">
                            <h3 className="text-xl font-bold text-gray-900 mb-6">Homeowner & Location</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <h4 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">
                                        Contact Info
                                    </h4>
                                    <dl>
                                        <div className="mb-4">
                                            <dt className="text-sm font-medium text-gray-500">Name</dt>
                                            <dd className="text-lg text-gray-900">
                                                {customerName || ownerDetails.displayName || homeownerName}
                                            </dd>
                                        </div>
                                        <div className="mb-4">
                                            <dt className="text-sm font-medium text-gray-500">Email</dt>
                                            <dd className="text-lg text-gray-900 break-words">
                                                {ownerDetails.email || homeownerEmail || 'N/A'}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-sm font-medium text-gray-500">Phone</dt>
                                            <dd className="text-lg text-gray-900">
                                                {ownerDetails.phoneNumber || homeownerPhone || 'N/A'}
                                            </dd>
                                        </div>
                                    </dl>
                                </div>

                                {serviceLocationAddress && (
                                    <div>
                                        <h4 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">
                                            Service Address
                                        </h4>
                                        <address className="not-italic text-lg text-gray-900">
                                            {serviceLocationAddress.streetAddress}
                                            <br />
                                            {serviceLocationAddress.city}, {serviceLocationAddress.state}{' '}
                                            {serviceLocationAddress.zip}
                                        </address>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {can("614") && (
                            <div className="bg-white p-6 rounded-2xl shadow-lg">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Manage Status</h3>
                                <select
                                    value={status}
                                    onChange={(e) => handleStatusChange(e.target.value)}
                                    className="w-full p-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="Pending">Pending</option>
                                    <option value="In Progress">In Progress</option>
                                    <option value="Completed">Completed</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                            </div>
                        )}

                        {customerId && can("612") ? (
                            <PreEstimateVisitCard
                                lead={lead}
                                companyId={recentlySelectedCompany}
                                technicians={technicians}
                                existingVisit={estimateVisit}
                                onVisitCreated={setEstimateVisit}
                            />
                        ) : !customerId && can("612") ? (
                            <PreEstimateVisitLockedCard lead={lead} />
                        ) : null}

                        {estimate ? (
                            <EstimateSnapshot estimate={estimate} />
                        ) : (
                            <>
                                {customerId && (
                                    <div className="bg-white p-6 rounded-2xl shadow-lg">
                                        <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                            Associated Customer
                                        </h3>
                                        <p className="text-gray-800 mb-3">{customerName}</p>
                                        <Link
                                            to={`/company/customers/details/${customerId}`}
                                            className="block w-full text-center py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium"
                                        >
                                            View Customer Profile
                                        </Link>
                                    </div>
                                )}

                                {(can("612") || can("22")) && (
                                    <div className="bg-white p-6 rounded-2xl shadow-lg">
                                        <h3 className="text-lg font-semibold text-gray-800 mb-4">
                                            {customerId ? 'Next Steps' : 'Lead Conversion'}
                                        </h3>
                                        <div className="space-y-3">{renderActions()}</div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                        <h3 className="text-xl font-bold text-gray-900">Delete Lead</h3>
                        <p className="mt-3 text-sm text-gray-600">
                            Delete this lead permanently? Any linked customer, estimate, or scheduled visit will stay in place.
                        </p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowDeleteModal(false)}
                                disabled={deletingLead}
                                className="rounded-md bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-300 disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteLead}
                                disabled={deletingLead}
                                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                            >
                                {deletingLead ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
