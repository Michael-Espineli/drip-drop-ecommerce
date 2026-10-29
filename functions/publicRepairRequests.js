const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { createHash, randomUUID } = require("node:crypto");

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 5 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const LEASE_MS = 3 * 60 * 1000;
const EQUIPMENT_STATUSES = ["Operational", "Needs Repair", "Non-Operational", "Needs Maintenance"];
const PRIORITY_LABELS = { 1: "Critical", 2: "Recommended", 3: "Preventive", 4: "Optional Upgrade" };
const hash = (value) => createHash("sha256").update(value).digest("hex");

const text = (value, label, maxLength, required = false) => {
  if (value !== undefined && typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} must be text.`);
  }
  const result = (value || "").trim();
  if ((required && !result) || result.length > maxLength) {
    throw new HttpsError("invalid-argument", `Please provide a valid ${label.toLowerCase()} (up to ${maxLength} characters).`);
  }
  return result;
};

const companyIdFrom = (value) => {
  const companyId = text(value, "Company", 160, true);
  if (/[\/\\]/.test(companyId) || /^\.{1,2}$/.test(companyId)) {
    throw new HttpsError("invalid-argument", "This repair request link is invalid.");
  }
  return companyId;
};

const recordId = (value, label, required = false) => {
  const id = text(value, label, 160, required);
  if (/[\/\\]/.test(id) || /^\.{1,2}$/.test(id)) throw new HttpsError("invalid-argument", `Please select a valid ${label.toLowerCase()}.`);
  return id;
};
const firstText = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
const userName = (user) => firstText(user.userName, user.displayName, [user.firstName, user.lastName].filter(Boolean).join(" "), user.name, user.fullName, "Company user");
const customerName = (customer) => firstText(customer.displayAsCompany ? customer.companyName : "", [customer.firstName, customer.lastName].filter(Boolean).join(" "), customer.displayName, customer.name, customer.companyName, "Customer");
const isDeleted = (record) => record.deleted === true || record.isDeleted === true;
const isActiveUser = (user) => {
  const status = firstText(user.status, user.userStatus).toLowerCase();
  return !isDeleted(user) && user.active !== false && user.isActive !== false
    && (status === "active" || (!status && (user.active === true || user.isActive === true)));
};
const sortedOptions = (snapshot, getLabel, include = (record) => !isDeleted(record)) => snapshot.docs
  .filter((snapshot) => include(snapshot.data()))
  .map((snapshot) => ({ id: snapshot.id, label: getLabel(snapshot.data()) }))
  .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));
const loadRecord = async (firestore, companyId, collection, id, label) => {
  const snapshot = await firestore.doc(`companies/${companyId}/${collection}/${id}`).get();
  if (!snapshot.exists || isDeleted(snapshot.data())) throw new HttpsError("invalid-argument", `Please select a valid ${label} for this company.`);
  return { ...snapshot.data(), id: snapshot.id };
};
const locationLabel = (location) => firstText(location.nickName, location.address?.streetAddress, location.name, "Service location");
const bodyLabel = (body) => firstText(body.name, body.nickName, "Unnamed body of water");
const equipmentLabel = (equipment) => equipment.name ? `${equipment.name}${equipment.model ? ` - ${equipment.model}` : ""}` : firstText(equipment.model, "Unnamed equipment");
const requireCustomerLocation = (location, customerId) => {
  if (location.customerId !== customerId) throw new HttpsError("invalid-argument", "Please select a service location for the selected customer.");
};
const requireLocationItem = (item, locationId, customerId, label) => {
  if (item.serviceLocationId !== locationId || (item.customerId && item.customerId !== customerId)) {
    throw new HttpsError("invalid-argument", `Please select ${label} for the selected service location.`);
  }
};

const validatePhoto = (photo) => {
  const name = text(photo?.name, "Photo name", 160, true);
  const contentType = photo?.contentType;
  const data = photo?.data;
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)
    || typeof data !== "string" || !data.length
    || data.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new HttpsError("invalid-argument", "Photos must be JPG, PNG, or WebP files up to 2 MB each.");
  }
  const buffer = Buffer.from(data, "base64");
  const matchesType = contentType === "image/jpeg"
    ? buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : contentType === "image/png"
      ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (!matchesType || buffer.length > MAX_PHOTO_BYTES) {
    throw new HttpsError("invalid-argument", "One of the photos is not a supported image.");
  }
  return { name, contentType, buffer };
};

const validateSubmission = (data = {}) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Please provide a repair request.");
  }
  const companyId = companyIdFrom(data.companyId);
  if (typeof data.submissionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.submissionId)) {
    throw new HttpsError("invalid-argument", "Please refresh the page and try again.");
  }
  if (data.website) throw new HttpsError("invalid-argument", "Unable to submit this request.");
  const requesterCompanyUserId = recordId(data.requesterCompanyUserId, "Technician", true);
  const customerId = recordId(data.customerId, "Customer", true);
  const locationId = recordId(data.locationId, "Service location");
  const bodyOfWaterId = recordId(data.bodyOfWaterId, "Body of water");
  const equipmentId = recordId(data.equipmentId, "Equipment");
  const equipmentStatusUpdate = text(data.equipmentStatusUpdate, "Equipment status", 40);
  if ((bodyOfWaterId || equipmentId) && !locationId) throw new HttpsError("invalid-argument", "Please select a service location first.");
  if (equipmentStatusUpdate && (!equipmentId || !EQUIPMENT_STATUSES.includes(equipmentStatusUpdate))) {
    throw new HttpsError("invalid-argument", "Please select a valid equipment status and equipment.");
  }
  const description = text(data.description, "Description", 5000, true);
  const issuePriorityLevel = data.issuePriorityLevel ?? 2;
  if (!Number.isInteger(issuePriorityLevel) || !PRIORITY_LABELS[issuePriorityLevel]) {
    throw new HttpsError("invalid-argument", "Please select a valid priority.");
  }
  if (data.photos !== undefined && (!Array.isArray(data.photos) || data.photos.length > MAX_PHOTOS)) {
    throw new HttpsError("invalid-argument", "Please attach no more than 3 photos.");
  }
  const photos = (data.photos || []).map(validatePhoto);
  if (photos.reduce((total, photo) => total + photo.buffer.length, 0) > MAX_TOTAL_PHOTO_BYTES) {
    throw new HttpsError("invalid-argument", "Please keep the total photo size under 5 MB.");
  }
  return { companyId, submissionId: data.submissionId, requesterCompanyUserId, customerId, locationId, bodyOfWaterId, equipmentId, equipmentStatusUpdate, description, issuePriorityLevel, photos };
};

const loadCompany = async (firestore, companyId) => {
  const snapshot = await firestore.doc(`companies/${companyId}`).get();
  const company = snapshot.data();
  if (!snapshot.exists || company.deleted === true || company.publicProfileDisabled === true || company.publicRepairRequestsDisabled === true) {
    throw new HttpsError("not-found", "This company's repair request form is unavailable. Please contact the company directly.");
  }
  return { id: companyId, name: company.name || company.companyName || company.displayName || "Pool company" };
};

// Dependency injection keeps the anonymous intake and its failure paths testable.
const createHandlers = ({ firestore, getBucket, now = Date.now }) => ({
  getCompany: async (request) => {
    const companyId = companyIdFrom(request.data?.companyId);
    const company = await loadCompany(firestore, companyId);
    const [users, customers] = await Promise.all([
      firestore.collection(`companies/${companyId}/companyUsers`).select("userName", "displayName", "firstName", "lastName", "name", "fullName", "status", "userStatus", "active", "isActive", "deleted", "isDeleted").get(),
      firestore.collection(`companies/${companyId}/customers`).select("firstName", "lastName", "displayName", "name", "companyName", "displayAsCompany", "deleted", "isDeleted").get(),
    ]);
    return { company, users: sortedOptions(users, userName, isActiveUser), customers: sortedOptions(customers, customerName) };
  },

  getOptions: async (request) => {
    const companyId = companyIdFrom(request.data?.companyId);
    await loadCompany(firestore, companyId);
    const customerId = recordId(request.data?.customerId, "Customer", true);
    const locationId = recordId(request.data?.locationId, "Service location");
    await loadRecord(firestore, companyId, "customers", customerId, "customer");
    if (!locationId) {
      const locations = await firestore.collection(`companies/${companyId}/serviceLocations`).where("customerId", "==", customerId)
        .select("nickName", "name", "address.streetAddress", "deleted", "isDeleted").get();
      return { serviceLocations: sortedOptions(locations, locationLabel), bodiesOfWater: [], equipment: [] };
    }
    const location = await loadRecord(firestore, companyId, "serviceLocations", locationId, "service location");
    requireCustomerLocation(location, customerId);
    const [bodies, equipment] = await Promise.all([
      firestore.collection(`companies/${companyId}/bodiesOfWater`).where("serviceLocationId", "==", locationId)
        .select("name", "nickName", "customerId", "deleted", "isDeleted").get(),
      firestore.collection(`companies/${companyId}/equipment`).where("serviceLocationId", "==", locationId)
        .select("name", "model", "customerId", "deleted", "isDeleted").get(),
    ]);
    const include = (record) => !isDeleted(record) && (!record.customerId || record.customerId === customerId);
    return { bodiesOfWater: sortedOptions(bodies, bodyLabel, include), equipment: sortedOptions(equipment, equipmentLabel, include) };
  },

  submit: async (request) => {
    const input = validateSubmission(request.data);
    const company = await loadCompany(firestore, input.companyId);
    const [requester, customer, location, body, equipment] = await Promise.all([
      loadRecord(firestore, input.companyId, "companyUsers", input.requesterCompanyUserId, "active technician"),
      loadRecord(firestore, input.companyId, "customers", input.customerId, "customer"),
      input.locationId ? loadRecord(firestore, input.companyId, "serviceLocations", input.locationId, "service location") : null,
      input.bodyOfWaterId ? loadRecord(firestore, input.companyId, "bodiesOfWater", input.bodyOfWaterId, "body of water") : null,
      input.equipmentId ? loadRecord(firestore, input.companyId, "equipment", input.equipmentId, "equipment") : null,
    ]);
    if (!isActiveUser(requester)) throw new HttpsError("invalid-argument", "Please select an active company user.");
    if (location) requireCustomerLocation(location, input.customerId);
    if (body) requireLocationItem(body, input.locationId, input.customerId, "a body of water");
    if (equipment) requireLocationItem(equipment, input.locationId, input.customerId, "equipment");
    const requestId = `public_rr_${hash(input.companyId).slice(0, 12)}_${input.submissionId}`;
    const receiptRef = firestore.doc(`publicRepairRequestSubmissions/${hash(`${input.companyId}:${input.submissionId}`)}`);
    const collectionPath = `companies/${input.companyId}/repairRequests`;
    const requestRef = firestore.doc(`${collectionPath}/${requestId}`);
    const fingerprintInput = { ...input };
    // Keep receipts from forms submitted before priority existed retryable.
    if (input.issuePriorityLevel === 2) delete fingerprintInput.issuePriorityLevel;
    const fingerprint = hash(JSON.stringify({ ...fingerprintInput, photos: input.photos.map(({ name, contentType, buffer }) => ({ name, contentType, hash: hash(buffer) })) }));
    const leaseId = randomUUID();
    const timestamp = now();
    const clientKey = hash(`${input.companyId}:${request.rawRequest?.ip || "unknown"}`);
    const limits = [
      { ref: firestore.doc(`publicRepairRequestLimits/client_${clientKey}`), windowMs: HOUR_MS, max: 30 },
      { ref: firestore.doc(`publicRepairRequestLimits/company_${hash(input.companyId)}`), windowMs: 24 * HOUR_MS, max: 1000 },
    ];

    const completed = await firestore.runTransaction(async (transaction) => {
      const receipt = (await transaction.get(receiptRef)).data();
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new HttpsError("invalid-argument", "This submission has already been used. Please start a new request.");
        if (receipt.status === "complete") return true;
        if (receipt.status === "pending" && receipt.leaseUntil > timestamp) {
          throw new HttpsError("aborted", "Your request is still being submitted. Please wait a moment and try again.");
        }
      }
      const snapshots = await Promise.all(limits.map(({ ref }) => transaction.get(ref)));
      limits.forEach(({ ref, windowMs, max }, index) => {
        const previous = snapshots[index].data() || {};
        const inWindow = timestamp - (previous.windowStart || 0) < windowMs;
        const count = inWindow ? previous.count || 0 : 0;
        if (count >= max) throw new HttpsError("resource-exhausted", "Too many repair requests. Please try again later or contact the company directly.");
        transaction.set(ref, { count: count + 1, windowStart: inWindow ? previous.windowStart : timestamp });
      });
      transaction.set(receiptRef, { fingerprint, status: "pending", leaseId, leaseUntil: timestamp + LEASE_MS, createdAt: new Date(timestamp) });
      return false;
    });
    if (completed) return { requestId };

    const uploadedFiles = [];
    try {
      const photoUrls = [];
      const bucket = input.photos.length ? getBucket() : null;
      for (const [index, photo] of input.photos.entries()) {
        const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[photo.contentType];
        const file = bucket.file(`companies/${input.companyId}/publicRepairRequests/${requestId}/${leaseId}/${index}.${extension}`);
        const token = randomUUID();
        uploadedFiles.push(file);
        await file.save(photo.buffer, {
          resumable: false,
          metadata: { contentType: photo.contentType, metadata: { firebaseStorageDownloadTokens: token } },
        });
        photoUrls.push({
          id: `img_${randomUUID()}`,
          description: photo.name,
          imageURL: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`,
        });
      }

      const date = new Date(timestamp);
      const address = location?.address || {};
      const serviceLocationAddress = [address.streetAddress, address.city, address.state, address.zip || address.zipCode].filter(Boolean).join(", ");
      const webPath = `/company/repair-requests/detail/${requestId}`;
      await firestore.runTransaction(async (transaction) => {
        const receipt = (await transaction.get(receiptRef)).data();
        if (receipt?.leaseId !== leaseId) throw new HttpsError("aborted", "Please try submitting your request again.");
        transaction.create(requestRef, {
          id: requestId,
          companyId: input.companyId,
          companyName: company.name,
          source: "publicTechnician",
          customerId: customer.id,
          customerName: customerName(customer),
          requesterId: firstText(requester.userId, requester.uid, requester.authUserId, requester.id),
          requesterCompanyUserId: requester.id,
          requesterName: userName(requester),
          requesterIdentityVerified: false,
          submittedByUserId: request.auth?.uid || "",
          userId: "",
          serviceLocationAddress,
          serviceLocationName: location ? locationLabel(location) : "",
          locationId: input.locationId,
          locationName: location ? locationLabel(location) : "",
          bodyOfWaterId: input.bodyOfWaterId,
          bodyOfWaterName: body ? bodyLabel(body) : "",
          equipmentId: input.equipmentId,
          equipmentName: equipment ? equipmentLabel(equipment) : "",
          equipmentStatusUpdate: input.equipmentStatusUpdate,
          description: input.description,
          issuePriorityLevel: input.issuePriorityLevel,
          issuePriorityLabel: PRIORITY_LABELS[input.issuePriorityLevel],
          priorityLevel: input.issuePriorityLevel,
          priorityLabel: PRIORITY_LABELS[input.issuePriorityLevel],
          status: "Unresolved",
          jobIds: [],
          photoUrls,
          date,
          createdAt: date,
        });
        const alertId = `repair_request_created_${requestId}`;
        transaction.create(firestore.doc(`companies/${input.companyId}/alerts/${alertId}`), {
          id: alertId, companyId: input.companyId, recipientCompanyId: input.companyId,
          title: "New external repair request", name: "New external repair request",
          message: `${userName(requester)} submitted a repair request for ${customerName(customer)}. ${input.description.slice(0, 300)}`,
          status: "unread", read: false, severity: "warning", type: "repair_request_created",
          source: "repairRequests", sourceId: requestId, route: webPath,
          category: "repairRequest", hasItem: true, itemId: requestId, itemName: customerName(customer),
          targetScope: "team", deliveryTargets: ["web", "ios"],
          relatedEntity: { type: "repairRequest", id: requestId, label: customerName(customer), companyId: input.companyId, collectionPath, webPath, companyWebPath: webPath },
          date, createdAt: date, updatedAt: date,
        });
        if (equipment && input.equipmentStatusUpdate) {
          transaction.update(firestore.doc(`companies/${input.companyId}/equipment/${equipment.id}`), { status: input.equipmentStatusUpdate });
        }
        transaction.set(receiptRef, { status: "complete", leaseUntil: 0 }, { merge: true });
      });
      return { requestId };
    } catch (error) {
      // A lost commit response must not remove photos from a completed request.
      const savedReceipt = await receiptRef.get();
      if (savedReceipt.data()?.status === "complete") return { requestId };
      await Promise.allSettled(uploadedFiles.map((file) => file.delete({ ignoreNotFound: true })));
      await firestore.runTransaction(async (transaction) => {
        const receipt = (await transaction.get(receiptRef)).data();
        if (receipt?.leaseId === leaseId && receipt.status !== "complete") {
          transaction.set(receiptRef, { status: "failed", leaseUntil: 0 }, { merge: true });
        }
      });
      if (error instanceof HttpsError) throw error;
      console.error("Unable to save public repair request", { requestId, code: error.code });
      throw new HttpsError("internal", "We couldn't submit your repair request. Please try again.");
    }
  },
});

const handlers = () => createHandlers({ firestore: admin.firestore(), getBucket: () => admin.storage().bucket() });
const callableOptions = { cors: [/^https:\/\/([a-z0-9-]+\.)?dripdrop-poolapp\.com$/, /^https:\/\/the-pool-app-(dev|3e652)\.(web\.app|firebaseapp\.com)$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/], timeoutSeconds: 120, maxInstances: 10, memory: "256MiB" };

exports.getPublicRepairRequestCompany = onCall(callableOptions, (request) => handlers().getCompany(request));
exports.getPublicRepairRequestOptions = onCall(callableOptions, (request) => handlers().getOptions(request));
exports.submitPublicRepairRequest = onCall(callableOptions, (request) => handlers().submit(request));
exports.createHandlers = createHandlers;
exports.validateSubmission = validateSubmission;
