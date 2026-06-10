import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import {
  BuildingOffice2Icon,
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Context } from '../../../context/AuthContext';
import { db } from '../../../utils/config';

const cleanString = (value) => String(value || '').trim();

const fullName = (...parts) => parts.map(cleanString).filter(Boolean).join(' ');

const getCustomerAccountUserId = (customer = {}) => {
  const linkedCustomerIds = Array.isArray(customer.linkedCustomerIds) ? customer.linkedCustomerIds : [];

  return cleanString(
    customer.linkedCustomerUserId
    || customer.linkedHomeownerUserId
    || customer.customerUserId
    || customer.homeownerUserId
    || customer.homeownerId
    || customer.userId
    || customer.clientId
    || linkedCustomerIds[0]
  );
};

const getCustomerName = (customer = {}) => (
  cleanString(customer.customerName)
  || (customer.displayAsCompany ? cleanString(customer.company) : '')
  || fullName(customer.firstName, customer.lastName)
  || cleanString(customer.name)
  || cleanString(customer.email)
  || 'Customer account'
);

const isConnectedCustomer = (customer = {}) => Boolean(getCustomerAccountUserId(customer));

const getCompanyUserId = (companyUser = {}, fallbackId = '') => (
  cleanString(companyUser.userId || companyUser.uid || companyUser.id || fallbackId)
);

const getCompanyUserName = (companyUser = {}) => (
  cleanString(companyUser.userName)
  || fullName(companyUser.firstName, companyUser.lastName)
  || cleanString(companyUser.name)
  || cleanString(companyUser.email)
  || 'Company user'
);

const targetSearchText = (target = {}) => [
  target.title,
  target.subtitle,
  target.email,
  target.badge,
].filter(Boolean).join(' ').toLowerCase();

const dedupeTargets = (targets = []) => {
  const byKey = new Map();

  targets.forEach((target) => {
    const key = target.dedupeKey || `${target.kind}:${target.routeId || target.userId || target.id}`;
    if (!byKey.has(key)) byKey.set(key, target);
  });

  return Array.from(byKey.values()).sort((left, right) => left.title.localeCompare(right.title));
};

const docsFromSnapshot = (snapshot) => (
  snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }))
);

const safeGetDocs = async (queryRef, label) => {
  try {
    const snapshot = await getDocs(queryRef);
    return docsFromSnapshot(snapshot);
  } catch (error) {
    console.error(`Unable to load ${label}:`, error);
    return [];
  }
};

