import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  BeakerIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
} from "@heroicons/react/24/outline";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import {
  TESTER_STRIP_PROFILE_COLLECTION,
  profileIsEnabledForCompany,
} from "../../../utils/testerStripProfiles";

const settingsDocRef = (companyId) =>
  doc(db, "companies", companyId, "settings", "testerStripProfiles");

const readingTemplatesRef = (companyId) =>
  collection(db, "companies", companyId, "settings", "readings", "readings");

const stripProfilesRef = () => collection(db, ...TESTER_STRIP_PROFILE_COLLECTION);

const normalizeKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const aliasesFor = (value = "") => {
  const key = normalizeKey(value);
  const aliases = new Set(key ? [key] : []);

  if (key === "totalalkalinity") aliases.add("alkalinity");
  if (key === "alkalinity") aliases.add("totalalkalinity");
  if (key === "totalhardness") aliases.add("hardness");
  if (key === "hardness") aliases.add("totalhardness");
  if (key === "cyanuricacid") aliases.add("cya");
  if (key === "cya") aliases.add("cyanuricacid");
  if (key === "freechlorine") aliases.add("chlorine");
  if (key === "totalchlorine") aliases.add("chlorine");
  if (key === "bromine") aliases.add("totalbromine");
  if (key === "totalbromine") aliases.add("bromine");

  return aliases;
};

const templatePayload = (template = null) => {
  if (!template) return null;

  return {
    templateId: template.id || "",
    readingsTemplateId: template.readingsTemplateId || template.universalTemplateId || "",
    name: template.name || "",
    UOM: template.UOM || "",
    chemType: template.chemType || "",
  };
};

const mappingRowsForProfile = (profile = {}) => (
  (profile.pads || []).flatMap((pad) =>
    (pad.readingMappings || []).map((mapping, index) => ({
      pad,
      mapping,
      key: mapping.key || `${pad.id || "pad"}_${index}`,
      label: mapping.label || pad.label || mapping.key || "Reading",
    }))
  )
);

const findBestTemplate = (row, readingTemplates = []) => {
  const candidates = [
    row.mapping.key,
    row.mapping.label,
    row.pad.id,
    row.pad.label,
  ].flatMap((value) => [...aliasesFor(value)]);

  return readingTemplates.find((template) => {
    const templateKeys = [
      template.id,
      template.readingsTemplateId,
      template.universalTemplateId,
      template.name,
      template.chemType,
    ].flatMap((value) => [...aliasesFor(value)]);

    return candidates.some((candidate) => templateKeys.includes(candidate));
  }) || null;
};

