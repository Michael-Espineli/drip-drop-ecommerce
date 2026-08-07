import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { ArrowLeftIcon, ArrowPathIcon, TagIcon } from "@heroicons/react/24/outline";
import toast from "react-hot-toast";

import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import { db } from "../../../utils/config";
import { appConfirm } from "../../../utils/appDialog";
import {
  filterCustomersByRegionalAccess,
  getCustomerRegionAccessTags,
  getCustomerTagOptions,
  normalizeCustomerTag,
  normalizeCustomerTags,
} from "../../../utils/customerTags";

const customerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) return customer.company || customer.companyName || "Unnamed Customer";
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.company || customer.email || "Unnamed Customer";
};

const addressZip = (source = {}) => String(
  source?.address?.zip ||
  source?.address?.zipCode ||
  source?.billingAddress?.zip ||
  source?.billingAddress?.zipCode ||
  source?.zip ||
  source?.zipCode ||
  ""
).trim();

const normalizeZip = (zip) => String(zip || "").trim().toLowerCase();

const parseListInput = (value) => String(value || "")
  .split(/[\s,;]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const routeLabel = (route = {}) => (
  route.name ||
  route.routeName ||
  [route.day, route.tech || route.techName].filter(Boolean).join(" - ") ||
  route.id ||
  "Unnamed route"
);

const chunkArray = (items, size = 450) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const CustomerTagManager = () => {
  const {
    recentlySelectedCompany,
    companyRole,
    companyUserAccess,
    selectedCustomerRegionTag,
  } = useContext(Context);
  const { requirePermission } = useCompanyPermissions();
  const [customers, setCustomers] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [recurringStops, setRecurringStops] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [zipInput, setZipInput] = useState("");
  const [routeId, setRouteId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const visibleCustomers = useMemo(
    () => filterCustomersByRegionalAccess(customers, {
      userAccess: companyUserAccess,
      role: companyRole,
      selectedRegionTag: selectedCustomerRegionTag,
    }),
    [customers, companyUserAccess, companyRole, selectedCustomerRegionTag]
  );
  const visibleCustomerIds = useMemo(
    () => new Set(visibleCustomers.map((customer) => customer.id)),
    [visibleCustomers]
  );
  const regionalTagAccess = useMemo(
    () => getCustomerRegionAccessTags({ userAccess: companyUserAccess, role: companyRole }),
    [companyUserAccess, companyRole]
  );
  const customerTagOptions = useMemo(() => getCustomerTagOptions(visibleCustomers), [visibleCustomers]);
  const activeTag = normalizeCustomerTag(tagInput) || normalizeCustomerTag(selectedTag);
  const recurringStopsById = useMemo(
    () => new Map(recurringStops.map((stop) => [stop.id, stop])),
    [recurringStops]
  );
  const selectedCustomerSet = useMemo(() => new Set(selectedCustomerIds), [selectedCustomerIds]);

  const filteredCustomers = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return visibleCustomers;

    return visibleCustomers.filter((customer) => [
      customerDisplayName(customer),
      customer.email,
      customer.phoneNumber,
      addressZip(customer),
      ...normalizeCustomerTags(customer.tags),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search)));
  }, [visibleCustomers, searchTerm]);

  const selectedRouteCustomerIds = useMemo(() => {
    const route = routes.find((item) => item.id === routeId);
    if (!route) return [];

    const ids = new Set();
    const orderedStops = Array.isArray(route.order) ? route.order : [];
    orderedStops.forEach((stop) => {
      const linkedStop = recurringStopsById.get(stop.recurringServiceStopId) || {};
      const customerId = stop.customerId || linkedStop.customerId || "";
      if (customerId && visibleCustomerIds.has(customerId)) ids.add(customerId);
    });

    return [...ids];
  }, [recurringStopsById, routeId, routes, visibleCustomerIds]);

  const zipMatchedCustomerIds = useMemo(() => {
    const zips = new Set(parseListInput(zipInput).map(normalizeZip));
    if (zips.size === 0) return [];

    const ids = new Set();
    visibleCustomers.forEach((customer) => {
      if (zips.has(normalizeZip(addressZip(customer)))) ids.add(customer.id);
    });
    serviceLocations.forEach((location) => {
      if (zips.has(normalizeZip(addressZip(location))) && location.customerId && visibleCustomerIds.has(location.customerId)) {
        ids.add(location.customerId);
      }
    });

    return [...ids];
  }, [serviceLocations, visibleCustomerIds, visibleCustomers, zipInput]);

  const loadTagData = useCallback(async () => {
    if (!recentlySelectedCompany) {
      setCustomers([]);
      setServiceLocations([]);
      setRecurringStops([]);
      setRoutes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [customerSnap, locationSnap, recurringStopSnap, routeSnap] = await Promise.all([
        getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "serviceLocations")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")),
        getDocs(collection(db, "companies", recentlySelectedCompany, "recurringRoutes")),
      ]);

      setCustomers(customerSnap.docs.map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() })));
      setServiceLocations(locationSnap.docs.map((locationDoc) => ({ id: locationDoc.id, ...locationDoc.data() })));
      setRecurringStops(recurringStopSnap.docs.map((stopDoc) => ({ id: stopDoc.id, ...stopDoc.data() })));
      setRoutes(routeSnap.docs.map((routeDoc) => ({ id: routeDoc.id, ...routeDoc.data() })));
    } catch (error) {
      console.error("Error loading customer tag helper data:", error);
      toast.error("Could not load customer tag data.");
    } finally {
      setIsLoading(false);
    }
  }, [recentlySelectedCompany]);

  useEffect(() => {
    loadTagData();
  }, [loadTagData]);

  useEffect(() => {
    setSelectedCustomerIds((currentIds) => currentIds.filter((customerId) => visibleCustomerIds.has(customerId)));
  }, [visibleCustomerIds]);

  const updateCustomerTags = async (customerIds, updater, successMessage) => {
    if (!requirePermission("14", "update customer tags")) return;
    const uniqueCustomerIds = [...new Set(customerIds)].filter(Boolean);
    if (uniqueCustomerIds.length === 0) {
      toast.error("No matching customers found.");
      return;
    }

    const nextCustomersById = new Map();
    uniqueCustomerIds.forEach((customerId) => {
      const customer = customers.find((item) => item.id === customerId);
      if (!customer) return;
      nextCustomersById.set(customerId, {
        ...customer,
        tags: updater(normalizeCustomerTags(customer.tags)),
      });
    });

    if (nextCustomersById.size === 0) {
      toast.error("No matching customers found.");
      return;
    }

    setIsSaving(true);
    try {
      for (const chunk of chunkArray([...nextCustomersById.values()])) {
        const batch = writeBatch(db);
        chunk.forEach((customer) => {
          batch.set(
            doc(db, "companies", recentlySelectedCompany, "customers", customer.id),
            { tags: normalizeCustomerTags(customer.tags) },
            { merge: true }
          );
        });
        await batch.commit();
      }

      setCustomers((currentCustomers) => currentCustomers.map((customer) => (
        nextCustomersById.get(customer.id) || customer
      )));
      toast.success(successMessage(nextCustomersById.size));
    } catch (error) {
      console.error("Error updating customer tags:", error);
      toast.error("Failed to update customer tags.");
    } finally {
      setIsSaving(false);
    }
  };

  const addTagToCustomers = (customerIds) => {
    if (!activeTag) {
      toast.error("Choose or enter a tag first.");
      return;
    }

    updateCustomerTags(
      customerIds,
      (tags) => normalizeCustomerTags([...tags, activeTag]),
      (count) => `Added ${activeTag} to ${count} customer${count === 1 ? "" : "s"}.`
    );
  };

  const removeTagFromCustomers = (customerIds) => {
    if (!activeTag) {
      toast.error("Choose or enter a tag first.");
      return;
    }

    updateCustomerTags(
      customerIds,
      (tags) => tags.filter((tag) => tag.toLowerCase() !== activeTag.toLowerCase()),
      (count) => `Removed ${activeTag} from ${count} customer${count === 1 ? "" : "s"}.`
    );
  };

  const deleteTagFromAllCustomers = async () => {
    if (!activeTag) {
      toast.error("Choose or enter a tag first.");
      return;
    }

    const confirmed = await appConfirm({
      title: "Delete Customer Tag",
      message: `Remove ${activeTag} from every customer in this company?`,
      confirmLabel: "Delete Tag",
      variant: "danger",
    });
    if (!confirmed) return;

    const matchingCustomerIds = visibleCustomers
      .filter((customer) => normalizeCustomerTags(customer.tags).some((tag) => tag.toLowerCase() === activeTag.toLowerCase()))
      .map((customer) => customer.id);
    await updateCustomerTags(
      matchingCustomerIds,
      (tags) => tags.filter((tag) => tag.toLowerCase() !== activeTag.toLowerCase()),
      (count) => `Removed ${activeTag} from ${count} customer${count === 1 ? "" : "s"}.`
    );
  };

  const toggleCustomerSelection = (customerId) => {
    setSelectedCustomerIds((currentIds) => (
      currentIds.includes(customerId)
        ? currentIds.filter((id) => id !== customerId)
        : [...currentIds, customerId]
    ));
  };

  const selectVisibleCustomers = () => {
    setSelectedCustomerIds((currentIds) => [...new Set([...currentIds, ...filteredCustomers.map((customer) => customer.id)])]);
  };

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-950 sm:px-4 lg:px-6">
      <div className="w-full space-y-5">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              to="/company/customers"
              className="mb-3 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Customers
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Customer Tag Helper</h1>
            <p className="mt-1 text-sm text-slate-500">Manage regional customer tags for filtering and user access.</p>
            {(regionalTagAccess.length > 0 || selectedCustomerRegionTag) && (
              <p className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
                Editing visible customers only
                {regionalTagAccess.length > 0 ? `: ${regionalTagAccess.join(", ")}` : ""}
                {selectedCustomerRegionTag ? ` Current area: ${selectedCustomerRegionTag}.` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={loadTagData}
            disabled={isLoading || isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
            <div>
              <label className="block text-sm font-semibold text-slate-700" htmlFor="customer-tag-manager-tag">
                Tag
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <select
                  value={selectedTag}
                  onChange={(event) => {
                    setSelectedTag(event.target.value);
                    setTagInput("");
                  }}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select existing tag</option>
                  {customerTagOptions.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
                <input
                  id="customer-tag-manager-tag"
                  value={tagInput}
                  onChange={(event) => {
                    setTagInput(event.target.value);
                    setSelectedTag("");
                  }}
                  placeholder="Or type a new tag"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <p className="mt-2 text-xs font-medium text-slate-500">Active tag: {activeTag || "None selected"}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <button
                type="button"
                onClick={() => addTagToCustomers(selectedCustomerIds)}
                disabled={isSaving || selectedCustomerIds.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add to Selected
              </button>
              <button
                type="button"
                onClick={() => removeTagFromCustomers(selectedCustomerIds)}
                disabled={isSaving || selectedCustomerIds.length === 0}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove from Selected
              </button>
              <button
                type="button"
                onClick={deleteTagFromAllCustomers}
                disabled={isSaving || !activeTag}
                className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete Tag From All
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Tag By ZIP Codes</h2>
                <p className="mt-1 text-sm text-slate-500">Matches billing ZIPs and service-location ZIPs.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {zipMatchedCustomerIds.length} match{zipMatchedCustomerIds.length === 1 ? "" : "es"}
              </span>
            </div>
            <textarea
              value={zipInput}
              onChange={(event) => setZipInput(event.target.value)}
              rows={4}
              placeholder="85251, 85255, 85258"
              className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addTagToCustomers(zipMatchedCustomerIds)}
                disabled={isSaving || zipMatchedCustomerIds.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Tag to ZIP Matches
              </button>
              <button
                type="button"
                onClick={() => setSelectedCustomerIds(zipMatchedCustomerIds)}
                disabled={zipMatchedCustomerIds.length === 0}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Select Matches
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Tag By Route</h2>
                <p className="mt-1 text-sm text-slate-500">Uses customer IDs from recurring route order stops.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {selectedRouteCustomerIds.length} customer{selectedRouteCustomerIds.length === 1 ? "" : "s"}
              </span>
            </div>
            <select
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
              className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Choose recurring route</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>{routeLabel(route)}</option>
              ))}
            </select>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => addTagToCustomers(selectedRouteCustomerIds)}
                disabled={isSaving || selectedRouteCustomerIds.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Tag to Route
              </button>
              <button
                type="button"
                onClick={() => setSelectedCustomerIds(selectedRouteCustomerIds)}
                disabled={selectedRouteCustomerIds.length === 0}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Select Route Customers
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Customers</h2>
              <p className="mt-1 text-sm text-slate-500">
                {selectedCustomerIds.length} selected out of {visibleCustomers.length} visible customers.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search customers or tags"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={selectVisibleCustomers}
                disabled={filteredCustomers.length === 0}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Select Visible
              </button>
              <button
                type="button"
                onClick={() => setSelectedCustomerIds([])}
                disabled={selectedCustomerIds.length === 0}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Clear
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading customer tags...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Select</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">ZIP</th>
                    <th className="px-4 py-3 text-left">Tags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredCustomers.map((customer) => {
                    const checked = selectedCustomerSet.has(customer.id);
                    const tags = normalizeCustomerTags(customer.tags);
                    return (
                      <tr key={customer.id} className="align-top">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCustomerSelection(customer.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-950">{customerDisplayName(customer)}</p>
                          <p className="mt-1 text-xs text-slate-500">{customer.email || customer.phoneNumber || customer.id}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{addressZip(customer) || "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-lg flex-wrap gap-1.5">
                            {tags.length > 0 ? tags.map((tag) => (
                              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                <TagIcon className="h-3 w-3" />
                                {tag}
                              </span>
                            )) : (
                              <span className="text-slate-400">No tags</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-8 text-center text-slate-500">
                        No customers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {isSaving && (
          <div className="fixed bottom-4 right-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
            Saving customer tags...
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerTagManager;
