import React, { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import {
  BriefcaseIcon,
  DocumentDuplicateIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import useCompanyPermissions from "../../../hooks/useCompanyPermissions";
import {
  CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
  CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID,
  CREATE_JOBS_PERMISSION_ID,
  CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID,
  SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID,
} from "../../../utils/companyPermissions";
import {
  DEFAULT_ISSUE_PRIORITY,
  getIssuePriorityLabel,
  getIssuePriorityTone,
  normalizeIssuePriority,
} from "../../../utils/models/JobPlan";
import { appAlert } from "../../../utils/appDialog";

const getTemplateDefaultPriorityLevel = (template = {}) => (
  normalizeIssuePriority(
    template.defaultIssuePriorityLevel ??
    template.issuePriorityLevel ??
    template.priorityLevel ??
    template.solutionTier,
    DEFAULT_ISSUE_PRIORITY
  )
);

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(value || 0) || 0) / 100);

const formatTemplateMoney = (template = {}) => (
  moneyFromCents(Number(template.defaultRateCents || template.rate || 0))
);

const getSolutionTierClass = (tier) => {
  switch (getIssuePriorityTone(tier)) {
    case "red":
      return "bg-red-100 text-red-800";
    case "amber":
      return "bg-amber-100 text-amber-800";
    case "blue":
      return "bg-blue-100 text-blue-800";
    case "emerald":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const renderSolutionTier = (tier) => {
  const normalizedTier = normalizeIssuePriority(tier);
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold leading-none ${getSolutionTierClass(normalizedTier)}`}>
      {normalizedTier} - {getIssuePriorityLabel(normalizedTier)}
    </span>
  );
};

const contextValue = (...values) => (
  values.find((value) => String(value || "").trim()) || ""
);

const jobCreatePathForContext = ({ customerId = "", serviceLocationId = "", contextState = {} } = {}) => {
  const repairRequest = contextState.repairRequest || {};
  const suggestedWork = contextState.suggestedWork || {};
  const equipmentContext = contextState.equipmentContext || {};
  const customerContext = contextState.customerContext || {};

  const resolvedCustomerId = contextValue(
    customerId,
    customerContext.customerId,
    customerContext.id,
    repairRequest.customerId,
    suggestedWork.customerId,
    equipmentContext.customerId
  );
  const resolvedLocationId = contextValue(
    serviceLocationId,
    customerContext.serviceLocationId,
    customerContext.locationId,
    repairRequest.serviceLocationId,
    repairRequest.locationId,
    suggestedWork.serviceLocationId,
    equipmentContext.serviceLocationId
  );

  if (resolvedCustomerId && resolvedLocationId) {
    return `/company/jobs/createNew/${encodeURIComponent(resolvedCustomerId)}/${encodeURIComponent(resolvedLocationId)}`;
  }

  if (resolvedCustomerId) {
    return `/company/jobs/createNew/${encodeURIComponent(resolvedCustomerId)}`;
  }

  return "/company/jobs/createNew";
};

const basicWorkOrderPathForContext = ({ customerId = "", serviceLocationId = "", templateId = "", contextState = {} } = {}) => {
  const repairRequest = contextState.repairRequest || {};
  const suggestedWork = contextState.suggestedWork || {};
  const equipmentContext = contextState.equipmentContext || {};
  const customerContext = contextState.customerContext || {};
  const params = new URLSearchParams();
  const resolvedCustomerId = contextValue(
    customerId,
    customerContext.customerId,
    customerContext.id,
    repairRequest.customerId,
    suggestedWork.customerId,
    equipmentContext.customerId
  );
  const resolvedLocationId = contextValue(
    serviceLocationId,
    customerContext.serviceLocationId,
    customerContext.locationId,
    repairRequest.serviceLocationId,
    repairRequest.locationId,
    suggestedWork.serviceLocationId,
    equipmentContext.serviceLocationId
  );
  const resolvedBodyOfWaterId = contextValue(
    customerContext.bodyOfWaterId,
    repairRequest.bodyOfWaterId,
    suggestedWork.bodyOfWaterId,
    equipmentContext.bodyOfWaterId
  );
  const resolvedEquipmentId = contextValue(
    customerContext.equipmentId,
    repairRequest.equipmentId,
    suggestedWork.equipmentId,
    equipmentContext.equipmentId
  );

  if (templateId) params.set("templateId", templateId);
  if (resolvedCustomerId) params.set("customerId", resolvedCustomerId);
  if (resolvedLocationId) params.set("locationId", resolvedLocationId);
  if (resolvedBodyOfWaterId) params.set("bodyOfWaterId", resolvedBodyOfWaterId);
  if (resolvedEquipmentId) params.set("equipmentId", resolvedEquipmentId);

  const queryString = params.toString();
  return `/company/jobs/basic-create${queryString ? `?${queryString}` : ""}`;
};

const CreateJobFlowLauncher = ({
  buttonLabel = "Create Job",
  buttonClassName = "inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700",
  buttonType = "button",
  contextState = {},
  customerId = "",
  serviceLocationId = "",
  disabled = false,
  hideIfNoPermission = true,
}) => {
  const navigate = useNavigate();
  const { recentlySelectedCompany } = useContext(Context);
  const { can } = useCompanyPermissions();
  const [showCreateOptionsModal, setShowCreateOptionsModal] = useState(false);
  const [showTemplatePickerModal, setShowTemplatePickerModal] = useState(false);
  const [jobTemplates, setJobTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateSearchTerm, setTemplateSearchTerm] = useState("");

  const canCreateJobs = can(CREATE_JOBS_PERMISSION_ID);
  const canCreateBasicWorkOrders =
    canCreateJobs ||
    can(SCHEDULE_TEMPLATE_WORK_ORDERS_PERMISSION_ID) ||
    can(CREATE_TEMPLATE_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID) ||
    can(CREATE_CUSTOM_WORK_ORDERS_FOR_SELF_PERMISSION_ID) ||
    can(CREATE_CUSTOM_WORK_ORDERS_FOR_OTHERS_PERMISSION_ID);
  const canCreateAnyJobs = canCreateJobs || canCreateBasicWorkOrders;

  const filteredJobTemplates = useMemo(() => {
    const normalizedSearchTerm = templateSearchTerm.trim().toLowerCase();
    if (!normalizedSearchTerm) return jobTemplates;

    return jobTemplates.filter((template) => {
      const priorityLevel = getTemplateDefaultPriorityLevel(template);
      return [
        template.name,
        template.description,
        template.id,
        template.defaultRateCents,
        template.rate,
        template.defaultLaborCostCents,
        priorityLevel,
        getIssuePriorityLabel(priorityLevel),
        template.locked ? "locked" : "",
        template.isActive === false ? "inactive" : "active",
      ].some((value) => String(value || "").toLowerCase().includes(normalizedSearchTerm));
    });
  }, [jobTemplates, templateSearchTerm]);

  const fetchJobTemplates = async () => {
    if (!recentlySelectedCompany) return;

    try {
      setLoadingTemplates(true);

      const templateSnap = await getDocs(
        query(
          collection(db, "companies", recentlySelectedCompany, "jobTemplates"),
          orderBy("name", "asc")
        )
      );

      setJobTemplates(templateSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          ...data,
          id: data.id || docSnap.id,
        };
      }));
    } catch (error) {
      console.error("Error fetching job templates:", error);
      appAlert("Failed to load job templates.");
    } finally {
      setLoadingTemplates(false);
    }
  };

  const openCreateOptions = () => {
    if (!canCreateAnyJobs) {
      appAlert("You do not have permission to create jobs or basic jobs.");
      return;
    }
    setShowCreateOptionsModal(true);
  };

  const createState = (extraState = {}) => ({
    ...contextState,
    ...extraState,
  });

  const handleCreateBlankJob = () => {
    setShowCreateOptionsModal(false);
    navigate(jobCreatePathForContext({ customerId, serviceLocationId, contextState }), {
      state: createState(),
    });
  };

  const handleOpenTemplatePicker = async () => {
    setShowCreateOptionsModal(false);
    setTemplateSearchTerm("");
    setShowTemplatePickerModal(true);
    await fetchJobTemplates();
  };

  const handleCreateFromTemplate = (template) => {
    setShowTemplatePickerModal(false);
    setTemplateSearchTerm("");

    navigate(jobCreatePathForContext({ customerId, serviceLocationId, contextState }), {
      state: createState({
        startingTemplate: template,
        template,
        templateId: template.id,
      }),
    });
  };

  const handleCreateBasicWorkOrder = () => {
    setShowCreateOptionsModal(false);
    navigate(basicWorkOrderPathForContext({ customerId, serviceLocationId, contextState }), {
      state: createState(),
    });
  };

  if (hideIfNoPermission && !canCreateAnyJobs) return null;

  return (
    <>
      <button
        type={buttonType}
        onClick={openCreateOptions}
        disabled={disabled}
        className={buttonClassName}
      >
        {buttonLabel}
      </button>

      {showCreateOptionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Create Job</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Start blank or use a reusable job template.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCreateOptionsModal(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                  aria-label="Close create job options"
                >
                  <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="space-y-3 p-5">
              {canCreateBasicWorkOrders && (
                <button
                  type="button"
                  onClick={handleCreateBasicWorkOrder}
                  className="w-full rounded-md border border-blue-200 bg-blue-50 p-4 text-left transition hover:bg-blue-100"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-blue-200 bg-white">
                      <BriefcaseIcon className="h-5 w-5 text-blue-700" aria-hidden="true" />
                    </div>

                    <div>
                      <p className="font-bold text-blue-900">Basic Job</p>
                      <p className="mt-1 text-sm text-blue-800">
                        Schedule a technician-safe template or simple custom job with a generated price.
                      </p>
                    </div>
                  </div>
                </button>
              )}

              {canCreateJobs && (
                <button
                  type="button"
                  onClick={handleCreateBlankJob}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-slate-100"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white">
                      <PlusIcon className="h-5 w-5 text-slate-700" aria-hidden="true" />
                    </div>

                    <div>
                      <p className="font-bold text-slate-900">Blank Job</p>
                      <p className="mt-1 text-sm text-slate-500">
                        Build a job manually from scratch.
                      </p>
                    </div>
                  </div>
                </button>
              )}

              {canCreateJobs && (
                <button
                  type="button"
                  onClick={handleOpenTemplatePicker}
                  className="w-full rounded-md border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white">
                      <DocumentDuplicateIcon className="h-5 w-5 text-slate-700" aria-hidden="true" />
                    </div>

                    <div>
                      <p className="font-bold text-slate-900">From Template</p>
                      <p className="mt-1 text-sm text-slate-500">
                        Copy planned stops, tasks, materials, and pricing into a new job.
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showTemplatePickerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Choose Template</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Select a template to prefill the new job.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowTemplatePickerModal(false);
                    setTemplateSearchTerm("");
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                  aria-label="Close template picker"
                >
                  <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="border-b border-slate-200 p-5">
              <div className="grid gap-3 sm:grid-cols-[minmax(240px,1fr)_auto] sm:items-center">
                <input
                  value={templateSearchTerm}
                  onChange={(event) => setTemplateSearchTerm(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  type="text"
                  placeholder="Search templates by name, description, price, priority, or status..."
                  autoFocus
                />
                <p className="text-sm font-semibold text-slate-500">
                  {filteredJobTemplates.length} of {jobTemplates.length} shown
                </p>
              </div>
            </div>

            <div className="max-h-[56vh] overflow-y-auto">
              {loadingTemplates ? (
                <div className="m-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
                  <p className="font-semibold text-slate-800">Loading templates...</p>
                </div>
              ) : jobTemplates.length === 0 ? (
                <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="font-semibold text-slate-800">No templates found.</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Create a job template first, then return here.
                  </p>
                </div>
              ) : filteredJobTemplates.length === 0 ? (
                <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="font-semibold text-slate-800">No templates match that search.</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Try a name, description, price, priority, or status.
                  </p>
                </div>
              ) : (
                <div className="min-w-full">
                  <div className="sticky top-0 z-10 hidden grid-cols-[minmax(260px,1fr)_140px_180px_150px_96px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 md:grid">
                    <span>Template</span>
                    <span>Price</span>
                    <span>Priority</span>
                    <span>Labor</span>
                    <span className="text-right">Action</span>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {filteredJobTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => handleCreateFromTemplate(template)}
                        className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-blue-50 focus:outline-none focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 md:grid-cols-[minmax(260px,1fr)_140px_180px_150px_96px] md:items-center md:gap-4"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            {template.name || "Job Template"}
                          </p>

                          {template.description && (
                            <p className="mt-1 line-clamp-2 text-sm text-slate-500 md:line-clamp-1">
                              {template.description}
                            </p>
                          )}

                          <div className="mt-2 flex flex-wrap gap-2 md:hidden">
                            {template.locked && (
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                                Locked
                              </span>
                            )}
                            {template.isActive === false && (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="font-bold text-slate-900 md:text-sm">
                          {formatTemplateMoney(template)}
                        </div>

                        <div>
                          {renderSolutionTier(getTemplateDefaultPriorityLevel(template))}
                        </div>

                        <div className="text-sm font-semibold text-slate-700">
                          {template.defaultLaborCostCents !== undefined && (
                            <span>{moneyFromCents(template.defaultLaborCostCents)}</span>
                          )}
                          {template.defaultLaborCostCents === undefined && <span className="text-slate-400">-</span>}
                        </div>

                        <div className="flex items-center justify-between gap-3 md:justify-end">
                          <div className="hidden flex-wrap justify-end gap-2 md:flex">
                            {template.locked && (
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                                Locked
                              </span>
                            )}
                            {template.isActive === false && (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                Inactive
                              </span>
                            )}
                          </div>
                          <span className="text-sm font-bold text-blue-700">Select</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CreateJobFlowLauncher;
