import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { FaChevronLeft, FaChevronRight, FaExpandAlt, FaSave, FaTimes } from 'react-icons/fa';
import { v4 as uuidv4 } from 'uuid';
import { Context } from '../../../../context/AuthContext';
import { db } from '../../../../utils/config';

const RECENT_NOTE_LIMIT = 3;
const NOTE_PAGE_SIZE = 10;

const customerNoteAudienceOptions = [
  { value: 'all', label: 'All', tone: 'emerald' },
  { value: 'office', label: 'Office', tone: 'slate' },
  { value: 'field', label: 'Field', tone: 'blue' },
];

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDateTimeValue = (value) => {
  const millis = toMillis(value);
  if (!millis) return 'Not set';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(millis));
};

const getNoteText = (note = {}) => note.note || note.comment || note.text || '';

const getBodyOfWaterLabel = (bodyOfWater = {}) => (
  bodyOfWater.name ||
  bodyOfWater.label ||
  [bodyOfWater.shape, bodyOfWater.material].filter(Boolean).join(' ') ||
  'Unnamed Body of Water'
);

const getCustomerName = (customer = {}, fallback = '') => (
  customer.companyName ||
  customer.company ||
  [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
  customer.name ||
  customer.displayName ||
  fallback ||
  'Customer'
);

const getCustomerNoteAudience = (note = {}) => {
  const normalized = String(note.audience || note.visibility || 'all').trim().toLowerCase();
  return customerNoteAudienceOptions.find((option) => option.value === normalized) || customerNoteAudienceOptions[0];
};

const getAuthorNameFromContext = ({ dataBaseUser, user }) => (
  `${dataBaseUser?.firstName || ''} ${dataBaseUser?.lastName || ''}`.trim() ||
  dataBaseUser?.userName ||
  dataBaseUser?.name ||
  user?.displayName ||
  user?.email ||
  'Unknown'
);

const StatusBadge = ({ children, tone = 'slate' }) => {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
};

const CustomerNoteCard = ({ note }) => {
  const audience = getCustomerNoteAudience(note);

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{note.userName || note.authorName || 'Unknown'}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatDateTimeValue(note.date || note.createdAt || note.dateMillis || note.createdAtMillis)}
            {note.bodyOfWaterName ? ` - ${note.bodyOfWaterName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={audience.tone}>{audience.label}</StatusBadge>
          {note.resolved && <StatusBadge tone="emerald">Resolved</StatusBadge>}
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{getNoteText(note)}</p>
    </div>
  );
};

const CustomerBillingNotesPanel = ({
  companyId,
  customerId,
  customerName = '',
  className = '',
}) => {
  const { dataBaseUser, recentlySelectedCompany, user } = useContext(Context);
  const resolvedCompanyId = companyId || recentlySelectedCompany || '';
  const [customer, setCustomer] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [billingNotesDraft, setBillingNotesDraft] = useState('');
  const [savingBillingNotes, setSavingBillingNotes] = useState(false);
  const [bodyOfWaterOptions, setBodyOfWaterOptions] = useState([]);
  const [selectedBodyOfWaterId, setSelectedBodyOfWaterId] = useState('');
  const [selectedAudience, setSelectedAudience] = useState('office');
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [latestNotes, setLatestNotes] = useState([]);
  const [latestNotesLoading, setLatestNotesLoading] = useState(false);
  const [noteCount, setNoteCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalNotes, setModalNotes] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState([null]);
  const [modalLastDoc, setModalLastDoc] = useState(null);

  const customerRef = useMemo(() => (
    resolvedCompanyId && customerId
      ? doc(db, 'companies', resolvedCompanyId, 'customers', customerId)
      : null
  ), [customerId, resolvedCompanyId]);

  const notesRef = useMemo(() => (
    resolvedCompanyId && customerId
      ? collection(db, 'companies', resolvedCompanyId, 'customers', customerId, 'notes')
      : null
  ), [customerId, resolvedCompanyId]);

  const displayCustomerName = getCustomerName(customer || {}, customerName);
  const selectedAudienceLabel = customerNoteAudienceOptions.find((option) => option.value === selectedAudience)?.label || 'Customer';
  const pageCount = Math.max(1, Math.ceil(noteCount / NOTE_PAGE_SIZE));
  const hasPreviousPage = pageIndex > 0;
  const hasNextPage = pageIndex + 1 < pageCount;

  const refreshNoteCount = useCallback(async () => {
    if (!notesRef) {
      setNoteCount(0);
      return;
    }

    try {
      setCountLoading(true);
      const countSnapshot = await getCountFromServer(notesRef);
      setNoteCount(Number(countSnapshot.data().count || 0));
    } catch (error) {
      console.error('Failed to count customer notes:', error);
    } finally {
      setCountLoading(false);
    }
  }, [notesRef]);

  const loadNotesPage = useCallback(async (nextPageIndex = 0, cursor = null) => {
    if (!notesRef) {
      setModalNotes([]);
      setModalLastDoc(null);
      return;
    }

    try {
      setModalLoading(true);
      const constraints = [orderBy('date', 'desc'), limit(NOTE_PAGE_SIZE)];
      if (cursor) constraints.splice(1, 0, startAfter(cursor));
      const pageSnapshot = await getDocs(query(notesRef, ...constraints));
      const pageNotes = pageSnapshot.docs.map((noteDoc) => ({ id: noteDoc.id, ...noteDoc.data() }));
      const lastDoc = pageSnapshot.docs[pageSnapshot.docs.length - 1] || null;

      setModalNotes(pageNotes);
      setModalLastDoc(lastDoc);
      setPageIndex(nextPageIndex);
      setPageCursors((current) => {
        const next = [...current];
        next[nextPageIndex] = cursor || null;
        if (lastDoc) next[nextPageIndex + 1] = lastDoc;
        return next;
      });
    } catch (error) {
      console.error('Failed to load customer note page:', error);
      toast.error('Failed to load customer notes.');
    } finally {
      setModalLoading(false);
    }
  }, [notesRef]);

  useEffect(() => {
    if (!customerRef) {
      setCustomer(null);
      setBillingNotesDraft('');
      setCustomerLoading(false);
      return undefined;
    }

    setCustomerLoading(true);
    return onSnapshot(
      customerRef,
      (snapshot) => {
        const nextCustomer = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
        setCustomer(nextCustomer);
        setBillingNotesDraft(nextCustomer?.billingNotes || '');
        setCustomerLoading(false);
      },
      (error) => {
        console.error('Failed to load customer billing notes:', error);
        setCustomerLoading(false);
      }
    );
  }, [customerRef]);

  useEffect(() => {
    if (!resolvedCompanyId || !customerId) {
      setBodyOfWaterOptions([]);
      return undefined;
    }

    let canceled = false;

    const loadBodyOfWaterOptions = async () => {
      try {
        const bodySnapshot = await getDocs(query(
          collection(db, 'companies', resolvedCompanyId, 'bodiesOfWater'),
          where('customerId', '==', customerId)
        ));

        if (canceled) return;
        setBodyOfWaterOptions(
          bodySnapshot.docs
            .map((bodyDoc) => ({ id: bodyDoc.id, ...bodyDoc.data() }))
            .sort((left, right) => getBodyOfWaterLabel(left).localeCompare(getBodyOfWaterLabel(right)))
        );
      } catch (error) {
        if (!canceled) console.error('Failed to load customer note pools:', error);
      }
    };

    loadBodyOfWaterOptions();

    return () => {
      canceled = true;
    };
  }, [customerId, resolvedCompanyId]);

  useEffect(() => {
    if (!notesRef) {
      setLatestNotes([]);
      setLatestNotesLoading(false);
      setNoteCount(0);
      return undefined;
    }

    setLatestNotesLoading(true);
    refreshNoteCount();

    const latestQuery = query(notesRef, orderBy('date', 'desc'), limit(RECENT_NOTE_LIMIT));
    return onSnapshot(
      latestQuery,
      (snapshot) => {
        setLatestNotes(snapshot.docs.map((noteDoc) => ({ id: noteDoc.id, ...noteDoc.data() })));
        setLatestNotesLoading(false);
      },
      (error) => {
        console.error('Failed to load recent customer notes:', error);
        setLatestNotesLoading(false);
      }
    );
  }, [notesRef, refreshNoteCount]);

  const saveBillingNotes = async () => {
    if (!customerRef) {
      toast.error('This record is not linked to a customer yet.');
      return;
    }

    try {
      setSavingBillingNotes(true);
      await updateDoc(customerRef, {
        billingNotes: billingNotesDraft,
        billingNotesUpdatedAt: serverTimestamp(),
        billingNotesUpdatedAtMillis: Date.now(),
        billingNotesUpdatedByUserId: user?.uid || dataBaseUser?.id || '',
        billingNotesUpdatedByUserName: getAuthorNameFromContext({ dataBaseUser, user }),
      });
      toast.success('Billing notes saved.');
    } catch (error) {
      console.error('Failed to save billing notes:', error);
      toast.error('Failed to save billing notes.');
    } finally {
      setSavingBillingNotes(false);
    }
  };

  const addCustomerNote = async () => {
    const trimmedNote = newNote.trim();
    if (!trimmedNote) {
      toast.error('Write a note first.');
      return;
    }

    if (!notesRef || !customerId || !resolvedCompanyId) {
      toast.error('This record is not linked to a customer yet.');
      return;
    }

    const userId = user?.uid || dataBaseUser?.id || '';
    if (!userId) {
      toast.error('Missing signed-in user.');
      return;
    }

    const selectedBody = bodyOfWaterOptions.find((body) => body.id === selectedBodyOfWaterId) || null;
    const nowMillis = Date.now();
    const noteId = `comp_cus_note_${uuidv4()}`;
    const authorName = getAuthorNameFromContext({ dataBaseUser, user });

    try {
      setAddingNote(true);
      await setDoc(doc(notesRef, noteId), {
        id: noteId,
        companyId: resolvedCompanyId,
        customerId,
        customerName: displayCustomerName,
        bodyOfWaterId: selectedBody?.id || '',
        bodyOfWaterName: selectedBody ? getBodyOfWaterLabel(selectedBody) : '',
        serviceLocationId: selectedBody?.serviceLocationId || '',
        userId,
        userName: authorName,
        authorId: userId,
        authorName,
        note: trimmedNote,
        comment: trimmedNote,
        audience: selectedAudience,
        visibility: selectedAudience,
        resolved: false,
        date: serverTimestamp(),
        dateMillis: nowMillis,
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      });

      setNewNote('');
      setSelectedAudience('office');
      await refreshNoteCount();
      if (modalOpen) {
        setPageCursors([null]);
        await loadNotesPage(0, null);
      }
      toast.success('Customer note added.');
    } catch (error) {
      console.error('Failed to add customer note:', error);
      toast.error('Failed to add customer note.');
    } finally {
      setAddingNote(false);
    }
  };

  const openNotesModal = async () => {
    setModalOpen(true);
    setPageIndex(0);
    setPageCursors([null]);
    await refreshNoteCount();
    await loadNotesPage(0, null);
  };

  const goToPreviousPage = () => {
    if (!hasPreviousPage || modalLoading) return;
    const previousPageIndex = pageIndex - 1;
    loadNotesPage(previousPageIndex, pageCursors[previousPageIndex] || null);
  };

  const goToNextPage = () => {
    if (!hasNextPage || !modalLastDoc || modalLoading) return;
    loadNotesPage(pageIndex + 1, modalLastDoc);
  };

  return (
    <>
      <section className={[
        'flex h-full min-h-[640px] flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm',
        className,
      ].filter(Boolean).join(' ')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{displayCustomerName}</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">Customer Notes</h2>
          </div>
          <StatusBadge>{countLoading ? 'Counting...' : `${noteCount} Total`}</StatusBadge>
        </div>

        {!customerId ? (
          <div className="mt-5 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            This record is not linked to a customer yet.
          </div>
        ) : (
          <>
            <div className="mt-5 border-b border-slate-200 pb-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900">Billing Notes</h3>
                <button
                  type="button"
                  onClick={saveBillingNotes}
                  disabled={savingBillingNotes || customerLoading}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaSave className="text-[10px]" />
                  {savingBillingNotes ? 'Saving...' : 'Save'}
                </button>
              </div>
              <textarea
                value={billingNotesDraft}
                onChange={(event) => setBillingNotesDraft(event.target.value)}
                rows={5}
                placeholder="Permanent billing notes for collections, payment preferences, or account context."
                className="mt-3 min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="mt-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Ongoing Customer Notes</h3>
              <textarea
                value={newNote}
                onChange={(event) => setNewNote(event.target.value)}
                rows={4}
                placeholder="Add a follow-up note..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <select
                  value={selectedBodyOfWaterId}
                  onChange={(event) => setSelectedBodyOfWaterId(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">All customer pools</option>
                  {bodyOfWaterOptions.map((body) => (
                    <option key={body.id} value={body.id}>
                      {getBodyOfWaterLabel(body)}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedAudience}
                  onChange={(event) => setSelectedAudience(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  {customerNoteAudienceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={addCustomerNote}
                disabled={addingNote || !newNote.trim()}
                className="inline-flex w-full items-center justify-center rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addingNote ? 'Adding...' : `Add ${selectedAudienceLabel} Note`}
              </button>
            </div>

            <div className="mt-5 flex flex-1 flex-col overflow-hidden border-t border-slate-200 pt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900">Most Recent 3</h3>
                <button
                  type="button"
                  onClick={openNotesModal}
                  disabled={latestNotesLoading || noteCount === 0}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaExpandAlt className="text-[10px]" />
                  Expand
                </button>
              </div>
              <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
                {latestNotesLoading ? (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    Loading customer notes...
                  </div>
                ) : latestNotes.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    No customer notes yet.
                  </div>
                ) : latestNotes.map((note) => (
                  <CustomerNoteCard key={note.id} note={note} />
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{displayCustomerName}</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">Customer Notes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Page {pageIndex + 1} of {pageCount} - {noteCount} note{noteCount === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-slate-50"
                aria-label="Close customer notes"
              >
                <FaTimes />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {modalLoading ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                  Loading notes...
                </div>
              ) : modalNotes.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                  No notes on this page.
                </div>
              ) : (
                <div className="space-y-3">
                  {modalNotes.map((note) => (
                    <CustomerNoteCard key={note.id} note={note} />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-600">
                {noteCount} note{noteCount === 1 ? '' : 's'} total
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToPreviousPage}
                  disabled={!hasPreviousPage || modalLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaChevronLeft className="text-xs" />
                  Previous
                </button>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  {pageIndex + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={goToNextPage}
                  disabled={!hasNextPage || modalLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                  <FaChevronRight className="text-xs" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CustomerBillingNotesPanel;
