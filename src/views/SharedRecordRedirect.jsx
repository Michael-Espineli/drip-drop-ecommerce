import React, { useContext, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { Context } from "../context/AuthContext";
import {
  getConversationLinkLabel,
  getConversationLinkRoute,
  normalizeConversationLink,
} from "../utils/chatMessaging";

const clean = (value) => String(value || "").trim();

const SharedRecordRedirect = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { dataBaseUser } = useContext(Context);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const audience = clean(params.get("audience"));
  const inferredAudience = audience || (dataBaseUser?.accountType === "Client" ? "client" : "company");
  const link = useMemo(() => normalizeConversationLink({
    type: params.get("type"),
    recordId: params.get("id") || params.get("recordId"),
    companyId: params.get("companyId"),
    customerId: params.get("customerId"),
    customerUserId: params.get("customerUserId"),
    title: params.get("title"),
    sharePath: `${location.pathname}${location.search}`,
  }), [location.pathname, location.search, params]);
  const targetRoute = getConversationLinkRoute(link, inferredAudience);
  const label = getConversationLinkLabel(link.type);

  useEffect(() => {
    if (!targetRoute) return;

    const timer = window.setTimeout(() => {
      navigate(targetRoute, { replace: true });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [navigate, targetRoute]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 text-slate-900">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <ArrowPathIcon className="h-6 w-6 animate-spin" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Opening shared {label.toLowerCase()}</h1>
        {targetRoute ? (
          <p className="mt-2 text-sm text-slate-600">Taking you to the right place in Drip Drop.</p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">This shared link is missing a supported record type or ID.</p>
        )}
        {targetRoute ? (
          <Link
            to={targetRoute}
            className="mt-5 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Open now
          </Link>
        ) : (
          <Link
            to="/"
            className="mt-5 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Go home
          </Link>
        )}
      </div>
    </div>
  );
};

export default SharedRecordRedirect;
