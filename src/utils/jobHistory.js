const text = (value) => typeof value === "string" ? value.trim() : "";
const meaningfulName = (value) => text(value) && !["unknown", "unknown user"].includes(text(value).toLowerCase());

export const resolveJobCreator = ({ user = {}, profile = {} } = {}) => {
  const userId = text(user.uid || user.id || profile.id);
  const matchingProfile = !profile.id || profile.id === userId ? profile : {};
  const names = [[matchingProfile.firstName, matchingProfile.lastName].filter(Boolean).join(" "), matchingProfile.userName,
    user.displayName, user.userName, user.email, matchingProfile.email, userId];
  return { userId, userName: names.find(meaningfulName) || userId };
};

export const buildJobCreatedHistory = ({ job, creator, createdAt, createdAtMillis, previous = {}, id = "created" }) => {
  if (!text(creator?.userId)) throw new Error("Sign in before creating a job so its creator can be recorded.");
  return {
    ...previous, id, companyId: job.companyId || previous.companyId || "", jobId: job.id,
    jobInternalId: job.internalId || "", eventType: "Created", title: previous.title || "Job created",
    description: previous.description || "Job initially created.", changes: previous.changes || [],
    metadata: previous.metadata || {}, severity: "success",
    actorUserId: creator.userId, actorUserName: meaningfulName(creator.userName) ? creator.userName : creator.userId,
    actorCompanyUserId: creator.companyUserId || "", createdAt, createdAtMillis,
  };
};

export const jobHistoryActorName = (event = {}) =>
  (meaningfulName(event.actorUserName) ? event.actorUserName : "") || event.actorUserId || event.tech || "Creator not recorded";

export const jobHistoryDate = (event = {}) => {
  const value = event.createdAt || event.createdAtMillis || event.date;
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatJobHistoryDate = (event) => {
  const date = jobHistoryDate(event);
  return date ? new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date) : "Time not recorded";
};
