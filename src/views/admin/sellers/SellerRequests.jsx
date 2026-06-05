import React from 'react';
import AdminQueueTemplate from '../templates/AdminQueueTemplate';

function SellerRequests() {
  return (
    <AdminQueueTemplate
      title="Seller Requests"
      subtitle="Review seller onboarding, access, and account change requests."
      primaryActionLabel="Add Request"
      statCards={[
        { label: 'New Requests', value: 0, hint: 'Awaiting review' },
        { label: 'Pending Info', value: 0, hint: 'Waiting on seller', accent: '#fed7aa' },
        { label: 'Approved', value: 0, hint: 'Approved this period', accent: '#86efac' },
        { label: 'Rejected', value: 0, hint: 'Not approved', accent: '#fca5a5' },
      ]}
      filters={[
        { label: 'All', value: 'all' },
        { label: 'New', value: 'New' },
        { label: 'Pending', value: 'Pending' },
        { label: 'Resolved', value: 'Resolved' },
      ]}
      columns={[
        { key: 'createdAt', label: 'Date' },
        { key: 'sellerName', label: 'Seller' },
        { key: 'companyName', label: 'Company' },
        { key: 'requestType', label: 'Request Type' },
        { key: 'email', label: 'Email' },
        { key: 'status', label: 'Status' },
        { key: 'owner', label: 'Owner' },
      ]}
      emptyTitle="No seller requests found."
      emptyBody="Seller request records will appear here when the request collection is connected."
    />
  );
}

export default SellerRequests;
