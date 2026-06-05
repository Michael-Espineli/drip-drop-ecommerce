import React from 'react';
import AdminQueueTemplate from '../templates/AdminQueueTemplate';

function Complaints() {
  return (
    <AdminQueueTemplate
      title="Complaints"
      subtitle="Review customer, company, and marketplace complaints."
      primaryActionLabel="Create Case"
      statCards={[
        { label: 'New Complaints', value: 0, hint: 'Awaiting first review' },
        { label: 'Open Cases', value: 0, hint: 'Currently being worked' },
        { label: 'Escalated', value: 0, hint: 'Needs admin decision', accent: '#fed7aa' },
        { label: 'Resolved', value: 0, hint: 'Closed this period', accent: '#86efac' },
      ]}
      filters={[
        { label: 'All', value: 'all' },
        { label: 'New', value: 'New' },
        { label: 'Open', value: 'Open' },
        { label: 'Pending', value: 'Pending' },
        { label: 'Resolved', value: 'Resolved' },
      ]}
      columns={[
        { key: 'createdAt', label: 'Date' },
        { key: 'complainant', label: 'Complainant' },
        { key: 'against', label: 'Against' },
        { key: 'type', label: 'Type' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'owner', label: 'Owner' },
      ]}
      emptyTitle="No complaints found."
      emptyBody="Complaint cases will appear here when the admin data source is connected."
    />
  );
}

export default Complaints;
