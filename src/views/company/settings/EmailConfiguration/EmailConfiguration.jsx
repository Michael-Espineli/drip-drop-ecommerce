import React, { useState, useEffect, useContext, useMemo } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  FaBriefcase,
  FaClipboardList,
  FaEnvelope,
  FaFileInvoiceDollar,
  FaQuestionCircle,
  FaRedoAlt,
  FaSave,
  FaUserFriends,
} from "react-icons/fa";
import { Context } from "../../../../context/AuthContext";
import { db } from "../../../../utils/config";
import { Customer } from "../../../../utils/models/Customer";
import {
  query,
  collection,
  getDocs,
  doc,
  orderBy,
  getDoc,
  where,
  setDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

const DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID = "d-a987a065df0e43378dafd14c1b7ee419";
const DEFAULT_JOB_ESTIMATE_TEMPLATE_ID = "d-566087cd96864db0a07167e8a080cc12";
const DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID = "d-866f4368544048aeabf108413f8b8c52";

const serviceStopEmailBuckets = [
  {
    id: "route",
    label: "Route",
    categoryKey: "Route",
    sourceId: "system_recurring_service_stop",
    helper: "Recurring route stops and standard pool route visits.",
    Icon: FaRedoAlt,
  },
  {
    id: "job",
    label: "Job",
    categoryKey: "Job",
    sourceId: "system_job_service_stop",
    helper: "Service stops attached to active job work.",
    Icon: FaBriefcase,
  },
  {
    id: "jobEstimate",
    label: "Job Estimate",
    categoryKey: "Job Estimate",
    sourceId: "system_job_estimate_service_stop",
    helper: "Estimate visits tied to requested job work.",
    Icon: FaFileInvoiceDollar,
  },
  {
    id: "serviceAgreementEstimate",
    label: "Service Agreement Estimate",
    categoryKey: "Service Agreement Estimate",
    sourceId: "system_service_agreement_estimate_service_stop",
    helper: "Fact-finding visits before recurring service agreements.",
    Icon: FaClipboardList,
  },
  {
    id: "customerRelationship",
    label: "Customer Relationship",
    categoryKey: "Customer Relationship",
    sourceId: "system_customer_relationship_service_stop",
    helper: "Follow-ups, courtesy visits, corrections, and open-ended customer stops.",
    Icon: FaUserFriends,
  },
  {
    id: "unknown",
    label: "Unknown Service Stop",
    categoryKey: "Unknown Service Stop",
    fallbackCategoryKey: "Customer Relationship",
    sourceId: "system_unknown_service_stop",
    helper: "Fallback when a stop cannot be matched to a known bucket.",
    Icon: FaQuestionCircle,
  },
];

const billingEmailTypes = [
  {
    id: "salesInvoice",
    label: "Sales Invoice",
    helper: "Current sales invoice email sent from sales billing and part approval workflows.",
    callableName: "sendSalesInvoiceEmail",
    Icon: FaFileInvoiceDollar,
  },
  {
    id: "paymentConfirmation",
    label: "Payment Confirmation",
    helper: "Receipt-style confirmation after an invoice payment is recorded.",
    callableName: "sendPaymentConfirmationEmail",
    Icon: FaEnvelope,
  },
];

const defaultServiceStopCategoryEmailSettings = (companyName = "your pool company") => ({
  Route: {
    category: "Route",
    emailSubject: `${companyName} Service Report`,
    emailBody: `Thank you for letting ${companyName} service your pool. Here is a summary of today's visit.`,
    emailFooter: "Please contact us with any questions.",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
  },
  Job: {
    category: "Job",
    emailSubject: `${companyName} Job Visit Summary`,
    emailBody: `Thank you for choosing ${companyName}. Here is a summary of the work completed during this visit.`,
    emailFooter: "Please contact us with any questions.",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
  },
  "Job Estimate": {
    category: "Job Estimate",
    emailSubject: `${companyName} Estimate Visit Recap`,
    emailBody: `Thank you for meeting with ${companyName}. Here is a recap of the information gathered for your estimate.`,
    emailFooter: "Please contact us with any questions.",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    sendGridTemplateId: DEFAULT_JOB_ESTIMATE_TEMPLATE_ID,
  },
  "Service Agreement Estimate": {
    category: "Service Agreement Estimate",
    emailSubject: `${companyName} Service Agreement Visit Recap`,
    emailBody: `Thank you for considering ${companyName} for recurring service. Here is a recap of the service location information we gathered.`,
    emailFooter: "Please contact us with any questions.",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    sendGridTemplateId: DEFAULT_SERVICE_AGREEMENT_TEMPLATE_ID,
  },
  "Customer Relationship": {
    category: "Customer Relationship",
    emailSubject: `${companyName} Visit Recap`,
    emailBody: `Thank you for taking the time to meet with ${companyName}. Here is a recap of the visit and any follow-up notes.`,
    emailFooter: "Please contact us with any questions.",
    sendEmailOnFinish: false,
    requirePhotoOnFinish: false,
    sendGridTemplateId: DEFAULT_SERVICE_STOP_REPORT_TEMPLATE_ID,
  },
});

const enabledLabel = (enabled) => (enabled ? "Enabled" : "Disabled");

const statusTone = (enabled) =>
  enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600";

const customerEmailConfigurationRef = (companyId) =>
  collection(db, "companies", companyId, "settings", "emailConfiguration", "customerConfiguration");

const emailConfigurationRef = (companyId) => doc(db, "companies", companyId, "settings", "emailConfiguration");

const resolveEditableCategoryKey = (bucket) => bucket.fallbackCategoryKey || bucket.categoryKey;

const chunkArray = (items, size) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const textareaClass =
  "mt-1 w-full resize-y rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const summaryToneClassNames = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

const SummaryCard = ({ label, value, helper, tone = "slate" }) => (
  <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${summaryToneClassNames[tone]}`}>
      {label}
    </div>
    <p className="mt-3 text-2xl font-bold text-slate-950">{value}</p>
    <p className="mt-1 text-sm text-slate-500">{helper}</p>
  </section>
);

const EmailTypeCard = ({ icon: Icon, title, subtitle, status, helper, onClick, selected }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full border-l-4 px-5 py-4 text-left transition hover:bg-slate-50 ${
      selected ? "border-l-blue-600 bg-blue-50/70" : "border-l-transparent bg-white"
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          {helper && <p className="mt-2 text-xs text-slate-500">{helper}</p>}
        </div>
      </div>
      {status && (
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(status.enabled)}`}>
          {status.label}
        </span>
      )}
    </div>
  </button>
);

