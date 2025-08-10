import React, { useState } from 'react';
import { db } from "../../../utils/config";
import { collection, addDoc } from 'firebase/firestore';
import { RepairRequest } from '../../../utils/models/RepairRequest'; // Adjust the path as needed
import {DripDropStoredImage} from '../../../utils/models/DripDropStoredImage'; // Adjust the path as needed
import { v4 as uuidv4 } from 'uuid';

const CreateNewRepairRequest = () => {
  const [formData, setFormData] = useState({
    customerId: '',
    customerName: '',
    requesterId: '',
    requesterName: '',
    date: new Date(),
    status: 'Open', // Default status, adjust as needed
    description: '',
    jobIds: [],
    photoUrls: [],
    locationId: '',
    bodyOfWaterId: '',
    equipmentId: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleArrayChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value.split(',').map(item => item.trim()) });
  };

  const handleDateChange = (e) => {
    setFormData({ ...formData, date: new Date(e.target.value) });
  };

  const handlePhotoUrlChange = (e) => {
    const { value } = e.target;
    // Assuming input is a comma-separated string of image URLs
    const urls = value.split(',').map(url => url.trim()).filter(url => url !== '');
    const dripDropImages = urls.map(url => new DripDropStoredImage({ url: url, name: url.substring(url.lastIndexOf('/') + 1) })); // Basic name
    setFormData({ ...formData, photoUrls: dripDropImages });
  };


  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic validation (you'll want more robust validation)
    if (!formData.customerId || !formData.customerName || !formData.requesterId || !formData.requesterName || !formData.description) {
      alert('Please fill in required fields.');
      return;
    }

    const newRepairRequest = new RepairRequest({
        id: "req_" + uuidv4(),
        customerId: formData.customerId,
        customerName: formData.customerName,
        requesterId: formData.requesterId,
        requesterName: formData.requesterName,
        date: formData.date,
        status: formData.status,
        description: formData.description,
        jobIds: formData.jobIds,
        photoUrls: formData.photoUrls,
        locationId: formData.locationId === '' ? null : formData.locationId,
        bodyOfWaterId: formData.bodyOfWaterId === '' ? null : formData.bodyOfWaterId,
        equipmentId: formData.equipmentId === '' ? null : formData.equipmentId,
    });

    try {
      const docRef = await addDoc(collection(db, 'repairRequests'), newRepairRequest.toFirestore());
      console.log('Repair Request created with ID: ', docRef.id);
      // Optionally clear the form or redirect
      setFormData({
        customerId: '',
        customerName: '',
        requesterId: '',
        requesterName: '',
        date: new Date(),
        status: 'Open',
        description: '',
        jobIds: [],
        photoUrls: [],
        locationId: '',
        bodyOfWaterId: '',
        equipmentId: '',
      });
    } catch (e) {
      console.error('Error adding document: ', e);
    }
  };

  return (
    <div>
      <h2>Create New Repair Request</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Customer ID:</label>
          <input type="text" name="customerId" value={formData.customerId} onChange={handleChange} required />
        </div>
        <div>
          <label>Customer Name:</label>
          <input type="text" name="customerName" value={formData.customerName} onChange={handleChange} required />
        </div>
        <div>
          <label>Requester ID:</label>
          <input type="text" name="requesterId" value={formData.requesterId} onChange={handleChange} required />
        </div>
        <div>
          <label>Requester Name:</label>
          <input type="text" name="requesterName" value={formData.requesterName} onChange={handleChange} required />
        </div>
        <div>
          <label>Date:</label>
          <input type="date" name="date" value={formData.date.toISOString().split('T')[0]} onChange={handleDateChange} required />
        </div>
        <div>
          <label>Status:</label>
          {/* You might want a dropdown or select for status */}
          <input type="text" name="status" value={formData.status} onChange={handleChange} required />
        </div>
        <div>
          <label>Description:</label>
          <textarea name="description" value={formData.description} onChange={handleChange} required />
        </div>
        <div>
          <label>Job IDs (comma-separated):</label>
          <input type="text" name="jobIds" value={formData.jobIds.join(', ')} onChange={handleArrayChange} />
        </div>
        <div>
          <label>Photo URLs (comma-separated):</label>
          <input type="text" name="photoUrls" onChange={handlePhotoUrlChange} />
          {/* Display previews if needed */}
        </div>
        <div>
          <label>Location ID:</label>
          <input type="text" name="locationId" value={formData.locationId} onChange={handleChange} />
        </div>
        <div>
          <label>Body of Water ID:</label>
          <input type="text" name="bodyOfWaterId" value={formData.bodyOfWaterId} onChange={handleChange} />
        </div>
        <div>
          <label>Equipment ID:</label>
          <input type="text" name="equipmentId" value={formData.equipmentId} onChange={handleChange} />
        </div>
        <button type="submit">Create Repair Request</button>
      </form>
    </div>
  );
};

export default CreateNewRepairRequest;