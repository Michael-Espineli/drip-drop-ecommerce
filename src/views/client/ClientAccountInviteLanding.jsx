import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import {
  ArrowRightIcon,
  BuildingOffice2Icon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  MapPinIcon,
  PhoneIcon,
  UserCircleIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { functions } from '../../utils/config';
import { Context } from '../../context/AuthContext';
import { getCallableAuthPayload } from '../../utils/callableAuth';

const InfoRow = ({ icon: Icon, label, value, href }) => {
  if (!value) return null;
  const cleanHref = href && !/^(https?:|mailto:|tel:)/i.test(href) ? `https://${href}` : href;

  const content = (
    <>
      <Icon className="h-4 w-4 flex-none text-slate-400" />
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="block break-words text-sm font-semibold text-slate-800">{value}</span>
      </span>
    </>
  );

  if (cleanHref) {
    return (
      <a href={cleanHref} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50">
        {content}
      </a>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3">
      {content}
    </div>
  );
};

const SummaryTile = ({ label, value }) => (
  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
  </div>
);

const getEquipmentLabel = (equipment = {}) => (
  [
    equipment.name || equipment.type || 'Equipment',
    equipment.make,
    equipment.model,
  ].filter(Boolean).join(' / ')
);

export default function ClientAccountInviteLanding() {
  const { inviteId } = useParams();
  const navigate = useNavigate();
  const { user, accountType } = useContext(Context);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = useMemo(() => (
    `/client/customer-account-invite/${inviteId || ''}`
  ), [inviteId]);

  const authLinks = useMemo(() => {
    const redirect = encodeURIComponent(redirectPath);
    const email = preview?.customer?.email ? `&email=${encodeURIComponent(preview.customer.email)}` : '';

    return {
      signIn: `/homeownerSignIn?redirect=${redirect}`,
      signUp: `/homeownerSignUp?redirect=${redirect}${email}`,
    };
  }, [preview?.customer?.email, redirectPath]);

  useEffect(() => {
    let cancelled = false;

    const loadInvitePreview = async () => {
      if (!inviteId) {
        setError('This invite link is missing its invite id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const callable = httpsCallable(functions, 'getCustomerAccountInvitePreview');
        const result = await callable({
          inviteId,
          baseUrl: window.location.origin,
        });
        const response = result.data || {};

        if (response.status !== 200) {
          throw new Error(response.error || 'Could not load this customer invite.');
        }

        if (!cancelled) {
          setPreview(response);
        }
      } catch (loadError) {
        console.error('Failed to load customer account invite', loadError);
        if (!cancelled) {
          const isCallableInternalError = String(loadError.code || '').includes('internal') || loadError.message === 'internal';
          setError(
            isCallableInternalError
              ? 'This invite link could not be verified. Please ask the company for a new client invite link.'
              : loadError.message || 'Could not load this customer invite.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadInvitePreview();

    return () => {
      cancelled = true;
    };
  }, [inviteId]);

  const copyInviteLink = async () => {
    const link = preview?.invite?.inviteUrl || window.location.href;

    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied.');
    } catch (copyError) {
      console.error('Failed to copy invite link', copyError);
      toast.error('Could not copy the invite link.');
    }
  };

  const claimInvite = async () => {
    if (!user?.uid) {
      navigate(authLinks.signIn);
      return;
    }

    if (accountType && accountType !== 'Client') {
      toast.error('Sign in with a homeowner account to claim this customer invite.');
      return;
    }

    setClaiming(true);

    try {
      const authPayload = await getCallableAuthPayload();
      const acceptInvite = httpsCallable(functions, 'acceptLinkedInvite');
      const result = await acceptInvite({
        ...authPayload,
        auth: authPayload,
        inviteId,
        linkedInviteId: inviteId,
        homeownerId: user.uid,
        email: user.email || '',
      });
      const response = result.data || {};

      if (response.status !== 200) {
        throw new Error(response.error || 'Could not connect this customer account.');
      }

      toast.success('Your homeowner account is connected.');
      navigate('/client/dashboard');
    } catch (claimError) {
      console.error('Failed to claim customer account invite', claimError);
      toast.error(claimError.message || 'Could not connect this customer account.');
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
        Loading customer invite...
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-md border border-rose-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">Invite unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error || 'This customer invite could not be loaded.'}</p>
          <Link to="/homeowners" className="mt-5 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            Homeowner portal
          </Link>
        </div>
      </div>
    );
  }

  const company = preview.company || {};
  const customer = preview.customer || {};
  const invite = preview.invite || {};
  const linkedToCurrentUser = user?.uid && customer.linkedCustomerIds?.includes(user.uid);
  const linkedToAnotherUser = user?.uid && customer.hasLinkedCustomerAccount && !linkedToCurrentUser;
  const canClaim = !invite.accepted && !linkedToCurrentUser && !linkedToAnotherUser;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-bold text-blue-700">Drip Drop</Link>
          <button
            onClick={copyInviteLink}
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            Copy link
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-6">
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                {company.logoUrl ? (
                  <img src={company.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <BuildingOffice2Icon className="h-9 w-9 text-slate-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Customer account invite</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">{company.name}</h1>
                <p className="mt-2 text-sm text-slate-600">
                  {customer.name} can claim the company customer profile and connect it to a homeowner portal account.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {invite.accepted ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      <CheckCircleIcon className="h-4 w-4" />
                      Invite accepted
                    </span>
                  ) : (
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      Ready to claim
                    </span>
                  )}
                  {customer.maskedEmail && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                      {customer.maskedEmail}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <InfoRow icon={PhoneIcon} label="Phone" value={company.phone} href={company.phone ? `tel:${company.phone}` : ''} />
              <InfoRow icon={EnvelopeIcon} label="Email" value={company.email} href={company.email ? `mailto:${company.email}` : ''} />
              <InfoRow icon={GlobeAltIcon} label="Website" value={company.website} href={company.website} />
              <InfoRow icon={BuildingOffice2Icon} label="Profile" value="View company profile" href={company.profileUrl} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryTile label="Locations" value={preview.serviceLocations?.length || 0} />
            <SummaryTile label="Pools & spas" value={preview.bodiesOfWater?.length || 0} />
            <SummaryTile label="Equipment" value={preview.equipment?.length || 0} />
          </div>

          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <MapPinIcon className="h-5 w-5 text-slate-400" />
              <h2 className="text-lg font-bold text-slate-950">Service locations</h2>
            </div>
            <div className="mt-4 grid gap-3">
              {preview.serviceLocations?.length > 0 ? preview.serviceLocations.map((location) => (
                <div key={location.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">{location.name}</p>
                  <p className="mt-1 text-sm text-slate-600">{location.addressSummary || 'Address on file'}</p>
                </div>
              )) : (
                <p className="text-sm text-slate-500">No service locations are attached yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <WrenchScrewdriverIcon className="h-5 w-5 text-slate-400" />
              <h2 className="text-lg font-bold text-slate-950">Pools, spas, and equipment</h2>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Pools & spas</h3>
                <div className="mt-2 space-y-2">
                  {preview.bodiesOfWater?.length > 0 ? preview.bodiesOfWater.map((body) => (
                    <div key={body.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-900">{body.name}</p>
                      {body.type && <p className="text-xs text-slate-500">{body.type}</p>}
                    </div>
                  )) : (
                    <p className="text-sm text-slate-500">No pools or spas are attached yet.</p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Equipment</h3>
                <div className="mt-2 space-y-2">
                  {preview.equipment?.length > 0 ? preview.equipment.map((equipment) => (
                    <div key={equipment.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-900">{getEquipmentLabel(equipment)}</p>
                      {equipment.type && <p className="text-xs text-slate-500">{equipment.type}</p>}
                    </div>
                  )) : (
                    <p className="text-sm text-slate-500">No equipment is attached yet.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </section>

        <aside className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <UserCircleIcon className="h-5 w-5 text-slate-400" />
              <h2 className="text-lg font-bold text-slate-950">Connect account</h2>
            </div>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{customer.name}</p>
              <p className="mt-1 text-sm text-slate-600">
                {customer.maskedEmail || 'This invite will attach to the homeowner account that claims it.'}
              </p>
            </div>

            {linkedToCurrentUser && (
              <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                This customer is already connected to your homeowner account.
              </div>
            )}

            {linkedToAnotherUser && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                This customer is already linked to another homeowner account.
              </div>
            )}

            {!user ? (
              <div className="mt-5 space-y-3">
                <Link
                  to={authLinks.signIn}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Sign in to claim
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
                <Link
                  to={authLinks.signUp}
                  className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Create homeowner account
                </Link>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <button
                  onClick={claimInvite}
                  disabled={!canClaim || claiming}
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {claiming ? 'Connecting...' : 'Connect my homeowner account'}
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
                <Link
                  to="/client/dashboard"
                  className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Go to homeowner dashboard
                </Link>
              </div>
            )}

            {!customer.hasEmail && !invite.accepted && (
              <p className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">
                This invite does not require a customer email. The first homeowner account that uses the link can claim it.
              </p>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
