import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  BeakerIcon,
  CloudArrowUpIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { db, functions } from '../../../utils/config';
import {
  AQUACHEK_7_IN_1_PROFILE,
  TESTER_STRIP_PROFILE_COLLECTION,
  matchTesterStripPadColor,
  normalizeHexColor,
  profileIsEnabledForCompany,
} from '../../../utils/testerStripProfiles';
import { appConfirm } from '../../../utils/appDialog';

const ADMIN_YELLOW = '#efb12f';
const NEW_PROFILE_ID = '__new_profile__';

const inputClass =
  'w-full rounded-md border border-slate-800/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30';
const smallInputClass =
  'w-full rounded-md border border-slate-800/70 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#efb12f]/30';
const labelClass = 'text-xs font-semibold uppercase tracking-wide text-slate-400';
const panelClass = 'rounded-lg border border-slate-800/70 bg-slate-950 text-slate-100 shadow-xl';
const buttonBaseClass =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass = `${buttonBaseClass} bg-[#efb12f] text-slate-950 hover:bg-[#efb12f]/90`;
const secondaryButtonClass = `${buttonBaseClass} border border-slate-800/70 bg-slate-900/80 text-slate-200 hover:bg-slate-900`;
const dangerButtonClass = `${buttonBaseClass} border border-red-500/30 bg-red-500/15 text-red-200 hover:bg-red-500/20`;

const collectionRef = () => collection(db, ...TESTER_STRIP_PROFILE_COLLECTION);

const cleanId = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `strip_profile_${Date.now()}`;

const cloneProfile = (profile) => JSON.parse(JSON.stringify(profile));

const enabledCompanyIdsToText = (ids = []) => (
  Array.isArray(ids) ? ids.join('\n') : ''
);

const textToEnabledCompanyIds = (value = '') => (
  String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
);

const emptyProfile = () => ({
  id: `tester_strip_${Date.now()}`,
  brand: '',
  productName: '',
  displayName: '',
  status: 'draft',
  enabledForAllCompanies: false,
  enabledCompanyIds: [],
  referenceSource: '',
  stripOrientation: 'handleToTip',
  readWindowSeconds: 15,
  lightingNormalization: {
    method: 'referenceChartWhiteBalance',
    referenceWhiteHex: '#FFFFFF',
    referenceBlackHex: '#111827',
    maxDeltaEForHighConfidence: 14,
    maxDeltaEForUsableMatch: 32,
    requiresReferenceChartInFrame: true,
  },
  captureGuidance: [],
  pads: [],
});

const emptyPad = (order) => ({
  id: `pad_${Date.now()}`,
  order,
  label: '',
  readingMappings: [{ key: '', label: '', unit: 'ppm' }],
  colorStops: [],
});

const emptyColorStop = () => ({
  id: `stop_${Date.now()}`,
  label: '',
  amount: '',
  hex: '#FFFFFF',
  zone: '',
});

const emptyReadingMapping = () => ({
  key: '',
  label: '',
  unit: 'ppm',
});

const sortByOrderThenLabel = (items = []) => (
  [...items].sort((left, right) => {
    const leftOrder = Number(left.order || 0);
    const rightOrder = Number(right.order || 0);

    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.label || '').localeCompare(String(right.label || ''));
  })
);

