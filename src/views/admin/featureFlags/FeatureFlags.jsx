import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../../utils/config';
import { FeatureFlag } from '../../../utils/models/FeatureFlag';

const FLAG_COUNT = 100;
const ADMIN_YELLOW = '#debf44';
const REAL_EMAILS_FLAG_ID = 'feature_flag_012';
const LEGACY_REAL_EMAILS_FLAG_ID = 'feature_flag_005';
const LEGACY_REAL_EMAILS_NAME = 'Turn on real emails';
const LEGACY_REAL_EMAILS_DESCRIPTION = 'When off, service agreement and invoice emails are routed to the internal test inbox instead of homeowners.';

function formatDate(value) {
  if (!value) return 'Never';

  const date = typeof value.toDate === 'function' ? value.toDate() : value;

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Never';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function FeatureFlags() {
  const [flags, setFlags] = useState([]);
  const [draftNames, setDraftNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [savingFlagIds, setSavingFlagIds] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  const flagsRef = useMemo(() => collection(db, 'featureFlags'), []);

  const ensureFeatureFlags = useCallback(async () => {
    setSeeding(true);

    try {
      const existingSnapshot = await getDocs(flagsRef);
      const existingFlagsById = new Map(
        existingSnapshot.docs.map((flagDoc) => [flagDoc.id, flagDoc])
      );
      const writes = [];

      Array.from({ length: FLAG_COUNT }, (_, index) => index + 1).forEach((index) => {
        const flagId = FeatureFlag.documentId(index);
        const existingFlag = existingFlagsById.get(flagId);
        const defaultName = FeatureFlag.defaultName(index);
        const defaultDescription = FeatureFlag.defaultDescription(index);

        if (!existingFlag) {
          writes.push({ type: 'create', index, flagId });
          return;
        }

        const existingData = existingFlag.data();
        const updates = {};

        if (defaultName && !(existingData.name || '').trim()) {
          updates.name = defaultName;
        }

        if (defaultDescription && !(existingData.description || '').trim()) {
          updates.description = defaultDescription;
        }

        if (flagId === LEGACY_REAL_EMAILS_FLAG_ID) {
          if ((existingData.name || '').trim() === LEGACY_REAL_EMAILS_NAME) {
            updates.name = defaultName;
          }

          if ((existingData.description || '').trim() === LEGACY_REAL_EMAILS_DESCRIPTION) {
            updates.description = defaultDescription;
          }
        }

        if (Object.keys(updates).length > 0) {
          writes.push({ type: 'update', flagId, updates });
        }
      });

      if (writes.length === 0) {
        return;
      }

      const batch = writeBatch(db);
      const timestamp = serverTimestamp();

      writes.forEach((write) => {
        if (write.type === 'create') {
          batch.set(
            doc(flagsRef, write.flagId),
            FeatureFlag.seedPayload(write.index, timestamp),
            { merge: true }
          );
          return;
        }

        batch.set(doc(flagsRef, write.flagId), {
          ...write.updates,
          updatedAt: timestamp,
        }, { merge: true });
      });

      await batch.commit();
      toast.success(`Updated ${writes.length} feature flags.`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to create feature flags.');
    } finally {
      setSeeding(false);
    }
  }, [flagsRef]);

  useEffect(() => {
    ensureFeatureFlags();
  }, [ensureFeatureFlags]);

  useEffect(() => {
    const flagsQuery = query(flagsRef, orderBy('index', 'asc'));

    const unsubscribe = onSnapshot(
      flagsQuery,
      (snapshot) => {
        const nextFlags = snapshot.docs.map((flagDoc) => FeatureFlag.fromFirestore(flagDoc));

        setFlags(nextFlags);
        setDraftNames((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };

          nextFlags.forEach((flag) => {
            if (nextDrafts[flag.id] === undefined) {
              nextDrafts[flag.id] = flag.name || '';
            }
          });

          return nextDrafts;
        });
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error('Failed to load feature flags.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [flagsRef]);

  const filteredFlags = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) return flags;

    return flags.filter((flag) => {
      return (
        flag.key.toLowerCase().includes(search) ||
        (flag.name || '').toLowerCase().includes(search) ||
        String(flag.index).includes(search)
      );
    });
  }, [flags, searchTerm]);

  const setSaving = (flagId, isSaving) => {
    setSavingFlagIds((current) => ({
      ...current,
      [flagId]: isSaving,
    }));
  };

  const saveName = async (flag) => {
    const nextName = (draftNames[flag.id] || '').trim();

    if (nextName === (flag.name || '')) {
      return;
    }

    setSaving(flag.id, true);

    try {
      await updateDoc(doc(flagsRef, flag.id), {
        name: nextName,
        updatedAt: serverTimestamp(),
      });
      toast.success('Feature flag name saved.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save feature flag name.');
      setDraftNames((currentDrafts) => ({
        ...currentDrafts,
        [flag.id]: flag.name || '',
      }));
    } finally {
      setSaving(flag.id, false);
    }
  };

  const toggleFlag = async (flag) => {
    setSaving(flag.id, true);

    try {
      await updateDoc(doc(flagsRef, flag.id), {
        enabled: !flag.enabled,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error(error);
      toast.error('Failed to update feature flag.');
    } finally {
      setSaving(flag.id, false);
    }
  };

  const realEmailsFlag = flags.find((flag) => flag.id === REAL_EMAILS_FLAG_ID);

  return (
    <div className="min-h-screen bg-slate-900 px-2 py-5 md:px-7">
      <div className="w-full bg-slate-950 p-4 text-slate-100 border border-slate-800/60 shadow-2xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight" style={{ color: ADMIN_YELLOW }}>
              Feature Flags
            </h1>
            <p className="text-sm text-slate-400">
              Manage global app flags stored in Firestore.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search flags"
              className="w-full rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30 sm:w-64"
            />

            <button
              type="button"
              onClick={ensureFeatureFlags}
              disabled={seeding}
              className="rounded-md px-4 py-2 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: ADMIN_YELLOW }}
            >
              {seeding ? 'Checking...' : 'Seed Missing'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-slate-800/60 bg-slate-900/50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="text-2xl font-bold text-slate-100">{flags.length}</p>
          </div>
          <div className="border border-slate-800/60 bg-slate-900/50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Enabled</p>
            <p className="text-2xl font-bold text-emerald-300">
              {flags.filter((flag) => flag.enabled).length}
            </p>
          </div>
          <div className="border border-slate-800/60 bg-slate-900/50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Unnamed</p>
            <p className="text-2xl font-bold text-slate-300">
              {flags.filter((flag) => !(flag.name || '').trim()).length}
            </p>
          </div>
          <div className="border border-slate-800/60 bg-slate-900/50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Real Emails</p>
            <p className={`text-2xl font-bold ${realEmailsFlag?.enabled ? 'text-emerald-300' : 'text-amber-300'}`}>
              {realEmailsFlag?.enabled ? 'On' : 'Test'}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border border-slate-800/60">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/70">
              <tr className="text-slate-200">
                <th className="px-4 py-3 text-left font-bold">Flag</th>
                <th className="px-4 py-3 text-left font-bold">Name</th>
                <th className="px-4 py-3 text-left font-bold">Status</th>
                <th className="px-4 py-3 text-left font-bold">Updated</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {filteredFlags.map((flag) => (
                <tr key={flag.id} className="hover:bg-slate-900/60">
                  <td className="px-4 py-3 align-middle">
                    <div className="font-semibold text-slate-100">#{flag.index}</div>
                    <div className="font-mono text-xs text-slate-500">{flag.key}</div>
                  </td>

                  <td className="min-w-[260px] px-4 py-3 align-middle">
                    <input
                      value={draftNames[flag.id] ?? ''}
                      onChange={(event) =>
                        setDraftNames((currentDrafts) => ({
                          ...currentDrafts,
                          [flag.id]: event.target.value,
                        }))
                      }
                      onBlur={() => saveName(flag)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder="Unnamed feature flag"
                      disabled={savingFlagIds[flag.id]}
                      className="w-full rounded-md border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {flag.description && (
                      <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                        {flag.description}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3 align-middle">
                    <button
                      type="button"
                      onClick={() => toggleFlag(flag)}
                      disabled={savingFlagIds[flag.id]}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        flag.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                      aria-label={`${flag.enabled ? 'Disable' : 'Enable'} ${flag.key}`}
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                          flag.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className="ml-3 text-sm text-slate-300">
                      {flag.enabled ? 'On' : 'Off'}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 align-middle text-slate-400">
                    {formatDate(flag.updatedAt)}
                  </td>
                </tr>
              ))}

              {!loading && filteredFlags.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-slate-400" colSpan={4}>
                    No feature flags found.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td className="px-4 py-8 text-slate-400" colSpan={4}>
                    Loading feature flags...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default FeatureFlags;
