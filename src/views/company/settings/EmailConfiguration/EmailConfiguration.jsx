import React, { useState, useEffect, useContext } from "react";
import {
  FaBriefcase,
  FaClipboardList,
  FaEnvelope,
  FaFileInvoiceDollar,
  FaQuestionCircle,
  FaReceipt,
  FaRedoAlt,
  FaUserFriends,
} from "react-icons/fa";
import { Context } from "../../../../context/AuthContext";
import { db } from "../../../../utils/config";
import { Customer } from "../../../../utils/models/Customer";
import { query, collection, getDocs, doc, orderBy, getDoc, where } from "firebase/firestore";

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
    id: "legacyInvoice",
    label: "Legacy Invoice",
    helper: "Original invoice email used by older invoice records.",
    callableName: "sendInvoiceEmail",
    Icon: FaReceipt,
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
    emailSubject: `${companyName} Service Report`,
    sendEmailOnFinish: false,
  },
  Job: {
    emailSubject: `${companyName} Job Visit Summary`,
    sendEmailOnFinish: false,
  },
  "Job Estimate": {
    emailSubject: `${companyName} Estimate Visit Recap`,
    sendEmailOnFinish: false,
  },
  "Service Agreement Estimate": {
    emailSubject: `${companyName} Service Agreement Visit Recap`,
    sendEmailOnFinish: false,
  },
  "Customer Relationship": {
    emailSubject: `${companyName} Visit Recap`,
    sendEmailOnFinish: false,
  },
});

const enabledLabel = (enabled) => (enabled ? "Enabled" : "Disabled");

const statusTone = (enabled) =>
  enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600";

