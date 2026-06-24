import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import toast from "react-hot-toast";
import {
  FaCheck,
  FaCheckCircle,
  FaClipboardCheck,
  FaFileInvoiceDollar,
  FaPlus,
  FaRegCircle,
  FaRoute,
  FaSearch,
  FaSyncAlt,
  FaUserPlus,
  FaUsers,
} from "react-icons/fa";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const defaultStages = [
  {
    id: "siteCustomerInfo",
    title: "Site and Customer Info",
    shortTitle: "Info",
    description: "Customer, service location, pool, contact, access, and site notes are in Drip Drop.",
    icon: FaUsers,
    tone: "blue",
  },
  {
    id: "routing",
    title: "Routing",
    shortTitle: "Routing",
    description: "Recurring stop, route day, route order, technician assignment, and service cadence are ready.",
    icon: FaRoute,
    tone: "emerald",
  },
  {
    id: "billing",
    title: "Billing",
    shortTitle: "Billing",
    description: "Agreement, billing profile, subscription or invoice plan, and payment expectation are ready.",
    icon: FaFileInvoiceDollar,
    tone: "amber",
  },
];

const toneClasses = {
  blue: "bg-blue-600",
  emerald: "bg-emerald-600",
  amber: "bg-amber-500",
  slate: "bg-slate-900",
};

const configDocRef = (companyId) => doc(db, "companies", companyId, "settings", "customerMigrationTracker");
const trackerRowsRef = (companyId) => collection(db, "companies", companyId, "customerMigrationTracker");

const getString = (...values) => values.find((value) => typeof value === "string" && value.trim()) || "";

const getActorId = (dataBaseUser, authUser) => (
  dataBaseUser?.id ||
  dataBaseUser?.userId ||
  dataBaseUser?.uid ||
  authUser?.uid ||
  ""
);