const safeGetCompany = async (companyId) => {
  try {
    const snapshot = await getDoc(doc(db, 'companies', companyId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    console.error('Unable to load company for chat target:', error);
    return null;
  }
};

const buildCompanyTarget = (company, sources = []) => ({
  id: `company:${company.id}`,
  kind: 'company',
  routeId: company.id,
  title: cleanString(company.name) || 'Company',
  subtitle: sources.length > 0 ? sources.join(' - ') : cleanString(company.ownerName || company.email),
  email: cleanString(company.email || company.ownerEmail),
  imageUrl: cleanString(company.logoUrl || company.photoUrl),
  badge: 'Company',
  dedupeKey: `company:${company.id}`,
});

const loadCompanyTargets = async ({ companyId, currentUserId }) => {
  if (!companyId) return [];

  const [customers, companyUsers] = await Promise.all([
    safeGetDocs(collection(db, 'companies', companyId, 'customers'), 'connected customers'),
    safeGetDocs(collection(db, 'companies', companyId, 'companyUsers'), 'company users'),
  ]);

  const customerTargets = customers
    .filter(isConnectedCustomer)
    .map((customer) => {
      const accountUserId = getCustomerAccountUserId(customer);
      const title = getCustomerName(customer);
      const email = cleanString(customer.email || customer.customerEmail || customer.linkedEmail);

      return {
        id: `customer:${customer.id}`,
        kind: 'customer',
        routeId: customer.id,
        userId: accountUserId,
        title,
        subtitle: email || 'Connected customer account',
        email,
        imageUrl: cleanString(customer.photoUrl || customer.profileImageUrl),
        badge: 'Customer',
        dedupeKey: `customer:${customer.id}`,
      };
    });

  const companyUserTargets = companyUsers
    .map((companyUser) => {
      const companyUserId = getCompanyUserId(companyUser);
      if (!companyUserId || companyUserId === currentUserId) return null;

      const title = getCompanyUserName(companyUser);
      const subtitle = [
        cleanString(companyUser.roleName),
        cleanString(companyUser.status),
        cleanString(companyUser.email),
      ].filter(Boolean).join(' - ');

      return {
        id: `companyUser:${companyUser.id}`,
        kind: 'companyUser',
        routeId: companyUserId,
        userId: companyUserId,
        title,
        subtitle: subtitle || 'Company user',
        email: cleanString(companyUser.email),
        imageUrl: cleanString(companyUser.photoUrl || companyUser.profileImageUrl),
        badge: 'Company user',
        dedupeKey: `companyUser:${companyUserId}`,
      };
    })
    .filter(Boolean);

  return dedupeTargets([...customerTargets, ...companyUserTargets]);
};

const loadClientTargets = async ({ currentUserId }) => {
  if (!currentUserId) return [];

  const [relationships, savedCompanies, serviceRequests] = await Promise.all([
    safeGetDocs(query(collection(db, 'customerCompanyRelationships'), where('homeownerUserId', '==', currentUserId)), 'connected companies'),
    safeGetDocs(collection(db, 'users', currentUserId, 'savedCompanies'), 'saved companies'),
    safeGetDocs(query(collection(db, 'homeownerServiceRequests'), where('homeownerId', '==', currentUserId)), 'service request companies'),
  ]);

  const sourcesByCompanyId = new Map();
  const addCompanySource = (companyId, source) => {
    const cleanCompanyId = cleanString(companyId);
    if (!cleanCompanyId) return;

    const sources = sourcesByCompanyId.get(cleanCompanyId) || new Set();
    sources.add(source);
    sourcesByCompanyId.set(cleanCompanyId, sources);
  };

  relationships.forEach((relationship) => addCompanySource(relationship.companyId, 'Connected'));
  savedCompanies.forEach((savedCompany) => addCompanySource(savedCompany.companyId, 'Saved'));
  serviceRequests.forEach((request) => addCompanySource(request.companyId, 'Requested'));

  const companyTargets = await Promise.all(
    Array.from(sourcesByCompanyId.entries()).map(async ([companyId, sources]) => {
      const company = await safeGetCompany(companyId);
      return company ? buildCompanyTarget(company, Array.from(sources)) : null;
    })
  );

  return dedupeTargets(companyTargets.filter(Boolean));
};

const ResultIcon = ({ target }) => {
  if (target.imageUrl) {
    return <img src={target.imageUrl} alt="" className="h-full w-full object-cover" />;
  }

  if (target.kind === 'company') {
    return <BuildingOffice2Icon className="h-6 w-6 text-blue-700" />;
  }

  return <UserCircleIcon className="h-7 w-7 text-blue-700" />;
};

const StartChatModal = ({ mode = 'company', closeModal }) => {
  const {
    user,
    recentlySelectedCompany,
  } = useContext(Context);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isCompanyMode = mode === 'company';

  useEffect(() => {
    let cancelled = false;

    const loadTargets = async () => {
      if (!user?.uid) {
        setTargets([]);
        setLoading(false);
        return;
      }

      if (isCompanyMode && !recentlySelectedCompany) {
        setTargets([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const nextTargets = isCompanyMode
          ? await loadCompanyTargets({ companyId: recentlySelectedCompany, currentUserId: user.uid })
          : await loadClientTargets({ currentUserId: user.uid });

        if (!cancelled) setTargets(nextTargets);
      } catch (loadError) {
        console.error('Unable to load chat targets:', loadError);
        if (!cancelled) setError('Unable to load chat options.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadTargets();

    return () => {
      cancelled = true;
    };
  }, [isCompanyMode, recentlySelectedCompany, user]);

  const filteredTargets = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return targets;

    return targets.filter((target) => targetSearchText(target).includes(needle));
  }, [searchTerm, targets]);

  const handleSelectTarget = (target) => {
    closeModal?.();

    if (isCompanyMode) {
      navigate(`/company/messages/${target.routeId}`);
      return;
    }

    navigate(`/messages/newCompany/${target.routeId}`);
  };

  const title = isCompanyMode ? 'Start a new chat' : 'Start a new message';
  const placeholder = isCompanyMode ? 'Search customers or company users...' : 'Search companies...';
  const emptyMessage = isCompanyMode
    ? 'No connected customers or company users found.'
    : 'No companies found.';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <ChatBubbleLeftRightIcon className="h-6 w-6" />
            </span>
            <h3 className="truncate text-xl font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close new chat"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="border-b border-gray-100 p-5">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              autoFocus
              placeholder={placeholder}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-gray-50 py-3 pl-10 pr-3 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="min-h-[16rem] overflow-y-auto p-3">
          {loading ? (
            <div className="p-6 text-center text-sm font-medium text-gray-500">Loading chats...</div>
          ) : error ? (
            <div className="p-6 text-center text-sm font-medium text-red-600">{error}</div>
          ) : filteredTargets.length > 0 ? (
            <ul className="space-y-1">
              {filteredTargets.map((target) => (
                <li key={target.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectTarget(target)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition hover:bg-gray-50"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50">
                      <ResultIcon target={target} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-gray-900">{target.title}</span>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                          {target.badge}
                        </span>
                      </span>
                      {target.subtitle && (
                        <span className="mt-0.5 block truncate text-sm text-gray-500">{target.subtitle}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center text-sm font-medium text-gray-500">{emptyMessage}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StartChatModal;
