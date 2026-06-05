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
            toast.error('Create a customer before scheduling a pre-estimate visit.');
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
                fallbackName: 'Initial Estimate Visit',
                useCase: SERVICE_STOP_TYPE_USE_CASES.estimate,
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

                description: notes || lead.serviceDescription || 'Initial estimate visit',

                typeId: resolvedTypeFields.typeId,
                type: resolvedTypeFields.type,
                typeImage: resolvedTypeFields.typeImage,
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

                    source: 'LeadDetailPreEstimate',
                    type: 'preEstimateTask',
                    operationStatus: SERVICE_STOP_OPERATION_STATUS.notFinished,
                    billingStatus: 'Non Billable',
                    isCompleted: false,
                    isSkipped: false,
                });
            }

            await updateDoc(doc(db, 'homeownerServiceRequests', lead.id), {
                initialEstimateServiceStopId: serviceStopId
            });

            const leadRef = doc(db, 'homeownerServiceRequests', lead.id);
            const newStatus = 'Initial Estimate Visit Scheduled';
            await updateDoc(leadRef, { status: newStatus });
            toast.success(`Status updated to ${newStatus}`);

            toast.success('Initial estimate visit created.');
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
                <h3 className="text-lg font-semibold text-gray-800">Pre-Estimate Visit</h3>
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
                        <p className="text-gray-900">{existingVisit.type || 'Initial Estimate Visit'}</p>
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
                        Schedule an on-site visit before creating the estimate.
                    </p>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Visit Type</label>
                        <input
                            value="Initial Estimate Visit"
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
                        {saving ? 'Creating Visit...' : 'Create Initial Estimate Visit'}
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
                <h3 className="text-lg font-semibold text-gray-800">Pre-Estimate Visit</h3>
                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
                    Locked
                </span>
            </div>

            <div className="space-y-4">
                <p className="text-sm text-gray-600">
                    Create the customer first before scheduling a pre-estimate visit.
                </p>

                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-sm font-medium text-amber-800">
                        A customer profile is required before this visit can be created.
                    </p>
                </div>

                <Link
                    to={`/company/customers/create-from-lead/${lead.id}`}
                    className="block w-full text-center py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium"
                >
                    Create Customer
                </Link>
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

    const [savingDescription, setSavingDescription] = useState(false);
    const [descriptionDraft, setDescriptionDraft] = useState('');

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

                    if (leadData.initialEstimateServiceStopId) {
                        const stopSnap = await getDoc(
                            doc(
                                db,
                                'companies',
                                recentlySelectedCompany,
                                'serviceStops',
                                leadData.initialEstimateServiceStopId
                            )
                        );

                        if (stopSnap.exists()) {
                            setEstimateVisit({ id: stopSnap.id, ...stopSnap.data() });
                        }
                    } else {
                        const visitQuery = query(
                            collection(db, 'companies', recentlySelectedCompany, 'serviceStops'),
                            where('leadId', '==', leadId),
                            where('typeId', '==', 'initialEstimate')
                        );
                        const visitSnap = await getDocs(visitQuery);

                        if (!visitSnap.empty) {
                            const firstVisit = visitSnap.docs[0];
                            setEstimateVisit({ id: firstVisit.id, ...firstVisit.data() });
                        }
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
        homeownerName
    } = lead;

    const renderActions = () => {
        if (source === 'Manual' && !customerId) {
            if (!can("612")) return null;

            return (
                <button
                    onClick={() => navigate(`/company/customers/create-from-lead/${lead.id}`)}
                    className="w-full py-2.5 px-4 rounded-md text-white bg-blue-600 hover:bg-blue-700 font-medium"
                >
                    Create Customer
                </button>
            );
        }

        if (customerId || source !== 'Manual') {
            if (!can("612")) return null;

            return (
                <button
                    onClick={() => navigate(`/company/recurring-contracts/createNew/${lead.customerId}`)}
                    className="w-full py-2.5 px-4 rounded-md text-white bg-green-600 hover:bg-green-700 font-medium"
                >
                    Send Estimate
                </button>
            );
        }

        return null;
    };

    return (
        <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-screen">
            <div className="mx-auto">
                <div className="mb-6">
                    <Link to="/company/leads" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                        &larr; Back to Leads
                    </Link>

                    <h2 className="text-3xl font-bold text-gray-800">Lead Detail</h2>
                    <p className="text-gray-600 mt-1">View and manage lead details.</p>
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
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Description
                                    </p>

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
                                    placeholder="Add lead description..."
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
                                                {ownerDetails.email}
                                            </dd>
                                        </div>
                                        {ownerDetails.phoneNumber && (
                                            <div>
                                                <dt className="text-sm font-medium text-gray-500">Phone</dt>
                                                <dd className="text-lg text-gray-900">
                                                    {ownerDetails.phoneNumber}
                                                </dd>
                                            </div>
                                        )}
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

                                {can("612") && (
                                    <div className="bg-white p-6 rounded-2xl shadow-lg">
                                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Actions</h3>
                                        <div className="space-y-3">{renderActions()}</div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
