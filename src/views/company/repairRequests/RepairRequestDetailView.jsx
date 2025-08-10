import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../utils/config';
import { RepairRequest} from '../../../utils/models/RepairRequest'; // Assuming you have this model

const RepairRequestDetailView = () => {
  const { id } = useParams();
  const [repairRequest, setRepairRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRepairRequest = async () => {
      try {
        const repairRequestRef = doc(db, 'repairRequests', id); // Assuming your collection is named 'repairRequests'
        const docSnap = await getDoc(repairRequestRef);

        if (docSnap.exists()) {
          setRepairRequest(RepairRequest.fromFirestore(docSnap));
        } else {
          setError('Repair Request not found');
        }
      } catch (err) {
        setError('Error fetching repair request');
        console.error('Error fetching repair request:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRepairRequest();
  }, [id]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!repairRequest) {
    return <div>Repair Request not found.</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Repair Request Details</h1>
      <div className="bg-white shadow-md rounded-lg p-6">
        <p className="mb-2"><strong>ID:</strong> {repairRequest.id}</p>
        <p className="mb-2"><strong>Customer ID:</strong> {repairRequest.customerId}</p>
        <p className="mb-2"><strong>Customer Name:</strong> {repairRequest.customerName}</p>
        <p className="mb-2"><strong>Requester ID:</strong> {repairRequest.requesterId}</p>
        <p className="mb-2"><strong>Requester Name:</strong> {repairRequest.requesterName}</p>
        <p className="mb-2"><strong>Date:</strong> {repairRequest.date.toDate().toLocaleString()}</p>
        <p className="mb-2"><strong>Status:</strong> {repairRequest.status}</p>
        <p className="mb-2"><strong>Description:</strong> {repairRequest.description}</p>
        <p className="mb-2"><strong>Job IDs:</strong> {repairRequest.jobIds.join(', ')}</p>
        <p className="mb-2"><strong>Location ID:</strong> {repairRequest.locationId || 'N/A'}</p>
        <p className="mb-2"><strong>Body of Water ID:</strong> {repairRequest.bodyOfWaterId || 'N/A'}</p>
        <p className="mb-2"><strong>Equipment ID:</strong> {repairRequest.equipmentId || 'N/A'}</p>

        <div className="mt-4">
          <strong>Photo URLs:</strong>
          {repairRequest.photoUrls && repairRequest.photoUrls.length > 0 ? (
            <ul className="list-disc ml-5">
              {repairRequest.photoUrls.map((photo, index) => (
                <li key={index}>
                  <a href={photo.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {photo.name || photo.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No photos available.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepairRequestDetailView;