import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

// Keep older bookmarks on the same company-scoped, real-data timeline.
export default function CustomerHistory({ customerId: selectedCustomerId }) {
  const { customerId: routeCustomerId } = useParams();
  const customerId = selectedCustomerId || routeCustomerId;
  return <Navigate to={customerId ? `/company/customers/details/${encodeURIComponent(customerId)}/history` : '/company/customers'} replace />;
}