export default function EmailConfiguration() {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const defaultCategorySettings = useMemo(
    () => defaultServiceStopCategoryEmailSettings(recentlySelectedCompanyName || "your pool company"),
    [recentlySelectedCompanyName]
  );

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [savingCategoryKey, setSavingCategoryKey] = useState("");
  const [savingCustomerId, setSavingCustomerId] = useState("");

  const [emailConfig, setEmailConfig] = useState(null);
  const [emailIsOn, setEmailIsOn] = useState(false);
  const [emailBody, setEmailBody] = useState("");
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [serviceStopCategorySettings, setServiceStopCategorySettings] = useState({});
  const [customerConfigList, setCustomerConfigList] = useState([]);
  const [selectedBucketId, setSelectedBucketId] = useState(serviceStopEmailBuckets[0].id);

  const selectedBucket = serviceStopEmailBuckets.find((bucket) => bucket.id === selectedBucketId) || serviceStopEmailBuckets[0];
  const selectedCategoryKey = resolveEditableCategoryKey(selectedBucket);
  const selectedCategorySetting = {
    ...(defaultCategorySettings[selectedCategoryKey] || {}),
    ...(serviceStopCategorySettings[selectedCategoryKey] || {}),
    category: selectedCategoryKey,
  };
  const editableCategoryKeys = useMemo(
    () => [...new Set(serviceStopEmailBuckets.map(resolveEditableCategoryKey))],
    []
  );
  const activeServiceTemplateCount = editableCategoryKeys.filter((categoryKey) => {
    const categorySettings = {
      ...(defaultCategorySettings[categoryKey] || {}),
      ...(serviceStopCategorySettings[categoryKey] || {}),
    };

    return categorySettings.sendEmailOnFinish === true;
  }).length;
  const customerEmailsEnabledCount = customerConfigList.filter((customer) => customer.emailIsOn === true).length;
  const allCustomersSelected = customerConfigList.length > 0 && customerConfigList.every((customer) => customer.emailIsOn === true);
  const senderDetailsAreSet = Boolean(fromEmail.trim() || replyToEmail.trim());
  const selectedTemplateDescription = selectedBucket.fallbackCategoryKey
    ? `${selectedBucket.label} uses the ${selectedCategoryKey} template.`
    : selectedBucket.helper;

  useEffect(() => {
    const onLoad = async () => {
      if (!recentlySelectedCompany) {
        setIsLoading(false);
        setEmailConfig(null);
        setCustomerConfigList([]);
        return;
      }

      try {
        setIsLoading(true);

        const docSnap = await getDoc(emailConfigurationRef(recentlySelectedCompany));
        const configData = docSnap.exists() ? docSnap.data() : {};
        const mergedCategorySettings = {
          ...defaultCategorySettings,
          ...(configData.serviceStopCategorySettings || {}),
        };

        const result = {
          id: configData.id || recentlySelectedCompany,
          emailIsOn: configData.emailIsOn === true,
          emailBody: configData.emailBody || "",
          requirePhoto: configData.requirePhoto === true,
          fromEmail: configData.fromEmail || "",
          replyToEmail: configData.replyToEmail || "",
          serviceStopCategorySettings: mergedCategorySettings,
        };

        setEmailConfig(result);
        setEmailIsOn(result.emailIsOn);
        setEmailBody(result.emailBody);
        setRequirePhoto(result.requirePhoto);
        setFromEmail(result.fromEmail);
        setReplyToEmail(result.replyToEmail);
        setServiceStopCategorySettings(mergedCategorySettings);

        const customerQuery = query(
          collection(db, "companies", recentlySelectedCompany, "customers"),
          where("active", "==", true),
          orderBy("lastName")
        );
        const [querySnapshotCustomer, querySnapshotConfig] = await Promise.all([
          getDocs(customerQuery),
          getDocs(query(customerEmailConfigurationRef(recentlySelectedCompany))),
        ]);

        const customerData = querySnapshotCustomer.docs.map((customerDoc) => Customer.fromFirestore(customerDoc));
        const configByCustomerId = new Map();

        querySnapshotConfig.forEach((configDoc) => {
          const customerConfig = configDoc.data();
          if (customerConfig.customerId) {
            configByCustomerId.set(customerConfig.customerId, {
              ...customerConfig,
              docId: configDoc.id,
            });
          }
        });

        setCustomerConfigList(
          customerData.map((customer) => {
            const customerConfig = configByCustomerId.get(customer.id) || {};

            return {
              id: customerConfig.id || customerConfig.docId || customer.id,
              docId: customerConfig.docId || customer.id,
              emailIsOn: customerConfig.emailIsOn === true,
              customerId: customer.id,
              fullName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Unknown Customer",
              email: customer.email || customerConfig.email || "",
            };
          })
        );
      } catch (err) {
        console.error(err);
        toast.error("Could not load email configuration.");
      } finally {
        setIsLoading(false);
      }
    };

    onLoad();
  }, [recentlySelectedCompany, defaultCategorySettings]);

  const updateCategorySetting = (categoryKey, field, value) => {
    setServiceStopCategorySettings((current) => ({
      ...current,
      [categoryKey]: {
        ...(defaultCategorySettings[categoryKey] || {}),
        ...(current[categoryKey] || {}),
        category: categoryKey,
        [field]: value,
      },
    }));
  };

  const saveEmailConfiguration = async (overrides = {}) => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before saving email settings.");
      return;
    }

    setIsSavingGeneral(true);

    try {
      const payload = {
        id: emailConfig?.id || recentlySelectedCompany,
        emailIsOn,
        emailBody,
        requirePhoto,
        fromEmail: fromEmail.trim(),
        replyToEmail: replyToEmail.trim(),
        serviceStopCategorySettings,
        updatedAt: serverTimestamp(),
        ...overrides,
      };

      await setDoc(emailConfigurationRef(recentlySelectedCompany), payload, { merge: true });
      setEmailConfig((current) => ({ ...(current || {}), ...payload }));
      toast.success("Email configuration saved.");
    } catch (error) {
      console.error(error);
      toast.error("Could not save email configuration.");
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const toggleCompanyEmail = async () => {
    const nextEmailIsOn = !emailIsOn;
    setEmailIsOn(nextEmailIsOn);
    await saveEmailConfiguration({ emailIsOn: nextEmailIsOn });
  };

  const saveCategorySetting = async (categoryKey) => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before saving email templates.");
      return;
    }

    const categorySetting = {
      ...(defaultCategorySettings[categoryKey] || {}),
      ...(serviceStopCategorySettings[categoryKey] || {}),
      category: categoryKey,
    };

    setSavingCategoryKey(categoryKey);

    try {
      const nextSettings = {
        ...serviceStopCategorySettings,
        [categoryKey]: categorySetting,
      };

      await setDoc(
        emailConfigurationRef(recentlySelectedCompany),
        {
          id: emailConfig?.id || recentlySelectedCompany,
          serviceStopCategorySettings: nextSettings,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setServiceStopCategorySettings(nextSettings);
      setEmailConfig((current) => ({
        ...(current || {}),
        serviceStopCategorySettings: nextSettings,
      }));
      toast.success(`${categoryKey} email template saved.`);
    } catch (error) {
      console.error(error);
      toast.error("Could not save service email template.");
    } finally {
      setSavingCategoryKey("");
    }
  };

  const resetCategoryToDefault = (categoryKey) => {
    setServiceStopCategorySettings((current) => ({
      ...current,
      [categoryKey]: {
        ...(defaultCategorySettings[categoryKey] || {}),
        category: categoryKey,
      },
    }));
  };

  const setCustomerEmailEnabled = async (customer, enabled) => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before changing customer email settings.");
      return;
    }

    setSavingCustomerId(customer.customerId);

    try {
      const docId = customer.docId || customer.customerId;
      const payload = {
        id: customer.id || docId,
        customerId: customer.customerId,
        email: customer.email || "",
        emailIsOn: enabled,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(customerEmailConfigurationRef(recentlySelectedCompany), docId), payload, { merge: true });

      setCustomerConfigList((current) =>
        current.map((item) =>
          item.customerId === customer.customerId
            ? {
                ...item,
                docId,
                id: payload.id,
                emailIsOn: enabled,
              }
            : item
        )
      );
      toast.success(enabled ? "Customer email enabled." : "Customer email disabled.");
    } catch (error) {
      console.error(error);
      toast.error("Could not update customer email setting.");
    } finally {
      setSavingCustomerId("");
    }
  };

  const setAllCustomerEmailsEnabled = async (enabled) => {
    if (!recentlySelectedCompany) {
      toast.error("Select a company before changing customer email settings.");
      return;
    }

    if (customerConfigList.length === 0) return;

    setSavingCustomerId("all");

    try {
      const customerChunks = chunkArray(customerConfigList, 450);

      await Promise.all(
        customerChunks.map((customerChunk) => {
          const batch = writeBatch(db);

          customerChunk.forEach((customer) => {
            const docId = customer.docId || customer.customerId;
            batch.set(
              doc(customerEmailConfigurationRef(recentlySelectedCompany), docId),
              {
                id: customer.id || docId,
                customerId: customer.customerId,
                email: customer.email || "",
                emailIsOn: enabled,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          });

          return batch.commit();
        })
      );

      setCustomerConfigList((current) =>
        current.map((customer) => ({
          ...customer,
          docId: customer.docId || customer.customerId,
          emailIsOn: enabled,
        }))
      );
      toast.success(enabled ? "All customer emails enabled." : "All customer emails disabled.");
    } catch (error) {
      console.error(error);
      toast.error("Could not update customer email settings.");
    } finally {
      setSavingCustomerId("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="w-full space-y-6">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <Link
            to="/company/settings"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Settings
          </Link>

          <div className="mt-4 flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
              <FaEnvelope className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-bold text-blue-700">
                {recentlySelectedCompanyName || "Selected company"}
              </p>
              <h1 className="mt-1 text-3xl font-bold text-slate-950">Email Configuration</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Sender details, service report templates, and customer email recipients.
              </p>
            </div>
          </div>
        </header>

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="text-sm font-semibold text-slate-800">Loading email configuration...</div>
            <div className="mt-1 text-sm text-slate-500">Fetching templates and active customers.</div>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Company sending"
                value={enabledLabel(emailIsOn)}
                helper="Master service email switch"
                tone={emailIsOn ? "emerald" : "slate"}
              />
              <SummaryCard
                label="Service templates"
                value={`${activeServiceTemplateCount}/${editableCategoryKeys.length}`}
                helper="sending when a stop is finished"
                tone={activeServiceTemplateCount > 0 ? "blue" : "slate"}
              />
              <SummaryCard
                label="Customer recipients"
                value={customerConfigList.length ? `${customerEmailsEnabledCount}/${customerConfigList.length}` : "0"}
                helper="active customers opted in"
                tone={customerEmailsEnabledCount > 0 ? "emerald" : "slate"}
              />
              <SummaryCard
                label="Sender details"
                value={senderDetailsAreSet ? "Set" : "Not set"}
                helper="from and reply-to addresses"
                tone={senderDetailsAreSet ? "blue" : "slate"}
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Company Delivery</h2>
                  <p className="mt-1 text-sm text-slate-500">Global sender fields and default delivery rules.</p>
                </div>

                <button
                  type="button"
                  onClick={() => saveEmailConfiguration()}
                  disabled={isSavingGeneral}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSave className="h-4 w-4" />
                  {isSavingGeneral ? "Saving..." : "Save Settings"}
                </button>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">From email address</span>
                    <input
                      className={inputClass}
                      value={fromEmail}
                      onChange={(event) => setFromEmail(event.target.value)}
                      placeholder="info@dripdrop-poolapp.com"
                      type="email"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">Reply-to email address</span>
                    <input
                      className={inputClass}
                      value={replyToEmail}
                      onChange={(event) => setReplyToEmail(event.target.value)}
                      placeholder="office@example.com"
                      type="email"
                    />
                  </label>

                  <label className="block md:col-span-2">
                    <span className="text-sm font-semibold text-slate-800">Default message</span>
                    <textarea
                      className={`${textareaClass} min-h-[110px]`}
                      value={emailBody}
                      onChange={(event) => setEmailBody(event.target.value)}
                      name="emailBody"
                      placeholder="Write the default email message..."
                    />
                  </label>
                </div>

                <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-4 px-4 py-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Email sending</p>
                      <p className="mt-1 text-xs text-slate-500">Company-wide service email switch.</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(emailIsOn)}`}>
                        {enabledLabel(emailIsOn)}
                      </span>
                      <button
                        className={`relative inline-flex h-9 w-16 items-center rounded-full border transition ${
                          emailIsOn ? "border-emerald-600 bg-emerald-600" : "border-slate-200 bg-slate-200"
                        } ${isSavingGeneral ? "opacity-70" : ""}`}
                        type="button"
                        onClick={toggleCompanyEmail}
                        disabled={isSavingGeneral}
                        aria-label="Toggle company email sending"
                        aria-pressed={emailIsOn}
                      >
                        <span
                          className={`inline-block h-7 w-7 transform rounded-full bg-white shadow-sm transition ${
                            emailIsOn ? "translate-x-7" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 border-t border-slate-200 px-4 py-4 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={requirePhoto}
                      onChange={(event) => setRequirePhoto(event.target.checked)}
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">Require photo by default</span>
                      <span className="mt-1 block text-xs text-slate-500">Default requirement for service email completion.</span>
                    </span>
                  </label>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Service Stop Templates</h2>
                  <p className="mt-1 text-sm text-slate-500">Select a stop type, then edit the subject, message, footer, and template ID.</p>
                </div>
                <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  {activeServiceTemplateCount} of {editableCategoryKeys.length} active
                </span>
              </div>

              <div className="grid lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
                <div className="divide-y divide-slate-100 border-b border-slate-200 lg:border-b-0 lg:border-r">
                  {serviceStopEmailBuckets.map((bucket) => {
                    const editableCategoryKey = resolveEditableCategoryKey(bucket);
                    const categorySettings = {
                      ...(defaultCategorySettings[editableCategoryKey] || {}),
                      ...(serviceStopCategorySettings[editableCategoryKey] || {}),
                    };
                    const isConfigured = Boolean(serviceStopCategorySettings[editableCategoryKey]);
                    const isEnabled = categorySettings.sendEmailOnFinish === true;
                    const subject = categorySettings.emailSubject || "No subject configured";
                    const statusLabel = bucket.fallbackCategoryKey && !isConfigured ? "Fallback" : enabledLabel(isEnabled);

                    return (
                      <EmailTypeCard
                        key={bucket.id}
                        icon={bucket.Icon}
                        title={bucket.label}
                        subtitle={subject}
                        helper={bucket.fallbackCategoryKey ? `Uses ${editableCategoryKey} when the category is unknown.` : bucket.helper}
                        onClick={() => setSelectedBucketId(bucket.id)}
                        selected={selectedBucketId === bucket.id}
                        status={{
                          enabled: isEnabled,
                          label: statusLabel,
                        }}
                      />
                    );
                  })}
                </div>

                <div>
                  <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">{selectedBucket.label} Template</h3>
                      <p className="mt-1 text-sm text-slate-500">{selectedTemplateDescription}</p>
                    </div>
                    <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(selectedCategorySetting.sendEmailOnFinish)}`}>
                      {selectedCategorySetting.sendEmailOnFinish ? "Sends on finish" : "Not sending"}
                    </span>
                  </div>

                  <div className="grid gap-5 p-5 xl:grid-cols-2">
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={selectedCategorySetting.sendEmailOnFinish === true}
                            onChange={(event) => updateCategorySetting(selectedCategoryKey, "sendEmailOnFinish", event.target.checked)}
                          />
                          Send when finished
                        </label>

                        <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={selectedCategorySetting.requirePhotoOnFinish === true}
                            onChange={(event) => updateCategorySetting(selectedCategoryKey, "requirePhotoOnFinish", event.target.checked)}
                          />
                          Require photo
                        </label>
                      </div>

                      <label className="block">
                        <span className="text-sm font-semibold text-slate-800">Subject line</span>
                        <input
                          className={inputClass}
                          value={selectedCategorySetting.emailSubject || ""}
                          onChange={(event) => updateCategorySetting(selectedCategoryKey, "emailSubject", event.target.value)}
                          placeholder="Email subject"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-semibold text-slate-800">SendGrid template ID</span>
                        <input
                          className={inputClass}
                          value={selectedCategorySetting.sendGridTemplateId || ""}
                          onChange={(event) => updateCategorySetting(selectedCategoryKey, "sendGridTemplateId", event.target.value)}
                          placeholder="d-..."
                        />
                      </label>
                    </div>

                    <div className="space-y-4">
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-800">Message body</span>
                        <textarea
                          className={`${textareaClass} min-h-[130px]`}
                          value={selectedCategorySetting.emailBody || ""}
                          onChange={(event) => updateCategorySetting(selectedCategoryKey, "emailBody", event.target.value)}
                          placeholder="Template body or preheader message"
                        />
                      </label>

                      <label className="block">
                        <span className="text-sm font-semibold text-slate-800">Footer message</span>
                        <textarea
                          className={`${textareaClass} min-h-[80px]`}
                          value={selectedCategorySetting.emailFooter || ""}
                          onChange={(event) => updateCategorySetting(selectedCategoryKey, "emailFooter", event.target.value)}
                          placeholder="Footer text"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-3 xl:col-span-2">
                      <button
                        type="button"
                        onClick={() => saveCategorySetting(selectedCategoryKey)}
                        disabled={savingCategoryKey === selectedCategoryKey}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FaSave className="h-4 w-4" />
                        {savingCategoryKey === selectedCategoryKey ? "Saving..." : "Save Template"}
                      </button>

                      <button
                        type="button"
                        onClick={() => resetCategoryToDefault(selectedCategoryKey)}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-950">Billing Emails</h2>
                <p className="mt-1 text-sm text-slate-500">Invoice and payment confirmations sent with the company sender details.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {billingEmailTypes.map((emailType) => (
                  <article key={emailType.id} className="flex gap-3 px-5 py-4">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                      <emailType.Icon />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950">{emailType.label}</p>
                      <p className="mt-1 text-sm text-slate-500">{emailType.helper}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Customer Recipients</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {customerConfigList.length
                      ? `${customerEmailsEnabledCount} of ${customerConfigList.length} active customers have service emails on.`
                      : "No active customers are available for email selection."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${
                      allCustomersSelected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-700"
                    }`}
                  >
                    {customerConfigList.length === 0 ? "No customers" : allCustomersSelected ? "All on" : "Needs review"}
                  </span>
                  <button
                    type="button"
                    disabled={savingCustomerId === "all" || customerConfigList.length === 0}
                    onClick={() => setAllCustomerEmailsEnabled(!allCustomersSelected)}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingCustomerId === "all" ? "Saving..." : allCustomersSelected ? "Turn All Off" : "Turn All On"}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-white">
                    <tr className="text-left text-xs font-semibold text-slate-500">
                      <th className="border-b border-slate-200 px-5 py-3">Customer</th>
                      <th className="border-b border-slate-200 px-5 py-3">Email address</th>
                      <th className="border-b border-slate-200 px-5 py-3">Service emails</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {customerConfigList.map((customer) => {
                      const isSaving = savingCustomerId === customer.customerId;

                      return (
                        <tr key={customer.customerId} className="transition hover:bg-slate-50">
                          <td className="px-5 py-3 text-sm font-semibold text-slate-900">{customer.fullName}</td>
                          <td className="px-5 py-3 text-sm text-slate-600">{customer.email || "-"}</td>
                          <td className="px-5 py-3">
                            <button
                              type="button"
                              onClick={() => setCustomerEmailEnabled(customer, !customer.emailIsOn)}
                              disabled={isSaving}
                              className={`inline-flex min-w-[92px] items-center justify-center rounded-md px-3 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                customer.emailIsOn
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {isSaving ? "Saving..." : customer.emailIsOn ? "On" : "Off"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {customerConfigList.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-10 text-center">
                          <div className="text-sm font-semibold text-slate-800">No active customers found</div>
                          <div className="mt-1 text-sm text-slate-500">Active customers will appear here for email selection.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="h-2" />
          </div>
        )}
      </div>
    </div>
  );
}