const sanitizeProfile = (profile = {}) => {
  const fallbackDisplayName = [profile.brand, profile.productName].filter(Boolean).join(' ').trim();
  const profileId = cleanId(profile.id || profile.displayName || fallbackDisplayName);

  return {
    id: profileId,
    brand: String(profile.brand || '').trim(),
    productName: String(profile.productName || '').trim(),
    displayName: String(profile.displayName || fallbackDisplayName || profileId).trim(),
    status: profile.status === 'active' ? 'active' : 'draft',
    enabledForAllCompanies: profile.enabledForAllCompanies === true,
    enabledCompanyIds: Array.isArray(profile.enabledCompanyIds)
      ? profile.enabledCompanyIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    referenceSource: String(profile.referenceSource || '').trim(),
    stripOrientation: String(profile.stripOrientation || 'handleToTip').trim(),
    readWindowSeconds: Number(profile.readWindowSeconds || 0),
    lightingNormalization: {
      method: String(profile.lightingNormalization?.method || 'referenceChartWhiteBalance').trim(),
      referenceWhiteHex: normalizeHexColor(profile.lightingNormalization?.referenceWhiteHex, '#FFFFFF'),
      referenceBlackHex: normalizeHexColor(profile.lightingNormalization?.referenceBlackHex, '#111827'),
      maxDeltaEForHighConfidence: Number(profile.lightingNormalization?.maxDeltaEForHighConfidence || 14),
      maxDeltaEForUsableMatch: Number(profile.lightingNormalization?.maxDeltaEForUsableMatch || 32),
      requiresReferenceChartInFrame: profile.lightingNormalization?.requiresReferenceChartInFrame !== false,
    },
    captureGuidance: Array.isArray(profile.captureGuidance)
      ? profile.captureGuidance.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    pads: sortByOrderThenLabel(profile.pads || []).map((pad, padIndex) => ({
      id: cleanId(pad.id || pad.label || `pad_${padIndex + 1}`),
      order: Number(pad.order || padIndex + 1),
      label: String(pad.label || '').trim(),
      readingMappings: (Array.isArray(pad.readingMappings) ? pad.readingMappings : [])
        .map((mapping) => ({
          key: String(mapping.key || '').trim(),
          label: String(mapping.label || '').trim(),
          unit: String(mapping.unit || '').trim(),
        }))
        .filter((mapping) => mapping.key || mapping.label),
      colorStops: (Array.isArray(pad.colorStops) ? pad.colorStops : [])
        .map((stop, stopIndex) => ({
          id: cleanId(stop.id || `${pad.id || 'pad'}_${stop.label || stopIndex + 1}`),
          label: String(stop.label || '').trim(),
          amount: String(stop.amount || stop.label || '').trim(),
          hex: normalizeHexColor(stop.hex, '#FFFFFF'),
          zone: String(stop.zone || '').trim(),
        }))
        .filter((stop) => stop.amount || stop.label),
    })),
  };
};

const confidenceBarClass = (label) => {
  if (label === 'High') return 'bg-emerald-400';
  if (label === 'Review') return 'bg-amber-300';

  return 'bg-red-400';
};

function TesterStripProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [draftProfile, setDraftProfile] = useState(null);
  const [enabledCompanyText, setEnabledCompanyText] = useState('');
  const [captureGuidanceText, setCaptureGuidanceText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [benchColors, setBenchColors] = useState({});

  useEffect(() => {
    const profilesQuery = query(collectionRef(), orderBy('displayName', 'asc'));

    const unsubscribe = onSnapshot(
      profilesQuery,
      (snapshot) => {
        const nextProfiles = snapshot.docs.map((profileDoc) => ({
          id: profileDoc.id,
          ...profileDoc.data(),
        }));

        setProfiles(nextProfiles);
        setLoading(false);

        if (!selectedProfileId && nextProfiles.length) {
          setSelectedProfileId(nextProfiles[0].id);
        }
      },
      (error) => {
        console.error('Failed to load tester strip profiles:', error);
        toast.error('Could not load tester strip profiles.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [selectedProfileId]);

  useEffect(() => {
    if (selectedProfileId === NEW_PROFILE_ID) return;

    const selected = profiles.find((profile) => profile.id === selectedProfileId);
    if (!selected) {
      setDraftProfile(null);
      setEnabledCompanyText('');
      setCaptureGuidanceText('');
      setBenchColors({});
      return;
    }

    const nextDraft = cloneProfile(selected);
    setDraftProfile(nextDraft);
    setEnabledCompanyText(enabledCompanyIdsToText(nextDraft.enabledCompanyIds));
    setCaptureGuidanceText((nextDraft.captureGuidance || []).join('\n'));
    setBenchColors(
      Object.fromEntries(
        (nextDraft.pads || []).map((pad) => [pad.id, pad.colorStops?.[0]?.hex || '#FFFFFF'])
      )
    );
  }, [profiles, selectedProfileId]);

  const filteredProfiles = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return profiles;

    return profiles.filter((profile) =>
      [
        profile.displayName,
        profile.brand,
        profile.productName,
        profile.referenceSource,
        profile.id,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [profiles, searchTerm]);

  const benchMatches = useMemo(() => {
    if (!draftProfile) return [];

    const options = draftProfile.lightingNormalization || {};

    return sortByOrderThenLabel(draftProfile.pads || []).map((pad) => ({
      pad,
      match: matchTesterStripPadColor(
        pad,
        benchColors[pad.id] || pad.colorStops?.[0]?.hex || '#FFFFFF',
        options
      ),
    }));
  }, [benchColors, draftProfile]);

  const updateDraft = (updates) => {
    setDraftProfile((current) => ({
      ...current,
      ...updates,
    }));
  };

  const updateLighting = (field, value) => {
    setDraftProfile((current) => ({
      ...current,
      lightingNormalization: {
        ...(current?.lightingNormalization || {}),
        [field]: value,
      },
    }));
  };

  const updatePad = (padId, updates) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => (
        pad.id === padId ? { ...pad, ...updates } : pad
      )),
    }));
  };

  const updateReadingMapping = (padId, mappingIndex, updates) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => {
        if (pad.id !== padId) return pad;

        return {
          ...pad,
          readingMappings: (pad.readingMappings || []).map((mapping, index) => (
            index === mappingIndex ? { ...mapping, ...updates } : mapping
          )),
        };
      }),
    }));
  };

  const updateColorStop = (padId, stopId, updates) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => {
        if (pad.id !== padId) return pad;

        return {
          ...pad,
          colorStops: (pad.colorStops || []).map((stop) => (
            stop.id === stopId ? { ...stop, ...updates } : stop
          )),
        };
      }),
    }));
  };

  const addProfile = () => {
    const nextProfile = emptyProfile();
    setSelectedProfileId(NEW_PROFILE_ID);
    setDraftProfile(nextProfile);
    setEnabledCompanyText('');
    setCaptureGuidanceText('');
    setBenchColors({});
  };

  const addPad = () => {
    if (!draftProfile) return;
    const nextOrder = (draftProfile.pads || []).reduce((maxOrder, pad) => (
      Math.max(maxOrder, Number(pad.order || 0))
    ), 0) + 1;
    const pad = emptyPad(nextOrder);

    updateDraft({
      pads: [...(draftProfile.pads || []), pad],
    });
    setBenchColors((current) => ({ ...current, [pad.id]: '#FFFFFF' }));
  };

  const removePad = (padId) => {
    updateDraft({
      pads: (draftProfile?.pads || []).filter((pad) => pad.id !== padId),
    });
    setBenchColors((current) => {
      const next = { ...current };
      delete next[padId];
      return next;
    });
  };

  const addReadingMapping = (padId) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => (
        pad.id === padId
          ? { ...pad, readingMappings: [...(pad.readingMappings || []), emptyReadingMapping()] }
          : pad
      )),
    }));
  };

  const removeReadingMapping = (padId, mappingIndex) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => (
        pad.id === padId
          ? {
              ...pad,
              readingMappings: (pad.readingMappings || []).filter((_, index) => index !== mappingIndex),
            }
          : pad
      )),
    }));
  };

  const addColorStop = (padId) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => (
        pad.id === padId
          ? { ...pad, colorStops: [...(pad.colorStops || []), emptyColorStop()] }
          : pad
      )),
    }));
  };

  const removeColorStop = (padId, stopId) => {
    setDraftProfile((current) => ({
      ...current,
      pads: (current?.pads || []).map((pad) => (
        pad.id === padId
          ? {
              ...pad,
              colorStops: (pad.colorStops || []).filter((stop) => stop.id !== stopId),
            }
          : pad
      )),
    }));
  };

  const saveProfile = async () => {
    if (!draftProfile) return;

    const cleanProfile = sanitizeProfile({
      ...draftProfile,
      enabledCompanyIds: textToEnabledCompanyIds(enabledCompanyText),
      captureGuidance: captureGuidanceText.split('\n'),
    });

    if (!cleanProfile.displayName) {
      toast.error('Profile name is required.');
      return;
    }

    if (!cleanProfile.pads.length) {
      toast.error('Add at least one strip pad.');
      return;
    }

    const isNewProfile =
      selectedProfileId === NEW_PROFILE_ID ||
      !profiles.some((profile) => profile.id === cleanProfile.id);
    const payload = {
      ...cleanProfile,
      updatedAt: serverTimestamp(),
      ...(isNewProfile ? { createdAt: serverTimestamp() } : {}),
    };

    setSaving(true);
    try {
      await setDoc(doc(collectionRef(), cleanProfile.id), payload, { merge: true });
      toast.success('Tester strip profile saved.');
      setSelectedProfileId(cleanProfile.id);
    } catch (error) {
      console.error('Failed to save tester strip profile:', error);
      toast.error('Could not save tester strip profile.');
    } finally {
      setSaving(false);
    }
  };

  const seedAquaChek = async () => {
    setSeeding(true);
    try {
      const seedProfile = httpsCallable(functions, 'seedAquaChekTesterStripProfile');
      await seedProfile({});
      toast.success('AquaChek 7-in-1 profile seeded.');
      setSelectedProfileId(AQUACHEK_7_IN_1_PROFILE.id);
    } catch (error) {
      console.error('Failed to seed AquaChek profile:', error);
      toast.error('Could not seed AquaChek profile.');
    } finally {
      setSeeding(false);
    }
  };

  const deleteProfile = async () => {
    if (!draftProfile || selectedProfileId === NEW_PROFILE_ID) return;
    const confirmed = await appConfirm({
      title: 'Delete Tester Strip Profile',
      message: `Delete ${draftProfile.displayName || draftProfile.id}?`,
      confirmLabel: 'Delete Profile',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(collectionRef(), selectedProfileId));
      toast.success('Tester strip profile deleted.');
      const nextProfile = profiles.find((profile) => profile.id !== selectedProfileId);
      setSelectedProfileId(nextProfile?.id || '');
      setDraftProfile(null);
    } catch (error) {
      console.error('Failed to delete tester strip profile:', error);
      toast.error('Could not delete tester strip profile.');
    }
  };

  const renderProfileList = () => (
    <aside className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-slate-800/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Profiles</h2>
            <p className="text-xs text-slate-400">{profiles.length} configured</p>
          </div>
          <button type="button" className={secondaryButtonClass} onClick={addProfile}>
            <PlusIcon className="h-4 w-4" />
            New
          </button>
        </div>
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className={`${inputClass} mt-4`}
          placeholder="Search profiles"
        />
      </div>

      <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-2">
        {loading ? (
          <div className="p-4 text-sm text-slate-400">Loading profiles...</div>
        ) : filteredProfiles.length ? (
          filteredProfiles.map((profile) => {
            const isSelected = selectedProfileId === profile.id;

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => setSelectedProfileId(profile.id)}
                className={`mb-2 w-full rounded-md border px-3 py-3 text-left transition ${
                  isSelected
                    ? 'border-[#efb12f]/40 bg-[#efb12f]/10'
                    : 'border-slate-800/70 bg-slate-900/50 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-100">
                    {profile.displayName || profile.productName || profile.id}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      profile.status === 'active'
                        ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30'
                        : 'bg-slate-700/70 text-slate-300'
                    }`}
                  >
                    {profile.status || 'draft'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {profile.brand || 'No brand'} · {(profile.pads || []).length} pads
                </div>
                {profile.enabledForAllCompanies ? (
                  <div className="mt-2 text-xs font-semibold text-[#efb12f]">Enabled for all companies</div>
                ) : (profile.enabledCompanyIds || []).length ? (
                  <div className="mt-2 text-xs text-slate-400">
                    {(profile.enabledCompanyIds || []).length} enabled companies
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500">No companies enabled</div>
                )}
              </button>
            );
          })
        ) : (
          <div className="p-4 text-sm text-slate-400">No profiles found.</div>
        )}
      </div>
    </aside>
  );

  const renderBasics = () => (
    <section className={`${panelClass} p-4`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Profile Details</h2>
          <p className="text-xs text-slate-400">Stored in universal settings for company-enabled strip scanning.</p>
        </div>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-slate-800">
          {draftProfile?.id || 'No profile'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label>
          <span className={labelClass}>Profile Id</span>
          <input
            type="text"
            value={draftProfile?.id || ''}
            onChange={(event) => updateDraft({ id: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label>
          <span className={labelClass}>Display Name</span>
          <input
            type="text"
            value={draftProfile?.displayName || ''}
            onChange={(event) => updateDraft({ displayName: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label>
          <span className={labelClass}>Brand</span>
          <input
            type="text"
            value={draftProfile?.brand || ''}
            onChange={(event) => updateDraft({ brand: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label>
          <span className={labelClass}>Product Name</span>
          <input
            type="text"
            value={draftProfile?.productName || ''}
            onChange={(event) => updateDraft({ productName: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label>
          <span className={labelClass}>Reference Source</span>
          <input
            type="text"
            value={draftProfile?.referenceSource || ''}
            onChange={(event) => updateDraft({ referenceSource: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label>
          <span className={labelClass}>Status</span>
          <select
            value={draftProfile?.status || 'draft'}
            onChange={(event) => updateDraft({ status: event.target.value })}
            className={`${inputClass} mt-1`}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Strip Orientation</span>
          <select
            value={draftProfile?.stripOrientation || 'handleToTip'}
            onChange={(event) => updateDraft({ stripOrientation: event.target.value })}
            className={`${inputClass} mt-1`}
          >
            <option value="handleToTip">Handle to Tip</option>
            <option value="tipToHandle">Tip to Handle</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Read Window Seconds</span>
          <input
            type="number"
            min="0"
            value={draftProfile?.readWindowSeconds || 0}
            onChange={(event) => updateDraft({ readWindowSeconds: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 rounded-md border border-slate-800/70 bg-slate-900/50 px-3 py-2">
          <input
            type="checkbox"
            checked={draftProfile?.enabledForAllCompanies === true}
            onChange={(event) => updateDraft({ enabledForAllCompanies: event.target.checked })}
            className="h-4 w-4 rounded border-slate-600 text-[#efb12f]"
          />
          <span className="text-sm font-semibold text-slate-200">Enabled for all companies</span>
        </label>
        <label className="flex items-center gap-3 rounded-md border border-slate-800/70 bg-slate-900/50 px-3 py-2">
          <input
            type="checkbox"
            checked={draftProfile?.lightingNormalization?.requiresReferenceChartInFrame !== false}
            onChange={(event) => updateLighting('requiresReferenceChartInFrame', event.target.checked)}
            className="h-4 w-4 rounded border-slate-600 text-[#efb12f]"
          />
          <span className="text-sm font-semibold text-slate-200">Require chart in scan frame</span>
        </label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label>
          <span className={labelClass}>Enabled Company Ids</span>
          <textarea
            value={enabledCompanyText}
            onChange={(event) => setEnabledCompanyText(event.target.value)}
            className={`${inputClass} mt-1 min-h-[120px]`}
            placeholder="One company id per line"
          />
        </label>
        <label>
          <span className={labelClass}>Capture Guidance</span>
          <textarea
            value={captureGuidanceText}
            onChange={(event) => setCaptureGuidanceText(event.target.value)}
            className={`${inputClass} mt-1 min-h-[120px]`}
            placeholder="One camera guidance line per line"
          />
        </label>
      </div>
    </section>
  );

  const renderLighting = () => (
    <section className={`${panelClass} p-4`}>
      <h2 className="text-lg font-bold">Lighting Normalization</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
        <label className="md:col-span-2">
          <span className={labelClass}>Method</span>
          <input
            type="text"
            value={draftProfile?.lightingNormalization?.method || ''}
            onChange={(event) => updateLighting('method', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label>
          <span className={labelClass}>White Ref</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={normalizeHexColor(draftProfile?.lightingNormalization?.referenceWhiteHex, '#FFFFFF')}
              onChange={(event) => updateLighting('referenceWhiteHex', event.target.value)}
              className="h-10 w-12 rounded-md border border-slate-800 bg-slate-900"
            />
            <input
              type="text"
              value={draftProfile?.lightingNormalization?.referenceWhiteHex || ''}
              onChange={(event) => updateLighting('referenceWhiteHex', event.target.value)}
              className={smallInputClass}
            />
          </div>
        </label>
        <label>
          <span className={labelClass}>Black Ref</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={normalizeHexColor(draftProfile?.lightingNormalization?.referenceBlackHex, '#111827')}
              onChange={(event) => updateLighting('referenceBlackHex', event.target.value)}
              className="h-10 w-12 rounded-md border border-slate-800 bg-slate-900"
            />
            <input
              type="text"
              value={draftProfile?.lightingNormalization?.referenceBlackHex || ''}
              onChange={(event) => updateLighting('referenceBlackHex', event.target.value)}
              className={smallInputClass}
            />
          </div>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>High ΔE</span>
            <input
              type="number"
              value={draftProfile?.lightingNormalization?.maxDeltaEForHighConfidence || 14}
              onChange={(event) => updateLighting('maxDeltaEForHighConfidence', event.target.value)}
              className={`${smallInputClass} mt-1`}
            />
          </label>
          <label>
            <span className={labelClass}>Usable ΔE</span>
            <input
              type="number"
              value={draftProfile?.lightingNormalization?.maxDeltaEForUsableMatch || 32}
              onChange={(event) => updateLighting('maxDeltaEForUsableMatch', event.target.value)}
              className={`${smallInputClass} mt-1`}
            />
          </label>
        </div>
      </div>
    </section>
  );

  const renderPad = (pad) => (
    <div key={pad.id} className="rounded-lg border border-slate-800/70 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[90px_1fr_1fr]">
          <label>
            <span className={labelClass}>Order</span>
            <input
              type="number"
              value={pad.order || 0}
              onChange={(event) => updatePad(pad.id, { order: event.target.value })}
              className={`${smallInputClass} mt-1`}
            />
          </label>
          <label>
            <span className={labelClass}>Pad Id</span>
            <input
              type="text"
              value={pad.id || ''}
              onChange={(event) => updatePad(pad.id, { id: event.target.value })}
              className={`${smallInputClass} mt-1`}
            />
          </label>
          <label>
            <span className={labelClass}>Label</span>
            <input
              type="text"
              value={pad.label || ''}
              onChange={(event) => updatePad(pad.id, { label: event.target.value })}
              className={`${smallInputClass} mt-1`}
            />
          </label>
        </div>
        <button type="button" className={dangerButtonClass} onClick={() => removePad(pad.id)}>
          <TrashIcon className="h-4 w-4" />
          Pad
        </button>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-200">Reading Mappings</h3>
          <button type="button" className={secondaryButtonClass} onClick={() => addReadingMapping(pad.id)}>
            <PlusIcon className="h-4 w-4" />
            Mapping
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(pad.readingMappings || []).map((mapping, mappingIndex) => (
            <div key={`${pad.id}_mapping_${mappingIndex}`} className="grid grid-cols-[1fr_1fr_90px_38px] gap-2">
              <input
                type="text"
                value={mapping.key || ''}
                onChange={(event) => updateReadingMapping(pad.id, mappingIndex, { key: event.target.value })}
                className={smallInputClass}
                placeholder="reading key"
              />
              <input
                type="text"
                value={mapping.label || ''}
                onChange={(event) => updateReadingMapping(pad.id, mappingIndex, { label: event.target.value })}
                className={smallInputClass}
                placeholder="label"
              />
              <input
                type="text"
                value={mapping.unit || ''}
                onChange={(event) => updateReadingMapping(pad.id, mappingIndex, { unit: event.target.value })}
                className={smallInputClass}
                placeholder="unit"
              />
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-red-200"
                onClick={() => removeReadingMapping(pad.id, mappingIndex)}
                title="Remove mapping"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-200">Bottle Chart Colors</h3>
          <button type="button" className={secondaryButtonClass} onClick={() => addColorStop(pad.id)}>
            <PlusIcon className="h-4 w-4" />
            Color
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {(pad.colorStops || []).map((stop) => (
            <div key={stop.id} className="grid grid-cols-[46px_1fr_1fr_1fr_38px] items-center gap-2">
              <input
                type="color"
                value={normalizeHexColor(stop.hex, '#FFFFFF')}
                onChange={(event) => updateColorStop(pad.id, stop.id, { hex: event.target.value })}
                className="h-9 w-10 rounded-md border border-slate-800 bg-slate-900"
                title="Swatch"
              />
              <input
                type="text"
                value={stop.label || ''}
                onChange={(event) => updateColorStop(pad.id, stop.id, { label: event.target.value })}
                className={smallInputClass}
                placeholder="label"
              />
              <input
                type="text"
                value={stop.amount || ''}
                onChange={(event) => updateColorStop(pad.id, stop.id, { amount: event.target.value })}
                className={smallInputClass}
                placeholder="amount"
              />
              <input
                type="text"
                value={stop.hex || ''}
                onChange={(event) => updateColorStop(pad.id, stop.id, { hex: event.target.value })}
                className={smallInputClass}
                placeholder="#RRGGBB"
              />
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-red-200"
                onClick={() => removeColorStop(pad.id, stop.id)}
                title="Remove color"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderPads = () => (
    <section className={`${panelClass} p-4`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Strip Pads</h2>
          <p className="text-xs text-slate-400">{(draftProfile?.pads || []).length} configured pads</p>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={addPad}>
          <PlusIcon className="h-4 w-4" />
          Pad
        </button>
      </div>
      <div className="space-y-4">
        {sortByOrderThenLabel(draftProfile?.pads || []).map(renderPad)}
      </div>
    </section>
  );

  const renderBench = () => (
    <section className={`${panelClass} p-4`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Match Test Bench</h2>
          <p className="text-xs text-slate-400">Paste or pick sample pad colors to preview result matching.</p>
        </div>
        <BeakerIcon className="h-6 w-6" style={{ color: ADMIN_YELLOW }} />
      </div>

      <div className="space-y-3">
        {benchMatches.length ? benchMatches.map(({ pad, match }) => {
          const selectedHex = benchColors[pad.id] || pad.colorStops?.[0]?.hex || '#FFFFFF';

          return (
            <div key={pad.id} className="rounded-md border border-slate-800/70 bg-slate-900/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-100">{pad.label || pad.id}</div>
                  <div className="text-xs text-slate-400">
                    {match?.matchedStop?.label || '-'} · {Math.round((match?.confidence || 0) * 100)}% confidence
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={normalizeHexColor(selectedHex, '#FFFFFF')}
                    onChange={(event) => setBenchColors((current) => ({
                      ...current,
                      [pad.id]: event.target.value,
                    }))}
                    className="h-9 w-12 rounded-md border border-slate-800 bg-slate-900"
                  />
                  <input
                    type="text"
                    value={selectedHex}
                    onChange={(event) => setBenchColors((current) => ({
                      ...current,
                      [pad.id]: event.target.value,
                    }))}
                    className="w-28 rounded-md border border-slate-800/70 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                  />
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${confidenceBarClass(match?.confidenceLabel)}`}
                  style={{ width: `${Math.round((match?.confidence || 0) * 100)}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(pad.colorStops || []).map((stop) => (
                  <button
                    key={stop.id}
                    type="button"
                    onClick={() => setBenchColors((current) => ({ ...current, [pad.id]: stop.hex }))}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition ${
                      match?.matchedStop?.id === stop.id
                        ? 'border-[#efb12f]/40 bg-[#efb12f]/10 text-[#efb12f]'
                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900'
                    }`}
                  >
                    <span
                      className="h-4 w-4 rounded-sm border border-black/20"
                      style={{ backgroundColor: normalizeHexColor(stop.hex, '#FFFFFF') }}
                    />
                    {stop.label || stop.amount}
                  </button>
                ))}
              </div>
            </div>
          );
        }) : (
          <div className="rounded-md border border-slate-800/70 bg-slate-900/50 p-4 text-sm text-slate-400">
            Add pads and chart colors to preview matches.
          </div>
        )}
      </div>
    </section>
  );

  const renderEditor = () => {
    if (!draftProfile) {
      return (
        <section className={`${panelClass} flex min-h-[420px] items-center justify-center p-8 text-center`}>
          <div>
            <BeakerIcon className="mx-auto h-10 w-10" style={{ color: ADMIN_YELLOW }} />
            <h2 className="mt-3 text-lg font-bold">No tester strip profile selected</h2>
            <p className="mt-1 text-sm text-slate-400">Seed AquaChek 7-in-1 or create a profile.</p>
          </div>
        </section>
      );
    }

    return (
      <div className="space-y-5">
        {renderBasics()}
        {renderLighting()}
        {renderPads()}
        {renderBench()}
      </div>
    );
  };

  const activeProfileCount = profiles.filter((profile) => profile.status === 'active').length;
  const enabledProfileCount = profiles.filter((profile) =>
    profile.enabledForAllCompanies || (profile.enabledCompanyIds || []).length > 0
  ).length;
  const profileEnabledForTypedCompany = draftProfile && enabledCompanyText
    ? textToEnabledCompanyIds(enabledCompanyText).some((companyId) =>
        profileIsEnabledForCompany({ ...draftProfile, enabledCompanyIds: textToEnabledCompanyIds(enabledCompanyText) }, companyId)
      )
    : false;

  return (
    <main className="min-h-screen bg-slate-900 px-2 py-5 text-slate-100 md:px-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold uppercase tracking-wide text-slate-500">Development</div>
          <h1 className="text-3xl font-black tracking-tight" style={{ color: ADMIN_YELLOW }}>Tester Strip Profiles</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
            <span className="rounded-full bg-slate-950 px-3 py-1 text-slate-300 ring-1 ring-slate-800">{profiles.length} total</span>
            <span className="rounded-full bg-slate-950 px-3 py-1 text-slate-300 ring-1 ring-slate-800">{activeProfileCount} active</span>
            <span className="rounded-full bg-slate-950 px-3 py-1 text-slate-300 ring-1 ring-slate-800">{enabledProfileCount} enabled</span>
            {profileEnabledForTypedCompany && (
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-200 ring-1 ring-emerald-500/30">
                Company enablement ready
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClass} onClick={seedAquaChek} disabled={seeding}>
            <CloudArrowUpIcon className="h-4 w-4" />
            {seeding ? 'Seeding...' : 'Seed AquaChek'}
          </button>
          <button type="button" className={primaryButtonClass} onClick={saveProfile} disabled={!draftProfile || saving}>
            <CloudArrowUpIcon className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
          {draftProfile && selectedProfileId !== NEW_PROFILE_ID && (
            <button type="button" className={dangerButtonClass} onClick={deleteProfile}>
              <TrashIcon className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_1fr]">
        {renderProfileList()}
        {renderEditor()}
      </div>
    </main>
  );
}

export default TesterStripProfiles;
