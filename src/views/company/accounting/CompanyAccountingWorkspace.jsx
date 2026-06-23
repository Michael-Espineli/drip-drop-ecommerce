import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import toast from "react-hot-toast";
import {
  FaArrowLeft,
  FaBook,
  FaBuildingColumns,
  FaCheck,
  FaCircleNotch,
  FaClipboardCheck,
  FaFileInvoiceDollar,
  FaLandmark,
  FaMoneyBillTransfer,
  FaMoon,
  FaReceipt,
  FaScaleBalanced,
  FaSun,
} from "react-icons/fa6";
import { Context } from "../../../context/AuthContext";
import { useTheme } from "../../../context/ThemeContext";
import { db, functions } from "../../../utils/config";
import { salesCollectionNames } from "../../../utils/models/Sales";
import { invoiceBalanceCents } from "../../../utils/sales/manualBilling";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const appPaymentMethods = new Set(["stripeCard", "stripeAch"]);
const reviewPurchaseCategories = new Set(["", "uncategorized", "misc", "unknown"]);

const normalizeStatus = (value) => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const labelize = (value) => {
  if (!value) return "Unknown";
  return String(value)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatCurrency = (amountCents = 0) => currencyFormatter.format((Number(amountCents) || 0) / 100);

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(millis));
};

const formatPercent = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

const sortByFreshest = (records) =>
  [...records].sort((left, right) => {
    const rightMillis = toMillis(right.updatedAt || right.receivedAt || right.paidAt || right.createdAt || right.dueDate || right.date);
    const leftMillis = toMillis(left.updatedAt || left.receivedAt || left.paidAt || left.createdAt || left.dueDate || left.date);
    return rightMillis - leftMillis;
  });

const daysPastDue = (value) => {
  const millis = toMillis(value);
  if (!millis) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(millis);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
};

