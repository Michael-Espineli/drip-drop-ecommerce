import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import {
  FaArrowLeft,
  FaChevronDown,
  FaExternalLinkAlt,
  FaFileSignature,
  FaPlus,
  FaRoute,
  FaSearch,
  FaUserSlash,
  FaUsers,
} from "react-icons/fa";
import toast from "react-hot-toast";

import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID } from "../../../utils/models/FeatureFlag";
import { SalesAgreementStatus, salesCollectionNames } from "../../../utils/models/Sales";
import { filterCustomersByRegionalAccess } from "../../../utils/customerTags";
import { appConfirm } from "../../../utils/appDialog";
import { endCustomerPipelineRowsForInactiveCustomer } from "../../../utils/customerPipeline";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";

const agreementTerminalStatuses = new Set([
  SalesAgreementStatus.canceled,
  "cancelled",
  SalesAgreementStatus.rejected,
  SalesAgreementStatus.expired,
  SalesAgreementStatus.superseded,
]);

const pageConfig = {
  serviceAgreements: {
    title: "Active Customers Without Service Agreements",
    backTo: "/company/sales/agreements",
    backLabel: "Service Agreements",
    coverageLabel: "Service Agreements",
    coveredLabel: "With Agreements",
    missingLabel: "Missing Agreements",
    actionLabel: "New Agreement",
    icon: FaFileSignature,
    actionTo: (customerId) => `/company/sales/agreements/new?customerId=${encodeURIComponent(customerId)}`,
  },
  recurringServiceStops: {
    title: "Active Customers Without Recurring Service Stops",
    backTo: "/company/recurringServiceStop",
    backLabel: "Recurring Stops",
    coverageLabel: "Recurring Stops",
    coveredLabel: "With Recurring Stops",
    missingLabel: "Missing Stops",
    actionLabel: "New Recurring Stop",
    icon: FaRoute,
    actionTo: (customerId) => `/company/recurring-service-stops/create/${encodeURIComponent(customerId)}`,
  },
};

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const customerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return customer.company || customer.companyName || "Unnamed Customer";
  }

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    || customer.company
    || customer.companyName
    || customer.email
    || "Unnamed Customer";
};

const customerContact = (customer = {}) => (
  customer.email
  || customer.billingEmail
  || customer.phoneNumber
  || customer.phone
  || customer.mobilePhone
  || ""
);

const formatAddress = (source = {}) => [
  source.streetAddress,
  source.addressLine1,
  source.city,
  source.state,
  source.zip || source.zipCode,
].filter(Boolean).join(", ");

const customerAddress = (customer = {}) => (
  formatAddress(customer.billingAddress)
  || formatAddress(customer.address)
  || formatAddress(customer.serviceAddress)
  || customer.streetAddress
  || ""
);

const isActiveCustomer = (customer = {}) => customer.active === true;

const isLiveAgreement = (agreement = {}) => {
  if (!agreement.customerId) return false;
  return !agreementTerminalStatuses.has(normalizeStatus(agreement.status));
};

const isLiveRecurringStop = (stop = {}) => {
  if (!stop.customerId) return false;
  if ((stop.active ?? stop.isActive ?? true) === false) return false;

  const endMillis = toMillis(stop.endDate);
  return stop.noEndDate || !endMillis || endMillis >= Date.now();
};

const searchableCustomerText = (customer = {}) => [
  customerDisplayName(customer),
  customer.email,
  customer.billingEmail,
  customer.phoneNumber,
  customer.phone,
  customerAddress(customer),
  customer.id,
].filter(Boolean).join(" ").toLowerCase();

const uniqueDocsByPath = (docs) => Array.from(
  new Map(docs.map((documentSnapshot) => [documentSnapshot.ref.path, documentSnapshot])).values()
);