function TesterStripSettings() {
  const { recentlySelectedCompany } = useContext(Context);
  const companyId = recentlySelectedCompany?.id || recentlySelectedCompany || "";

  const [profiles, setProfiles] = useState([]);
  const [readingTemplates, setReadingTemplates] = useState([]);
  const [enabledProfileIds, setEnabledProfileIds] = useState([]);
  const [profileMappings, setProfileMappings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const enabledProfileSet = useMemo(() => new Set(enabledProfileIds), [enabledProfileIds]);
  const templateById = useMemo(() => (
    new Map(readingTemplates.map((template) => [template.id, template]))
  ), [readingTemplates]);

  const activeProfiles = useMemo(() => (
    profiles.filter((profile) => profile.status === "active")
  ), [profiles]);

  const loadSettings = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [profilesSnapshot, readingTemplatesSnapshot, settingsSnapshot] = await Promise.all([
        getDocs(query(stripProfilesRef(), orderBy("displayName", "asc"))),
        getDocs(query(readingTemplatesRef(companyId), orderBy("order", "asc"))),
        getDoc(settingsDocRef(companyId)),
      ]);

      const nextProfiles = profilesSnapshot.docs.map((profileDoc) => ({
        id: profileDoc.id,
        ...profileDoc.data(),
      }));
      const nextReadingTemplates = readingTemplatesSnapshot.docs.map((templateDoc) => ({
        id: templateDoc.id,
        ...templateDoc.data(),
      }));
      const savedSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
      const defaultEnabledProfileIds = nextProfiles
        .filter((profile) => profile.status === "active")
        .filter((profile) => profileIsEnabledForCompany(profile, companyId))
        .map((profile) => profile.id);

      setProfiles(nextProfiles);
      setReadingTemplates(nextReadingTemplates);
      setEnabledProfileIds(
        Array.isArray(savedSettings.enabledProfileIds)
          ? savedSettings.enabledProfileIds
          : defaultEnabledProfileIds
      );
      setProfileMappings(savedSettings.profileMappings || {});
    } catch (error) {
      console.error("Failed to load tester strip settings:", error);
      toast.error("Could not load tester strip settings.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const toggleProfile = (profileId) => {
    setEnabledProfileIds((current) => {
      if (current.includes(profileId)) return current.filter((id) => id !== profileId);
      return [...current, profileId];
    });

    setProfileMappings((current) => ({
      ...current,
      [profileId]: {
        ...(current[profileId] || {}),
        enabled: !enabledProfileSet.has(profileId),
      },
    }));
  };

  const selectTemplate = (profileId, mappingKey, templateId) => {
    const selectedTemplate = templateById.get(templateId);

    setProfileMappings((current) => {
      const currentProfile = current[profileId] || {};
      const currentMappings = currentProfile.readingMappings || {};
      const nextMappings = { ...currentMappings };

      if (selectedTemplate) {
        nextMappings[mappingKey] = templatePayload(selectedTemplate);
      } else {
        delete nextMappings[mappingKey];
      }

      return {
        ...current,
        [profileId]: {
          ...currentProfile,
          enabled: enabledProfileSet.has(profileId),
          readingMappings: nextMappings,
        },
      };
    });
  };

  const autoMapProfile = (profile) => {
    const rows = mappingRowsForProfile(profile);

    setEnabledProfileIds((current) => (
      current.includes(profile.id) ? current : [...current, profile.id]
    ));

    setProfileMappings((current) => {
      const currentProfile = current[profile.id] || {};
      const nextMappings = { ...(currentProfile.readingMappings || {}) };

      rows.forEach((row) => {
        if (nextMappings[row.key]?.templateId) return;
        const matchedTemplate = findBestTemplate(row, readingTemplates);
        if (matchedTemplate) {
          nextMappings[row.key] = templatePayload(matchedTemplate);
        }
      });

      return {
        ...current,
        [profile.id]: {
          ...currentProfile,
          enabled: true,
          readingMappings: nextMappings,
        },
      };
    });
  };

  const saveSettings = async () => {
    if (!companyId) {
      toast.error("Select a company before saving tester strip settings.");
      return;
    }

    const cleanedMappings = Object.fromEntries(
      Object.entries(profileMappings).map(([profileId, config]) => [
        profileId,
        {
          enabled: enabledProfileIds.includes(profileId),
          readingMappings: Object.fromEntries(
            Object.entries(config?.readingMappings || {}).filter(([, mapping]) =>
              mapping?.templateId || mapping?.readingsTemplateId
            )
          ),
        },
      ])
    );

    setSaving(true);

    try {
      await setDoc(settingsDocRef(companyId), {
        enabledProfileIds,
        profileMappings: cleanedMappings,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast.success("Tester strip settings saved.");
    } catch (error) {
      console.error("Failed to save tester strip settings:", error);
      toast.error("Could not save tester strip settings.");
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = enabledProfileIds.length;

  return (
    <div className="min-h-screen bg-gray-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/company/settings" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeftIcon className="h-4 w-4" />
            Settings
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Tester Strips</h1>
          <p className="mt-1 text-gray-600">Enabled strips and reading mappings for service stop scans.</p>
        </div>

        <button
          type="button"
          onClick={saveSettings}
          disabled={loading || saving || !companyId}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CloudArrowUpIcon className="h-4 w-4" />
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available profiles</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{activeProfiles.length}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enabled</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{selectedCount}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reading templates</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{readingTemplates.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading tester strip settings...
        </div>
      ) : activeProfiles.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          No active tester strip profiles are available.
        </div>
      ) : (
        <div className="space-y-4">
          {activeProfiles.map((profile) => {
            const isEnabled = enabledProfileSet.has(profile.id);
            const rows = mappingRowsForProfile(profile);
            const profileConfig = profileMappings[profile.id] || {};
            const rowMappings = profileConfig.readingMappings || {};

            return (
              <section key={profile.id} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                      <BeakerIcon className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-slate-900">{profile.displayName || profile.id}</h2>
                        {isEnabled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            Enabled
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {[profile.brand, profile.productName].filter(Boolean).join(" ") || profile.referenceSource || profile.id}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => autoMapProfile(profile)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Auto-map
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleProfile(profile.id)}
                      className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                        isEnabled
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-slate-900 text-white hover:bg-slate-800"
                      }`}
                    >
                      {isEnabled ? "Enabled" : "Enable"}
                    </button>
                  </div>
                </div>

                {isEnabled && (
                  <div className="divide-y divide-slate-100">
                    {rows.map((row) => {
                      const selectedMapping = rowMappings[row.key] || {};
                      const selectedTemplateId = selectedMapping.templateId ||
                        readingTemplates.find((template) =>
                          template.readingsTemplateId === selectedMapping.readingsTemplateId
                        )?.id ||
                        "";

                      return (
                        <div key={`${profile.id}_${row.key}`} className="grid gap-3 p-4 md:grid-cols-[1fr_260px] md:items-center">
                          <div>
                            <p className="font-semibold text-slate-900">{row.label}</p>
                            <p className="mt-0.5 text-sm text-slate-500">{row.pad.label || row.pad.id}</p>
                          </div>
                          <select
                            value={selectedTemplateId}
                            onChange={(event) => selectTemplate(profile.id, row.key, event.target.value)}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                          >
                            <option value="">No mapped reading</option>
                            {readingTemplates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}{template.UOM ? ` (${template.UOM})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TesterStripSettings;
