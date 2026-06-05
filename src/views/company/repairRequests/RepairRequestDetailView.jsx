import React, { useEffect, useState, useContext } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { arrayUnion, collection, doc, getDoc, getDocs, query, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db } from '../../../utils/config';
import {
  REPAIR_REQUEST_STATUS,
  REPAIR_REQUEST_STATUS_OPTIONS,
  RepairRequest,
  displayRepairRequestStatus,
  normalizeRepairRequestStatus,
  repairRequestStatusForSelection,
} from '../../../utils/models/RepairRequest';
import { EQUIPMENT_STATUS, EQUIPMENT_STATUS_OPTIONS } from '../../../utils/models/Equipment';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { displayRecordReference, linkedReferenceText } from '../../../utils/displayReferences';

const RepairRequestDetailView = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const { repairRequestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [repairRequest, setRepairRequest] = useState(null);
  const [sourcePath, setSourcePath] = useState(location.state?.sourcePath || "company");
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    status: REPAIR_REQUEST_STATUS.UNRESOLVED,
  });
  const [savingStatus, setSavingStatus] = useState(false);
  const [connectedEquipmentStatus, setConnectedEquipmentStatus] = useState(EQUIPMENT_STATUS.OPERATIONAL);
  const [savingEquipmentStatus, setSavingEquipmentStatus] = useState(false);

  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [availableJobs, setAvailableJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [connectingJob, setConnectingJob] = useState(false);
  const repairRequestJobIdsKey = (repairRequest?.jobIds || []).join("|");

  const getRequestRef = (path = sourcePath) => (
    path === "homeowner"
      ? doc(db, 'homeownerRepairRequests', repairRequestId)
      : doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId)
  );

  const getConnectedEquipmentRef = () => {
    if (!repairRequest?.equipmentId) return null;

    return sourcePath === "homeowner"
      ? doc(db, "homeownerEquipment", repairRequest.equipmentId)
      : doc(db, "companies", recentlySelectedCompany, "equipment", repairRequest.equipmentId);
  };

  const getDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "number") return new Date(value);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getDateMillis = (value) => {
    const date = getDateValue(value);
    return date ? date.getTime() : 0;
  };

  const formatJobOption = (job) => {
    const title = displayRecordReference(job, "Job");
    const description = job.description || job.type || "No description";
    const date = getDateValue(job.dateCreated || job.createdAt);
    const dateLabel = date ? format(date, "MMM d, yyyy") : "No date";
    const status = job.operationStatus || job.billingStatus || "No status";

    return `${title} - ${description} (${status}, ${dateLabel})`;
  };

  useEffect(() => {
    const fetchRepairRequest = async () => {
      if (recentlySelectedCompany && repairRequestId) {
        try {
          const preferredSourcePath = location.state?.sourcePath || "company";
          const fallbackSourcePath = preferredSourcePath === "homeowner" ? "company" : "homeowner";
          let docSnap = await getDoc(getRequestRef(preferredSourcePath));
          let loadedSourcePath = preferredSourcePath;

          if (!docSnap.exists()) {
            docSnap = await getDoc(getRequestRef(fallbackSourcePath));
            loadedSourcePath = fallbackSourcePath;
          }

          if (docSnap.exists()) {
            const req = RepairRequest.fromFirestore(docSnap);
            setRepairRequest(req);
            setSourcePath(loadedSourcePath);
            setDescriptionDraft(req.description || "");
            setFormData({
              status: repairRequestStatusForSelection(req.status),
            });
          } else {
            console.log("No such document!");
          }
        } catch (err) {
          console.error("Error fetching repair request:", err);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchRepairRequest();
  }, [repairRequestId, recentlySelectedCompany, location.state?.sourcePath]);

  useEffect(() => {
    const fetchCustomerJobs = async () => {
      if (!recentlySelectedCompany || !repairRequest?.customerId) {
        setAvailableJobs([]);
        setSelectedJobId("");
        return;
      }

      try {
        setLoadingJobs(true);

        const jobsSnap = await getDocs(
          query(
            collection(db, "companies", recentlySelectedCompany, "workOrders"),
            where("customerId", "==", repairRequest.customerId)
          )
        );

        const jobs = jobsSnap.docs
          .map((jobDoc) => ({
            id: jobDoc.id,
            ...jobDoc.data(),
          }))
          .sort((a, b) => getDateMillis(b.dateCreated || b.createdAt) - getDateMillis(a.dateCreated || a.createdAt));

        const connectedIds = new Set(repairRequest.jobIds || []);
        const firstAvailableJob = jobs.find((job) => !connectedIds.has(job.id));

        setAvailableJobs(jobs);
        setSelectedJobId((prev) => (
          prev && jobs.some((job) => job.id === prev && !connectedIds.has(job.id))
            ? prev
            : firstAvailableJob?.id || ""
        ));
      } catch (error) {
        console.error("Error fetching customer jobs:", error);
        setAvailableJobs([]);
        setSelectedJobId("");
      } finally {
        setLoadingJobs(false);
      }
    };

    fetchCustomerJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, repairRequest?.customerId, repairRequestJobIdsKey]);

  useEffect(() => {
    const fetchConnectedEquipmentStatus = async () => {
      const equipmentRef = getConnectedEquipmentRef();

      if (!equipmentRef) {
        setConnectedEquipmentStatus(EQUIPMENT_STATUS.OPERATIONAL);
        return;
      }

      try {
        const equipmentSnap = await getDoc(equipmentRef);
        const equipmentStatus = equipmentSnap.exists()
          ? equipmentSnap.data()?.status || EQUIPMENT_STATUS.OPERATIONAL
          : EQUIPMENT_STATUS.OPERATIONAL;

        setConnectedEquipmentStatus(equipmentStatus);
      } catch (error) {
        console.error("Error loading connected equipment status:", error);
        setConnectedEquipmentStatus(EQUIPMENT_STATUS.OPERATIONAL);
      }
    };

    fetchConnectedEquipmentStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairRequest?.equipmentId, sourcePath, recentlySelectedCompany]);

  const handleCreateJob = () => {
    if (!requirePermission("22", "create jobs")) return;
    navigate(`/company/jobs/createNew`, {
      state: {
        repairRequest: {
          ...repairRequest,
          sourcePath,
        },
        repairRequestSourcePath: sourcePath,
      },
    });
  };

  const handleStatusChange = async (e) => {
    const status = repairRequestStatusForSelection(e.target.value);
    const previousStatus = repairRequestStatusForSelection(repairRequest?.status);

    if (!requirePermission("34", "update repair requests")) return;

    setFormData((prev) => ({
      ...prev,
      status,
    }));

    if (!repairRequest || status === previousStatus || savingStatus) return;

    try {
      setSavingStatus(true);

      await updateDoc(getRequestRef(), {
        status,
      });

      if (
        status === REPAIR_REQUEST_STATUS.RESOLVED &&
        repairRequest?.equipmentId &&
        connectedEquipmentStatus
      ) {
        try {
          await updateDoc(getConnectedEquipmentRef(), {
            status: connectedEquipmentStatus,
          });
        } catch (equipmentError) {
          console.error("Error updating connected equipment status:", equipmentError);
          alert("Repair request status was updated, but the connected equipment status could not be saved.");
        }
      }

      setRepairRequest((prev) => ({
        ...prev,
        status,
      }));
    } catch (error) {
      console.error("Error updating repair request status:", error);
      alert("Failed to update repair request status.");
      setFormData((prev) => ({
        ...prev,
        status: previousStatus,
      }));
    } finally {
      setSavingStatus(false);
    }
  };

  const handleConnectedEquipmentStatusChange = async (e) => {
    const status = e.target.value;

    setConnectedEquipmentStatus(status);

    if (!requirePermission("34", "update repair requests")) return;
    if (!repairRequest?.equipmentId || !status || savingEquipmentStatus) return;

    try {
      setSavingEquipmentStatus(true);
      await updateDoc(getConnectedEquipmentRef(), {
        status,
      });
    } catch (error) {
      console.error("Error updating connected equipment status:", error);
      alert("Failed to update connected equipment status.");
    } finally {
      setSavingEquipmentStatus(false);
    }
  };

  const saveDescription = async () => {
    if (!requirePermission("34", "update repair requests")) return;

    if (!repairRequest || savingDescription) return;
    if (descriptionDraft === (repairRequest.description || "")) return;

    try {
      setSavingDescription(true);

      const requestRef = getRequestRef();

      await updateDoc(requestRef, {
        description: descriptionDraft,
      });

      setRepairRequest(prev => ({
        ...prev,
        description: descriptionDraft,
      }));
    } catch (error) {
      console.error("Error updating description:", error);
      alert("Failed to save description.");
    } finally {
      setSavingDescription(false);
    }
  };

  const handleConnectExistingJob = async () => {
    if (!selectedJobId || !repairRequest?.id || connectingJob) return;
    if (!requirePermission("34", "update repair requests")) return;
    if (!requirePermission("24", "update jobs")) return;

    try {
      setConnectingJob(true);

      const requestRef = getRequestRef();
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", selectedJobId);

      await Promise.all([
        updateDoc(requestRef, {
          jobIds: arrayUnion(selectedJobId),
          status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
        }),
        updateDoc(jobRef, {
          repairRequestId: repairRequest.id,
          repairRequestSourcePath: sourcePath,
        }),
      ]);

      setRepairRequest((prev) => ({
        ...prev,
        jobIds: Array.from(new Set([...(prev?.jobIds || []), selectedJobId])),
        status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
      }));
      setFormData((prev) => ({
        ...prev,
        status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
      }));
      setAvailableJobs((prev) => prev.map((job) => (
        job.id === selectedJobId
          ? {
            ...job,
            repairRequestId: repairRequest.id,
            repairRequestSourcePath: sourcePath,
          }
          : job
      )));
      setSelectedJobId("");
    } catch (error) {
      console.error("Error connecting job to repair request:", error);
      alert("Failed to connect the job to this repair request.");
    } finally {
      setConnectingJob(false);
    }
  };

  const handleDelete = async () => {
    if (!requirePermission("36", "delete repair requests")) return;

    const confirmed = window.confirm('Are you sure you want to delete this repair request?');
    if (!confirmed) return;

    try {
      const requestRef = getRequestRef();
      await deleteDoc(requestRef);
      navigate('/company/repair-requests');
    } catch (error) {
      console.error('Error deleting repair request:', error);
      alert('Failed to delete repair request.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-lg">Loading request details...</p>
      </div>
    );
  }

  if (!repairRequest) {
    return <div className="text-center p-8">Repair Request not found.</div>;
  }

  const photoUrls = repairRequest.photoUrls || [];
  const jobIds = repairRequest.jobIds || [];
  const connectedJobIds = new Set(jobIds);
  const connectableJobs = availableJobs.filter((job) => !connectedJobIds.has(job.id));
  const availableJobsById = new Map(availableJobs.map((job) => [job.id, job]));

  return (
    <div className='min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8'>
      <div className="max-w-screen-xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <Link
              to={"/company/repair-requests"}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >&larr; Back to Repair Requests</Link>
            <h2 className="text-3xl font-bold text-gray-800">Repair Request Details</h2>
            <p className="text-sm text-gray-500">{displayRepairRequestStatus(repairRequest.status)} request</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">Request Details</h3>
              </div>

              <div className="space-y-6">
                {/* Description (always editable) */}
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>

                    {can("34") && (
                      <button
                        type="button"
                        onClick={saveDescription}
                        disabled={savingDescription || descriptionDraft === (repairRequest.description || "")}
                        className={[
                          "px-3 py-1 rounded-lg text-sm font-semibold transition border",
                          savingDescription || descriptionDraft === (repairRequest.description || "")
                            ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                        ].join(" ")}
                      >
                        {savingDescription ? "Saving..." : "Save"}
                      </button>
                    )}
                  </div>

                  <textarea
                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                    placeholder="Add repair request description..."
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    readOnly={!can("34")}
                    onBlur={() => {
                      if (can("34") && descriptionDraft !== (repairRequest.description || "")) {
                        saveDescription();
                      }
                    }}
                  />
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-gray-800">Attached Photos</h4>
                  {photoUrls.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {photoUrls.map((photo, index) => {
                        const photoSrc = typeof photo === 'string' ? photo : photo?.url;
                        return photoSrc ? (
                          <img
                            key={index}
                            src={photoSrc}
                            alt={`Repair photo ${index + 1}`}
                            className="rounded-lg w-full h-auto object-cover"
                          />
                        ) : null;
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-700">No photos attached.</p>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-gray-800">Connected Jobs</h4>
                  {jobIds.length > 0 ? (
                    <div className="space-y-2">
                      {jobIds.map((id) => (
                        <Link
                          key={id}
                          to={`/company/jobs/detail/${id}`}
                          className="block text-blue-600 hover:underline font-medium"
                        >
                          {linkedReferenceText("Job", id, displayRecordReference(availableJobsById.get(id), ""))}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-700">No connected jobs.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6 space-y-4">
              {can("22") && (
                <button
                  onClick={handleCreateJob}
                  className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition"
                >
                  Create Job from Request
                </button>
              )}

              {(can("34") && can("24")) && (
                <div className="border-t border-gray-200 pt-4 space-y-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800">Connect Existing Job</p>
                    <p className="text-xs text-gray-500">Attach an already-created job to this request.</p>
                  </div>

                  <select
                    value={selectedJobId}
                    onChange={(event) => setSelectedJobId(event.target.value)}
                    disabled={loadingJobs || connectingJob || connectableJobs.length === 0}
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="">
                      {loadingJobs
                        ? "Loading jobs..."
                        : connectableJobs.length === 0
                          ? "No unconnected jobs for this customer"
                          : "Select a job"}
                    </option>
                    {connectableJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {formatJobOption(job)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleConnectExistingJob}
                    disabled={!selectedJobId || connectingJob}
                    className={[
                      "w-full rounded-lg px-4 py-2 text-sm font-bold transition",
                      selectedJobId && !connectingJob
                        ? "bg-slate-900 text-white hover:bg-slate-800"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed",
                    ].join(" ")}
                  >
                    {connectingJob ? "Connecting..." : "Connect Job"}
                  </button>
                </div>
              )}

              {can("36") && (
                <button
                  onClick={handleDelete}
                  className="w-full px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
                  type="button"
                >
                  Delete Request
                </button>
              )}
            </div>

            <div className="bg-white shadow-lg rounded-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Information</h3>
              <div className="space-y-3 text-gray-700">
                <div>
                  <strong>Status:</strong>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      name="status"
                      value={formData.status}
                      onChange={handleStatusChange}
                      disabled={!can("34") || savingStatus}
                      className="p-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      {REPAIR_REQUEST_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <span
                      className={`px-3 py-1 text-sm font-bold rounded-full ${normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.RESOLVED)
                        ? 'bg-green-100 text-green-800'
                        : normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.CANCELLED)
                          ? 'bg-red-100 text-red-800'
                          : normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB)
                            ? 'bg-gray-100 text-gray-700'
                            : normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.LEGACY_IN_PROGRESS)
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                    >
                      {displayRepairRequestStatus(repairRequest.status)}
                    </span>
                    {savingStatus && (
                      <span className="text-xs font-semibold text-gray-500">Saving...</span>
                    )}
                  </div>
                </div>

                <p>
                  <strong>Date:</strong>{' '}
                  {repairRequest.date
                    ? format(repairRequest.date, 'PP')
                    : repairRequest.dateCreated
                      ? format(repairRequest.dateCreated, 'PP')
                      : 'N/A'}
                </p>

                <Link to={`/company/customers/details/${repairRequest.customerId}`}>
                  <p><strong>Customer:</strong> {repairRequest.customerName}</p>
                </Link>

                <p><strong>Requester:</strong> {repairRequest.requesterName || 'N/A'}</p>

                {repairRequest.locationId && (
                  <Link to={`/company/customers/details/${repairRequest.customerId}/locations`}>
                    <p><strong>Location:</strong> {linkedReferenceText("Service Location", repairRequest.locationId, repairRequest.locationName || repairRequest.serviceLocationName)}</p>
                  </Link>
                )}

                {repairRequest.equipmentId && (
                  <Link to={`/company/equipment/detail/${repairRequest.equipmentId}`}>
                    <p><strong>Equipment:</strong> {linkedReferenceText("Equipment", repairRequest.equipmentId, repairRequest.equipmentName || repairRequest.equipmentModel)}</p>
                  </Link>
                )}

                {repairRequest.equipmentId && (
                  <div>
                    <strong>Equipment Status:</strong>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={connectedEquipmentStatus}
                        onChange={handleConnectedEquipmentStatusChange}
                        disabled={!can("34") || savingEquipmentStatus}
                        className="p-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                          <option key={statusOption} value={statusOption}>
                            {statusOption}
                          </option>
                        ))}
                      </select>
                      {savingEquipmentStatus && (
                        <span className="text-xs font-semibold text-gray-500">Saving...</span>
                      )}
                    </div>
                  </div>
                )}

                {repairRequest.bodyOfWaterId && (
                  <Link to={`/company/bodiesOfWater/detail/${repairRequest.bodyOfWaterId}`}>
                    <p><strong>Body Of Water:</strong> {linkedReferenceText("Body Of Water", repairRequest.bodyOfWaterId, repairRequest.bodyOfWaterName)}</p>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RepairRequestDetailView;
