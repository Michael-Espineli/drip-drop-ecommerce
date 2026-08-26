import React, { useEffect, useMemo, useState } from "react";
import { FaTimes, FaTrash } from "react-icons/fa";
import { agreementCanBeRejectedForLeadCancellation } from "../../../utils/leads/leadCancellation";

const optionBoxClass = "flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3";
const disabledOptionBoxClass = "flex items-start gap-3 rounded-md border border-slate-200 bg-slate-100 p-3 opacity-60";

const formatDate = (value) => {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
};

const stopLabel = (serviceStop = {}) => (
  [
    serviceStop.type || serviceStop.serviceStopType || serviceStop.serviceStopTypeName || "Service estimate",
    formatDate(serviceStop.serviceDate || serviceStop.scheduledDate || serviceStop.date || serviceStop.startTime),
  ].filter(Boolean).join(" - ")
);

const customerLabel = (customer = {}) => (
  customer.customerName ||
  customer.name ||
  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
  customer.email ||
  "Linked customer"
);

const agreementLabel = (agreement = {}) => (
  agreement.title ||
  agreement.serviceAgreementTitle ||
  "Service Agreement"
);

export default function LeadCancellationDialog({
  lead,
  targets = {},
  loadingTargets = false,
  saving = false,
  permissions = {},
  onClose,
  onConfirm,
}) {
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [options, setOptions] = useState({
    deleteServiceStop: false,
    makeCustomerInactive: false,
    rejectAgreement: false,
  });

  const availability = useMemo(() => {
    const customerActive = targets.customer
      ? (targets.customer.active ?? targets.customer.isActive ?? true) !== false
      : false;

    return {
      deleteServiceStop: Boolean(targets.serviceStop?.id && permissions.canDeleteServiceStop),
      makeCustomerInactive: Boolean(targets.customer?.id && customerActive && permissions.canDeactivateCustomer),
      rejectAgreement: Boolean(
        targets.agreement?.id &&
        agreementCanBeRejectedForLeadCancellation(targets.agreement) &&
        permissions.canRejectAgreement
      ),
    };
  }, [permissions, targets]);

  useEffect(() => {
    setConfirmation("");
    setReason(lead?.lostReason || lead?.cancelReason || lead?.statusChangeReason || "");
    setOptions({
      deleteServiceStop: false,
      makeCustomerInactive: false,
      rejectAgreement: false,
    });
  }, [lead?.id, lead?.lostReason, lead?.cancelReason, lead?.statusChangeReason]);

  if (!lead) return null;

  const leadName = lead.homeownerName || lead.customerName || lead.serviceName || "this lead";
  const confirmDisabled = saving || loadingTargets || confirmation.trim().toUpperCase() !== "CANCEL";

  const toggleOption = (key) => {
    if (!availability[key]) return;
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  const renderOption = ({
    keyName,
    title,
    available,
    disabledReason,
    detail,
  }) => (
    <label className={available ? optionBoxClass : disabledOptionBoxClass}>
      <input
        type="checkbox"
        checked={Boolean(options[keyName])}
        disabled={!available || saving || loadingTargets}
        onChange={() => toggleOption(keyName)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-600">
          {available ? detail : disabledReason}
        </span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Cancel Lead</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Mark {leadName} cancelled. Choose any related records that should be cleaned up at the same time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
            aria-label="Close"
          >
            <FaTimes className="text-sm" />
          </button>
        </div>

        <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="leadCancelReason">
          Lost / cancelled reason
        </label>
        <textarea
          id="leadCancelReason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          disabled={saving}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:bg-slate-100"
          placeholder="Price, timing, no response, wrong fit..."
        />

        <div className="mt-4 space-y-2">
          {loadingTargets ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Checking linked service stop, customer, and service agreement...
            </div>
          ) : (
            <>
              {renderOption({
                keyName: "deleteServiceStop",
                title: "Delete corresponding service stop",
                available: availability.deleteServiceStop,
                disabledReason: targets.serviceStop?.id
                  ? "You do not have permission to delete service stops."
                  : "No linked service stop was found for this lead.",
                detail: stopLabel(targets.serviceStop),
              })}
              {renderOption({
                keyName: "makeCustomerInactive",
                title: "Make linked customer inactive",
                available: availability.makeCustomerInactive,
                disabledReason: targets.customer?.id
                  ? ((targets.customer.active ?? targets.customer.isActive ?? true) === false
                    ? "The linked customer is already inactive."
                    : "You do not have permission to update customers.")
                  : "No linked customer was found for this lead.",
                detail: customerLabel(targets.customer),
              })}
              {renderOption({
                keyName: "rejectAgreement",
                title: "Reject linked service agreement",
                available: availability.rejectAgreement,
                disabledReason: targets.agreement?.id
                  ? (agreementCanBeRejectedForLeadCancellation(targets.agreement)
                    ? "You do not have permission to update service agreements."
                    : `Agreement status is already ${targets.agreement.status || "final"}.`)
                  : "No linked service agreement was found for this lead.",
                detail: agreementLabel(targets.agreement),
              })}
            </>
          )}
        </div>

        <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="leadCancelConfirmation">
          Type CANCEL to confirm
        </label>
        <input
          id="leadCancelConfirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={saving}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:bg-slate-100"
        />

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Keep Lead
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.({ reason, options })}
            disabled={confirmDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FaTrash className="text-xs" />
            {saving ? "Cancelling..." : "Cancel Lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
