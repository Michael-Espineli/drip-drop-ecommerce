import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
export default function ConnectServiceLocation() {
    const { linkedInviteId } = useParams();
    return <Navigate to={`/client/customer-account-invite/${encodeURIComponent(linkedInviteId)}`} replace />;
}
