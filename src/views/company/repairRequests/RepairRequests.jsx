import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../utils/config'; // Adjust the import path as needed
import {RepairRequest} from '../../../utils/models/RepairRequest'; // Adjust the import path as needed

const RepairRequests = () => {
  const [repairRequests, setRepairRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRepairRequests = async () => {
      try {
        setLoading(true);
        const querySnapshot = await getDocs(collection(db, 'repairRequests')); // Replace 'repairRequests' with your collection name
        const requestsData = querySnapshot.docs.map(doc => {
          const data = doc.data();
          return RepairRequest.fromFirebase(data);
        });
        setRepairRequests(requestsData);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching repair requests:", err);
        setError("Failed to fetch repair requests.");
        setLoading(false);
      }
    };

    fetchRepairRequests();
  }, []);

  if (loading) {
    return <p>Loading repair requests...</p>;
  }

  if (error) {
    return <p className="text-red-500">{error}</p>;
  }

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Repair Requests</h2>
      {repairRequests.length === 0 ? (
        <p>No repair requests found.</p>
      ) : (
        <table className="min-w-full bg-white border border-gray-200">
          <thead>
            <tr>
              <th className="py-2 px-4 border-b">ID</th>
              <th className="py-2 px-4 border-b">Customer Name</th>
              <th className="py-2 px-4 border-b">Requester Name</th>
              <th className="py-2 px-4 border-b">Date</th>
              <th className="py-2 px-4 border-b">Status</th>
              <th className="py-2 px-4 border-b">Description</th>
              {/* Add other table headers for RepairRequest properties */}
            </tr>
          </thead>
          <tbody>
            {repairRequests.map(request => (
              <tr key={request.id} className="hover:bg-gray-100">
                <td className="py-2 px-4 border-b">{request.id}</td>
                <td className="py-2 px-4 border-b">{request.customerName}</td>
                <td className="py-2 px-4 border-b">{request.requesterName}</td>
                <td className="py-2 px-4 border-b">{request.date ? new Date(request.date.seconds * 1000).toLocaleDateString() : 'N/A'}</td>
                <td className="py-2 px-4 border-b">{request.status}</td>
                <td className="py-2 px-4 border-b">{request.description}</td>
                {/* Add other table cells for RepairRequest properties */}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default RepairRequests;