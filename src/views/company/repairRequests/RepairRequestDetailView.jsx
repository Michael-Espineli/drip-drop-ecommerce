import React, { useEffect, useState, useContext } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { RepairRequest } from '../../../utils/models/RepairRequest';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';

const RepairRequestDetailView = () => {
  const { recentlySelectedCompany } = useContext(Context);
  const { repairRequestId } = useParams();
  const navigate = useNavigate();

  const [repairRequest, setRepairRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    status: 'Pending',
  });

  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  useEffect(() => {
    const fetchRepairRequest = async () => {
      if (recentlySelectedCompany && repairRequestId) {
        try {
          const requestRef = doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId);
          const docSnap = await getDoc(requestRef);

          if (docSnap.exists()) {
            const req = RepairRequest.fromFirestore(docSnap);
            setRepairRequest(req);
            setDescriptionDraft(req.description || "");
            setFormData({
              status: req.status || 'Pending',
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
  }, [repairRequestId, recentlySelectedCompany]);

  const handleCreateJob = () => {
    navigate(`/company/jobs/createNew`, { state: { repairRequest } });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const saveDescription = async () => {
    if (!repairRequest || savingDescription) return;
    if (descriptionDraft === (repairRequest.description || "")) return;

    try {
      setSavingDescription(true);

      const requestRef = doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId);

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

  const handleSave = async () => {
    try {
      const requestRef = doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId);

      await updateDoc(requestRef, {
        status: formData.status,
      });

      setRepairRequest(prev => ({
        ...prev,
        status: formData.status,
      }));

      setIsEditing(false);
    } catch (error) {
      console.error('Error updating repair request:', error);
      alert('Failed to update repair request.');
    }
  };

  const handleCancel = () => {
    setFormData({
      status: repairRequest?.status || 'Pending',
    });
    setIsEditing(false);
  };

  const handleDelete = async () => {
    const confirmed = window.confirm('Are you sure you want to delete this repair request?');
    if (!confirmed) return;

    try {
      const requestRef = doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId);
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
            <p className="text-sm text-gray-500">ID: {repairRequest.id}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white shadow-lg rounded-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">Request Details</h3>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="py-2 px-4 bg-blue-100 text-blue-800 font-semibold rounded-lg hover:bg-blue-200 transition"
                    type="button"
                  >
                    Edit
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleCancel}
                      className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                      type="button"
                    >
                      Save Changes
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {/* Description (always editable) */}
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>

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
                  </div>

                  <textarea
                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                    placeholder="Add repair request description..."
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onBlur={() => {
                      if (descriptionDraft !== (repairRequest.description || "")) {
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
                          {id}
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
              <button
                onClick={handleCreateJob}
                className="w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition"
              >
                Create Job from Request
              </button>

              {isEditing && (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"
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
                  <strong>Status:</strong>{' '}
                  {isEditing ? (
                    <select
                      name="status"
                      value={formData.status}
                      onChange={handleInputChange}
                      className="ml-2 p-2 border border-gray-300 rounded-lg"
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  ) : (
                    <span
                      className={`ml-2 px-3 py-1 text-sm font-bold rounded-full ${
                        repairRequest.status?.toLowerCase() === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : repairRequest.status?.toLowerCase() === 'cancelled'
                          ? 'bg-red-100 text-red-800'
                          : repairRequest.status?.toLowerCase() === 'in progress'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {repairRequest.status || 'Pending'}
                    </span>
                  )}
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
                    <p><strong>Location ID:</strong> {repairRequest.locationId}</p>
                  </Link>
                )}

                {repairRequest.equipmentId && (
                  <Link to={`/company/equipment/detail/${repairRequest.equipmentId}`}>
                    <p><strong>Equipment ID:</strong> {repairRequest.equipmentId}</p>
                  </Link>
                )}

                {repairRequest.bodyOfWaterId && (
                  <Link to={`/company/bodiesOfWater/detail/${repairRequest.bodyOfWaterId}`}>
                    <p><strong>Body Of Water ID:</strong> {repairRequest.bodyOfWaterId}</p>
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