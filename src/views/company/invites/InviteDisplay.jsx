import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowTopRightOnSquareIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  IdentificationIcon,
  InformationCircleIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  UserCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../../utils/config";
import { buildCompanyInviteUrl, isCompanyAccessInactive } from "../../../utils/invites";

const KNOWN_INVITE_FIELDS = new Set([
  "id",
  "userId",
  "firstName",
  "lastName",
  "email",
  "companyName",
  "companyId",
  "roleId",
  "roleName",
  "status",
  "workerType",
  "currentUser",
  "dateCreated",
  "createdAt",
  "acceptedAt",
  "rejectedAt",
  "revokedAt",
  "updatedAt",
  "linkedCompanyId",
  "linkedCompanyName",
  "inviteUrl",
  "companyUserStatus",
  "userAccessStatus",
  "accessStatus",
  "accessActive",
  "accessUpdatedAt",
  "lastSentAt",
  "lastSentByUserId",
  "lastEmailActualTo",
  "lastEmailIntendedTo",
  "lastEmailTestMode",
  "lastEmailTemplateId",
  "lastEmailTemplateMode",
  "createdByUserId",
  "updatedByUserId",
  "revokedByUserId",
]);

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const titleize = (value) => {
  const text = String(value || "").trim();
  if (!text) return "Not provided";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const labelize = (key) =>
  String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const toDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export const formatInviteDate = (value) => {
  const date = toDate(value);
  if (!date) return "Not provided";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export const formatInviteValue = (value) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value?.toDate || value instanceof Date) return formatInviteDate(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (value && typeof value === "object") return JSON.stringify(value);
  const text = String(value ?? "").trim();
  return text || "Not provided";
};

export const getInviteeName = (invite) => {
  const fullName = `${invite?.firstName || ""} ${invite?.lastName || ""}`.trim();
  return fullName || invite?.userName || invite?.displayName || invite?.email || "Invitee";
};

const statusStyles = (status) => {
  switch (normalizeStatus(status)) {
    case "accepted":
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "inactive":
    case "past":
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "rejected":
    case "declined":
    case "revoked":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
};

const StatusChip = ({ status }) => (
  <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${statusStyles(status)}`}>
    {titleize(status)}
  </span>
);

const getInviteAccessStatus = (invite) => {
  const safeInvite = invite || {};
  const explicitStatus = String(safeInvite.companyUserStatus || safeInvite.userAccessStatus || safeInvite.accessStatus || "").trim();
  const normalizedExplicitStatus = normalizeStatus(explicitStatus);
  if (["active", "inactive", "past"].includes(normalizedExplicitStatus)) {
    return explicitStatus;
  }
  if (normalizeStatus(safeInvite.status) === "accepted") {
    return isCompanyAccessInactive(safeInvite) ? "Inactive" : "Active";
  }
  return "";
};

const getInviteUrl = (invite) => {
  const safeInvite = invite || {};
  const directUrl = String(safeInvite.inviteUrl || "").trim();
  if (directUrl) return directUrl;
  if (!safeInvite.id || typeof window === "undefined") return "";
  return buildCompanyInviteUrl(window.location.origin, safeInvite.id);
};

const copyText = async (value, successMessage) => {
  const text = String(value || "").trim();
  if (!text) {
    toast.error("Nothing to copy.");
    return;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard is not available in this browser.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (error) {
    console.error("Error copying invite text:", error);
    toast.error("Copy failed.");
  }
};

const Field = ({ label, value }) => (
  <div className="rounded-md border border-slate-200 bg-white p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 break-words text-sm font-medium text-slate-900">{formatInviteValue(value)}</div>
  </div>
);

const IconText = ({ icon: Icon, label, value }) => (
  <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
    <Icon className="h-4 w-4 flex-none text-slate-400" />
    <span className="font-medium text-slate-500">{label}:</span>
    <span className="min-w-0 truncate text-slate-700">{formatInviteValue(value)}</span>
  </div>
);

const getCompanyDisplayName = (company) =>
  company?.name || company?.companyName || company?.businessName || "";

const getCompanyDescription = (company) =>
  company?.bio || company?.description || company?.about || company?.mission || "";

const getCompanyServices = (company) => {
  if (Array.isArray(company?.services)) return company.services.filter(Boolean);
  if (typeof company?.services === "string") {
    return company.services.split(",").map((service) => service.trim()).filter(Boolean);
  }
  return [];
};

const getCompanyServiceAreas = (company) => {
  const areas = company?.serviceZipCodes || company?.serviceAreas || company?.serviceArea || [];
  if (Array.isArray(areas)) return areas.filter(Boolean);
  if (typeof areas === "string") return areas.split(",").map((area) => area.trim()).filter(Boolean);
  return [];
};

const formatReviewDate = (value) => {
  const date = toDate(value);
  if (!date) return "Recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const averageRating = (reviews) => {
  const ratings = reviews
    .map((review) => Number(review.rating))
    .filter((rating) => Number.isFinite(rating));
  if (!ratings.length) return null;
  return ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
};

const CompanyPublicPreview = ({ company, reviews, loading, error, companyId }) => {
  const detailPath = companyId ? `/companies-detail/${companyId}` : "";
  const services = getCompanyServices(company);
  const serviceAreas = getCompanyServiceAreas(company);
  const rating = averageRating(reviews);
  const visibleReviews = reviews.slice(0, 3);

  if (!companyId) {
    return (
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-950">Company Public Information</h3>
        <p className="mt-2 text-sm text-slate-500">This invite does not include a company ID.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-48 rounded bg-slate-200"></div>
          <div className="h-20 rounded bg-slate-100"></div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-16 rounded bg-slate-100"></div>
            <div className="h-16 rounded bg-slate-100"></div>
            <div className="h-16 rounded bg-slate-100"></div>
          </div>
        </div>
      </section>
    );
  }

  if (error || !company) {
    return (
      <section className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4">
        <h3 className="text-sm font-semibold text-rose-900">Company Public Information</h3>
        <p className="mt-2 text-sm text-rose-700">{error || "Company information could not be loaded."}</p>
        {detailPath ? (
          <Link to={detailPath} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-rose-800 hover:text-rose-950">
            Open company detail
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </Link>
        ) : null}
      </section>
    );
  }

  const description = getCompanyDescription(company);
  const companyName = getCompanyDisplayName(company) || "Company";

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={`${companyName} logo`} className="h-full w-full object-cover" />
            ) : (
              <BuildingOffice2Icon className="h-8 w-8 text-slate-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Company Public Information</div>
            <h3 className="mt-1 truncate text-xl font-semibold text-slate-950">{companyName}</h3>
            {description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{description}</p> : null}
          </div>
        </div>

        <Link
          to={detailPath}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Company detail
          <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <IconText icon={StarIcon} label="Reviews" value={rating ? `${rating.toFixed(1)} average (${reviews.length})` : `${reviews.length} reviews`} />
        <IconText icon={MapPinIcon} label="Region" value={company.region || serviceAreas.slice(0, 3).join(", ")} />
        <IconText icon={PhoneIcon} label="Phone" value={company.phoneNumber || company.phone} />
        <IconText icon={EnvelopeIcon} label="Email" value={company.email} />
      </div>

      {company.websiteURL || company.website || company.yelpURL ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {company.websiteURL || company.website ? (
            <a
              href={company.websiteURL || company.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <GlobeAltIcon className="h-4 w-4" />
              Website
            </a>
          ) : null}
          {company.yelpURL ? (
            <a
              href={company.yelpURL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <StarIcon className="h-4 w-4" />
              Yelp
            </a>
          ) : null}
        </div>
      ) : null}

      {services.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-slate-950">Services</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {services.slice(0, 8).map((service) => (
              <span key={service} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {service}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-950">Reviews</h4>
          {rating ? <span className="text-xs font-semibold text-slate-500">{rating.toFixed(1)} / 5</span> : null}
        </div>
        <div className="mt-3 space-y-3">
          {visibleReviews.length > 0 ? (
            visibleReviews.map((review) => (
              <article key={review.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">{review.reviewerName || review.reviewer || "Customer"}</div>
                  <div className="text-xs font-semibold text-slate-500">{formatReviewDate(review.createdAt || review.dateCreated)}</div>
                </div>
                <div className="mt-1 text-sm font-semibold text-amber-600">{formatInviteValue(review.rating)} / 5</div>
                {review.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{review.description}</p> : null}
              </article>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">No public reviews yet.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export const InviteSummaryCard = ({ invite, audience = "company", status, onOpen, actions }) => {
  const inviteeName = getInviteeName(invite);
  const primaryTitle = audience === "company" ? inviteeName : invite.companyName || "Company invite";
  const secondaryTitle = audience === "company" ? invite.email : inviteeName;
  const inviteId = invite.id || "Not provided";
  const accessStatus = getInviteAccessStatus(invite);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={invite.status || status} />
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {invite.currentUser ? "Existing user" : "New user"}
            </span>
            {accessStatus ? (
              <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${statusStyles(accessStatus)}`}>
                Access: {titleize(accessStatus)}
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
              {String(primaryTitle || "I").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-950">{primaryTitle}</h2>
              <p className="mt-0.5 truncate text-sm text-slate-500">{secondaryTitle || "No email on invite"}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-x-4 gap-y-2 md:grid-cols-2 xl:grid-cols-4">
            <IconText icon={EnvelopeIcon} label="Email" value={invite.email} />
            <IconText icon={IdentificationIcon} label="Role" value={invite.roleName} />
            <IconText icon={UserCircleIcon} label="Type" value={invite.workerType} />
            <IconText icon={CalendarDaysIcon} label="Created" value={invite.dateCreated || invite.createdAt} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {actions}
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            aria-label={`View invite ${inviteId} details`}
          >
            <InformationCircleIcon className="h-4 w-4" />
            Details
          </button>
        </div>
      </div>
    </article>
  );
};

export const InviteDetailModal = ({ invite, onClose, actions }) => {
  const safeInvite = invite || {};
  const companyId = safeInvite.companyId || safeInvite.linkedCompanyId || "";
  const [company, setCompany] = useState(null);
  const [companyReviews, setCompanyReviews] = useState([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const fetchCompanyPublicInfo = async () => {
      if (!companyId) {
        setCompany(null);
        setCompanyReviews([]);
        setCompanyLoading(false);
        setCompanyError("");
        return;
      }

      setCompanyLoading(true);
      setCompanyError("");

      try {
        const companyDoc = await getDoc(doc(db, "companies", companyId));
        if (!companyDoc.exists()) {
          if (!cancelled) {
            setCompany(null);
            setCompanyReviews([]);
            setCompanyError("Company information could not be found.");
          }
          return;
        }

        const reviewsSnapshot = await getDocs(collection(db, "companies", companyId, "reviews"));
        const reviews = reviewsSnapshot.docs
          .map((reviewDoc) => ({ id: reviewDoc.id, ...reviewDoc.data() }))
          .sort((a, b) => {
            const bTime = toDate(b.createdAt || b.dateCreated)?.getTime() || 0;
            const aTime = toDate(a.createdAt || a.dateCreated)?.getTime() || 0;
            return bTime - aTime;
          });

        if (!cancelled) {
          setCompany({ id: companyDoc.id, ...companyDoc.data() });
          setCompanyReviews(reviews);
        }
      } catch (error) {
        console.error("Error loading invite company information:", error);
        if (!cancelled) {
          setCompany(null);
          setCompanyReviews([]);
          setCompanyError("Company information could not be loaded.");
        }
      } finally {
        if (!cancelled) setCompanyLoading(false);
      }
    };

    fetchCompanyPublicInfo();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const primaryCompanyName = useMemo(
    () => getCompanyDisplayName(company) || safeInvite.companyName || "Company not provided",
    [company, safeInvite.companyName]
  );
  const inviteUrl = useMemo(() => getInviteUrl(safeInvite), [safeInvite]);
  const accessStatus = useMemo(() => getInviteAccessStatus(safeInvite), [safeInvite]);

  if (!invite) return null;

  const copyInviteId = async () => copyText(invite.id, "Invite ID copied.");
  const copyInviteLink = async () => copyText(inviteUrl, "Invite link copied.");

  const additionalFields = Object.entries(invite)
    .filter(([key, value]) => !KNOWN_INVITE_FIELDS.has(key) && value !== undefined && value !== null && String(value).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={invite.status} />
              <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                {invite.currentUser ? "Existing user" : "New user"}
              </span>
              {accessStatus ? (
                <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${statusStyles(accessStatus)}`}>
                  Access: {titleize(accessStatus)}
                </span>
              ) : null}
            </div>
            <h2 className="mt-3 truncate text-xl font-semibold text-slate-950">{getInviteeName(invite)}</h2>
            <p className="mt-1 text-sm text-slate-500">{primaryCompanyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close invite details"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-9rem)] overflow-y-auto p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invite ID</div>
                <div className="mt-1 break-all font-mono text-sm text-slate-950">{formatInviteValue(invite.id)}</div>
                {inviteUrl ? (
                  <>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Invite Link</div>
                    <a
                      href={inviteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-2 break-all text-sm font-medium text-blue-700 hover:text-blue-900"
                    >
                      <span className="break-all">{inviteUrl}</span>
                      <ArrowTopRightOnSquareIcon className="h-4 w-4 flex-none" />
                    </a>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyInviteId}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <ClipboardDocumentIcon className="h-4 w-4" />
                  Copy ID
                </button>
                {inviteUrl ? (
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                    Copy Invite Link
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Field label="First Name" value={invite.firstName} />
            <Field label="Last Name" value={invite.lastName} />
            <Field label="Email" value={invite.email} />
            <Field label="User ID" value={invite.userId} />
            <Field label="Company Name" value={invite.companyName} />
            {/* <Field label="Company ID" value={invite.companyId} /> */}
            <Field label="Role Name" value={invite.roleName} />
            {/* <Field label="Role ID" value={invite.roleId} /> */}
            <Field label="Worker Type" value={invite.workerType} />
            <Field label="Current User" value={invite.currentUser} />
            <Field label="Status" value={invite.status} />
            <Field label="Access Status" value={accessStatus} />
            <Field label="Created" value={invite.dateCreated || invite.createdAt} />
            <Field label="Accepted At" value={invite.acceptedAt} />
            <Field label="Rejected At" value={invite.rejectedAt} />
            <Field label="Revoked At" value={invite.revokedAt} />
            <Field label="Last Sent" value={invite.lastSentAt} />
            <Field label="Access Updated" value={invite.accessUpdatedAt} />
            <Field label="Updated At" value={invite.updatedAt} />
            {/* <Field label="Linked Company Name" value={invite.linkedCompanyName} /> */}
            {/* <Field label="Linked Company ID" value={invite.linkedCompanyId} /> */}
          </div>

          <CompanyPublicPreview
            company={company}
            reviews={companyReviews}
            loading={companyLoading}
            error={companyError}
            companyId={companyId}
          />

          {additionalFields.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-900">Additional Fields</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {additionalFields.map(([key, value]) => (
                  <Field key={key} label={labelize(key)} value={value} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <XCircleIcon className="h-4 w-4" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export { CheckCircleIcon, XMarkIcon };