const deactivateCustomerRelations = async ({ companyId, customerId }) => {
  if (!companyId || !customerId) {
    return { serviceLocations: 0, bodiesOfWater: 0, equipment: 0 };
  }

  const serviceLocationsSnapshot = await getDocs(query(
    collection(db, "companies", companyId, "serviceLocations"),
    where("customerId", "==", customerId)
  ));
  const serviceLocationDocs = serviceLocationsSnapshot.docs;
  const serviceLocationIds = serviceLocationDocs.map((locationDoc) => locationDoc.id);

  const [bodiesByCustomerSnapshot, equipmentByCustomerSnapshot] = await Promise.all([
    getDocs(query(
      collection(db, "companies", companyId, "bodiesOfWater"),
      where("customerId", "==", customerId)
    )),
    getDocs(query(
      collection(db, "companies", companyId, "equipment"),
      where("customerId", "==", customerId)
    )),
  ]);

  const [bodiesByLocationSnapshots, equipmentByLocationSnapshots] = await Promise.all([
    Promise.all(serviceLocationIds.map((locationId) => getDocs(query(
      collection(db, "companies", companyId, "bodiesOfWater"),
      where("serviceLocationId", "==", locationId)
    )))),
    Promise.all(serviceLocationIds.map((locationId) => getDocs(query(
      collection(db, "companies", companyId, "equipment"),
      where("serviceLocationId", "==", locationId)
    )))),
  ]);

  const bodyOfWaterDocs = uniqueDocsByPath([
    ...bodiesByCustomerSnapshot.docs,
    ...bodiesByLocationSnapshots.flatMap((snapshot) => snapshot.docs),
  ]);
  const bodyOfWaterIds = bodyOfWaterDocs.map((bodyDoc) => bodyDoc.id);
  const equipmentByBodyOfWaterSnapshots = await Promise.all(bodyOfWaterIds.map((bodyOfWaterId) => getDocs(query(
    collection(db, "companies", companyId, "equipment"),
    where("bodyOfWaterId", "==", bodyOfWaterId)
  ))));
  const equipmentDocs = uniqueDocsByPath([
    ...equipmentByCustomerSnapshot.docs,
    ...equipmentByLocationSnapshots.flatMap((snapshot) => snapshot.docs),
    ...equipmentByBodyOfWaterSnapshots.flatMap((snapshot) => snapshot.docs),
  ]);

  await Promise.all([
    ...serviceLocationDocs.map((locationDoc) => updateDoc(locationDoc.ref, { isActive: false, active: false })),
    ...bodyOfWaterDocs.map((bodyDoc) => updateDoc(bodyDoc.ref, { isActive: false, active: false })),
    ...equipmentDocs.map((equipmentDoc) => updateDoc(equipmentDoc.ref, { isActive: false, active: false })),
  ]);

  return {
    serviceLocations: serviceLocationDocs.length,
    bodiesOfWater: bodyOfWaterDocs.length,
    equipment: equipmentDocs.length,
  };
};

