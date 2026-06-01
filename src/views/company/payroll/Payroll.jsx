import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { v4 as uuidv4 } from "uuid";

const moneyFromCents = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);

const dateFromValue = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shortDate = (value) => {
  const date = dateFromValue(value);
  return date ? date.toLocaleDateString() : "-";
};

const isoDate = (date) => date.toISOString().slice(0, 10);

const isoDateTime = (value) => {
  const date = dateFromValue(value);
  return date ? date.toISOString() : "";
};

const csvCell = (value) => {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

const downloadCsv = (fileName, rows) => {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const statusLabel = (value) =>
  String(value || "unknown")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const StatCard = ({ title, value, subtitle }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
  </div>
);

const StatusPill = ({ status }) => (
  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
    {statusLabel(status)}
  </span>
);

const emptyPaymentForm = () => ({
  paidDate: isoDate(new Date()),
  paymentMode: "manual",
  paymentReference: "",
  exportBatchId: "",
  exportProvider: "",
  paidNotes: "",
});

const Payroll = () => {
  const { recentlySelectedCompany, user } = useContext(Context);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return isoDate(date);
  });
  const [endDate, setEndDate] = useState(() => isoDate(new Date()));
  const [lineItems, setLineItems] = useState([]);
  const [statements, setStatements] = useState([]);
  const [payrollBatches, setPayrollBatches] = useState([]);
  const [paySettings, setPaySettings] = useState(null);
  const [activeTab, setActiveTab] = useState("lineItems");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [savingAction, setSavingAction] = useState("");
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setLineItems([]);
      setStatements([]);
      setPayrollBatches([]);
      setPaySettings(null);
      return;
    }

    const loadPayroll = async () => {
      setLoading(true);
      setError("");

      try {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T23:59:59`);

        const lineItemsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayLineItems");
        const lineItemsQuery = query(
          lineItemsRef,
          where("completedDate", ">=", start),
          where("completedDate", "<=", end)
        );

        const statementsRef = collection(db, "companies", recentlySelectedCompany, "technicianPayStatements");
        const batchesRef = collection(db, "companies", recentlySelectedCompany, "payrollBatches");
        const settingsRef = doc(db, "companies", recentlySelectedCompany, "paySettings", "main");

        const [lineItemsSnap, statementsSnap, batchesSnap, settingsSnap] = await Promise.all([
          getDocs(lineItemsQuery),
          getDocs(statementsRef),
          getDocs(batchesRef),
          getDoc(settingsRef),
        ]);

        const nextLineItems = lineItemsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => (dateFromValue(b.completedDate)?.getTime() || 0) - (dateFromValue(a.completedDate)?.getTime() || 0));

        const nextStatements = statementsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((statement) => {
            const statementStart = dateFromValue(statement.startDate);
            const statementEnd = dateFromValue(statement.endDate);
            if (!statementStart || !statementEnd) return true;
            return statementStart <= end && statementEnd >= start;
          })
          .sort((a, b) => (dateFromValue(b.startDate)?.getTime() || 0) - (dateFromValue(a.startDate)?.getTime() || 0));

        const nextBatches = batchesSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((batch) => {
            const batchStart = dateFromValue(batch.startDate);
            const batchEnd = dateFromValue(batch.endDate);
            if (!batchStart || !batchEnd) return true;
            return batchStart <= end && batchEnd >= start;
          })
          .sort((a, b) => (dateFromValue(b.createdAt)?.getTime() || 0) - (dateFromValue(a.createdAt)?.getTime() || 0));

        setLineItems(nextLineItems);
        setStatements(nextStatements);
        setPayrollBatches(nextBatches);
        setPaySettings(settingsSnap.exists() ? settingsSnap.data() : null);
      } catch (err) {
        console.error("Error loading payroll:", err);
        setError("Could not load payroll data.");
      } finally {
        setLoading(false);
      }
    };

    loadPayroll();
  }, [recentlySelectedCompany, startDate, endDate]);

  const summary = useMemo(() => {
    const activeItems = lineItems.filter((item) => !item.voidedAt);
    const totalCents = activeItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);
    const needsReview = activeItems.filter((item) => item.calculationStatus === "needsReview").length;
    const approved = activeItems.filter((item) => item.approvedAt).length;
    const paid = activeItems.filter((item) => item.paidAt).length;
    const approvedUnpaidItems = activeItems.filter(
      (item) =>
        !item.paidAt &&
        !item.exportBatchId &&
        (item.approvedAt || item.calculationStatus === "approved")
    );
    const approvedUnpaidCents = approvedUnpaidItems.reduce((total, item) => total + Number(item.totalAmountCents || 0), 0);

    return { activeItems, totalCents, needsReview, approved, paid, approvedUnpaidItems, approvedUnpaidCents };
  }, [lineItems]);

  const currentUserId = user?.uid || user?.id || "";

  const lineItemsForStatement = (statement) => {
    const ids = new Set(Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []);
    return lineItems.filter((item) => ids.has(item.id) || item.payStatementId === statement.id);
  };

  const statementLineItemIds = (statement) => {
    const ids = new Set(Array.isArray(statement.lineItemIds) ? statement.lineItemIds : []);
    lineItems
      .filter((item) => item.payStatementId === statement.id)
      .forEach((item) => ids.add(item.id));
    return [...ids];
  };

  const setActionNotice = (message = "") => {
    setActionError("");
    setActionMessage(message);
  };

  const setActionFailure = (message) => {
    setActionMessage("");
    setActionError(message);
  };

  const updateLocalLineItem = (id, payload) => {
    setLineItems((items) => items.map((item) => (item.id === id ? { ...item, ...payload } : item)));
  };

  const updateLocalStatement = (id, payload) => {
    setStatements((items) => items.map((item) => (item.id === id ? { ...item, ...payload } : item)));
  };

  const updateLocalBatch = (payload) => {
    setPayrollBatches((items) => [payload, ...items.filter((item) => item.id !== payload.id)]);
  };

  const lineItemsForBatch = (batch) => {
    const ids = new Set(Array.isArray(batch.lineItemIds) ? batch.lineItemIds : []);
    return lineItems.filter((item) => ids.has(item.id) || item.exportBatchId === batch.id);
  };

  const buildApprovalPayload = () => ({
    approvedAt: new Date(),
    approvedByUserId: currentUserId,
  });

  const buildPaymentPayload = () => {
    const paidDate = paymentForm.paidDate || isoDate(new Date());
    const paymentMode = paymentForm.paymentMode || "manual";
    const paymentReference = paymentForm.paymentReference.trim();
    const exportBatchId = paymentForm.exportBatchId.trim();
    const exportProvider = paymentMode === "batch" ? paymentForm.exportProvider.trim() || "batch" : "manual";
    const externalReferenceId = paymentReference || exportBatchId || null;
    const paidNotes = paymentForm.paidNotes.trim();

    return {
      paidAt: new Date(`${paidDate}T12:00:00`),
      paidByUserId: currentUserId,
      paymentMode,
      paymentSource: paymentMode,
      paymentReference: paymentReference || null,
      exportBatchId: paymentMode === "batch" ? exportBatchId || null : null,
      exportProvider,
      externalReferenceId,
      paidNotes: paidNotes || null,
    };
  };

  const createPayrollBatch = async () => {
    if (!recentlySelectedCompany || summary.approvedUnpaidItems.length === 0) return;
    const actionKey = "create-payroll-batch";
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const now = new Date();
      const batchId = `payroll_batch_${uuidv4()}`;
      const batchPayload = {
        id: batchId,
        companyId: recentlySelectedCompany,
        status: "draft",
        startDate: new Date(`${startDate}T00:00:00`),
        endDate: new Date(`${endDate}T23:59:59`),
        lineItemIds: summary.approvedUnpaidItems.map((item) => item.id),
        lineItemCount: summary.approvedUnpaidItems.length,
        totalCents: summary.approvedUnpaidCents,
        paymentMode: "batch",
        paymentSource: "batch",
        exportProvider: "pending",
        externalReferenceId: null,
        createdAt: now,
        createdByUserId: currentUserId,
        updatedAt: now,
      };
      const linePayload = {
        exportBatchId: batchId,
        paymentMode: "batch",
        paymentSource: "batch",
        payrollBatchStatus: "draft",
        batchedAt: now,
        batchedByUserId: currentUserId,
      };
      const firestoreBatch = writeBatch(db);
      const batchRef = doc(db, "companies", recentlySelectedCompany, "payrollBatches", batchId);
      firestoreBatch.set(batchRef, batchPayload);

      summary.approvedUnpaidItems.forEach((item) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
        firestoreBatch.update(lineRef, linePayload);
      });

      await firestoreBatch.commit();
      updateLocalBatch(batchPayload);
      setLineItems((items) =>
        items.map((item) =>
          batchPayload.lineItemIds.includes(item.id) ? { ...item, ...linePayload } : item
        )
      );
      setActionNotice(`Created payroll batch with ${batchPayload.lineItemCount} line item(s).`);
    } catch (err) {
      console.error("Error creating payroll batch:", err);
      setActionFailure("Could not create payroll batch.");
    } finally {
      setSavingAction("");
    }
  };

  const exportPayrollBatchCsv = async (payrollBatch) => {
    if (!recentlySelectedCompany || !payrollBatch?.id) return;
    const batchLineItems = lineItemsForBatch(payrollBatch);

    if (batchLineItems.length === 0) {
      setActionFailure("No loaded line items are linked to this payroll batch.");
      return;
    }

    const actionKey = `export-payroll-batch-${payrollBatch.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const now = new Date();
      const exportReference = `CSV ${now.toLocaleString()}`;
      const fileName = `payroll_batch_${payrollBatch.id}_${isoDate(now)}.csv`;
      const rows = [
        [
          "batchId",
          "lineItemId",
          "companyId",
          "technicianId",
          "technicianName",
          "workerType",
          "source",
          "completedDate",
          "displayTitle",
          "workTypeName",
          "rateType",
          "quantity",
          "quantityUnit",
          "rateAmountCents",
          "totalAmountCents",
          "calculationStatus",
          "approvedAt",
          "paidAt",
          "customerName",
          "serviceLocationAddress",
          "jobId",
          "jobInternalId",
        ],
        ...batchLineItems.map((item) => [
          payrollBatch.id,
          item.id,
          item.companyId || recentlySelectedCompany,
          item.technicianId || "",
          item.technicianName || "",
          item.workerType || "",
          item.source || "",
          isoDateTime(item.completedDate),
          item.displayTitle || "",
          item.workTypeName || "",
          item.rateType || "",
          item.quantity || "",
          item.quantityUnit || "",
          item.rateAmountCents || 0,
          item.totalAmountCents || 0,
          item.calculationStatus || "",
          isoDateTime(item.approvedAt),
          isoDateTime(item.paidAt),
          item.customerName || "",
          item.serviceLocationAddress || "",
          item.jobId || "",
          item.jobInternalId || "",
        ]),
      ];

      downloadCsv(fileName, rows);

      const batchPayload = {
        status: "exported",
        exportedAt: now,
        exportedByUserId: currentUserId,
        exportProvider: "csv",
        externalReferenceId: exportReference,
        csvFileName: fileName,
        updatedAt: now,
      };
      const linePayload = {
        exportBatchId: payrollBatch.id,
        payrollBatchStatus: "exported",
        exportedAt: now,
        exportedByUserId: currentUserId,
        exportProvider: "csv",
        externalReferenceId: exportReference,
      };
      const firestoreBatch = writeBatch(db);
      const batchRef = doc(db, "companies", recentlySelectedCompany, "payrollBatches", payrollBatch.id);
      firestoreBatch.update(batchRef, batchPayload);

      batchLineItems.forEach((item) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
        firestoreBatch.update(lineRef, linePayload);
      });

      await firestoreBatch.commit();
      updateLocalBatch({ ...payrollBatch, ...batchPayload });
      setLineItems((items) =>
        items.map((item) =>
          batchLineItems.some((lineItem) => lineItem.id === item.id) ? { ...item, ...linePayload } : item
        )
      );
      setActionNotice(`Exported ${batchLineItems.length} payroll line item(s) to CSV.`);
    } catch (err) {
      console.error("Error exporting payroll batch:", err);
      setActionFailure("Could not export payroll batch.");
    } finally {
      setSavingAction("");
    }
  };

  const approveLineItem = async (item) => {
    if (!recentlySelectedCompany || !item?.id) return;
    const actionKey = `approve-line-${item.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const payload = { ...buildApprovalPayload(), calculationStatus: "approved" };
      const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
      await updateDoc(lineRef, payload);
      updateLocalLineItem(item.id, payload);
      setActionNotice("Line item approved.");
    } catch (err) {
      console.error("Error approving payroll line item:", err);
      setActionFailure("Could not approve that payroll line item.");
    } finally {
      setSavingAction("");
    }
  };

  const approveStatement = async (statement) => {
    if (!recentlySelectedCompany || !statement?.id) return;
    const actionKey = `approve-statement-${statement.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const approvalPayload = buildApprovalPayload();
      const statementPayload = { ...approvalPayload, status: "approved" };
      const linePayload = { ...approvalPayload, calculationStatus: "approved" };
      const batch = writeBatch(db);
      const statementRef = doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statement.id);
      batch.update(statementRef, statementPayload);

      const eligibleLineIds = statementLineItemIds(statement).filter((id) => {
        const line = lineItems.find((item) => item.id === id);
        return !line || (line.calculationStatus !== "paid" && line.calculationStatus !== "voided");
      });

      eligibleLineIds.forEach((id) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id);
        batch.update(lineRef, linePayload);
      });

      await batch.commit();
      updateLocalStatement(statement.id, statementPayload);
      setLineItems((items) =>
        items.map((item) => (eligibleLineIds.includes(item.id) ? { ...item, ...linePayload } : item))
      );
      setActionNotice("Statement approved.");
    } catch (err) {
      console.error("Error approving payroll statement:", err);
      setActionFailure("Could not approve that payroll statement.");
    } finally {
      setSavingAction("");
    }
  };

  const openPaymentModal = (targetType, target) => {
    const isBatch = targetType === "batch";
    setPaymentForm({
      ...emptyPaymentForm(),
      paymentMode: isBatch ? "batch" : "manual",
      paymentReference: target?.paymentReference || "",
      exportBatchId: isBatch ? target?.id || "" : target?.exportBatchId || "",
      exportProvider: isBatch ? target?.exportProvider || "csv" : target?.exportProvider || "",
      paidNotes: target?.paidNotes || "",
    });
    setPaymentModal({ targetType, target });
    setActionNotice();
  };

  const closePaymentModal = () => {
    if (savingAction) return;
    setPaymentModal(null);
    setPaymentForm(emptyPaymentForm());
  };

  const markLineItemPaid = async (item) => {
    if (!recentlySelectedCompany || !item?.id) return;
    const actionKey = `pay-line-${item.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = item.approvedAt ? {} : buildApprovalPayload();
      const payload = {
        ...approvalPayload,
        ...paymentPayload,
        calculationStatus: "paid",
      };
      const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
      await updateDoc(lineRef, payload);
      updateLocalLineItem(item.id, payload);
      setPaymentModal(null);
      setActionNotice("Line item marked paid.");
    } catch (err) {
      console.error("Error marking payroll line item paid:", err);
      setActionFailure("Could not mark that payroll line item paid.");
    } finally {
      setSavingAction("");
    }
  };

  const markStatementPaid = async (statement) => {
    if (!recentlySelectedCompany || !statement?.id) return;
    const actionKey = `pay-statement-${statement.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = statement.approvedAt ? {} : buildApprovalPayload();
      const statementPayload = {
        ...approvalPayload,
        ...paymentPayload,
        status: "paid",
      };
      const linePaymentPayload = {
        ...paymentPayload,
        calculationStatus: "paid",
        payStatementId: statement.id,
      };
      const batch = writeBatch(db);
      const statementRef = doc(db, "companies", recentlySelectedCompany, "technicianPayStatements", statement.id);
      batch.update(statementRef, statementPayload);

      const linkedLineIds = statementLineItemIds(statement);
      linkedLineIds.forEach((id) => {
        const line = lineItems.find((item) => item.id === id);
        const lineApprovalPayload = line?.approvedAt ? {} : approvalPayload;
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", id);
        batch.update(lineRef, {
          ...lineApprovalPayload,
          ...linePaymentPayload,
        });
      });

      await batch.commit();
      updateLocalStatement(statement.id, statementPayload);
      setLineItems((items) =>
        items.map((item) =>
          linkedLineIds.includes(item.id)
            ? {
                ...item,
                ...(item.approvedAt ? {} : approvalPayload),
                ...linePaymentPayload,
              }
            : item
        )
      );
      setPaymentModal(null);
      setActionNotice("Statement marked paid.");
    } catch (err) {
      console.error("Error marking payroll statement paid:", err);
      setActionFailure("Could not mark that payroll statement paid.");
    } finally {
      setSavingAction("");
    }
  };

  const markBatchPaid = async (payrollBatch) => {
    if (!recentlySelectedCompany || !payrollBatch?.id) return;
    const batchLineItems = lineItemsForBatch(payrollBatch);

    if (batchLineItems.length === 0) {
      setActionFailure("No loaded line items are linked to this payroll batch.");
      return;
    }

    const actionKey = `pay-batch-${payrollBatch.id}`;
    setSavingAction(actionKey);
    setActionNotice();

    try {
      const paymentPayload = buildPaymentPayload();
      const approvalPayload = buildApprovalPayload();
      const batchPayload = {
        ...paymentPayload,
        status: "paid",
        paidLineItemCount: batchLineItems.length,
        updatedAt: new Date(),
      };
      const linePaymentPayload = {
        ...paymentPayload,
        exportBatchId: payrollBatch.id,
        payrollBatchStatus: "paid",
        calculationStatus: "paid",
      };
      const firestoreBatch = writeBatch(db);
      const batchRef = doc(db, "companies", recentlySelectedCompany, "payrollBatches", payrollBatch.id);

      firestoreBatch.update(batchRef, batchPayload);
      batchLineItems.forEach((item) => {
        const lineRef = doc(db, "companies", recentlySelectedCompany, "technicianPayLineItems", item.id);
        firestoreBatch.update(lineRef, {
          ...(item.approvedAt ? {} : approvalPayload),
          ...linePaymentPayload,
        });
      });

      await firestoreBatch.commit();
      updateLocalBatch({ ...payrollBatch, ...batchPayload });
      setLineItems((items) =>
        items.map((item) => {
          const linkedLine = batchLineItems.find((lineItem) => lineItem.id === item.id);
          if (!linkedLine) return item;
          return {
            ...item,
            ...(item.approvedAt ? {} : approvalPayload),
            ...linePaymentPayload,
          };
        })
      );
      setPaymentModal(null);
      setActionNotice(`Marked ${batchLineItems.length} payroll line item(s) paid from batch.`);
    } catch (err) {
      console.error("Error marking payroll batch paid:", err);
      setActionFailure("Could not mark that payroll batch paid.");
    } finally {
      setSavingAction("");
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!paymentModal) return;
    if (paymentModal.targetType === "statement") {
      await markStatementPaid(paymentModal.target);
    } else if (paymentModal.targetType === "batch") {
      await markBatchPaid(paymentModal.target);
    } else {
      await markLineItemPaid(paymentModal.target);
    }
  };

  const renderLineItems = () => {
    if (summary.activeItems.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No payroll line items found for this date range.</div>;
    }

    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Work</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.activeItems.map((item) => {
              const isPaid = Boolean(item.paidAt) || item.calculationStatus === "paid";
              const isApproved = Boolean(item.approvedAt) || item.calculationStatus === "approved" || isPaid;
              const isVoided = item.calculationStatus === "voided";

              return (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{shortDate(item.completedDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">{item.technicianName || "Worker"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="font-medium">{item.displayTitle || item.workTypeName || "Payroll Line"}</div>
                    <div className="text-xs text-slate-500">{statusLabel(item.rateType)} · {Number(item.quantity || 0)} {item.quantityUnit || "each"}</div>
                    {item.paymentReference ? <div className="mt-1 text-xs text-slate-500">Ref: {item.paymentReference}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.customerName || item.serviceLocationAddress || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusPill status={isPaid ? "paid" : item.calculationStatus} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{moneyFromCents(item.totalAmountCents)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => approveLineItem(item)}
                        disabled={isApproved || isVoided || savingAction === `approve-line-${item.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingAction === `approve-line-${item.id}` ? "Saving" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openPaymentModal("lineItem", item)}
                        disabled={isPaid || isVoided}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Mark Paid
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderStatements = () => {
    if (statements.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No pay statements found for this date range.</div>;
    }

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {statements.map((statement) => {
          const isPaid = Boolean(statement.paidAt) || statement.status === "paid";
          const isApproved = Boolean(statement.approvedAt) || statement.status === "approved" || isPaid;
          const linkedLines = lineItemsForStatement(statement);

          return (
            <div key={statement.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">{statement.statementReference || statement.technicianName || "Pay Statement"}</p>
                  <p className="text-sm text-slate-500">{shortDate(statement.startDate)} - {shortDate(statement.endDate)}</p>
                  <p className="mt-1 text-xs text-slate-500">{linkedLines.length || statement.lineItemIds?.length || 0} linked line item(s)</p>
                  {statement.paymentReference ? <p className="mt-1 text-xs text-slate-500">Payment ref: {statement.paymentReference}</p> : null}
                </div>
                <StatusPill status={isPaid ? "paid" : statement.status} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subtotal</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(statement.subtotalCents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Adjustments</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(statement.adjustmentCents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(statement.totalCents)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => approveStatement(statement)}
                  disabled={isApproved || savingAction === `approve-statement-${statement.id}`}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAction === `approve-statement-${statement.id}` ? "Saving" : "Approve Statement"}
                </button>
                <button
                  type="button"
                  onClick={() => openPaymentModal("statement", statement)}
                  disabled={isPaid}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark Paid
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderBatches = () => {
    if (payrollBatches.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">No payroll batches found for this date range.</div>;
    }

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {payrollBatches.map((batch) => {
          const batchLineItems = lineItemsForBatch(batch);
          const isExporting = savingAction === `export-payroll-batch-${batch.id}`;
          const isPaid = Boolean(batch.paidAt) || batch.status === "paid";

          return (
            <div key={batch.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">{batch.batchReference || batch.id}</p>
                  <p className="text-sm text-slate-500">{shortDate(batch.startDate)} - {shortDate(batch.endDate)}</p>
                  {batch.externalReferenceId ? <p className="mt-1 text-xs text-slate-500">{batch.externalReferenceId}</p> : null}
                </div>
                <StatusPill status={isPaid ? "paid" : batch.status || "draft"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lines</p>
                  <p className="font-bold text-slate-900">{batch.lineItemCount || batch.lineItemIds?.length || batchLineItems.length || 0}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="font-bold text-slate-900">{moneyFromCents(batch.totalCents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</p>
                  <p className="font-bold text-slate-900">{statusLabel(batch.exportProvider || "pending")}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>{isPaid ? `Paid ${shortDate(batch.paidAt)}` : batch.exportedAt ? `Exported ${shortDate(batch.exportedAt)}` : `Created ${shortDate(batch.createdAt)}`}</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => exportPayrollBatchCsv(batch)}
                    disabled={isExporting || batchLineItems.length === 0}
                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isExporting ? "Exporting" : batch.status === "exported" || isPaid ? "Export CSV Again" : "Export CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openPaymentModal("batch", batch)}
                    disabled={isPaid || batchLineItems.length === 0}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Mark Paid
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSettings = () => (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Payroll Settings</h2>
      {paySettings ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Setting label="Pay mode" value={statusLabel(paySettings.payMode)} />
          <Setting label="Route pay source" value={statusLabel(paySettings.routePaySource)} />
          <Setting label="Task pay source" value={statusLabel(paySettings.taskPaySource)} />
          <Setting label="Hourly pay source" value={statusLabel(paySettings.hourlyPaySource)} />
          <Setting label="Manual adjustments" value={paySettings.allowManualPayAdjustments ? "Allowed" : "Not allowed"} />
          <Setting label="Lock after approval" value={paySettings.lockPayAfterApproval ? "Yes" : "No"} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No payroll settings have been saved for this company yet.</p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Payroll</h1>
            <p className="mt-1 text-slate-600">Review internal technician pay lines, statements, and payroll settings.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <button
              type="button"
              onClick={createPayrollBatch}
              disabled={summary.approvedUnpaidItems.length === 0 || savingAction === "create-payroll-batch"}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAction === "create-payroll-batch" ? "Creating" : "Create Batch"}
            </button>
          </div>
        </header>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Payroll total" value={moneyFromCents(summary.totalCents)} subtitle={`${summary.activeItems.length} active line item(s)`} />
          <StatCard title="Needs review" value={summary.needsReview} subtitle="Line items requiring attention" />
          <StatCard title="Approved" value={summary.approved} subtitle="Approved line items" />
          <StatCard title="Ready to batch" value={moneyFromCents(summary.approvedUnpaidCents)} subtitle={`${summary.approvedUnpaidItems.length} approved unpaid line(s)`} />
          <StatCard title="Paid" value={summary.paid} subtitle="Marked paid internally" />
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {[
            ["lineItems", "Line Items"],
            ["statements", "Statements"],
            ["batches", "Batches"],
            ["settings", "Settings"],
          ].map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {actionMessage ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{actionMessage}</div> : null}
        {actionError ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{actionError}</div> : null}
        {loading ? <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">Loading payroll...</div> : null}
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {!loading && !error && activeTab === "lineItems" ? renderLineItems() : null}
        {!loading && !error && activeTab === "statements" ? renderStatements() : null}
        {!loading && !error && activeTab === "batches" ? renderBatches() : null}
        {!loading && !error && activeTab === "settings" ? renderSettings() : null}
      </div>
      {paymentModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={submitPayment} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Mark Paid</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {paymentModal.targetType === "statement"
                    ? paymentModal.target.statementReference || paymentModal.target.technicianName || "Pay statement"
                    : paymentModal.targetType === "batch"
                      ? paymentModal.target.batchReference || paymentModal.target.id || "Payroll batch"
                      : paymentModal.target.displayTitle || paymentModal.target.workTypeName || "Payroll line item"}
                </p>
              </div>
              <button type="button" onClick={closePaymentModal} className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="text-sm font-semibold text-slate-700">
                Paid date
                <input
                  type="date"
                  value={paymentForm.paidDate}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paidDate: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Payment source
                <select
                  value={paymentForm.paymentMode}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paymentMode: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="manual">Manual entry</option>
                  <option value="batch">Batch/export reference</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Reference
                <input
                  type="text"
                  value={paymentForm.paymentReference}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paymentReference: event.target.value }))}
                  placeholder={paymentForm.paymentMode === "manual" ? "Check number, cash note, ACH ref" : "Provider transaction or export ref"}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              {paymentForm.paymentMode === "batch" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Batch ID
                    <input
                      type="text"
                      value={paymentForm.exportBatchId}
                      onChange={(event) => setPaymentForm((form) => ({ ...form, exportBatchId: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Export provider
                    <input
                      type="text"
                      value={paymentForm.exportProvider}
                      onChange={(event) => setPaymentForm((form) => ({ ...form, exportProvider: event.target.value }))}
                      placeholder="CSV, Gusto, ADP"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              ) : null}

              <label className="text-sm font-semibold text-slate-700">
                Notes
                <textarea
                  value={paymentForm.paidNotes}
                  onChange={(event) => setPaymentForm((form) => ({ ...form, paidNotes: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closePaymentModal} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(savingAction)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAction ? "Saving" : "Mark Paid"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};

const Setting = ({ label, value }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 font-semibold text-slate-900">{value || "-"}</p>
  </div>
);

export default Payroll;
