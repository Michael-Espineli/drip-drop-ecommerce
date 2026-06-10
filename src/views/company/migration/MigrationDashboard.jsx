import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getCountFromServer } from "firebase/firestore";
import { FaRegFileAlt, FaSwimmingPool, FaUsers } from "react-icons/fa";
import { AiOutlineCheckCircle, AiOutlineDashboard } from "react-icons/ai";
import { GoTools } from "react-icons/go";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";

const countCollections = [
  { key: "customers", label: "Customers", path: ["customers"] },
  { key: "serviceLocations", label: "Service Locations", path: ["serviceLocations"] },
  { key: "bodiesOfWater", label: "Pools", path: ["bodiesOfWater"] },
  { key: "equipment", label: "Equipment", path: ["equipment"] },
  { key: "recurringServiceStops", label: "Recurring Stops", path: ["recurringServiceStop"] },
  { key: "serviceStops", label: "Service History", path: ["serviceStops"] },
];

const statusClasses = {
  done: "bg-emerald-100 text-emerald-700",
  active: "bg-blue-100 text-blue-700",
  review: "bg-amber-100 text-amber-700",
  planned: "bg-slate-100 text-slate-600",
};

const buildChecklistSteps = (counts) => [
  {
    title: "Import customer export",
    description: "Compare the customer workbook against existing Drip Drop records, then import missing customers, locations, and pools.",
    path: "/company/migration/customer-export-import",
    icon: FaUsers,
    status: counts.customers > 0 ? "active" : "active",
    statusLabel: counts.customers > 0 ? "In progress" : "First step",
    detail: `${counts.customers || 0} customers and ${counts.serviceLocations || 0} service locations in Drip Drop`,
  },
  {
    title: "Verify service locations and pools",
    description: "Review addresses, active status, gate codes, dog notes, and placeholder pool records after customer import.",
    path: "/company/serviceLocations",
    icon: AiOutlineCheckCircle,
    status: counts.serviceLocations > 0 && counts.bodiesOfWater > 0 ? "review" : "planned",
    statusLabel: counts.serviceLocations > 0 ? "Review" : "Waiting",
    detail: `${counts.serviceLocations || 0} locations and ${counts.bodiesOfWater || 0} pools`,
  },
  {
    title: "Move equipment details",
    description: "Import pumps, filters, cleaners, heaters, maintenance dates, and equipment notes once core customer/location records are stable.",
    path: "/company/migration/equipment-import",
    icon: FaSwimmingPool,
    status: counts.equipment > 0 ? "review" : counts.serviceLocations > 0 ? "active" : "planned",
    statusLabel: counts.equipment > 0 ? "Review" : counts.serviceLocations > 0 ? "Ready" : "Waiting",
    detail: `${counts.equipment || 0} equipment records`,
  },
  {
    title: "Build routes and recurring stops",
    description: "Use imported service locations to build routes, recurring stops, and technician assignments.",
    path: "/company/route-dashboard",
    icon: AiOutlineDashboard,
    status: counts.recurringServiceStops > 0 ? "review" : "planned",
    statusLabel: counts.recurringServiceStops > 0 ? "Review" : "Planned",
    detail: `${counts.recurringServiceStops || 0} recurring stops`,
  },
  {
    title: "Import dosage history",
    description: "Use the Skimmer dosage upload after customers, locations, pools, and dosage templates are ready.",
    path: "/company/migration/skimmer-previous-dosages-upload",
    icon: FaRegFileAlt,
    status: counts.customers > 0 && counts.bodiesOfWater > 0 ? "active" : "planned",
    statusLabel: counts.customers > 0 && counts.bodiesOfWater > 0 ? "Ready" : "Waiting",
    detail: `${counts.serviceStops || 0} existing service history records`,
  },
  {
    title: "Final migration audit",
    description: "Confirm customers, locations, pools, equipment, routes, billing, and service history before retiring the old system.",
    path: "",
    icon: GoTools,
    status: "planned",
    statusLabel: "Planned",
    detail: "Audit checklist placeholder",
  },
];

function MigrationDashboard() {
  const { recentlySelectedCompany } = useContext(Context);
  const [counts, setCounts] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countError, setCountError] = useState("");
  const checklistSteps = useMemo(() => buildChecklistSteps(counts), [counts]);

  useEffect(() => {
    let cancelled = false;

    const loadCounts = async () => {
      if (!recentlySelectedCompany) {
        setCounts({});
        return;
      }

      setLoadingCounts(true);
      setCountError("");

      try {
        const countResults = await Promise.all(
          countCollections.map(async (item) => {
            const countRef = collection(db, "companies", recentlySelectedCompany, ...item.path);
            const snapshot = await getCountFromServer(countRef);
            return [item.key, snapshot.data().count || 0];
          })
        );

        if (!cancelled) {
          setCounts(Object.fromEntries(countResults));
        }
      } catch (error) {
        console.error("Failed to load migration dashboard counts:", error);
        if (!cancelled) {
          setCountError("Could not load migration counts for this company.");
        }
      } finally {
        if (!cancelled) {
          setLoadingCounts(false);
        }
      }
    };

    loadCounts();

    return () => {
      cancelled = true;
    };
  }, [recentlySelectedCompany]);

  return (
    <div className="min-h-screen bg-slate-50 px-0 py-4">
      <div className="w-full space-y-5">
        <div className="border-b border-slate-200 px-4 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Migration</p>
          <h1 className="text-2xl font-bold text-slate-950">Migration Dashboard</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Track what has moved into Drip Drop, compare exports against existing records, and work through the migration steps in order.
          </p>
        </div>

        <section className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 xl:grid-cols-6">
          {countCollections.map((item) => (
            <div key={item.key} className="border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">
                {loadingCounts ? "-" : counts[item.key] || 0}
              </p>
            </div>
          ))}
        </section>

        {countError && (
          <div className="mx-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {countError}
          </div>
        )}

        <section className="mx-4 border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">Migration Checklist</h2>
            <p className="mt-1 text-sm text-slate-500">
              Work from top to bottom. Each step should either move data, compare data, or flag records that need cleanup.
            </p>
          </div>

          <div className="divide-y divide-slate-200">
            {checklistSteps.map((step, index) => {
              const Icon = step.icon;
              const content = (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-4 transition hover:bg-slate-50 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Step {index + 1}</span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          statusClasses[step.status] || statusClasses.planned
                        }`}
                      >
                        {step.statusLabel}
                      </span>
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-slate-950">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{step.detail}</p>
                  </div>
                  <div className="col-span-2 self-center md:col-span-1">
                    <span className={`text-sm font-semibold ${step.path ? "text-blue-700" : "text-slate-400"}`}>
                      {step.path ? "Open" : "Coming later"}
                    </span>
                  </div>
                </div>
              );

              return step.path ? (
                <Link key={step.title} to={step.path} className="block focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {content}
                </Link>
              ) : (
                <div key={step.title}>{content}</div>
              );
            })}
          </div>
        </section>

        <section className="mx-4 border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Customer Import Starts Here</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-700 md:grid-cols-3">
            <div className="border-l-4 border-blue-500 bg-blue-50 px-3 py-2">
              Upload the export and compare it against existing Drip Drop customers.
            </div>
            <div className="border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2">
              Already-added rows are identified before the importer writes anything.
            </div>
            <div className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
              Review partial matches before importing to avoid duplicate customers.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default MigrationDashboard;