const isThisMonth = (value) => {
  const millis = toMillis(value);
  if (!millis) return false;
  const date = new Date(millis);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

const isPostedPayment = (payment) => normalizeStatus(payment.status) === "posted";

const isReconciledPayment = (payment) => (
  normalizeStatus(payment.accountingStatus) === "reconciled" ||
  Boolean(payment.reconciledAt)
);

const isAppPayment = (payment) => (
  appPaymentMethods.has(payment.method) ||
  Boolean(payment.stripePaymentIntentId || payment.stripeChargeId || payment.stripeInvoiceId)
);

const centsFromMaybeDollars = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

const purchaseAmountCents = (purchase = {}) => {
  const directCents = Number(
    purchase.amountCents ??
    purchase.totalCents ??
    purchase.totalAmountCents ??
    0
  );
  if (directCents) return directCents;

  const quantity = Number(purchase.quantity || purchase.qty || purchase.quantityString || 1) || 1;
  const unitPriceCents = Number(purchase.priceCents ?? purchase.unitPriceCents ?? purchase.price ?? 0);
  if (unitPriceCents) return unitPriceCents * quantity;

  return centsFromMaybeDollars(purchase.price || purchase.amount || purchase.total || purchase.cost) * quantity;
};

const purchaseTaxCents = (purchase = {}) => {
  const directCents = Number(purchase.taxCents ?? purchase.taxAmountCents ?? purchase.salesTaxCents ?? 0);
  if (directCents) return directCents;
  return centsFromMaybeDollars(purchase.tax || purchase.salesTax || purchase.taxAmount);
};

const purchaseVendorName = (purchase = {}) => (
  purchase.vendorName ||
  purchase.venderName ||
  purchase.supplierName ||
  "Vendor"
);

const purchaseDate = (purchase = {}) => purchase.date || purchase.purchasedAt || purchase.createdAt;
const isReturnedPurchase = (purchase = {}) => Boolean(purchase.returned || purchase.returnedAt);
const hasSourceDocument = (purchase = {}) => Boolean(purchase.receiptId || purchase.invoiceNum || purchase.invoiceNumber || purchase.receiptUrl || purchase.receiptFileUrl);
const isBillablePurchase = (purchase = {}) => Boolean(purchase.billable || purchase.jobBillable);
const isInvoicedPurchase = (purchase = {}) => Boolean(purchase.invoiced || purchase.invoiceId || normalizeStatus(purchase.jobBillingStatus) === "invoiced");

const purchaseNeedsReview = (purchase = {}) => {
  const category = normalizeStatus(purchase.category);
  return (
    !hasSourceDocument(purchase) ||
    !purchaseVendorName(purchase).trim() ||
    reviewPurchaseCategories.has(category)
  );
};

const sumCents = (records, selector) => records.reduce((total, record) => total + Number(selector(record) || 0), 0);

const groupCents = (records, keySelector, centsSelector, fallback = "Uncategorized") => {
  const grouped = records.reduce((acc, record) => {
    const key = keySelector(record) || fallback;
    acc[key] = (acc[key] || 0) + Number(centsSelector(record) || 0);
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([label, amountCents]) => ({ label, amountCents }))
    .sort((left, right) => right.amountCents - left.amountCents);
};

const agingBucketFor = (invoice) => {
  const lateDays = daysPastDue(invoice.dueDate);
  if (lateDays === null || lateDays === 0) return "Current";
  if (lateDays <= 30) return "1-30";
  if (lateDays <= 60) return "31-60";
  return "61+";
};

const StatusPill = ({ children, tone = "slate" }) => {
  const toneClasses = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  };

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold ${toneClasses[tone] || toneClasses.slate}`}>
      {children}
    </span>
  );
};

const NavButton = ({ href, icon: Icon, label }) => (
  <a
    href={href}
    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-emerald-50/80 transition hover:bg-white/10 hover:text-white"
  >
    <Icon className="h-4 w-4" />
    <span>{label}</span>
  </a>
);

const Panel = ({ children, className = "" }) => (
  <section className={`rounded-md border border-slate-200 bg-white ${className}`}>
    {children}
  </section>
);

const MetricCard = ({ label, value, helper, tone = "slate" }) => (
  <Panel className="p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
    {helper && (
      <div className="mt-3">
        <StatusPill tone={tone}>{helper}</StatusPill>
      </div>
    )}
  </Panel>
);

const SectionHeader = ({ eyebrow, title, action }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-bold text-slate-950">{title}</h2>
    </div>
    {action}
  </div>
);

const EmptyState = ({ title }) => (
  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">
    {title}
  </div>
);

const ReviewRow = ({ label, value, status, tone = "slate" }) => (
  <div className="grid gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
    <span className="font-semibold text-slate-700">{label}</span>
    <span className="font-bold text-slate-950">{value}</span>
    <StatusPill tone={tone}>{status}</StatusPill>
  </div>
);

const readinessTone = (value) => (value ? "emerald" : "amber");

const readinessText = (value, enabled = "Enabled", disabled = "Needs attention") => (
  value ? enabled : disabled
);

const StripeInfoRow = ({ label, value, status, tone = "slate" }) => (
  <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
    <dt className="min-w-0 text-slate-500">{label}</dt>
    <dd className="flex min-w-0 items-center gap-2 text-right">
      <span className="truncate font-bold text-slate-950">{value || "Not set"}</span>
      {status ? <StatusPill tone={tone}>{status}</StatusPill> : null}
    </dd>
  </div>
);

const StripeRequirementList = ({ title, items = [], tone = "amber" }) => {
  const visibleItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (visibleItems.length === 0) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {visibleItems.map((item, index) => (
          <StatusPill key={`${title}-${item}-${index}`} tone={tone}>
            {labelize(item.reason || item.code || item.requirement || item)}
          </StatusPill>
        ))}
      </div>
    </div>
  );
};

const CompanyAccountingWorkspace = () => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    stripeConnectedAccountId,
    user,
  } = useContext(Context);
  const { isDarkMode, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState({ title: "", body: "", priority: "normal" });
  const [savingNote, setSavingNote] = useState(false);
  const [reconcilingPaymentId, setReconcilingPaymentId] = useState("");
  const [stripeReadiness, setStripeReadiness] = useState(null);
  const [stripeReadinessLoading, setStripeReadinessLoading] = useState(false);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setInvoices([]);
      setPayments([]);
      setSubscriptions([]);
      setAgreements([]);
      setPurchases([]);
      setNotes([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    let firstSnapshotsRemaining = 6;
    const markReady = () => {
      firstSnapshotsRemaining -= 1;
      if (firstSnapshotsRemaining <= 0) setLoading(false);
    };
    const handleError = (label) => (error) => {
      console.error(`Unable to load ${label}`, error);
      toast.error(`Unable to load ${label}.`);
      markReady();
    };
    const companyFilter = where("companyId", "==", recentlySelectedCompany);
    const bind = (ref, setter, label) => onSnapshot(
      ref,
      (snapshot) => {
        setter(snapshot.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() })));
        markReady();
      },
      handleError(label)
    );

    const unsubscribes = [
      bind(query(collection(db, salesCollectionNames.invoices), companyFilter), setInvoices, "invoices"),
      bind(query(collection(db, salesCollectionNames.payments), companyFilter), setPayments, "payments"),
      bind(query(collection(db, salesCollectionNames.billingSubscriptions), companyFilter), setSubscriptions, "subscriptions"),
      bind(query(collection(db, salesCollectionNames.agreements), companyFilter), setAgreements, "agreements"),
      bind(collection(db, "companies", recentlySelectedCompany, "purchasedItems"), setPurchases, "purchases"),
      bind(
        query(
          collection(db, "companies", recentlySelectedCompany, "accountingNotes"),
          orderBy("createdAt", "desc"),
          limit(30)
        ),
        setNotes,
        "accounting notes"
      ),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [recentlySelectedCompany]);

  const accounting = useMemo(() => {
    const postedPayments = payments.filter(isPostedPayment);
    const unreconciledPayments = postedPayments.filter((payment) => !isReconciledPayment(payment));
    const appPayments = postedPayments.filter(isAppPayment);
    const manualPayments = postedPayments.filter((payment) => !isAppPayment(payment));
    const nonReturnedPurchases = purchases.filter((purchase) => !isReturnedPurchase(purchase));
    const activeSubscriptions = subscriptions.filter((subscription) => ["active", "trialing"].includes(normalizeStatus(subscription.status || subscription.stripeStatus)));
    const acceptedAgreements = agreements.filter((agreement) => normalizeStatus(agreement.status) === "accepted");
    const eligibleInvoices = invoices.filter((invoice) => !["void", "draft"].includes(normalizeStatus(invoice.status)));
    const openInvoices = eligibleInvoices.filter((invoice) => {
      const status = normalizeStatus(invoice.status);
      return invoiceBalanceCents(invoice) > 0 && !["paid", "void", "uncollectible"].includes(status);
    });
    const overdueInvoices = openInvoices.filter((invoice) => daysPastDue(invoice.dueDate) > 0 || normalizeStatus(invoice.status) === "overdue");
    const currentMonthInvoices = eligibleInvoices.filter((invoice) => isThisMonth(invoice.invoiceDate || invoice.createdAt || invoice.dueDate));
    const currentMonthPayments = postedPayments.filter((payment) => isThisMonth(payment.receivedAt || payment.paidAt || payment.createdAt));
    const currentMonthPurchases = nonReturnedPurchases.filter((purchase) => isThisMonth(purchaseDate(purchase)));
    const billableUninvoicedPurchases = nonReturnedPurchases.filter((purchase) => isBillablePurchase(purchase) && !isInvoicedPurchase(purchase));
    const purchaseReviewQueue = nonReturnedPurchases.filter(purchaseNeedsReview);
    const missingReceiptPurchases = nonReturnedPurchases.filter((purchase) => !hasSourceDocument(purchase));
    const openNotes = notes.filter((note) => normalizeStatus(note.status) !== "resolved");

    const agingBuckets = ["Current", "1-30", "31-60", "61+"].map((bucket) => {
      const bucketInvoices = openInvoices.filter((invoice) => agingBucketFor(invoice) === bucket);
      return {
        bucket,
        count: bucketInvoices.length,
        amountCents: sumCents(bucketInvoices, invoiceBalanceCents),
      };
    });

    const invoiceTaxCents = sumCents(eligibleInvoices, (invoice) => invoice.taxAmountCents);
    const taxableRevenueCents = sumCents(eligibleInvoices, (invoice) => Math.max(Number(invoice.subtotalAmountCents || invoice.totalAmountCents || 0) - Number(invoice.taxAmountCents || 0), 0));
    const purchaseSpendCents = sumCents(nonReturnedPurchases, purchaseAmountCents);
    const purchaseTaxesCents = sumCents(nonReturnedPurchases, purchaseTaxCents);
    const postedPaymentCents = sumCents(postedPayments, (payment) => payment.amountCents);
    const recurringRunRateCents = sumCents(activeSubscriptions, (subscription) => subscription.amountCents);
    const openArCents = sumCents(openInvoices, invoiceBalanceCents);
    const currentMonthRevenueCents = sumCents(currentMonthInvoices, (invoice) => invoice.totalAmountCents);
    const currentMonthCashCents = sumCents(currentMonthPayments, (payment) => payment.amountCents);
    const currentMonthSpendCents = sumCents(currentMonthPurchases, purchaseAmountCents);
    const documentedPurchaseCents = sumCents(nonReturnedPurchases.filter(hasSourceDocument), purchaseAmountCents);

    return {
      acceptedAgreementCount: acceptedAgreements.length,
      activeSubscriptionCount: activeSubscriptions.length,
      agingBuckets,
      appPaymentCents: sumCents(appPayments, (payment) => payment.amountCents),
      billableUninvoicedPurchases,
      billableUninvoicedCents: sumCents(billableUninvoicedPurchases, purchaseAmountCents),
      currentMonthCashCents,
      currentMonthRevenueCents,
      currentMonthSpendCents,
      documentedPurchaseRate: purchaseSpendCents ? documentedPurchaseCents / purchaseSpendCents : 1,
      eligibleInvoices,
      invoiceTaxCents,
      manualPaymentCents: sumCents(manualPayments, (payment) => payment.amountCents),
      missingReceiptPurchases,
      openArCents,
      openInvoices,
      openNotes,
      overdueInvoiceCount: overdueInvoices.length,
      overdueInvoiceCents: sumCents(overdueInvoices, invoiceBalanceCents),
      paymentMethods: groupCents(postedPayments, (payment) => labelize(payment.method), (payment) => payment.amountCents, "Unknown"),
      postedPaymentCents,
      purchaseCategorySpend: groupCents(nonReturnedPurchases, (purchase) => purchase.category || "Uncategorized", purchaseAmountCents),
      purchaseReviewQueue,
      purchaseSpendCents,
      purchaseTaxesCents,
      recurringRunRateCents,
      taxableRevenueCents,
      unreconciledPaymentCount: unreconciledPayments.length,
      unreconciledPaymentCents: sumCents(unreconciledPayments, (payment) => payment.amountCents),
      unreconciledPayments,
      vendorSpend: groupCents(nonReturnedPurchases, purchaseVendorName, purchaseAmountCents, "Vendor"),
    };
  }, [agreements, invoices, notes, payments, purchases, subscriptions]);

  const reconciliationQueue = useMemo(
    () => sortByFreshest(accounting.unreconciledPayments).slice(0, 12),
    [accounting.unreconciledPayments]
  );

  const arQueue = useMemo(
    () => [...accounting.openInvoices].sort((left, right) => toMillis(left.dueDate) - toMillis(right.dueDate)).slice(0, 12),
    [accounting.openInvoices]
  );

  const expenseQueue = useMemo(
    () => sortByFreshest(accounting.purchaseReviewQueue).slice(0, 10),
    [accounting.purchaseReviewQueue]
  );

  const recentAppPayments = useMemo(
    () => sortByFreshest(payments.filter((payment) => isPostedPayment(payment) && isAppPayment(payment))).slice(0, 8),
    [payments]
  );

  const taxRows = useMemo(() => {
    const taxableInvoices = invoices.filter((invoice) => Number(invoice.taxAmountCents || 0) > 0);
    return sortByFreshest(taxableInvoices).slice(0, 8);
  }, [invoices]);

  const documentExceptions = useMemo(() => {
    const missingReceiptRows = accounting.missingReceiptPurchases.slice(0, 6).map((purchase) => ({
      id: `purchase-${purchase.id}`,
      type: "Purchase",
      label: purchase.name || purchase.invoiceNum || purchase.id,
      detail: purchaseVendorName(purchase),
      amountCents: purchaseAmountCents(purchase),
      date: purchaseDate(purchase),
      link: `/company/purchased-items/detail/${purchase.id}`,
      issue: "Missing source document",
    }));
    const invoiceRows = accounting.openInvoices
      .filter((invoice) => !invoice.dueDate || !invoice.customerName)
      .slice(0, 4)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        type: "Invoice",
        label: invoice.invoiceNumber || invoice.id,
        detail: invoice.customerName || invoice.email || "Customer missing",
        amountCents: invoiceBalanceCents(invoice),
        date: invoice.dueDate || invoice.createdAt,
        link: `/company/sales/invoices/${invoice.id}`,
        issue: !invoice.dueDate ? "Missing due date" : "Missing customer name",
      }));

    return [...missingReceiptRows, ...invoiceRows].slice(0, 10);
  }, [accounting.missingReceiptPurchases, accounting.openInvoices]);

  const closeChecklist = useMemo(() => ([
    {
      label: "Bank reconciliation",
      value: `${accounting.unreconciledPaymentCount} unreconciled`,
      status: accounting.unreconciledPaymentCount === 0 ? "Clear" : "Review",
      tone: accounting.unreconciledPaymentCount === 0 ? "emerald" : "rose",
    },
    {
      label: "Accounts receivable",
      value: formatCurrency(accounting.overdueInvoiceCents),
      status: accounting.overdueInvoiceCount === 0 ? "Current" : `${accounting.overdueInvoiceCount} overdue`,
      tone: accounting.overdueInvoiceCount === 0 ? "emerald" : "amber",
    },
    {
      label: "Billable expenses",
      value: formatCurrency(accounting.billableUninvoicedCents),
      status: accounting.billableUninvoicedPurchases.length === 0 ? "Clear" : "Uninvoiced",
      tone: accounting.billableUninvoicedPurchases.length === 0 ? "emerald" : "amber",
    },
    {
      label: "Source documents",
      value: `${accounting.missingReceiptPurchases.length} missing`,
      status: formatPercent(accounting.documentedPurchaseRate),
      tone: accounting.missingReceiptPurchases.length === 0 ? "emerald" : "amber",
    },
    {
      label: "Tax review",
      value: formatCurrency(accounting.invoiceTaxCents),
      status: accounting.invoiceTaxCents > 0 ? "Collected" : "No tax",
      tone: accounting.invoiceTaxCents > 0 ? "emerald" : "slate",
    },
    {
      label: "Open accountant notes",
      value: accounting.openNotes.length,
      status: accounting.openNotes.length === 0 ? "Clear" : "Open",
      tone: accounting.openNotes.length === 0 ? "emerald" : "amber",
    },
  ]), [accounting]);

  const verifyStripeReadiness = useCallback(async ({ showToast = true } = {}) => {
    if (!stripeConnectedAccountId || !recentlySelectedCompany) {
      setStripeReadiness(null);
      return;
    }

    setStripeReadinessLoading(true);
    try {
      const verifyCallable = httpsCallable(functions, "verifyConnectedAccountBillingReadiness");
      const result = await verifyCallable({
        connectedAccount: stripeConnectedAccountId,
        stripeConnectedAccountId,
        companyId: recentlySelectedCompany,
      });
      setStripeReadiness(result.data);
      if (showToast) toast.success("Stripe account checked.");
    } catch (error) {
      console.error("Unable to verify Stripe account", error);
      if (showToast) toast.error(error.message || "Unable to verify Stripe account.");
    } finally {
      setStripeReadinessLoading(false);
    }
  }, [recentlySelectedCompany, stripeConnectedAccountId]);

  useEffect(() => {
    if (!recentlySelectedCompany || !stripeConnectedAccountId) {
      setStripeReadiness(null);
      return;
    }

    verifyStripeReadiness({ showToast: false });
  }, [recentlySelectedCompany, stripeConnectedAccountId, verifyStripeReadiness]);

  const markPaymentReconciled = async (payment) => {
    setReconcilingPaymentId(payment.id);
    try {
      await updateDoc(doc(db, salesCollectionNames.payments, payment.id), {
        accountingStatus: "reconciled",
        reconciledAt: serverTimestamp(),
        reconciledByUserId: user?.uid || "",
        updatedAt: serverTimestamp(),
      });
      toast.success("Payment marked reconciled.");
    } catch (error) {
      console.error("Unable to reconcile payment", error);
      toast.error(error.message || "Unable to reconcile payment.");
    } finally {
      setReconcilingPaymentId("");
    }
  };

  const saveNote = async (event) => {
    event.preventDefault();
    if (!recentlySelectedCompany || savingNote) return;

    const body = noteDraft.body.trim();
    const title = noteDraft.title.trim();
    if (!body && !title) {
      toast.error("Add a note before saving.");
      return;
    }

    setSavingNote(true);
    try {
      await addDoc(collection(db, "companies", recentlySelectedCompany, "accountingNotes"), {
        title,
        body,
        priority: noteDraft.priority,
        status: "open",
        createdAt: serverTimestamp(),
        createdByUserId: user?.uid || "",
        createdByName: user?.displayName || user?.email || "",
        updatedAt: serverTimestamp(),
      });
      setNoteDraft({ title: "", body: "", priority: "normal" });
      toast.success("Accounting note saved.");
    } catch (error) {
      console.error("Unable to save accounting note", error);
      toast.error(error.message || "Unable to save accounting note.");
    } finally {
      setSavingNote(false);
    }
  };

  const resolveNote = async (note) => {
    if (!recentlySelectedCompany) return;

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "accountingNotes", note.id), {
        status: "resolved",
        resolvedAt: serverTimestamp(),
        resolvedByUserId: user?.uid || "",
        updatedAt: serverTimestamp(),
      });
      toast.success("Note resolved.");
    } catch (error) {
      console.error("Unable to resolve accounting note", error);
      toast.error(error.message || "Unable to resolve accounting note.");
    }
  };

  if (!recentlySelectedCompany) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-6">
        <Panel className="max-w-md p-6 text-center">
          <h1 className="text-xl font-bold text-slate-950">Select a company</h1>
          <p className="mt-2 text-sm text-slate-500">Accounting opens after a company is selected.</p>
          <Link to="/company/selection" className="mt-5 inline-flex rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            Choose Company
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="theme-page min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-[#083528] text-white lg:flex">
        <div className="border-b border-white/10 px-4 py-4">
          <Link to="/company/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-50/80 hover:text-white">
            <FaArrowLeft className="h-4 w-4" />
            Return to Company View
          </Link>
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-200">Accounting</p>
            <h1 className="mt-1 text-xl font-bold">Finance Review</h1>
            <p className="mt-1 truncate text-sm text-emerald-50/70">{recentlySelectedCompanyName || "Selected Company"}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          <NavButton href="#overview" icon={FaLandmark} label="Overview" />
          <NavButton href="#reconciliation" icon={FaClipboardCheck} label="Reconciliation" />
          <NavButton href="#receivables" icon={FaFileInvoiceDollar} label="AR Aging" />
          <NavButton href="#expenses" icon={FaReceipt} label="AP & Expenses" />
          <NavButton href="#payouts" icon={FaMoneyBillTransfer} label="Stripe" />
          <NavButton href="#tax" icon={FaScaleBalanced} label="Tax" />
          <NavButton href="#documents" icon={FaBuildingColumns} label="Documents" />
          <NavButton href="#close" icon={FaCheck} label="Close" />
          <NavButton href="#notes" icon={FaBook} label="Notes" />
        </nav>
        <div className="border-t border-white/10 p-3">
          <Link to="/company/sales" className="flex items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50">
            <FaFileInvoiceDollar className="h-4 w-4" />
            Sales Billing
          </Link>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-800/20 bg-[#0b4938] px-4 py-3 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-100">Accountant View</p>
              <h2 className="truncate text-lg font-bold">{recentlySelectedCompanyName || "Company Finance"}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-white/10 transition hover:bg-white/20"
                aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDarkMode ? <FaSun className="h-4 w-4" /> : <FaMoon className="h-4 w-4" />}
              </button>
              <Link to="/company/dashboard" className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20">
                Return to Company View
              </Link>
              <Link to="/company/sales/invoices" className="rounded-md bg-white px-3 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50">
                Invoices
              </Link>
            </div>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm font-semibold text-emerald-50/80 lg:hidden">
            <NavButton href="#overview" icon={FaLandmark} label="Overview" />
            <NavButton href="#reconciliation" icon={FaClipboardCheck} label="Reconcile" />
            <NavButton href="#receivables" icon={FaFileInvoiceDollar} label="AR" />
            <NavButton href="#expenses" icon={FaReceipt} label="Expenses" />
            <NavButton href="#payouts" icon={FaMoneyBillTransfer} label="Stripe" />
            <NavButton href="#tax" icon={FaScaleBalanced} label="Tax" />
            <NavButton href="#documents" icon={FaBuildingColumns} label="Docs" />
            <NavButton href="#close" icon={FaCheck} label="Close" />
            <NavButton href="#notes" icon={FaBook} label="Notes" />
          </nav>
        </header>

        <main className="space-y-7 px-4 py-5 sm:px-6 lg:px-8">
          <section id="overview" className="space-y-4">
            <Panel className="p-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Accounting Workspace</p>
                  <h1 className="mt-1 text-2xl font-bold text-slate-950">Review, reconcile, and close</h1>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <StatusPill tone="slate">{loading ? "Syncing" : "Current"}</StatusPill>
                  <StatusPill tone="emerald">{accounting.activeSubscriptionCount} active subscriptions</StatusPill>
                  <StatusPill tone="slate">{accounting.acceptedAgreementCount} accepted agreements</StatusPill>
                </div>
              </div>
            </Panel>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Cash received" value={formatCurrency(accounting.postedPaymentCents)} helper={`${formatCurrency(accounting.currentMonthCashCents)} this month`} tone="emerald" />
              <MetricCard label="Open AR" value={formatCurrency(accounting.openArCents)} helper={`${accounting.overdueInvoiceCount} overdue`} tone={accounting.overdueInvoiceCount ? "amber" : "emerald"} />
              <MetricCard label="Unreconciled" value={formatCurrency(accounting.unreconciledPaymentCents)} helper={`${accounting.unreconciledPaymentCount} payments`} tone={accounting.unreconciledPaymentCount ? "rose" : "emerald"} />
              <MetricCard label="Purchase spend" value={formatCurrency(accounting.purchaseSpendCents)} helper={`${formatCurrency(accounting.currentMonthSpendCents)} this month`} />
              <MetricCard label="Revenue booked" value={formatCurrency(accounting.currentMonthRevenueCents)} helper="Current month invoices" />
              <MetricCard label="Tax collected" value={formatCurrency(accounting.invoiceTaxCents)} helper={`${formatCurrency(accounting.taxableRevenueCents)} taxable base`} tone="emerald" />
              <MetricCard label="Billable not invoiced" value={formatCurrency(accounting.billableUninvoicedCents)} helper={`${accounting.billableUninvoicedPurchases.length} purchases`} tone={accounting.billableUninvoicedPurchases.length ? "amber" : "emerald"} />
              <MetricCard label="Open notes" value={accounting.openNotes.length} helper="Accountant follow-ups" tone={accounting.openNotes.length ? "amber" : "emerald"} />
            </div>
          </section>

          <section id="reconciliation" className="space-y-4">
            <SectionHeader
              eyebrow="Reconciliation"
              title="Payment Queue"
              action={<Link to="/company/sales/payments" className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Payment History</Link>}
            />
            <div className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
              <Panel className="overflow-hidden">
                {reconciliationQueue.length === 0 ? (
                  <EmptyState title="No unreconciled posted payments." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Customer</th>
                          <th className="px-4 py-3">Method</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                          <th className="px-4 py-3">Received</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reconciliationQueue.map((payment) => (
                          <tr key={payment.id} className="align-top hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="font-bold text-slate-950">{payment.customerName || payment.email || "Customer"}</p>
                              <p className="text-xs text-slate-500">{payment.invoiceId || payment.referenceNumber || payment.id}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{labelize(payment.method)}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-950">{formatCurrency(payment.amountCents)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatDate(payment.receivedAt || payment.createdAt)}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => markPaymentReconciled(payment)}
                                disabled={reconcilingPaymentId === payment.id}
                                className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {reconcilingPaymentId === payment.id ? <FaCircleNotch className="h-3 w-3 animate-spin" /> : <FaCheck className="h-3 w-3" />}
                                Reconciled
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel className="p-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Payment method totals</h3>
                <div className="mt-3 divide-y divide-slate-100">
                  {accounting.paymentMethods.slice(0, 6).map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="font-semibold text-slate-700">{row.label}</span>
                      <span className="font-bold text-slate-950">{formatCurrency(row.amountCents)}</span>
                    </div>
                  ))}
                  {accounting.paymentMethods.length === 0 && <EmptyState title="No posted payments." />}
                </div>
              </Panel>
            </div>
          </section>

          <section id="receivables" className="space-y-4">
            <SectionHeader
              eyebrow="Accounts Receivable"
              title="AR Aging and Open Invoices"
              action={<Link to="/company/sales/invoices" className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Invoice List</Link>}
            />
            <div className="grid gap-4 xl:grid-cols-[0.8fr_1.5fr]">
              <Panel className="p-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Aging</h3>
                <div className="mt-3 divide-y divide-slate-100">
                  {accounting.agingBuckets.map((bucket) => (
                    <div key={bucket.bucket} className="grid grid-cols-[1fr_auto_auto] gap-3 py-3 text-sm">
                      <span className="font-bold text-slate-950">{bucket.bucket}</span>
                      <span className="text-slate-500">{bucket.count}</span>
                      <span className="font-bold text-slate-950">{formatCurrency(bucket.amountCents)}</span>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel className="overflow-hidden">
                {arQueue.length === 0 ? (
                  <EmptyState title="No open invoices." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Invoice</th>
                          <th className="px-4 py-3">Customer</th>
                          <th className="px-4 py-3">Due</th>
                          <th className="px-4 py-3 text-right">Balance</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {arQueue.map((invoice) => {
                          const lateDays = daysPastDue(invoice.dueDate);
                          return (
                            <tr key={invoice.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <Link to={`/company/sales/invoices/${invoice.id}`} className="font-bold text-emerald-700 hover:text-emerald-800">
                                  {invoice.invoiceNumber || invoice.id}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-slate-700">{invoice.customerName || invoice.email || "Customer"}</td>
                              <td className="px-4 py-3 text-slate-700">{formatDate(invoice.dueDate)}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-950">{formatCurrency(invoiceBalanceCents(invoice))}</td>
                              <td className="px-4 py-3">
                                <StatusPill tone={lateDays > 0 ? "amber" : "slate"}>
                                  {lateDays > 0 ? `${lateDays}d overdue` : labelize(invoice.status)}
                                </StatusPill>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </section>

          <section id="expenses" className="space-y-4">
            <SectionHeader
              eyebrow="AP and Expenses"
              title="Purchases, Vendors, and Expense Review"
              action={<Link to="/company/purchased-items" className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Purchased Items</Link>}
            />
            <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
              <Panel className="overflow-hidden">
                {expenseQueue.length === 0 ? (
                  <EmptyState title="No purchase review exceptions." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Item</th>
                          <th className="px-4 py-3">Vendor</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Amount</th>
                          <th className="px-4 py-3">Document</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {expenseQueue.map((purchase) => (
                          <tr key={purchase.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <Link to={`/company/purchased-items/detail/${purchase.id}`} className="font-bold text-emerald-700 hover:text-emerald-800">
                                {purchase.name || purchase.invoiceNum || purchase.id}
                              </Link>
                              <p className="text-xs text-slate-500">{formatDate(purchaseDate(purchase))}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{purchaseVendorName(purchase)}</td>
                            <td className="px-4 py-3 text-slate-700">{purchase.category || "Uncategorized"}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-950">{formatCurrency(purchaseAmountCents(purchase))}</td>
                            <td className="px-4 py-3">
                              <StatusPill tone={hasSourceDocument(purchase) ? "emerald" : "amber"}>
                                {hasSourceDocument(purchase) ? "Attached" : "Missing"}
                              </StatusPill>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <div className="grid gap-4">
                <Panel className="p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Top vendors</h3>
                  <div className="mt-3 divide-y divide-slate-100">
                    {accounting.vendorSpend.slice(0, 5).map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate font-semibold text-slate-700">{row.label}</span>
                        <span className="font-bold text-slate-950">{formatCurrency(row.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel className="p-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Spend categories</h3>
                  <div className="mt-3 divide-y divide-slate-100">
                    {accounting.purchaseCategorySpend.slice(0, 5).map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate font-semibold text-slate-700">{row.label}</span>
                        <span className="font-bold text-slate-950">{formatCurrency(row.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          </section>

          <section id="payouts" className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
            <Panel className="p-5">
              <SectionHeader
                eyebrow="Stripe"
                title="Connected Account Snapshot"
                action={
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to="/company/settings/stripe-billing"
                      className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      Billing Snapshot
                    </Link>
                    <button
                      type="button"
                      onClick={() => verifyStripeReadiness()}
                      disabled={!stripeConnectedAccountId || stripeReadinessLoading}
                      className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {stripeReadinessLoading ? "Checking" : "Refresh Stripe"}
                    </button>
                  </div>
                }
              />
              <dl className="mt-5 space-y-3 text-sm">
                <StripeInfoRow label="Connected Account" value={stripeReadiness?.accountId || stripeConnectedAccountId || "Not connected"} />
                <StripeInfoRow
                  label="Mode"
                  value={stripeReadiness ? (stripeReadiness.livemode ? "Live" : "Test") : "Unchecked"}
                  status={stripeReadiness ? (stripeReadiness.livemode ? "Live mode" : "Test mode") : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.livemode) : "slate"}
                />
                <StripeInfoRow
                  label="Live Billing"
                  value={stripeReadiness ? readinessText(stripeReadiness.canRunLiveBilling, "Ready", "Not ready") : "Unchecked"}
                  status={stripeReadiness ? (stripeReadiness.canRunLiveBilling ? "Ready" : "Review") : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.canRunLiveBilling) : "slate"}
                />
                <StripeInfoRow
                  label="Charges"
                  value={stripeReadiness ? readinessText(stripeReadiness.chargesEnabled, "Enabled", "Disabled") : "Unchecked"}
                  status={stripeReadiness ? (stripeReadiness.chargesEnabled ? "OK" : "Needs setup") : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.chargesEnabled) : "slate"}
                />
                <StripeInfoRow
                  label="Card Payments"
                  value={stripeReadiness ? readinessText(stripeReadiness.cardPaymentsEnabled, "Enabled", "Pending") : "Unchecked"}
                  status={stripeReadiness?.capabilities?.cardPayments ? labelize(stripeReadiness.capabilities.cardPayments) : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.cardPaymentsEnabled) : "slate"}
                />
                <StripeInfoRow
                  label="Payouts"
                  value={stripeReadiness ? readinessText(stripeReadiness.payoutsEnabled, "Enabled", "Pending") : "Unchecked"}
                  status={stripeReadiness ? (stripeReadiness.payoutsEnabled ? "OK" : "Needs setup") : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.payoutsEnabled) : "slate"}
                />
                <StripeInfoRow
                  label="Transfers"
                  value={stripeReadiness ? readinessText(stripeReadiness.transfersEnabled, "Enabled", "Pending") : "Unchecked"}
                  status={stripeReadiness?.capabilities?.transfers ? labelize(stripeReadiness.capabilities.transfers) : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.transfersEnabled) : "slate"}
                />
                <StripeInfoRow
                  label="Onboarding"
                  value={stripeReadiness ? readinessText(stripeReadiness.detailsSubmitted, "Submitted", "Incomplete") : "Unchecked"}
                  status={stripeReadiness ? (stripeReadiness.detailsSubmitted ? "Submitted" : "Needs owner") : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.detailsSubmitted) : "slate"}
                />
                <StripeInfoRow
                  label="Webhook Secret"
                  value={stripeReadiness ? readinessText(stripeReadiness.platform?.webhookSigningSecretConfigured, "Configured", "Missing") : "Unchecked"}
                  status={stripeReadiness ? (stripeReadiness.platform?.webhookSigningSecretConfigured ? "Sync ready" : "Required") : ""}
                  tone={stripeReadiness ? readinessTone(stripeReadiness.platform?.webhookSigningSecretConfigured) : "slate"}
                />
                <StripeInfoRow
                  label="Platform Fee"
                  value={stripeReadiness?.platform?.applicationFeePercent ? `${stripeReadiness.platform.applicationFeePercent}%` : "Rail based"}
                  status={stripeReadiness?.platform?.applicationFeeSource ? labelize(stripeReadiness.platform.applicationFeeSource) : "Card/ACH"}
                />
                <StripeInfoRow label="Default Currency" value={String(stripeReadiness?.defaultCurrency || "usd").toUpperCase()} />
                <StripeInfoRow label="Country" value={stripeReadiness?.country || "US"} />
                <StripeInfoRow label="Business Type" value={labelize(stripeReadiness?.businessType || "")} />
                <StripeInfoRow label="Business Name" value={stripeReadiness?.businessProfile?.name || stripeReadiness?.dashboard?.displayName || ""} />
                <StripeInfoRow label="Stripe Email" value={stripeReadiness?.email || ""} />
                <StripeInfoRow
                  label="Payout Schedule"
                  value={stripeReadiness?.payoutsSchedule?.interval
                    ? labelize(stripeReadiness.payoutsSchedule.interval)
                    : "Not returned"}
                  status={stripeReadiness?.payoutsSchedule?.delayDays !== "" ? `${stripeReadiness.payoutsSchedule.delayDays} day delay` : ""}
                />
              </dl>

              {stripeReadiness?.disabledReason && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-bold">Stripe disabled reason</p>
                  <p className="mt-1">{labelize(stripeReadiness.disabledReason)}</p>
                </div>
              )}

              <div className="mt-4 space-y-3">
                <StripeRequirementList title="Currently Due" items={stripeReadiness?.currentlyDue || []} />
                <StripeRequirementList title="Past Due" items={stripeReadiness?.pastDue || []} tone="rose" />
                <StripeRequirementList title="Pending Verification" items={stripeReadiness?.pendingVerification || []} tone="slate" />
                <StripeRequirementList title="Future Requirements" items={stripeReadiness?.futureRequirements?.currentlyDue || []} tone="slate" />
                <StripeRequirementList title="Errors" items={stripeReadiness?.errors || []} tone="rose" />
              </div>

              {!stripeConnectedAccountId && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  This company does not have a Stripe connected account saved yet.
                </div>
              )}
            </Panel>

            <Panel className="p-5">
              <SectionHeader eyebrow="Payout Activity" title="App-Collected Payments" />
              {recentAppPayments.length === 0 ? (
                <div className="mt-5">
                  <EmptyState title="No app-collected posted payments yet." />
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Customer</th>
                        <th className="px-3 py-2">Method</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentAppPayments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-950">{payment.customerName || payment.email || "Customer"}</td>
                          <td className="px-3 py-2 text-slate-700">{labelize(payment.method)}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-950">{formatCurrency(payment.amountCents)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatDate(payment.receivedAt || payment.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>

          <section id="tax" className="grid gap-4 xl:grid-cols-[0.8fr_1.4fr]">
            <Panel className="p-5">
              <SectionHeader eyebrow="Tax" title="Tax Position" />
              <div className="mt-5 divide-y divide-slate-100 text-sm">
                <ReviewRow label="Revenue tax collected" value={formatCurrency(accounting.invoiceTaxCents)} status="Collected" tone="emerald" />
                <ReviewRow label="Taxable revenue base" value={formatCurrency(accounting.taxableRevenueCents)} status="Sales" />
                <ReviewRow label="Purchase tax tracked" value={formatCurrency(accounting.purchaseTaxesCents)} status="Purchases" />
                <ReviewRow label="Effective tax rate" value={accounting.taxableRevenueCents ? formatPercent(accounting.invoiceTaxCents / accounting.taxableRevenueCents) : "0%"} status="Estimate" />
              </div>
            </Panel>

            <Panel className="p-5">
              <SectionHeader
                eyebrow="Tax Review"
                title="Taxed Invoices"
                action={<Link to="/company/reports" className="rounded-md border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Reports</Link>}
              />
              {taxRows.length === 0 ? (
                <div className="mt-5">
                  <EmptyState title="No invoices with tax collected." />
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Invoice</th>
                        <th className="px-3 py-2">Customer</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Tax</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {taxRows.map((invoice) => (
                        <tr key={invoice.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <Link to={`/company/sales/invoices/${invoice.id}`} className="font-bold text-emerald-700 hover:text-emerald-800">
                              {invoice.invoiceNumber || invoice.id}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{invoice.customerName || invoice.email || "Customer"}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-950">{formatCurrency(invoice.totalAmountCents)}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">{formatCurrency(invoice.taxAmountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>

          <section id="documents" className="space-y-4">
            <SectionHeader
              eyebrow="Source Documents"
              title="Receipts, Invoice Details, and Audit Trail"
              action={<Link to="/company/receipts" className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Receipts</Link>}
            />
            <Panel className="overflow-hidden">
              {documentExceptions.length === 0 ? (
                <EmptyState title="No document exceptions found." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Record</th>
                        <th className="px-4 py-3">Issue</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {documentExceptions.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <Link to={row.link} className="font-bold text-emerald-700 hover:text-emerald-800">{row.label}</Link>
                            <p className="text-xs text-slate-500">{row.type} - {row.detail}</p>
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill tone="amber">{row.issue}</StatusPill>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{formatDate(row.date)}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-950">{formatCurrency(row.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>

          <section id="close" className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Panel className="p-5">
              <SectionHeader eyebrow="Month Close" title="Close Checklist" />
              <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
                {closeChecklist.map((item) => (
                  <ReviewRow key={item.label} label={item.label} value={item.value} status={item.status} tone={item.tone} />
                ))}
              </div>
            </Panel>

            <Panel className="p-5">
              <SectionHeader
                eyebrow="Report Links"
                title="Workpapers"
                action={<Link to="/company/reports" className="rounded-md border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Open Reports</Link>}
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Link to="/company/sales/invoices" className="rounded-md border border-slate-200 bg-slate-50 p-4 hover:border-emerald-300">
                  <p className="font-bold text-slate-950">Invoice Register</p>
                  <p className="mt-1 text-sm text-slate-500">{accounting.eligibleInvoices.length} invoices</p>
                </Link>
                <Link to="/company/sales/payments" className="rounded-md border border-slate-200 bg-slate-50 p-4 hover:border-emerald-300">
                  <p className="font-bold text-slate-950">Payment Register</p>
                  <p className="mt-1 text-sm text-slate-500">{payments.filter(isPostedPayment).length} posted payments</p>
                </Link>
                <Link to="/company/purchased-items" className="rounded-md border border-slate-200 bg-slate-50 p-4 hover:border-emerald-300">
                  <p className="font-bold text-slate-950">Purchase Detail</p>
                  <p className="mt-1 text-sm text-slate-500">{purchases.length} purchased items</p>
                </Link>
                <Link to="/company/receipts" className="rounded-md border border-slate-200 bg-slate-50 p-4 hover:border-emerald-300">
                  <p className="font-bold text-slate-950">Receipt File</p>
                  <p className="mt-1 text-sm text-slate-500">{accounting.missingReceiptPurchases.length} missing documents</p>
                </Link>
              </div>
            </Panel>
          </section>

          <section id="notes" className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel className="p-5">
              <SectionHeader eyebrow="Notes" title="Accountant Notes" />
              <form onSubmit={saveNote} className="mt-5 space-y-3">
                <input
                  type="text"
                  value={noteDraft.title}
                  onChange={(event) => setNoteDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Title"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <textarea
                  value={noteDraft.body}
                  onChange={(event) => setNoteDraft((current) => ({ ...current, body: event.target.value }))}
                  placeholder="Note"
                  rows={5}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <select
                    value={noteDraft.priority}
                    onChange={(event) => setNoteDraft((current) => ({ ...current, priority: event.target.value }))}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="tax">Tax</option>
                    <option value="reconciliation">Reconciliation</option>
                    <option value="documents">Documents</option>
                    <option value="close">Close</option>
                  </select>
                  <button
                    type="submit"
                    disabled={savingNote}
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingNote ? "Saving" : "Save Note"}
                  </button>
                </div>
              </form>
            </Panel>

            <Panel className="p-5">
              <SectionHeader eyebrow="Ledger Trail" title="Recent Notes" />
              <div className="mt-5 space-y-3">
                {notes.length === 0 ? (
                  <EmptyState title="No accounting notes saved." />
                ) : (
                  notes.map((note) => {
                    const resolved = normalizeStatus(note.status) === "resolved";
                    return (
                      <article key={note.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-bold text-slate-950">{note.title || labelize(note.priority)}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{note.body}</p>
                            <p className="mt-3 text-xs font-semibold text-slate-500">{formatDate(note.createdAt)} - {labelize(note.priority)}</p>
                          </div>
                          {!resolved && (
                            <button
                              type="button"
                              onClick={() => resolveNote(note)}
                              className="rounded-md border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                            >
                              Resolve
                            </button>
                          )}
                          {resolved && <StatusPill tone="emerald">Resolved</StatusPill>}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </Panel>
          </section>
        </main>
      </div>
    </div>
  );
};

export default CompanyAccountingWorkspace;
