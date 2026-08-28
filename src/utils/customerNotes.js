import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";

export const customerNoteId = () => `comp_cus_note_${uuidv4()}`;

const cleanText = (value) => String(value || "").trim();

const optionalTextField = (fieldName, value) => {
  const text = cleanText(value);
  return text ? { [fieldName]: text } : {};
};

const optionalArrayField = (fieldName, value) => (
  Array.isArray(value) && value.length ? { [fieldName]: value } : {}
);

const optionalObjectField = (fieldName, value) => (
  value && typeof value === "object" && Object.keys(value).length ? { [fieldName]: value } : {}
);

export const createCustomerNote = async ({
  db,
  companyId,
  customerId,
  customerName = "",
  bodyOfWaterId = "",
  bodyOfWaterName = "",
  serviceLocationId = "",
  userId = "",
  userName = "",
  authorId = "",
  authorName = "",
  text = "",
  note = "",
  comment = "",
  audience = "office",
  visibility,
  resolved = false,
  source = "",
  sourceType = "",
  sourceId = "",
  sourcePath = "",
  jobId = "",
  repairRequestId = "",
  performanceReviewId = "",
  references = null,
  metadata = null,
  attachedReports = [],
  attachments = [],
  extraFields = {},
} = {}) => {
  const noteText = cleanText(note || comment || text);

  if (!db || !companyId || !customerId) {
    throw new Error("Missing customer note destination.");
  }

  if (!noteText) {
    throw new Error("Customer note text is required.");
  }

  const id = customerNoteId();
  const nowMillis = Date.now();
  const normalizedAudience = cleanText(audience) || "office";
  const normalizedAuthorName = cleanText(authorName || userName) || "Unknown";
  const normalizedUserName = cleanText(userName || authorName) || normalizedAuthorName;
  const normalizedUserId = cleanText(userId || authorId);

  const payload = {
    id,
    companyId,
    customerId,
    customerName: cleanText(customerName),
    bodyOfWaterId: cleanText(bodyOfWaterId),
    bodyOfWaterName: cleanText(bodyOfWaterName),
    serviceLocationId: cleanText(serviceLocationId),
    userId: normalizedUserId,
    userName: normalizedUserName,
    authorId: cleanText(authorId || userId),
    authorName: normalizedAuthorName,
    note: noteText,
    comment: noteText,
    text: noteText,
    audience: normalizedAudience,
    visibility: cleanText(visibility) || normalizedAudience,
    resolved: Boolean(resolved),
    date: serverTimestamp(),
    dateMillis: nowMillis,
    createdAt: serverTimestamp(),
    createdAtMillis: nowMillis,
    updatedAt: serverTimestamp(),
    updatedAtMillis: nowMillis,
    ...optionalTextField("source", source),
    ...optionalTextField("sourceType", sourceType),
    ...optionalTextField("sourceId", sourceId),
    ...optionalTextField("sourcePath", sourcePath),
    ...optionalTextField("jobId", jobId),
    ...optionalTextField("repairRequestId", repairRequestId),
    ...optionalTextField("performanceReviewId", performanceReviewId),
    ...optionalObjectField("references", references),
    ...optionalObjectField("metadata", metadata),
    ...optionalArrayField("attachedReports", attachedReports),
    ...optionalArrayField("attachments", attachments),
    ...extraFields,
  };

  await setDoc(
    doc(db, "companies", companyId, "customers", customerId, "notes", id),
    payload
  );

  return { id, payload };
};