const ActiveCustomersWithoutCoverage = ({ mode = "serviceAgreements" }) => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    user,
    dataBaseUser,
    companyRole,
    companyUserAccess,
    selectedCustomerRegionTag,
    featureFlagsLoaded,
    isFeatureEnabled,
  } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const config = pageConfig[mode] || pageConfig.serviceAgreements;
  const CoverageIcon = config.icon;
  const customerAreaFilteringEnabled = featureFlagsLoaded && isFeatureEnabled(CUSTOMER_AREA_FILTERING_FEATURE_FLAG_ID);

  const [customers, setCustomers] = useState([]);
  const [coveredCustomerIds, setCoveredCustomerIds] = useState(new Set());
  const [coverageRecordCount, setCoverageRecordCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deactivatingCustomerId, setDeactivatingCustomerId] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadCoverage = async () => {
      if (!recentlySelectedCompany) {
        setCustomers([]);
        setCoveredCustomerIds(new Set());
        setCoverageRecordCount(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const customerRef = collection(db, "companies", recentlySelectedCompany, "customers");
        const coverageRef = mode === "recurringServiceStops"
          ? collection(db, "companies", recentlySelectedCompany, "recurringServiceStop")
          : query(
            collection(db, salesCollectionNames.agreements),
            where("companyId", "==", recentlySelectedCompany)
          );

        const [customerSnapshot, coverageSnapshot] = await Promise.all([
          getDocs(customerRef),
          getDocs(coverageRef),
        ]);

        if (cancelled) return;

        const customerRows = customerSnapshot.docs
          .map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() }))
          .filter(isActiveCustomer)
          .sort((left, right) => customerDisplayName(left).localeCompare(customerDisplayName(right)));

        const liveCoverageRows = coverageSnapshot.docs
          .map((coverageDoc) => ({ id: coverageDoc.id, ...coverageDoc.data() }))
          .filter(mode === "recurringServiceStops" ? isLiveRecurringStop : isLiveAgreement);

        setCustomers(customerRows);
        setCoveredCustomerIds(new Set(liveCoverageRows.map((record) => record.customerId).filter(Boolean)));
        setCoverageRecordCount(liveCoverageRows.length);
      } catch (loadError) {
        console.error("Unable to load active customer coverage", loadError);
        if (!cancelled) {
          setError(`Unable to load ${config.title.toLowerCase()}.`);
          setCustomers([]);
          setCoveredCustomerIds(new Set());
          setCoverageRecordCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadCoverage();

    return () => {
      cancelled = true;
    };
  }, [config.title, mode, recentlySelectedCompany]);

  const visibleCustomers = useMemo(
    () => filterCustomersByRegionalAccess(customers, {
      userAccess: companyUserAccess,
      role: companyRole,
      selectedRegionTag: selectedCustomerRegionTag,
      regionalAccessEnabled: customerAreaFilteringEnabled,
    }),
    [companyRole, companyUserAccess, customerAreaFilteringEnabled, customers, selectedCustomerRegionTag]
  );

  const missingCustomers = useMemo(
    () => visibleCustomers.filter((customer) => !coveredCustomerIds.has(customer.id)),
    [coveredCustomerIds, visibleCustomers]
  );

  const filteredMissingCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return missingCustomers;

    return missingCustomers.filter((customer) => searchableCustomerText(customer).includes(term));
  }, [missingCustomers, searchTerm]);

  const coveredVisibleCount = visibleCustomers.length - missingCustomers.length;
  const useCustomerActionsMenu = mode === "recurringServiceStops";

  const handleMakeInactive = async (customer) => {
    if (!requirePermission("14", "update customers")) return;
    if (!recentlySelectedCompany || !customer?.id) return;

    const confirmed = await appConfirm({
      title: "Make Customer Inactive",
      message: `Are you sure you want to mark ${customerDisplayName(customer)} as inactive? This will not delete their data. Linked service locations, bodies of water, and equipment will also be marked inactive.`,
      confirmLabel: "Make Inactive",
      cancelLabel: "Cancel",
      tone: "warning",
    });

    if (!confirmed) return;

    setDeactivatingCustomerId(customer.id);

    try {
      const customerRef = doc(db, "companies", recentlySelectedCompany, "customers", customer.id);
      await updateDoc(customerRef, { active: false, isActive: false });

      const inactiveCascadeCounts = await deactivateCustomerRelations({
        companyId: recentlySelectedCompany,
        customerId: customer.id,
      });
      const pipelineRowsEnded = await endCustomerPipelineRowsForInactiveCustomer({
        companyId: recentlySelectedCompany,
        customerId: customer.id,
        reason: "Customer marked inactive",
        actorId: user?.uid || "",
        actorName: `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() || user?.displayName || user?.email || "",
      });

      setCustomers((currentCustomers) => currentCustomers.filter((row) => row.id !== customer.id));
      toast.success(`Customer marked inactive. ${inactiveCascadeCounts.serviceLocations} service locations, ${inactiveCascadeCounts.bodiesOfWater} bodies of water, ${inactiveCascadeCounts.equipment} equipment records, and ${pipelineRowsEnded} pipeline row(s) were ended.`);
    } catch (statusError) {
      console.error("Failed to update customer status.", statusError);
      toast.error("Failed to update customer status.");
    } finally {
      setDeactivatingCustomerId("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {recentlySelectedCompanyName || "Selected Company"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                  <CoverageIcon />
                </span>
                <h1 className="text-3xl font-bold text-slate-950">{config.title}</h1>
              </div>
            </div>

            <Link
              to={config.backTo}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <FaArrowLeft className="text-xs" />
              {config.backLabel}
            </Link>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard icon={FaUsers} label="Active Customers" value={visibleCustomers.length} />
          <SummaryCard icon={CoverageIcon} label={config.coveredLabel} value={coveredVisibleCount} />
          <SummaryCard icon={FaPlus} label={config.missingLabel} value={missingCustomers.length} tone="blue" />
          <SummaryCard icon={CoverageIcon} label={config.coverageLabel} value={coverageRecordCount} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="relative max-w-xl">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search customer, email, phone, address..."
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-8 text-sm text-slate-500">Loading customers...</div>
            ) : filteredMissingCustomers.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-800">No active customers found</p>
                <p className="mt-1 text-sm text-slate-500">Every visible active customer currently has coverage in this view.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Address</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredMissingCustomers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4 align-top">
                        <Link
                          to={`/company/customers/details/${customer.id}`}
                          className="font-semibold text-slate-900 hover:text-blue-700"
                        >
                          {customerDisplayName(customer)}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">{customer.internalId || customer.id}</p>
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-600">
                        {customerContact(customer) || "No contact on file"}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-600">
                        {customerAddress(customer) || "No address on file"}
                      </td>
                      <td className="px-5 py-4 align-top">
                        {useCustomerActionsMenu ? (
                          <CustomerActionsMenu
                            customer={customer}
                            actionLabel={config.actionLabel}
                            actionTo={config.actionTo(customer.id)}
                            canMakeInactive={can("14")}
                            deactivating={deactivatingCustomerId === customer.id}
                            onMakeInactive={() => handleMakeInactive(customer)}
                          />
                        ) : (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link
                              to={`/company/customers/details/${customer.id}`}
                              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <FaExternalLinkAlt className="text-[10px]" />
                              Customer
                            </Link>
                            <Link
                              to={config.actionTo(customer.id)}
                              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                            >
                              <FaPlus className="text-[10px]" />
                              {config.actionLabel}
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const menuItemClassName = "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition";

const CustomerActionsMenu = ({
  customer,
  actionLabel,
  actionTo,
  canMakeInactive,
  deactivating,
  onMakeInactive,
}) => (
  <div className="flex justify-end">
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={deactivating}
        title={`Actions for ${customerDisplayName(customer)}`}
      >
        Actions
        <FaChevronDown className="text-[10px]" aria-hidden="true" />
      </MenuButton>
      <MenuItems className="absolute right-0 z-30 mt-2 w-56 origin-top-right overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg focus:outline-none">
        <MenuItem>
          <Link
            to={`/company/customers/details/${customer.id}`}
            className={`${menuItemClassName} text-slate-700 hover:bg-slate-50 data-[focus]:bg-slate-50`}
          >
            <FaExternalLinkAlt className="text-[10px]" aria-hidden="true" />
            Customer
          </Link>
        </MenuItem>
        <MenuItem>
          <Link
            to={actionTo}
            className={`${menuItemClassName} text-blue-700 hover:bg-blue-50 data-[focus]:bg-blue-50`}
          >
            <FaPlus className="text-[10px]" aria-hidden="true" />
            {actionLabel}
          </Link>
        </MenuItem>
        {canMakeInactive && (
          <MenuItem disabled={deactivating}>
            <button
              type="button"
              onClick={onMakeInactive}
              disabled={deactivating}
              className={`${menuItemClassName} text-amber-700 hover:bg-amber-50 data-[focus]:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FaUserSlash className="text-[10px]" aria-hidden="true" />
              {deactivating ? "Making inactive..." : "Make Inactive"}
            </button>
          </MenuItem>
        )}
      </MenuItems>
    </Menu>
  </div>
);

const SummaryCard = ({ icon: Icon, label, value, tone = "slate" }) => {
  const iconClassName = tone === "blue" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconClassName}`}>
          <Icon className="text-sm" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</p>
    </div>
  );
};

export default ActiveCustomersWithoutCoverage;
