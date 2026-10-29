import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { v4 as uuidv4 } from "uuid";
import { CheckCircleIcon, PhotoIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { functions } from "../../utils/config";
import Select from "react-select";
import { EQUIPMENT_STATUS, EQUIPMENT_STATUS_OPTIONS } from "../../utils/models/Equipment";

import RepairRequestPriority from '../../components/RepairRequestPriority';
import { DEFAULT_ISSUE_PRIORITY } from '../../utils/models/JobPlan';

const initialForm = { requesterCompanyUserId: "", customerId: "", locationId: "", bodyOfWaterId: "", equipmentId: "", equipmentStatusUpdate: "", description: "", issuePriorityLevel: DEFAULT_ISSUE_PRIORITY, website: "" };
const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
const selectStyles = { control: (base) => ({ ...base, minHeight: 48, borderRadius: "0.5rem", borderColor: "#cbd5e1" }), menu: (base) => ({ ...base, zIndex: 30 }) };
const toOptions = (items = []) => items.map(({ id, label }) => ({ value: id, label }));
const readPhoto = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, contentType: file.type, data: String(reader.result).split(",")[1] });
  reader.onerror = () => reject(new Error("We couldn't read a photo. Please select it again."));
  reader.readAsDataURL(file);
});

const RepairRequestForm = ({ companyId }) => {
  const [company, setCompany] = useState(null);
  const [users, setUsers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [bodies, setBodies] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [submissionId, setSubmissionId] = useState(uuidv4);
  const submitting = useRef(false);
  const errorRef = useRef(null);
  const successRef = useRef(null);
  const previews = useMemo(() => photos.map((file) => ({ file, url: URL.createObjectURL(file) })), [photos]);

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    httpsCallable(functions, "getPublicRepairRequestCompany")({ companyId })
      .then(({ data }) => {
        if (!data?.company) throw new Error("This repair request form is unavailable.");
        if (!cancelled) {
          setCompany(data.company);
          setUsers(toOptions(data.users));
          setCustomers(toOptions(data.customers));
        }
      })
      .catch((loadFailure) => {
        if (!cancelled) setLoadError(loadFailure.code === "functions/not-found"
          ? loadFailure.message
          : "We couldn't load this company's repair form. Please try again.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, loadAttempt]);
  useEffect(() => {
    if (!form.customerId) return;
    let cancelled = false;
    setLocationsLoading(true);
    setOptionsError("");
    httpsCallable(functions, "getPublicRepairRequestOptions")({ companyId, customerId: form.customerId })
      .then(({ data }) => {
        if (cancelled) return;
        const options = toOptions(data.serviceLocations);
        setLocations(options);
        setForm((current) => ({ ...current, locationId: options[0]?.value || "", bodyOfWaterId: "", equipmentId: "", equipmentStatusUpdate: "" }));
      })
      .catch(() => { if (!cancelled) setOptionsError("We couldn't load this customer's locations. Please try again."); })
      .finally(() => { if (!cancelled) setLocationsLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, form.customerId, optionsAttempt]);
  useEffect(() => {
    if (!form.customerId || !form.locationId) return;
    let cancelled = false;
    setEquipmentLoading(true);
    setOptionsError("");
    httpsCallable(functions, "getPublicRepairRequestOptions")({ companyId, customerId: form.customerId, locationId: form.locationId })
      .then(({ data }) => {
        if (cancelled) return;
        setBodies(toOptions(data.bodiesOfWater));
        setEquipment(toOptions(data.equipment));
      })
      .catch(() => { if (!cancelled) setOptionsError("We couldn't load the pools and equipment for this location. Please try again."); })
      .finally(() => { if (!cancelled) setEquipmentLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, form.customerId, form.locationId, optionsAttempt]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (requestId) successRef.current?.focus(); }, [requestId]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setSubmissionId(uuidv4());
    setError("");
  };
  const choose = (name, option) => {
    const value = option?.value || "";
    setForm((current) => ({
      ...current, [name]: value,
      ...(name === "customerId" ? { locationId: "", bodyOfWaterId: "", equipmentId: "", equipmentStatusUpdate: "" } : {}),
      ...(name === "locationId" ? { bodyOfWaterId: "", equipmentId: "", equipmentStatusUpdate: "" } : {}),
      ...(name === "equipmentId" ? { equipmentStatusUpdate: value ? EQUIPMENT_STATUS.NEEDS_REPAIR : "" } : {}),
    }));
    if (name === "customerId") {
      setLocations([]);
      setLocationsLoading(Boolean(value));
    }
    if (name === "customerId" || name === "locationId") {
      setBodies([]);
      setEquipment([]);
      setEquipmentLoading(false);
      setOptionsError("");
    }
    setSubmissionId(uuidv4());
    setError("");
  };

  const selectPhotos = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const next = [...photos, ...files];
    if (next.length > 3) return setPhotoError("You can attach up to 3 photos. Remove a photo to add another.");
    if (next.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      return setPhotoError("Choose JPG, PNG, or WebP photos up to 2 MB each.");
    }
    if (next.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024) {
      return setPhotoError("Please keep the total photo size under 5 MB.");
    }
    setPhotos(next);
    setSubmissionId(uuidv4());
    setPhotoError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!form.requesterCompanyUserId || !form.customerId || !form.description.trim()) return setError("Please select a technician and customer, and describe the issue.");
    if (locationsLoading || equipmentLoading || optionsError) return setError("Please wait for the selections to load, or retry loading them.");
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const photoData = await Promise.all(photos.map(readPhoto));
      const { data } = await httpsCallable(functions, "submitPublicRepairRequest")({ companyId, submissionId, ...form, photos: photoData });
      if (!data?.requestId) throw new Error("We couldn't submit your repair request. Please try again.");
      setRequestId(data.requestId);
      setPhotos([]);
    } catch (failure) {
      const actionable = ["functions/invalid-argument", "functions/resource-exhausted", "functions/not-found", "functions/aborted"].includes(failure.code);
      setError(actionable ? failure.message : "We couldn't submit your repair request. Your details are still here. Please try again.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const picker = (name, label, options, { required = false, disabled = false, loading = false, placeholder = "Select..." } = {}) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={`repair-${name}`}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <Select inputId={`repair-${name}`} instanceId={`repair-${name}`} name={name} options={options} value={options.find((option) => option.value === form[name]) || null} onChange={(option) => choose(name, option)} isDisabled={saving || disabled} isLoading={loading} isClearable isSearchable placeholder={placeholder} noOptionsMessage={() => loading ? "Loading..." : "No options found"} styles={selectStyles} />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-5">
          <Link to="/" className="text-xl font-bold text-cyan-700">Drip Drop</Link>
          <span className="text-sm text-slate-500">Technician repair requests</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {loading ? <p role="status" className="py-12 text-center text-slate-600">Loading repair request form...</p>
          : loadError ? (
            <div role="alert" className="rounded-xl border border-slate-200 bg-white p-8">
              <h1 className="text-2xl font-bold">Repair request form unavailable</h1>
              <p className="mt-3 text-slate-600">{loadError}</p>
              <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mt-5 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white">Try again</button>
            </div>
          ) : requestId ? (
            <section ref={successRef} tabIndex={-1} aria-labelledby="repair-success" className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm outline-none sm:p-12">
              <CheckCircleIcon className="mx-auto h-14 w-14 text-emerald-600" aria-hidden="true" />
              <h1 id="repair-success" className="mt-5 text-3xl font-bold">Your repair request is in.</h1>
              <p className="mt-4 text-slate-600">{company.name} has received your repair request for the selected customer.</p>
              <p className="mt-4 text-sm text-slate-500">A visit has not been scheduled yet.</p>
              <p className="mt-6 break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Reference: {requestId}</p>
            </section>
          ) : (
            <>
              <div className="mb-8">
                <div className="mb-4 inline-flex rounded-xl bg-blue-100 p-3 text-blue-700"><WrenchScrewdriverIcon className="h-7 w-7" aria-hidden="true" /></div>
                <p className="mb-2 text-sm font-semibold text-blue-700">{company.name}</p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Create External Repair Request</h1>
                <p className="mt-3 text-slate-600">For technicians: select your name and customer, then describe the repair. No login required.</p>
              </div>
              <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <fieldset disabled={saving} className="min-w-0 space-y-7 p-5 sm:p-8">
                  <p className="text-sm text-slate-500">Fields marked * are required.</p>
                  <section aria-labelledby="repair-technician">
                    <h2 id="repair-technician" className="mb-4 text-lg font-semibold">Requester</h2>
                    {picker("requesterCompanyUserId", "Technician", users, { required: true, placeholder: "Select an active company user..." })}
                    {!users.length && <p className="mt-2 text-sm text-slate-500">No active company users are available. Contact the office.</p>}
                  </section>
                  <section aria-labelledby="repair-owner" className="border-t border-slate-100 pt-6">
                    <h2 id="repair-owner" className="mb-4 text-lg font-semibold">Owner Details</h2>
                    <div className="grid gap-5 sm:grid-cols-2">
                      {picker("customerId", "Customer", customers, { required: true, placeholder: "Select a customer..." })}
                      {picker("locationId", "Service Location (Optional)", locations, { disabled: !form.customerId || locationsLoading, loading: locationsLoading, placeholder: "Select a location..." })}
                      {picker("bodyOfWaterId", "Body Of Water (Optional)", bodies, { disabled: !form.locationId || equipmentLoading, loading: equipmentLoading, placeholder: "Select a body of water..." })}
                      {picker("equipmentId", "Equipment (Optional)", equipment, { disabled: !form.locationId || equipmentLoading, loading: equipmentLoading, placeholder: "Select equipment..." })}
                      {form.equipmentId && (
                        <label htmlFor="repair-equipmentStatusUpdate" className="block text-sm font-medium text-slate-700">Equipment Status
                          <select id="repair-equipmentStatusUpdate" name="equipmentStatusUpdate" value={form.equipmentStatusUpdate} onChange={updateField} className={fieldClass}>
                            <option value="">Do not change status</option>
                            {EQUIPMENT_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                    {optionsError && <div role="alert" className="mt-4 text-sm text-red-700">{optionsError} <button type="button" onClick={() => setOptionsAttempt((value) => value + 1)} className="font-semibold underline">Retry selections</button></div>}
                  </section>
                  <section aria-labelledby="repair-details" className="border-t border-slate-100 pt-6">
                    <h2 id="repair-details" className="mb-4 text-lg font-semibold">Request Details</h2>
                    <div className="space-y-4">
                      <RepairRequestPriority
                        value={form.issuePriorityLevel}
                        onChange={(issuePriorityLevel) => {
                          setForm((current) => ({ ...current, issuePriorityLevel }));
                          setSubmissionId(uuidv4());
                          setError("");
                        }}
                        disabled={saving}
                      />
                      <label htmlFor="repair-description" className="block text-sm font-medium text-slate-700">
                        Description <span aria-hidden="true">*</span>
                        <textarea id="repair-description" name="description" required rows={5} maxLength={5000} value={form.description} onChange={updateField} placeholder="Describe the issue, when it started, and any error messages or unusual sounds." className={fieldClass} />
                      </label>
                    </div>
                  </section>
                  <section aria-labelledby="repair-photos" className="border-t border-slate-100 pt-6">
                    <h2 id="repair-photos" className="text-lg font-semibold">Photos <span className="text-sm font-normal text-slate-500">(optional)</span></h2>
                    <p id="repair-photo-help" className="mt-1 text-sm text-slate-500">Up to 3 JPG, PNG, or WebP photos. 2 MB per photo, 5 MB total.</p>
                    <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-semibold text-blue-700 focus-within:ring-2 focus-within:ring-blue-500">
                      <PhotoIcon className="h-8 w-8 text-slate-400" aria-hidden="true" />
                      Choose photos
                      <input aria-label="Attach photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={selectPhotos} aria-describedby="repair-photo-help" className="sr-only" />
                    </label>
                    {photoError && <p role="alert" className="mt-3 text-sm text-red-700">{photoError}</p>}
                    {previews.length > 0 && (
                      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {previews.map(({ file, url }, index) => (
                          <li key={`${file.name}-${index}`} className="min-w-0 overflow-hidden rounded-lg border border-slate-200">
                            <img src={url} alt={`Attachment ${index + 1}: ${file.name}`} className="h-28 w-full object-cover" />
                            <div className="p-3">
                              <p className="truncate text-xs text-slate-600">{file.name}</p>
                              <button type="button" aria-label={`Remove ${file.name}`} className="mt-2 text-sm font-semibold text-red-700" onClick={() => { setPhotos((current) => current.filter((_, i) => i !== index)); setSubmissionId(uuidv4()); setPhotoError(""); }}>Remove</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <div hidden aria-hidden="true">
                    <label htmlFor="repair-website">Website</label>
                    <input id="repair-website" name="website" value={form.website} onChange={updateField} autoComplete="off" tabIndex={-1} />
                  </div>
                  {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 outline-none">{error}</p>}
                  <div className="border-t border-slate-100 pt-6">
                    <p className="mb-4 text-sm text-slate-500">This repair request will be sent to {company.name} for the selected customer.</p>
                    <button type="submit" disabled={saving} className="w-full rounded-lg bg-blue-600 px-6 py-3.5 font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60">{saving ? "Submitting request..." : "Submit repair request"}</button>
                    <p className="mt-3 text-center text-xs text-slate-500">No login or account creation required.</p>
                  </div>
                </fieldset>
              </form>
            </>
          )}
      </main>
    </div>
  );
};

export default function PublicRepairRequest() {
  const { companyId } = useParams();
  return <RepairRequestForm key={companyId} companyId={companyId} />;
}