const getActorName = (dataBaseUser, authUser) => (
  getString(
    dataBaseUser?.userName,
    dataBaseUser?.displayName,
    [dataBaseUser?.firstName, dataBaseUser?.lastName].filter(Boolean).join(" "),
    authUser?.displayName,
    authUser?.email
  ) || "Company user"
);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value) => {
  const date = dateFromValue(value);
  if (!date) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getCustomerDisplayName = (customer = {}) => {
  if (customer.displayAsCompany) {
    return getString(customer.company, customer.companyName, customer.name);
  }

  return getString(
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    customer.customerName,
    customer.name,
    customer.company,
    customer.companyName,
    customer.email,
    "Unnamed customer"
  );
};

const getCustomerContact = (customer = {}) => (
  getString(
    customer.email,
    customer.billingEmail,
    customer.phoneNumber,
    customer.phone,
    customer.mainContact?.email,
    customer.mainContact?.phoneNumber
  )
);

const normalizeChecklist = (checklist = {}) => (
  Object.fromEntries(
    Object.entries(checklist || {}).map(([key, value]) => [
      key,
      {
        complete: !!value?.complete,
        completedAt: value?.completedAt || null,
        completedByUserId: value?.completedByUserId || "",
        completedByName: value?.completedByName || "",
      },
    ])
  )
);

const normalizeRow = (rowDoc) => {
  const data = rowDoc.data() || {};
  return {
    id: rowDoc.id,
    customerId: data.customerId || "",
    source: data.source || "manual",
    customerName: getString(data.customerName, data.name, "Unnamed customer"),
    contact: data.contact || "",
    notes: data.notes || "",
    checklist: normalizeChecklist(data.checklist),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
};

const normalizeCustomPart = (part = {}) => ({
  id: part.id || `custom_${Date.now()}`,
  title: getString(part.title, part.name, "Custom item"),
  description: part.description || "",
  archived: !!part.archived,
});

const emptySignoff = {
  complete: false,
  completedAt: null,
  completedByUserId: "",
  completedByName: "",
};

const ProgressCard = ({ stage, percent, complete, total }) => {
  const Icon = stage.icon || FaClipboardCheck;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-white ${toneClasses[stage.tone] || toneClasses.slate}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-2xl font-bold text-slate-950">{percent}%</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-950">{stage.title}</p>
      <p className="mt-1 text-xs text-slate-500">{complete}/{total} complete</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${toneClasses[stage.tone] || toneClasses.slate}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

const SignoffButton = ({ row, stage, onToggle, saving }) => {
  const signoff = row.checklist?.[stage.id] || emptySignoff;
  const complete = !!signoff.complete;

  return (
    <button
      type="button"
      onClick={() => onToggle(row, stage)}
      disabled={saving}
      className={`min-h-[76px] w-full rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold">
        {complete ? <FaCheckCircle className="h-4 w-4 text-emerald-600" /> : <FaRegCircle className="h-4 w-4 text-slate-300" />}
        {complete ? "Signed off" : "Needs signoff"}
      </span>
      {complete ? (
        <span className="mt-2 block text-xs leading-5 text-emerald-800">
          {formatDate(signoff.completedAt) || "Today"}
          <br />
          {signoff.completedByName || "Company user"}
        </span>
      ) : (
        <span className="mt-2 block text-xs leading-5 text-slate-400">Click to sign off</span>
      )}
    </button>
  );
};

function CustomerMigrationTracker() {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    user: authUser,
    dataBaseUser,
  } = useContext(Context);
  const [customers, setCustomers] = useState([]);
  const [rows, setRows] = useState([]);
  const [customParts, setCustomParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [manualName, setManualName] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");

  const allStages = useMemo(() => [
    ...defaultStages,
    ...customParts
      .filter((part) => !part.archived)
      .map((part) => ({
        id: part.id,
        title: part.title,
        shortTitle: part.title,
        description: part.description,
        icon: FaClipboardCheck,
        tone: "slate",
        custom: true,
      })),
  ], [customParts]);

  const rowsByCustomerId = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (row.customerId) map.set(row.customerId, row);
    });
    return map;
  }, [rows]);

  const missingCustomerCount = customers.filter((customer) => !rowsByCustomerId.has(customer.id)).length;

  const visibleRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (!search) return true;
        return [row.customerName, row.contact, row.notes, row.customerId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .filter((row) => {
        if (statusFilter === "all") return true;
        const completedCount = allStages.filter((stage) => row.checklist?.[stage.id]?.complete).length;
        if (statusFilter === "complete") return completedCount === allStages.length && allStages.length > 0;
        if (statusFilter === "notStarted") return completedCount === 0;
        return completedCount > 0 && completedCount < allStages.length;
      })
      .sort((left, right) => left.customerName.localeCompare(right.customerName));
  }, [allStages, rows, searchTerm, statusFilter]);

  const stageStats = useMemo(() => {
    const total = rows.length;

    return allStages.map((stage) => {
      const complete = rows.filter((row) => row.checklist?.[stage.id]?.complete).length;
      return {
        ...stage,
        complete,
        total,
        percent: total ? Math.round((complete / total) * 100) : 0,
      };
    });
  }, [allStages, rows]);

  const totalStats = useMemo(() => {
    const total = rows.length * allStages.length;
    const complete = rows.reduce((sum, row) => (
      sum + allStages.filter((stage) => row.checklist?.[stage.id]?.complete).length
    ), 0);

    return {
      title: "Total Complete",
      icon: FaCheck,
      tone: "slate",
      complete,
      total,
      percent: total ? Math.round((complete / total) * 100) : 0,
    };
  }, [allStages, rows]);

  useEffect(() => {
    let cancelled = false;

    const loadTracker = async () => {
      if (!recentlySelectedCompany) {
        setCustomers([]);
        setRows([]);
        setCustomParts([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const [customerSnap, trackerSnap, configSnap] = await Promise.all([
          getDocs(collection(db, "companies", recentlySelectedCompany, "customers")),
          getDocs(trackerRowsRef(recentlySelectedCompany)),
          getDoc(configDocRef(recentlySelectedCompany)),
        ]);

        if (cancelled) return;

        const nextCustomers = customerSnap.docs
          .map((customerDoc) => ({ id: customerDoc.id, ...customerDoc.data() }))
          .sort((left, right) => getCustomerDisplayName(left).localeCompare(getCustomerDisplayName(right)));
        const nextRows = trackerSnap.docs.map(normalizeRow);
        const config = configSnap.exists() ? configSnap.data() : {};

        setCustomers(nextCustomers);
        setRows(nextRows);
        setCustomParts(Array.isArray(config.customParts) ? config.customParts.map(normalizeCustomPart) : []);
      } catch (error) {
        console.error("Unable to load customer migration tracker:", error);
        if (!cancelled) toast.error("Could not load the customer migration tracker.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadTracker();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  const handleSyncCustomers = async () => {
    if (!recentlySelectedCompany) return;

    const missingCustomers = customers.filter((customer) => !rowsByCustomerId.has(customer.id));
    if (!missingCustomers.length) {
      toast.success("All current customers are already on the tracker.");
      return;
    }

    setSavingKey("sync-customers");

    try {
      const createdRows = [];
      let batch = writeBatch(db);
      let batchCount = 0;
      let committedCount = 0;

      for (const customer of missingCustomers) {
        const rowId = `customer_${customer.id}`;
        const row = {
          id: rowId,
          companyId: recentlySelectedCompany,
          customerId: customer.id,
          source: "customer",
          customerName: getCustomerDisplayName(customer),
          contact: getCustomerContact(customer),
          notes: "",
          checklist: {},
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        batch.set(doc(trackerRowsRef(recentlySelectedCompany), rowId), row, { merge: true });
        createdRows.push({ ...row, createdAt: new Date(), updatedAt: new Date() });
        batchCount += 1;

        if (batchCount === 450) {
          await batch.commit();
          committedCount += batchCount;
          batch = writeBatch(db);
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
        committedCount += batchCount;
      }

      setRows((currentRows) => [...currentRows, ...createdRows]);
      toast.success(`Added ${committedCount} customer(s) to the tracker.`);
    } catch (error) {
      console.error("Unable to sync tracker customers:", error);
      toast.error("Could not sync customers to the tracker.");
    } finally {
      setSavingKey("");
    }
  };

  const handleAddManualCustomer = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;

    const name = manualName.trim();
    if (!name) {
      toast.error("Add a customer name first.");
      return;
    }

    setSavingKey("manual-customer");

    try {
      const rowId = `manual_${Date.now()}`;
      const row = {
        id: rowId,
        companyId: recentlySelectedCompany,
        customerId: "",
        source: "manual",
        customerName: name,
        contact: "",
        notes: manualNote.trim(),
        checklist: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(trackerRowsRef(recentlySelectedCompany), rowId), row, { merge: true });
      setRows((currentRows) => [...currentRows, { ...row, createdAt: new Date(), updatedAt: new Date() }]);
      setManualName("");
      setManualNote("");
      toast.success("Customer added to the migration tracker.");
    } catch (error) {
      console.error("Unable to add manual migration customer:", error);
      toast.error("Could not add this customer.");
    } finally {
      setSavingKey("");
    }
  };

  const handleAddCustomPart = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany) return;

    const title = customTitle.trim();
    if (!title) {
      toast.error("Add a custom checklist title first.");
      return;
    }

    const part = {
      id: `custom_${Date.now()}`,
      title,
      description: customDescription.trim(),
      archived: false,
    };
    const nextParts = [...customParts, part];

    setSavingKey("custom-part");

    try {
      await setDoc(configDocRef(recentlySelectedCompany), {
        companyId: recentlySelectedCompany,
        customParts: nextParts,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setCustomParts(nextParts);
      setCustomTitle("");
      setCustomDescription("");
      toast.success("Custom tracking item added.");
    } catch (error) {
      console.error("Unable to add custom migration part:", error);
      toast.error("Could not add the custom item.");
    } finally {
      setSavingKey("");
    }
  };

  const handleToggleStage = async (row, stage) => {
    if (!recentlySelectedCompany) return;

    const key = `${row.id}:${stage.id}`;
    const currentSignoff = row.checklist?.[stage.id] || emptySignoff;
    const isComplete = !!currentSignoff.complete;
    const actorId = getActorId(dataBaseUser, authUser);
    const actorName = getActorName(dataBaseUser, authUser);
    const nextSignoff = isComplete
      ? emptySignoff
      : {
          complete: true,
          completedAt: serverTimestamp(),
          completedByUserId: actorId,
          completedByName: actorName,
        };
    const optimisticSignoff = isComplete
      ? emptySignoff
      : {
          ...nextSignoff,
          completedAt: new Date(),
        };

    setSavingKey(key);

    try {
      await updateDoc(doc(trackerRowsRef(recentlySelectedCompany), row.id), {
        [`checklist.${stage.id}`]: nextSignoff,
        updatedAt: serverTimestamp(),
      });
      setRows((currentRows) => currentRows.map((currentRow) => (
        currentRow.id === row.id
          ? {
              ...currentRow,
              checklist: {
                ...currentRow.checklist,
                [stage.id]: optimisticSignoff,
              },
              updatedAt: new Date(),
            }
          : currentRow
      )));
    } catch (error) {
      console.error("Unable to update migration signoff:", error);
      toast.error("Could not save this signoff.");
    } finally {
      setSavingKey("");
    }
  };

  if (!recentlySelectedCompany) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-5">
        <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Select a company to view the customer migration tracker.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
      <div className="mb-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Migration</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">Customer Migration Tracker</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Track every customer through site setup, routing, billing, and any company-specific transition steps.
              Each completed item records the signoff date and user for accountability.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-400">{recentlySelectedCompanyName || "Selected company"}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/company/setup-guide"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <FaClipboardCheck className="h-3.5 w-3.5" />
              Setup Guide
            </Link>
            <button
              type="button"
              onClick={handleSyncCustomers}
              disabled={loading || savingKey === "sync-customers"}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaSyncAlt className="h-3.5 w-3.5" />
              {savingKey === "sync-customers" ? "Syncing..." : `Sync Customers${missingCustomerCount ? ` (${missingCustomerCount})` : ""}`}
            </button>
          </div>
        </div>
      </div>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {defaultStages.map((stage) => {
          const stat = stageStats.find((item) => item.id === stage.id) || { ...stage, complete: 0, total: rows.length, percent: 0 };
          return <ProgressCard key={stage.id} stage={stage} complete={stat.complete} total={stat.total} percent={stat.percent} />;
        })}
        <ProgressCard stage={totalStats} complete={totalStats.complete} total={totalStats.total} percent={totalStats.percent} />
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Customer List</h2>
              <p className="mt-1 text-sm text-slate-500">
                Use synced Drip Drop customers or add manual names while moving from paper.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(220px,1fr)_160px]">
              <label className="relative block">
                <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search customers"
                  className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All statuses</option>
                <option value="notStarted">Not started</option>
                <option value="inProgress">In progress</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </div>
        </div>

        <form onSubmit={handleAddManualCustomer} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <FaUserPlus className="h-4 w-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-950">Add Manual Customer</h2>
          </div>
          <div className="mt-3 space-y-2">
            <input
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              placeholder="Customer name"
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <input
              value={manualNote}
              onChange={(event) => setManualNote(event.target.value)}
              placeholder="Short note or paper list reference"
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={savingKey === "manual-customer"}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FaPlus className="h-3.5 w-3.5" />
              {savingKey === "manual-customer" ? "Adding..." : "Add to Tracker"}
            </button>
          </div>
        </form>
      </section>

      <section className="mb-5 rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Custom Tracking Parts</h2>
              <p className="mt-1 text-sm text-slate-500">
                Add simple extra checks for anything unique to the company transition.
              </p>
            </div>
            <form onSubmit={handleAddCustomPart} className="grid w-full grid-cols-1 gap-2 lg:max-w-2xl lg:grid-cols-[180px_minmax(0,1fr)_120px]">
              <input
                value={customTitle}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder="Title"
                className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <input
                value={customDescription}
                onChange={(event) => setCustomDescription(event.target.value)}
                placeholder="Short description"
                className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="submit"
                disabled={savingKey === "custom-part"}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaPlus className="h-3.5 w-3.5" />
                Add
              </button>
            </form>
          </div>
        </div>
        {customParts.filter((part) => !part.archived).length ? (
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {stageStats.filter((stage) => stage.custom).map((stage) => (
              <div key={stage.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{stage.title}</p>
                    {stage.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{stage.description}</p> : null}
                  </div>
                  <span className="shrink-0 rounded bg-white px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                    {stage.percent}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-500">No custom tracking parts yet.</div>
        )}
      </section>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Loading customer migration tracker...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <FaClipboardCheck className="mx-auto h-8 w-8 text-slate-300" />
            <h2 className="mt-3 text-base font-semibold text-slate-950">Start the customer migration list</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Sync existing Drip Drop customers or add manual customers from a paper list. The tracker will calculate completion percentages as each row is signed off.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[260px] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Customer
                  </th>
                  {allStages.map((stage) => (
                    <th key={stage.id} className="min-w-[170px] px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {stage.shortTitle}
                    </th>
                  ))}
                  <th className="min-w-[220px] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {visibleRows.map((row) => {
                  const completedCount = allStages.filter((stage) => row.checklist?.[stage.id]?.complete).length;
                  const rowPercent = allStages.length ? Math.round((completedCount / allStages.length) * 100) : 0;

                  return (
                    <tr key={row.id} className="align-top">
                      <td className="sticky left-0 z-10 bg-white px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-950">{row.customerName}</p>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              {row.source === "manual" ? "Manual" : "Customer"}
                            </span>
                          </div>
                          {row.contact ? <p className="mt-1 text-xs text-slate-500">{row.contact}</p> : null}
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rowPercent}%` }} />
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{rowPercent}% complete</p>
                        </div>
                      </td>
                      {allStages.map((stage) => (
                        <td key={`${row.id}-${stage.id}`} className="px-3 py-3">
                          <SignoffButton
                            row={row}
                            stage={stage}
                            saving={savingKey === `${row.id}:${stage.id}`}
                            onToggle={handleToggleStage}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-3 text-sm leading-6 text-slate-500">
                        {row.notes || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visibleRows.length ? (
              <div className="border-t border-slate-200 p-5 text-sm text-slate-500">
                No customers match the current filter.
              </div>
            ) : null}
          </div>
        )}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link to="/company/migration/customer-export-import" className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
          <span>Customer Export Upload</span>
          <FaSyncAlt className="h-3.5 w-3.5" />
        </Link>
        <Link to="/company/route-builder" className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
          <span>Route Builder</span>
          <FaRoute className="h-3.5 w-3.5" />
        </Link>
        <Link to="/company/sales" className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
          <span>Sales and Billing</span>
          <FaFileInvoiceDollar className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

export default CustomerMigrationTracker;
