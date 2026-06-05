import React from 'react';
import AdminQueueTemplate from '../templates/AdminQueueTemplate';

function DeactivatedSellers() {
  return (
    <AdminQueueTemplate
      title="Deactivated Sellers"
      subtitle="Track sellers that are suspended, paused, or removed from active use."
      statCards={[
        { label: 'Deactivated', value: 0, hint: 'Not available to customers', accent: '#fca5a5' },
        { label: 'Pending Review', value: 0, hint: 'Waiting on admin review', accent: '#fed7aa' },
        { label: 'Eligible to Restore', value: 0, hint: 'Ready for reactivation', accent: '#86efac' },
        { label: 'Permanent', value: 0, hint: 'No reactivation planned' },
      ]}
      filters={[
        { label: 'All', value: 'all' },
        { label: 'Deactivated', value: 'Deactivated' },
        { label: 'Pending', value: 'Pending' },
        { label: 'Resolved', value: 'Resolved' },
      ]}
      columns={[
        { key: 'sellerName', label: 'Seller' },
        { key: 'companyName', label: 'Company' },
        { key: 'reason', label: 'Reason' },
        { key: 'deactivatedAt', label: 'Deactivated' },
        { key: 'reviewDate', label: 'Review Date' },
        { key: 'status', label: 'Status' },
        { key: 'owner', label: 'Owner' },
      ]}
      emptyTitle="No deactivated sellers found."
      emptyBody="Inactive seller records will appear here when the seller status source is connected."
    />
  );
}

export default DeactivatedSellers;
