import React, { useContext } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Context } from '../../context/AuthContext';
import { getAccountHomePath } from '../../utils/accountHome';

export function AccountHomeRedirect() {
  const { accountType } = useContext(Context);
  return <Navigate to={getAccountHomePath(accountType)} replace />;
}

export default function BillingReturnPage({ title, description, openApp = false }) {
  const { accountType } = useContext(Context);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-5 px-5 py-12 text-center text-slate-900">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-slate-600">{description}</p>
      <Link to={getAccountHomePath(accountType)} className="inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-blue-50 px-5 py-3 font-semibold text-blue-700">Back to home</Link>
      {openApp && <a href="com.dripdroppoolapp://" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-blue-700">Open Drip Drop app</a>}
    </main>
  );
}
