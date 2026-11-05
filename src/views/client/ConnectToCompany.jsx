import { userFacingErrorMessage } from '../../utils/permissionErrors';
import WorkspaceHeader from '../../components/workspace/WorkspaceHeader';
import React, { useContext, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { getCallableAuthPayload } from '../../utils/callableAuth';
import { clientVerificationPath } from '../../utils/clientNavigation';
export default function ConnectToCompany() {
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const {
    user
  } = useContext(Context);
  const companyId = params.get('companyId') || '',
    customerId = params.get('customerId') || '';
  const [company, setCompany] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!companyId || !customerId) {
      setError('This link is incomplete. Ask your pool company for a new customer invitation.');
      return;
    }
    let active = true;
    getDoc(doc(db, 'companies', companyId)).then(snapshot => {
      if (active) {
        if (snapshot.exists()) setCompany(snapshot.data());else setError('This company could not be found.');
      }
    }).catch(() => {
      if (active) setError('We could not load the company. Please reopen your invitation.');
    });
    return () => {
      active = false;
    };
  }, [companyId, customerId]);
  const connect = async () => {
    if (!user?.emailVerified) {
      navigate(clientVerificationPath(`/client/connect-to-company?${params}`));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await httpsCallable(functions, 'createHomeOwnerCustomerBasedOnCompany')({
        ...(await getCallableAuthPayload()),
        companyId,
        customerId
      });
      if (result.data?.status !== 200) throw new Error(result.data?.error || 'Could not connect your account.');
      navigate('/client/my-pool', {
        replace: true
      });
    } catch (err) {
      setError(userFacingErrorMessage(err, err.message || 'Could not connect. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  return <main className="mx-auto max-w-lg space-y-5 p-5"><WorkspaceHeader title={<>Connect your pool company</>} eyebrow="Your pool care" /><p className="text-slate-600">Connect your existing customer account with {company?.name || 'your pool company'} to see your properties, service history, and billing. Use the same email your company has on file.</p>{error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}<button disabled={!company || !customerId || busy} onClick={connect} className="min-h-[44px] w-full rounded-lg bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Connecting…' : 'Connect my account'}</button><Link to="/client/dashboard" className="inline-flex min-h-[44px] items-center text-blue-700">Back to home</Link></main>;
}
