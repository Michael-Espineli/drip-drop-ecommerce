import React, { useContext, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { getAuth, sendEmailVerification, signOut } from 'firebase/auth';
import { Context } from '../../context/AuthContext';
import { safeClientReturnPath } from '../../utils/clientNavigation';
export default function ClientEmailVerification() {
  const {
    user,
    refreshAccount
  } = useContext(Context);
  const [params] = useSearchParams();
  const destination = safeClientReturnPath(params.get('redirect'));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(0),
    [verified, setVerified] = useState(false);
  const check = async () => {
    setBusy(true);
    setError('');
    try {
      if (await refreshAccount()) setVerified(true);else setMessage('Open the verification link in your email, then check again.');
    } catch (_) {
      setError('We could not check verification. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    if (Date.now() - sentAt < 60000) {
      setMessage('A verification email was just sent. Please check your inbox or wait a minute.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await sendEmailVerification(getAuth().currentUser, {
        url: `${window.location.origin}/client/verify-email?redirect=${encodeURIComponent(destination)}`
      });
      setSentAt(Date.now());
      setMessage('Verification email sent. Check your inbox and spam folder.');
    } catch (_) {
      setError('We could not send the email. Please wait a minute and try again.');
    } finally {
      setBusy(false);
    }
  };
  if (verified || user?.emailVerified) return <Navigate to={destination} replace />;
  return <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4"><section className="w-full max-w-md space-y-5 rounded-xl border bg-white p-6">
        <Link to="/homeowners" className="font-bold text-blue-700">Drip Drop</Link><h1 className="text-2xl font-bold">Verify your email</h1>
        {user ? <><p className="text-slate-600">Open the verification email sent to <strong className="break-all">{user.email}</strong> to connect your pool company and view billing.</p>
            <button disabled={busy} onClick={check} className="min-h-[44px] w-full rounded-lg bg-blue-600 px-4 font-semibold text-white">{busy ? 'Checking…' : 'I verified my email'}</button>
            <button disabled={busy} onClick={resend} className="min-h-[44px] w-full rounded-lg border px-4 font-semibold">Resend verification email</button>
            <button onClick={() => signOut(getAuth())} className="min-h-[44px] w-full text-sm font-semibold text-blue-700">Use a different account</button></> : <Link className="inline-flex min-h-[44px] items-center text-blue-700" to={`/homeownerSignIn?redirect=${encodeURIComponent(`/client/verify-email?redirect=${encodeURIComponent(destination)}`)}`}>Sign in to continue</Link>}
        {message && <p role="status" className="text-sm text-slate-600">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section></main>;
}