const EmailTypeCard = ({ icon: Icon, title, subtitle, status, meta }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 rounded-md bg-slate-100 p-2 text-slate-600">
          <Icon />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          {meta && <p className="mt-2 break-all text-xs font-semibold text-slate-500">{meta}</p>}
        </div>
      </div>
      {status && (
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(status.enabled)}`}>
          {status.label}
        </span>
      )}
    </div>
  </div>
);

export default function EmailConfiguration() {
  const { recentlySelectedCompany, recentlySelectedCompanyName } = useContext(Context);
  const defaultCategorySettings = defaultServiceStopCategoryEmailSettings(recentlySelectedCompanyName || "your pool company");

  const [isLoading, setIsLoading] = useState(false);

  const [emailConfig, setEmailConfig] = useState(null);
  const [emailIsOn, setEmailIsOn] = useState(false);
  const [emailBody, setEmailBody] = useState("");
  const [serviceStopCategorySettings, setServiceStopCategorySettings] = useState({});
  const [customerConfigList, setCustomerConfigList] = useState([]);
  const [allCustomersSelected, setAllCustomersSelected] = useState(false);

  useEffect(() => {
    const onLoad = async () => {
      if (!recentlySelectedCompany) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);

        // Get Company Email Configuration
        const docRef = doc(db, "companies", recentlySelectedCompany, "settings", "emailConfiguration");
        const docSnap = await getDoc(docRef);
        let emailConfigResult;

        if (docSnap.exists()) {
          const configData = docSnap.data();
          let result = {
            id: configData.id,
            emailIsOn: configData.emailIsOn,
            emailBody: configData.emailBody,
            requirePhoto: configData.requirePhoto,
            serviceStopCategorySettings: configData.serviceStopCategorySettings || {},
          };
          setEmailConfig(result);
          emailConfigResult = result;
        }

        if (emailConfigResult) {
          setEmailIsOn(emailConfigResult.emailIsOn);
          setEmailBody(emailConfigResult.emailBody);
          setServiceStopCategorySettings(emailConfigResult.serviceStopCategorySettings || {});
        }

        // Get customer list
        let customerQuery = query(
          collection(db, "companies", recentlySelectedCompany, "customers"),
          where("active", "==", true),
          orderBy("lastName")
        );
        const querySnapshotCustomer = await getDocs(customerQuery);
        const customerData = querySnapshotCustomer.docs.map((doc) => Customer.fromFirestore(doc));

        // Get Customer Config List
        let q = query(collection(db, "companies", recentlySelectedCompany, "settings", "emailConfiguration", "customerConfiguration"));
        const querySnapshot = await getDocs(q);

        let configList = [];
        setCustomerConfigList([]);
        querySnapshot.forEach((doc) => {
          const configData = doc.data();
          const customer = customerData.find((customer1) => customer1.id === configData.customerId);

          const config = {
            id: configData.id,
            emailIsOn: configData.emailIsOn,
            customerId: configData.customerId,
            fullName: customer ? customer.firstName + " " + customer.lastName : "Unknown Customer",
            email: customer ? customer.email : "",
          };
          configList.push(config);
          setCustomerConfigList((list) => [...list, config]);
        });

        // Determine if all customers selected
        if (configList.length === 0) {
          setAllCustomersSelected(false);
        } else {
          const anyOff = configList.some((c) => c.emailIsOn === false);
          setAllCustomersSelected(!anyOff);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    onLoad();
  }, [recentlySelectedCompany]);

  async function turnOffEmailConfig(e) {
    e.preventDefault();
  }

  async function turnOnEmailConfig(e) {
    e.preventDefault();
  }

  return (
    <>
      <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
        <div className="w-full space-y-6">
          {/* Header */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  {recentlySelectedCompanyName || "Selected company"}
                </p>
                <h1 className="text-3xl font-bold text-slate-950">Email Configuration</h1>
                <p className="max-w-3xl text-sm text-slate-600">
                  Service stop and billing email controls for this company.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  Service Stops
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  Billing
                </span>
              </div>
            </div>
          </section>

          {isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="text-sm font-semibold text-slate-800">Loading…</div>
              <div className="text-sm text-slate-500 mt-1">Fetching configuration and customers.</div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Email Settings */}
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-5">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Email Settings</div>
                    <div className="text-xs text-slate-500 mt-1">Toggle global email reporting for this company.</div>
                  </div>

                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      emailIsOn ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {emailIsOn ? "Enabled" : "Disabled"}
                  </span>
                </div>

                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Turn on Email Reports</div>
                      <div className="text-sm text-slate-500 mt-1">
                        When enabled, customers can receive automated service updates.
                      </div>
                    </div>

                    {/* purely aesthetic switch (no functional change requested) */}
                    <button
                      className={`relative inline-flex h-10 w-16 items-center rounded-full border transition ${
                        emailIsOn ? "bg-emerald-600 border-emerald-600" : "bg-slate-200 border-slate-200"
                      }`}
                      type="button"
                    >
                      <span
                        className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-sm transition ${
                          emailIsOn ? "translate-x-7" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 p-5">
                    <h2 className="text-lg font-bold text-slate-950">Service Stop Emails</h2>
                    <p className="mt-1 text-sm text-slate-500">Buckets match payroll service stop sources.</p>
                  </div>
                  <div className="grid gap-4 p-5 md:grid-cols-2">
                    {serviceStopEmailBuckets.map((bucket) => {
                      const categorySettings = serviceStopCategorySettings[bucket.categoryKey]
                        || serviceStopCategorySettings[bucket.fallbackCategoryKey]
                        || defaultCategorySettings[bucket.categoryKey]
                        || defaultCategorySettings[bucket.fallbackCategoryKey]
                        || {};
                      const isConfigured = Boolean(serviceStopCategorySettings[bucket.categoryKey]);
                      const isEnabled = emailIsOn && categorySettings.sendEmailOnFinish === true;
                      const subject = categorySettings.emailSubject || "No subject configured";
                      const statusLabel = bucket.fallbackCategoryKey && !isConfigured ? "Fallback" : enabledLabel(isEnabled);

                      return (
                        <EmailTypeCard
                          key={bucket.id}
                          icon={bucket.Icon}
                          title={bucket.label}
                          subtitle={subject}
                          meta={bucket.sourceId}
                          status={{
                            enabled: isConfigured ? isEnabled : false,
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
                      <EmailTypeCard
                        key={emailType.id}
                        icon={emailType.Icon}
                        title={emailType.label}
                        subtitle={emailType.helper}
                        meta={emailType.callableName}
                      />
                    ))}
                  </div>
                </div>
              </section>

              {/* Email Body */}
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <div className="text-sm font-semibold text-slate-900">Email Body</div>
                  <div className="text-xs text-slate-500 mt-1">Default message appended to outgoing emails.</div>
                </div>

                <div className="space-y-4 p-5">
                  <textarea
                    className="w-full min-h-[140px] rounded-md border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-y"
                    value={emailBody}
                    // onChange={(e) => setEmailBody(e.target.value)}
                    type="text"
                    name="emailBody"
                    placeholder="Write the default email message…"
                    readOnly
                  />

                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Require Photo on Complete</div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        When enabled, techs must attach a photo before marking complete.
                      </div>
                    </div>

                    {/* aesthetic toggle only */}
                    <button
                      className={`relative inline-flex h-10 w-16 items-center rounded-full border transition ${
                        emailConfig?.requirePhoto ? "bg-blue-600 border-blue-600" : "bg-slate-200 border-slate-200"
                      }`}
                      type="button"
                    >
                      <span
                        className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-sm transition ${
                          emailConfig?.requirePhoto ? "translate-x-7" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>

              {/* Customer Configuration Table */}
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-5">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">All Customers</div>
                    <div className="text-xs text-slate-500 mt-1">Control per-customer email sending.</div>
                  </div>

                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      allCustomersSelected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {allCustomersSelected ? "All Enabled" : "Not All Enabled"}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-white">
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3 border-b border-slate-200">Name</th>
                        <th className="px-5 py-3 border-b border-slate-200">Email</th>
                        <th className="px-5 py-3 border-b border-slate-200">Config</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                      {customerConfigList?.map((customer) => (
                        <tr key={customer.id} className="hover:bg-slate-50 transition">
                          <td className="px-5 py-3 text-sm font-semibold text-slate-900">{customer.fullName}</td>
                          <td className="px-5 py-3 text-sm text-slate-600">{customer.email}</td>
                          <td className="px-5 py-3">
                            {emailIsOn ? (
                              <button
                                onClick={(e) => {
                                  turnOffEmailConfig(e, customer);
                                }}
                                className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
                              >
                                Sends Email
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  turnOnEmailConfig(e, customer);
                                }}
                                className="inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                              >
                                Does Not Send Email
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}

                      {customerConfigList?.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-6 py-10 text-center">
                            <div className="text-sm font-semibold text-slate-800">No customer configurations found</div>
                            <div className="text-sm text-slate-500 mt-1">Once configs are created, they’ll appear here.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Optional footer spacing */}
              <div className="h-2" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
