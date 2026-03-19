import React, { useState, useEffect, useContext } from "react";
import { signOut, getAuth } from "firebase/auth";
import { Link, useLocation, Navigate } from "react-router-dom";
import Footer from "../../../../layout/Footer";
import { Context } from "../../../../context/AuthContext";
import { db } from "../../../../utils/config";
import { Customer } from "../../../../utils/models/Customer";
import { query, collection, getDocs, doc, orderBy, getDoc, where } from "firebase/firestore";

export default function EmailConfiguration() {
  const { recentlySelectedCompany, user } = useContext(Context);

  const [isLoading, setIsLoading] = useState(false);

  const [emailConfig, setEmailConfig] = useState(null);
  const [emailIsOn, setEmailIsOn] = useState(false);
  const [emailBody, setEmailBody] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customerConfigList, setCustomerConfigList] = useState([]);
  const [allCustomersSelected, setAllCustomersSelected] = useState(false);

  useEffect(() => {
    const onLoad = async () => {
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
          };
          setEmailConfig(result);
          emailConfigResult = result;
        }

        if (emailConfigResult) {
          setEmailIsOn(emailConfigResult.emailIsOn);
          setEmailBody(emailConfigResult.emailBody);
        }

        // Get customer list
        setCustomers();
        let customerQuery = query(
          collection(db, "companies", recentlySelectedCompany, "customers"),
          where("active", "==", true),
          orderBy("lastName")
        );
        const querySnapshotCustomer = await getDocs(customerQuery);
        const customerData = querySnapshotCustomer.docs.map((doc) => Customer.fromFirestore(doc));
        setCustomers(customerData);

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
            customerI: configData.customerId,
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
  }, []);

  async function turnOffEmailConfig(e, config) {
    e.preventDefault();
    const message = {
      id: "messageData.id",
      dateSent: "messageData.dateSent",
      read: "messageData.read",
      senderName: "messageData.senderName",
    };
  }

  async function turnOnEmailConfig(e, config) {
    e.preventDefault();
    const message = {
      id: "messageData.id",
      dateSent: "messageData.dateSent",
      read: "messageData.read",
      senderName: "messageData.senderName",
    };
  }

  return (
    <>
      <div className="min-h-screen bg-slate-50 px-4 md:px-10 py-8 text-slate-900">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Header */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Email Configuration</h1>
                <p className="mt-1 text-sm text-slate-500">Manage automated emails and per-customer settings.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  Service Stop Emails
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  Jobs Emails
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  Invoices Emails
                </span>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-10 text-center">
              <div className="text-sm font-semibold text-slate-800">Loading…</div>
              <div className="text-sm text-slate-500 mt-1">Fetching configuration and customers.</div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Email Settings */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
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

                <div className="p-6">
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
              </div>

              {/* Email Body */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                  <div className="text-sm font-semibold text-slate-900">Email Body</div>
                  <div className="text-xs text-slate-500 mt-1">Default message appended to outgoing emails.</div>
                </div>

                <div className="p-6 space-y-4">
                  <textarea
                    className="w-full min-h-[140px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-y"
                    // value={emailBody}
                    // onChange={(e) => setEmailBody(e.target.value)}
                    type="text"
                    name="emailBody"
                    placeholder="Write the default email message…"
                  />

                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
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
              </div>

              {/* Customer Configuration Table */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
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
                        <th className="py-3 px-6 border-b border-slate-200">Name</th>
                        <th className="py-3 px-6 border-b border-slate-200">Email</th>
                        <th className="py-3 px-6 border-b border-slate-200">Config</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                      {customerConfigList?.map((customer) => (
                        <tr key={customer.id} className="hover:bg-slate-50 transition">
                          <td className="py-3 px-6 text-sm font-semibold text-slate-900">{customer.fullName}</td>
                          <td className="py-3 px-6 text-sm text-slate-600">{customer.email}</td>
                          <td className="py-3 px-6">
                            {emailIsOn ? (
                              <button
                                onClick={(e) => {
                                  turnOffEmailConfig(e, customer);
                                }}
                                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
                              >
                                Sends Email
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  turnOnEmailConfig(e, customer);
                                }}
                                className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
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
              </div>

              {/* Optional footer spacing */}
              <div className="h-2" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
