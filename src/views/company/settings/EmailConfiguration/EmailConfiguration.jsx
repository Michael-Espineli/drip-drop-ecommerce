import React, { useState, useEffect, useContext, useMemo } from "react";
import toast from "react-hot-toast";
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

const EmailTypeCard = ({ icon: Icon, title, subtitle, status, meta, helper, onClick, selected }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40 ${
      selected ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 rounded-md bg-slate-100 p-2 text-slate-600">
          <Icon />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          {helper && <p className="mt-2 text-xs text-slate-500">{helper}</p>}
          {meta && <p className="mt-2 break-all text-xs font-semibold text-slate-500">{meta}</p>}
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
  const allCustomersSelected = customerConfigList.length > 0 && customerConfigList.every((customer) => customer.emailIsOn === true);

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
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {recentlySelectedCompanyName || "Selected company"}
              </p>
              <h1 className="text-3xl font-bold text-slate-950">Email Configuration</h1>
              <p className="max-w-3xl text-sm text-slate-600">
                Configure service stop templates, billing senders, and customer email opt-ins.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                Service Stops
              </span>
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                Billing
              </span>
              <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                Editable While Off
              </span>
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="text-sm font-semibold text-slate-800">Loading...</div>
            <div className="mt-1 text-sm text-slate-500">Fetching configuration and customers.</div>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Company Email Sending</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Turning this off pauses company-triggered sends, but the templates and customer selections below remain editable.
                  </div>
                </div>

                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                    emailIsOn ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                  }`}
                >
                  {enabledLabel(emailIsOn)}
                </span>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">From Email</span>
                    <input
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={fromEmail}
                      onChange={(event) => setFromEmail(event.target.value)}
                      placeholder="info@dripdrop-poolapp.com"
                      type="email"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">Reply-To Email</span>
                    <input
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={replyToEmail}
                      onChange={(event) => setReplyToEmail(event.target.value)}
                      placeholder="office@example.com"
                      type="email"
                    />
                  </label>

                  <label className="md:col-span-2 block">
                    <span className="text-sm font-semibold text-slate-800">Default Email Body</span>
                    <textarea
                      className="mt-1 min-h-[110px] w-full resize-y rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={emailBody}
                      onChange={(event) => setEmailBody(event.target.value)}
                      name="emailBody"
                      placeholder="Write the default email message..."
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    className={`relative inline-flex h-10 w-16 items-center rounded-full border transition ${
                      emailIsOn ? "border-emerald-600 bg-emerald-600" : "border-slate-200 bg-slate-200"
                    } ${isSavingGeneral ? "opacity-70" : ""}`}
                    type="button"
                    onClick={toggleCompanyEmail}
                    disabled={isSavingGeneral}
                    aria-label="Toggle company email sending"
                  >
                    <span
                      className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-sm transition ${
                        emailIsOn ? "translate-x-7" : "translate-x-1"
                      }`}
                    />
                  </button>

                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={requirePhoto}
                      onChange={(event) => setRequirePhoto(event.target.checked)}
                    />
                    Require photo by default
                  </label>

                  <button
                    type="button"
                    onClick={() => saveEmailConfiguration()}
                    disabled={isSavingGeneral}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FaSave />
                    {isSavingGeneral ? "Saving..." : "Save Settings"}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-lg font-bold text-slate-950">Service Stop Emails</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Turn each service email type on or off and edit the SendGrid template details.
                  </p>
                </div>
                <div className="grid gap-4 p-5 md:grid-cols-2">
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
                        meta={bucket.sourceId}
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
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h2 className="text-lg font-bold text-slate-950">Billing Emails</h2>
                  <p className="mt-1 text-sm text-slate-500">Invoice and payment email types sent by billing workflows.</p>
                </div>
                <div className="space-y-4 p-5">
                  {billingEmailTypes.map((emailType) => (
                    <div key={emailType.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex gap-3">
                        <span className="mt-0.5 rounded-md bg-slate-100 p-2 text-slate-600">
                          <emailType.Icon />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-950">{emailType.label}</p>
                          <p className="mt-1 text-sm text-slate-500">{emailType.helper}</p>
                          <p className="mt-2 break-all text-xs font-semibold text-slate-500">{emailType.callableName}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 p-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">{selectedCategoryKey} Template</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    These settings can be changed even while company email sending is disabled.
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
                    selectedCategorySetting.sendEmailOnFinish ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {selectedCategorySetting.sendEmailOnFinish ? "Sends on Finish" : "Not Sending"}
                </span>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedCategorySetting.sendEmailOnFinish === true}
                        onChange={(event) => updateCategorySetting(selectedCategoryKey, "sendEmailOnFinish", event.target.checked)}
                      />
                      Send when finished
                    </label>

                    <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
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
                    <span className="text-sm font-semibold text-slate-800">Subject</span>
                    <input
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={selectedCategorySetting.emailSubject || ""}
                      onChange={(event) => updateCategorySetting(selectedCategoryKey, "emailSubject", event.target.value)}
                      placeholder="Email subject"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">SendGrid Template ID</span>
                    <input
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={selectedCategorySetting.sendGridTemplateId || ""}
                      onChange={(event) => updateCategorySetting(selectedCategoryKey, "sendGridTemplateId", event.target.value)}
                      placeholder="d-..."
                    />
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">Body</span>
                    <textarea
                      className="mt-1 min-h-[130px] w-full resize-y rounded-md border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={selectedCategorySetting.emailBody || ""}
                      onChange={(event) => updateCategorySetting(selectedCategoryKey, "emailBody", event.target.value)}
                      placeholder="Template body or preheader message"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-800">Footer</span>
                    <textarea
                      className="mt-1 min-h-[80px] w-full resize-y rounded-md border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={selectedCategorySetting.emailFooter || ""}
                      onChange={(event) => updateCategorySetting(selectedCategoryKey, "emailFooter", event.target.value)}
                      placeholder="Footer text"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3 lg:col-span-2">
                  <button
                    type="button"
                    onClick={() => saveCategorySetting(selectedCategoryKey)}
                    disabled={savingCategoryKey === selectedCategoryKey}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <FaSave />
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
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Customer Email Selection</div>
                  <div className="mt-1 text-xs text-slate-500">Control per-customer service email sending.</div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      allCustomersSelected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {allCustomersSelected ? "All Enabled" : "Not All Enabled"}
                  </span>
                  <button
                    type="button"
                    disabled={savingCustomerId === "all" || customerConfigList.length === 0}
                    onClick={() => setAllCustomerEmailsEnabled(!allCustomersSelected)}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingCustomerId === "all" ? "Saving..." : allCustomersSelected ? "Disable All" : "Enable All"}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-white">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="border-b border-slate-200 px-5 py-3">Name</th>
                      <th className="border-b border-slate-200 px-5 py-3">Email</th>
                      <th className="border-b border-slate-200 px-5 py-3">Config</th>
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
                              onClick={() => setCustomerEmailEnabled(customer, !customer.emailIsOn)}
                              disabled={isSaving}
                              className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                customer.emailIsOn
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {isSaving ? "Saving..." : customer.emailIsOn ? "Sends Email" : "Does Not Send Email"}
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
