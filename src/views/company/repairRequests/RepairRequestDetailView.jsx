import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, updateDoc, deleteDoc, where, serverTimestamp, setDoc } from 'firebase/firestore';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { v4 as uuidv4 } from 'uuid';
import { db, storage } from '../../../utils/config';
import {
  REPAIR_REQUEST_STATUS,
  REPAIR_REQUEST_STATUS_OPTIONS,
  RepairRequest,
  displayRepairRequestStatus,
  normalizeRepairRequestStatus,
  repairRequestStatusForSelection,
} from '../../../utils/models/RepairRequest';
import { EQUIPMENT_STATUS, EQUIPMENT_STATUS_OPTIONS } from '../../../utils/models/Equipment';
import { Context } from "../../../context/AuthContext";
import { format } from 'date-fns';
import useCompanyPermissions from '../../../hooks/useCompanyPermissions';
import { displayRecordReference, linkedReferenceText } from '../../../utils/displayReferences';
import {
  buildCompanyRepairRequestPhotoPath,
  getRepairRequestPhotoUrl,
  uploadRepairRequestPhoto,
} from '../../../utils/repairRequestPhotos';
import { createCustomerNote } from '../../../utils/customerNotes';
import {
  DEFAULT_SUGGESTED_WORK_TIER,
  SUGGESTED_WORK_STATUS,
  SUGGESTED_WORK_TIER_OPTIONS,
  getSuggestedWorkTierLabel,
  normalizeSuggestedWorkTier,
  suggestedWorkIdForSource,
} from '../../../utils/models/SuggestedWork';
import { appAlert, appConfirm } from '../../../utils/appDialog';
import ShareItemButton from '../../components/share/ShareItemButton';
import PartApprovalCreateModal from '../partApprovals/PartApprovalCreateModal';
import CreateJobFlowLauncher from '../jobs/CreateJobFlowLauncher';

const RepairRequestDetailView = () => {
  const { recentlySelectedCompany, dataBaseUser, user } = useContext(Context);
  const { can, requirePermission } = useCompanyPermissions();
  const { repairRequestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [repairRequest, setRepairRequest] = useState(null);
  const [sourcePath, setSourcePath] = useState(location.state?.sourcePath || "company");
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    status: REPAIR_REQUEST_STATUS.UNRESOLVED,
  });
  const [savingStatus, setSavingStatus] = useState(false);
  const [connectedEquipmentStatus, setConnectedEquipmentStatus] = useState(EQUIPMENT_STATUS.OPERATIONAL);
  const [savingEquipmentStatus, setSavingEquipmentStatus] = useState(false);

  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [availableJobs, setAvailableJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [connectingJob, setConnectingJob] = useState(false);
  const [suggestedWorkTier, setSuggestedWorkTier] = useState(DEFAULT_SUGGESTED_WORK_TIER);
  const [convertingToSuggestedWork, setConvertingToSuggestedWork] = useState(false);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [showPartApprovalModal, setShowPartApprovalModal] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [commentFilter, setCommentFilter] = useState("All");
  const [copyNewCommentToCustomerNotes, setCopyNewCommentToCustomerNotes] = useState(false);
  const [copyingCommentToCustomerNoteId, setCopyingCommentToCustomerNoteId] = useState("");
  const repairRequestJobIdsKey = (repairRequest?.jobIds || []).join("|");

  const getRequestRef = (path = sourcePath) => (
    path === "homeowner"
      ? doc(db, 'homeownerRepairRequests', repairRequestId)
      : doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId)
  );

  const getCommentsRef = (path = sourcePath) => (
    path === "homeowner"
      ? collection(db, 'homeownerRepairRequests', repairRequestId, 'comments')
      : collection(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId, 'comments')
  );

  const getConnectedEquipmentRef = () => {
    if (!repairRequest?.equipmentId) return null;

    return sourcePath === "homeowner"
      ? doc(db, "homeownerEquipment", repairRequest.equipmentId)
      : doc(db, "companies", recentlySelectedCompany, "equipment", repairRequest.equipmentId);
  };

  const getDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value === "number") return new Date(value);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getDateMillis = (value) => {
    const date = getDateValue(value);
    return date ? date.getTime() : 0;
  };

  const formatJobOption = (job) => {
    const title = displayRecordReference(job, "Job");
    const description = job.description || job.type || "No description";
    const date = getDateValue(job.dateCreated || job.createdAt);
    const dateLabel = date ? format(date, "MMM d, yyyy") : "No date";
    const status = job.operationStatus || job.billingStatus || "No status";

    return `${title} - ${description} (${status}, ${dateLabel})`;
  };

  const getUserId = () => user?.uid || dataBaseUser?.id || "";

  const getAuditUserName = () => (
    `${dataBaseUser?.firstName || ""} ${dataBaseUser?.lastName || ""}`.trim() ||
    dataBaseUser?.userName ||
    user?.displayName ||
    user?.email ||
    "Unknown"
  );

  const filteredComments = useMemo(() => {
    if (commentFilter === "Open") return (comments || []).filter((comment) => !comment.resolved);
    if (commentFilter === "Resolved") return (comments || []).filter((comment) => !!comment.resolved);
    return comments || [];
  }, [commentFilter, comments]);

  const partApprovalCustomer = useMemo(() => {
    if (!repairRequest?.customerId) return null;

    return {
      id: repairRequest.customerId,
      name: repairRequest.customerName || "Customer",
      displayName: repairRequest.customerName || "Customer",
      email: repairRequest.customerEmail || repairRequest.email || repairRequest.billingEmail || "",
      billingEmail: repairRequest.billingEmail || repairRequest.customerEmail || repairRequest.email || "",
      customerUserId: repairRequest.customerUserId || repairRequest.homeownerId || repairRequest.userId || "",
    };
  }, [repairRequest]);

  const partApprovalServiceLocation = useMemo(() => {
    const serviceLocationId = repairRequest?.serviceLocationId || repairRequest?.locationId || "";
    if (!serviceLocationId) return null;

    return {
      id: serviceLocationId,
      name: repairRequest.serviceLocationName || repairRequest.locationName || "Service Location",
      nickName: repairRequest.serviceLocationName || repairRequest.locationName || "",
      streetAddress: repairRequest.serviceLocationAddress || repairRequest.locationAddress || "",
    };
  }, [repairRequest]);

  const partApprovalDefaultForm = useMemo(() => ({
    mode: "manual",
    description: repairRequest?.description || "",
    quantity: "1",
  }), [repairRequest?.description]);

  const partApprovalWorkflowContext = useMemo(() => {
    if (!repairRequest?.id) return {};

    return {
      sourceRecordType: "repairRequest",
      sourceRecordId: repairRequest.id,
      sourceRecordPath: sourcePath === "homeowner"
        ? `homeownerRepairRequests/${repairRequest.id}`
        : `companies/${recentlySelectedCompany}/repairRequests/${repairRequest.id}`,
      repairRequestId: repairRequest.id,
      repairRequestSourcePath: sourcePath,
      repairRequestPath: sourcePath === "homeowner"
        ? `homeownerRepairRequests/${repairRequest.id}`
        : `companies/${recentlySelectedCompany}/repairRequests/${repairRequest.id}`,
      repairRequestDescription: repairRequest.description || "",
      requestStatus: repairRequest.status || "",
      serviceLocationAddress: repairRequest.serviceLocationAddress || repairRequest.locationAddress || "",
    };
  }, [recentlySelectedCompany, repairRequest, sourcePath]);

  const getRepairRequestCustomerName = () => (
    repairRequest?.customerName ||
    repairRequest?.requesterName ||
    repairRequest?.name ||
    "Customer"
  );

  const formatCommentDateLabel = (comment = {}) => {
    const date = getDateValue(comment.date || comment.createdAt || comment.dateMillis || comment.createdAtMillis);
    return date ? format(date, "MMM d, yyyy - h:mm a") : "";
  };

  const buildRepairRequestCommentCustomerNoteText = (comment = {}) => {
    const commentText = String(comment.comment || comment.note || comment.text || "").trim();
    const requestLabel = displayRecordReference(repairRequest, "Repair Request") || repairRequestId;
    const contextLines = [
      `Repair request comment copied from ${requestLabel}.`,
      `Comment by: ${comment.userName || comment.authorName || "Unknown"}`,
      formatCommentDateLabel(comment) ? `Comment date: ${formatCommentDateLabel(comment)}` : "",
      `Customer: ${getRepairRequestCustomerName()}`,
      repairRequest?.serviceLocationName || repairRequest?.locationName
        ? `Location: ${repairRequest.serviceLocationName || repairRequest.locationName}`
        : "",
      repairRequest?.serviceLocationAddress || repairRequest?.locationAddress
        ? `Address: ${repairRequest.serviceLocationAddress || repairRequest.locationAddress}`
        : "",
      repairRequest?.bodyOfWaterName ? `Body of water: ${repairRequest.bodyOfWaterName}` : "",
      repairRequest?.equipmentName || repairRequest?.equipmentModel
        ? `Equipment: ${repairRequest.equipmentName || repairRequest.equipmentModel}`
        : "",
    ].filter(Boolean);

    return [...contextLines, "", commentText].join("\n");
  };

  const createCustomerNoteFromRepairRequestComment = async (comment = {}) => {
    const commentText = String(comment.comment || comment.note || comment.text || "").trim();
    const customerId = String(repairRequest?.customerId || "").trim();
    const userId = getUserId();

    if (!commentText) throw new Error("Comment text is required.");
    if (!recentlySelectedCompany || !customerId) throw new Error("This repair request needs a customer before copying to customer notes.");
    if (!userId) throw new Error("Missing signed-in user.");

    return createCustomerNote({
      db,
      companyId: recentlySelectedCompany,
      customerId,
      customerName: getRepairRequestCustomerName(),
      bodyOfWaterId: repairRequest?.bodyOfWaterId || "",
      bodyOfWaterName: repairRequest?.bodyOfWaterName || "",
      serviceLocationId: repairRequest?.serviceLocationId || repairRequest?.locationId || "",
      userId,
      userName: getAuditUserName(),
      authorId: userId,
      authorName: getAuditUserName(),
      note: buildRepairRequestCommentCustomerNoteText(comment),
      audience: "office",
      visibility: "office",
      source: "repairRequestComment",
      sourceType: "repairRequestComment",
      sourceId: comment.id || "",
      sourcePath: comment.id
        ? `${sourcePath === "homeowner" ? "homeownerRepairRequests" : `companies/${recentlySelectedCompany}/repairRequests`}/${repairRequestId}/comments/${comment.id}`
        : `${sourcePath === "homeowner" ? "homeownerRepairRequests" : `companies/${recentlySelectedCompany}/repairRequests`}/${repairRequestId}/comments`,
      repairRequestId: repairRequest.id || repairRequestId,
      metadata: {
        commentId: comment.id || "",
        repairRequestSourcePath: sourcePath,
        originalCommentAuthorName: comment.userName || comment.authorName || "",
      },
    });
  };

  const copyRepairRequestCommentToCustomerNotes = async (comment = {}) => {
    if (!requirePermission("34", "copy repair request comments to customer notes")) return;

    try {
      setCopyingCommentToCustomerNoteId(comment.id || "comment");
      await createCustomerNoteFromRepairRequestComment(comment);
      appAlert("Comment copied to customer notes.");
    } catch (error) {
      console.error("Error copying repair request comment to customer notes:", error);
      appAlert(error?.message || "Failed to copy comment to customer notes.");
    } finally {
      setCopyingCommentToCustomerNoteId("");
    }
  };

  useEffect(() => {
    const fetchRepairRequest = async () => {
      if (recentlySelectedCompany && repairRequestId) {
        try {
          const requestRefForSource = (path) => (
            path === "homeowner"
              ? doc(db, 'homeownerRepairRequests', repairRequestId)
              : doc(db, 'companies', recentlySelectedCompany, 'repairRequests', repairRequestId)
          );
          const preferredSourcePath = location.state?.sourcePath || "company";
          const fallbackSourcePath = preferredSourcePath === "homeowner" ? "company" : "homeowner";
          let docSnap = await getDoc(requestRefForSource(preferredSourcePath));
          let loadedSourcePath = preferredSourcePath;

          if (!docSnap.exists()) {
            docSnap = await getDoc(requestRefForSource(fallbackSourcePath));
            loadedSourcePath = fallbackSourcePath;
          }

          if (docSnap.exists()) {
            const data = docSnap.data();
            const req = {
              ...data,
              ...RepairRequest.fromFirestore(docSnap),
              id: data.id || docSnap.id,
            };
            setRepairRequest(req);
            setSourcePath(loadedSourcePath);
            setDescriptionDraft(req.description || "");
            setFormData({
              status: repairRequestStatusForSelection(req.status),
            });
          } else {
            console.log("No such document!");
          }
        } catch (err) {
          console.error("Error fetching repair request:", err);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchRepairRequest();
  }, [repairRequestId, recentlySelectedCompany, location.state?.sourcePath]);

  useEffect(() => {
    const fetchCustomerJobs = async () => {
      if (!recentlySelectedCompany || !repairRequest?.customerId) {
        setAvailableJobs([]);
        setSelectedJobId("");
        return;
      }

      try {
        setLoadingJobs(true);

        const jobsSnap = await getDocs(
          query(
            collection(db, "companies", recentlySelectedCompany, "workOrders"),
            where("customerId", "==", repairRequest.customerId)
          )
        );

        const jobs = jobsSnap.docs
          .map((jobDoc) => ({
            id: jobDoc.id,
            ...jobDoc.data(),
          }))
          .sort((a, b) => getDateMillis(b.dateCreated || b.createdAt) - getDateMillis(a.dateCreated || a.createdAt));

        const connectedIds = new Set(repairRequest.jobIds || []);
        const firstAvailableJob = jobs.find((job) => !connectedIds.has(job.id));

        setAvailableJobs(jobs);
        setSelectedJobId((prev) => (
          prev && jobs.some((job) => job.id === prev && !connectedIds.has(job.id))
            ? prev
            : firstAvailableJob?.id || ""
        ));
      } catch (error) {
        console.error("Error fetching customer jobs:", error);
        setAvailableJobs([]);
        setSelectedJobId("");
      } finally {
        setLoadingJobs(false);
      }
    };

    fetchCustomerJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, repairRequest?.customerId, repairRequestJobIdsKey]);

  useEffect(() => {
    const fetchConnectedEquipmentStatus = async () => {
      const equipmentRef = getConnectedEquipmentRef();

      if (!equipmentRef) {
        setConnectedEquipmentStatus(EQUIPMENT_STATUS.OPERATIONAL);
        return;
      }

      try {
        const equipmentSnap = await getDoc(equipmentRef);
        const equipmentStatus = equipmentSnap.exists()
          ? equipmentSnap.data()?.status || EQUIPMENT_STATUS.OPERATIONAL
          : EQUIPMENT_STATUS.OPERATIONAL;

        setConnectedEquipmentStatus(equipmentStatus);
      } catch (error) {
        console.error("Error loading connected equipment status:", error);
        setConnectedEquipmentStatus(EQUIPMENT_STATUS.OPERATIONAL);
      }
    };

    fetchConnectedEquipmentStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repairRequest?.equipmentId, sourcePath, recentlySelectedCompany]);

  useEffect(() => {
    if (!recentlySelectedCompany || !repairRequestId || !sourcePath) return undefined;

    setCommentsLoading(true);
    const commentsQ = query(getCommentsRef(sourcePath), orderBy("date", "desc"));

    const unsubscribe = onSnapshot(
      commentsQ,
      (snapshot) => {
        setComments(snapshot.docs.map((commentDoc) => ({
          id: commentDoc.id,
          ...commentDoc.data(),
        })));
        setCommentsLoading(false);
      },
      (error) => {
        console.error("Error loading repair request comments:", error);
        setCommentsLoading(false);
        appAlert("Failed to load repair request comments.");
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, repairRequestId, sourcePath]);

  useEffect(() => {
    if (!selectedPhoto) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSelectedPhoto(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedPhoto]);

  const handlePartApprovalCreated = async (approval) => {
    if (!approval?.id || !repairRequest?.id) return;

    try {
      await updateDoc(getRequestRef(), {
        partApprovalIds: arrayUnion(approval.id),
        lastPartApprovalId: approval.id,
        lastPartApprovalStatus: approval.status || approval.approvalStatus || "pending",
        updatedAt: serverTimestamp(),
      });

      setRepairRequest((prev) => ({
        ...prev,
        partApprovalIds: Array.from(new Set([...(prev?.partApprovalIds || []), approval.id])),
        lastPartApprovalId: approval.id,
        lastPartApprovalStatus: approval.status || approval.approvalStatus || "pending",
      }));
    } catch (error) {
      console.error("Error linking part approval to repair request:", error);
      appAlert("Part approval was created, but it could not be linked back to this repair request.");
    }
  };

  const handleConvertToSuggestedWork = async () => {
    if (!repairRequest?.id || convertingToSuggestedWork) return;
    if (!requirePermission("34", "update repair requests")) return;
    if (!recentlySelectedCompany) return;
    if (!repairRequest.customerId) {
      await appAlert("Attach this request to a customer before converting it to suggested work.");
      return;
    }

    const ok = await appConfirm({
      title: "Move Repair Request",
      message: "Move this repair request to Suggested Work? It will stay linked here and will be available from the company suggested work page.",
      confirmLabel: "Move Request",
    });
    if (!ok) return;

    try {
      setConvertingToSuggestedWork(true);

      const normalizedTier = normalizeSuggestedWorkTier(suggestedWorkTier);
      const priorityLabel = getSuggestedWorkTierLabel(normalizedTier);
      const suggestedWorkId = suggestedWorkIdForSource("repair_request", repairRequest.id);
      const nowMillis = Date.now();
      const sourceCollection = sourcePath === "homeowner"
        ? "homeownerRepairRequests"
        : `companies/${recentlySelectedCompany}/repairRequests`;

      const suggestedWorkRecord = {
        id: suggestedWorkId,
        companyId: recentlySelectedCompany,
        customerId: repairRequest.customerId || "",
        customerName: repairRequest.customerName || "",
        title: repairRequest.description
          ? `${priorityLabel}: ${repairRequest.description.slice(0, 90)}`
          : `${priorityLabel}: Repair request`,
        description: repairRequest.description || "",
        note: repairRequest.description || "",
        status: SUGGESTED_WORK_STATUS.OPEN,
        suggestionStatus: SUGGESTED_WORK_STATUS.OPEN,
        priorityLevel: normalizedTier,
        priorityLabel,
        solutionTier: normalizedTier,
        solutionTierLabel: priorityLabel,
        sourceType: "repairRequest",
        sourceId: repairRequest.id,
        sourcePath: sourcePath === "homeowner"
          ? `homeownerRepairRequests/${repairRequest.id}`
          : `companies/${recentlySelectedCompany}/repairRequests/${repairRequest.id}`,
        sourceCollection,
        repairRequestId: repairRequest.id,
        repairRequestSourcePath: sourcePath,
        requestStatus: repairRequest.status || "",
        requesterId: repairRequest.requesterId || "",
        requesterName: repairRequest.requesterName || "",
        serviceLocationId: repairRequest.locationId || repairRequest.serviceLocationId || "",
        serviceLocationName: repairRequest.locationName || repairRequest.serviceLocationName || "",
        bodyOfWaterId: repairRequest.bodyOfWaterId || "",
        bodyOfWaterName: repairRequest.bodyOfWaterName || "",
        equipmentId: repairRequest.equipmentId || "",
        equipmentName: repairRequest.equipmentName || repairRequest.equipmentModel || "",
        photoUrls: repairRequest.photoUrls || [],
        createdAt: serverTimestamp(),
        createdAtMillis: nowMillis,
        updatedAt: serverTimestamp(),
        updatedAtMillis: nowMillis,
      };

      await Promise.all([
        setDoc(
          doc(db, "companies", recentlySelectedCompany, "suggestedWork", suggestedWorkId),
          suggestedWorkRecord,
          { merge: true }
        ),
        updateDoc(getRequestRef(), {
          status: REPAIR_REQUEST_STATUS.SUGGESTED_WORK,
          suggestedWorkId,
          suggestedWorkPriorityLevel: normalizedTier,
          suggestedWorkPriorityLabel: priorityLabel,
          updatedAt: serverTimestamp(),
        }),
      ]);

      setRepairRequest((prev) => ({
        ...prev,
        status: REPAIR_REQUEST_STATUS.SUGGESTED_WORK,
        suggestedWorkId,
        suggestedWorkPriorityLevel: normalizedTier,
        suggestedWorkPriorityLabel: priorityLabel,
      }));
      setFormData((prev) => ({
        ...prev,
        status: REPAIR_REQUEST_STATUS.SUGGESTED_WORK,
      }));
      appAlert("Repair request moved to Suggested Work.");
    } catch (error) {
      console.error("Error converting repair request to suggested work:", error);
      appAlert("Failed to convert this repair request to suggested work.");
    } finally {
      setConvertingToSuggestedWork(false);
    }
  };

  const addComment = async () => {
    const trimmedComment = newComment.trim();
    const userId = getUserId();
    const shouldCopyToCustomerNotes = copyNewCommentToCustomerNotes && Boolean(repairRequest?.customerId);

    if (!requirePermission("34", "update repair requests")) return;
    if (!userId) {
      appAlert("Missing user information. Please sign in again before adding a comment.");
      return;
    }
    if (!trimmedComment) {
      appAlert("Write a comment first.");
      return;
    }
    if (copyNewCommentToCustomerNotes && !repairRequest?.customerId) {
      appAlert("Attach this request to a customer before copying to customer notes.");
      return;
    }
    if (!recentlySelectedCompany || !repairRequest?.id || addingComment) return;

    try {
      setAddingComment(true);

      const id = `rep_req_com_${uuidv4()}`;
      const authorName = getAuditUserName();
      const dateMillis = Date.now();
      await setDoc(doc(getCommentsRef(), id), {
        id,
        repairRequestId: repairRequest.id,
        companyId: recentlySelectedCompany,
        userId,
        userName: authorName,
        authorId: userId,
        authorName,
        date: serverTimestamp(),
        dateMillis,
        comment: trimmedComment,
        resolved: false,
        sourcePath,
      });

      let copyFailed = false;
      if (shouldCopyToCustomerNotes) {
        try {
          await createCustomerNoteFromRepairRequestComment({
            id,
            comment: trimmedComment,
            userName: authorName,
            authorName,
            dateMillis,
          });
        } catch (copyError) {
          copyFailed = true;
          console.error("Error copying new repair request comment to customer notes:", copyError);
          appAlert(copyError?.message || "Comment added, but the customer note copy failed.");
        }
      }

      setNewComment("");
      if (!copyFailed && shouldCopyToCustomerNotes) setCopyNewCommentToCustomerNotes(false);
      if (shouldCopyToCustomerNotes && !copyFailed) {
        appAlert("Comment added and copied to customer notes.");
      }
    } catch (error) {
      console.error("Error adding repair request comment:", error);
      appAlert("Failed to add comment.");
    } finally {
      setAddingComment(false);
    }
  };

  const setCommentResolved = async (commentId, resolved) => {
    if (!requirePermission("34", "update repair requests")) return;
    if (!recentlySelectedCompany || !repairRequest?.id || !commentId) return;

    try {
      await updateDoc(doc(getCommentsRef(), commentId), {
        resolved,
        resolvedAt: resolved ? serverTimestamp() : null,
        resolvedByUserId: resolved ? getUserId() : "",
        resolvedByUserName: resolved ? getAuditUserName() : "",
      });
    } catch (error) {
      console.error("Error updating repair request comment:", error);
      appAlert("Failed to update comment.");
    }
  };

  const handleStatusChange = async (e) => {
    const status = repairRequestStatusForSelection(e.target.value);
    const previousStatus = repairRequestStatusForSelection(repairRequest?.status);

    if (!requirePermission("34", "update repair requests")) return;

    setFormData((prev) => ({
      ...prev,
      status,
    }));

    if (!repairRequest || status === previousStatus || savingStatus) return;

    try {
      setSavingStatus(true);

      await updateDoc(getRequestRef(), {
        status,
      });

      if (
        status === REPAIR_REQUEST_STATUS.RESOLVED &&
        repairRequest?.equipmentId &&
        connectedEquipmentStatus
      ) {
        try {
          await updateDoc(getConnectedEquipmentRef(), {
            status: connectedEquipmentStatus,
          });
        } catch (equipmentError) {
          console.error("Error updating connected equipment status:", equipmentError);
          appAlert("Repair request status was updated, but the connected equipment status could not be saved.");
        }
      }

      setRepairRequest((prev) => ({
        ...prev,
        status,
      }));
    } catch (error) {
      console.error("Error updating repair request status:", error);
      appAlert("Failed to update repair request status.");
      setFormData((prev) => ({
        ...prev,
        status: previousStatus,
      }));
    } finally {
      setSavingStatus(false);
    }
  };

  const handleConnectedEquipmentStatusChange = async (e) => {
    const status = e.target.value;

    setConnectedEquipmentStatus(status);

    if (!requirePermission("34", "update repair requests")) return;
    if (!repairRequest?.equipmentId || !status || savingEquipmentStatus) return;

    try {
      setSavingEquipmentStatus(true);
      await updateDoc(getConnectedEquipmentRef(), {
        status,
      });
    } catch (error) {
      console.error("Error updating connected equipment status:", error);
      appAlert("Failed to update connected equipment status.");
    } finally {
      setSavingEquipmentStatus(false);
    }
  };

  const saveDescription = async () => {
    if (!requirePermission("34", "update repair requests")) return;

    if (!repairRequest || savingDescription) return;
    if (descriptionDraft === (repairRequest.description || "")) return;

    try {
      setSavingDescription(true);

      const requestRef = getRequestRef();

      await updateDoc(requestRef, {
        description: descriptionDraft,
      });

      setRepairRequest(prev => ({
        ...prev,
        description: descriptionDraft,
      }));
    } catch (error) {
      console.error("Error updating description:", error);
      appAlert("Failed to save description.");
    } finally {
      setSavingDescription(false);
    }
  };

  const handlePhotoSelection = (event) => {
    setPhotoFiles(Array.from(event.target.files || []));
  };

  const handleAddPhotos = async () => {
    if (!photoFiles.length || uploadingPhotos) return;
    if (!requirePermission("34", "update repair requests")) return;

    try {
      setUploadingPhotos(true);

      const uploadedPhotos = await Promise.all(
        photoFiles.map((file) => uploadRepairRequestPhoto({
          storage,
          file,
          path: buildCompanyRepairRequestPhotoPath({
            companyId: recentlySelectedCompany,
            repairRequestId: repairRequest.id,
            file,
          }),
          description: file.name,
        }))
      );

      await updateDoc(getRequestRef(), {
        photoUrls: arrayUnion(...uploadedPhotos),
      });

      setRepairRequest((prev) => ({
        ...prev,
        photoUrls: [...(prev?.photoUrls || []), ...uploadedPhotos],
      }));
      setPhotoFiles([]);
    } catch (error) {
      console.error("Error adding repair request photos:", error);
      appAlert("Failed to add photos to this repair request.");
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleConnectExistingJob = async () => {
    if (!selectedJobId || !repairRequest?.id || connectingJob) return;
    if (!requirePermission("34", "update repair requests")) return;
    if (!requirePermission("24", "update jobs")) return;

    try {
      setConnectingJob(true);

      const requestRef = getRequestRef();
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", selectedJobId);

      await Promise.all([
        updateDoc(requestRef, {
          jobIds: arrayUnion(selectedJobId),
          status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
        }),
        updateDoc(jobRef, {
          repairRequestId: repairRequest.id,
          repairRequestSourcePath: sourcePath,
        }),
      ]);

      setRepairRequest((prev) => ({
        ...prev,
        jobIds: Array.from(new Set([...(prev?.jobIds || []), selectedJobId])),
        status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
      }));
      setFormData((prev) => ({
        ...prev,
        status: REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB,
      }));
      setAvailableJobs((prev) => prev.map((job) => (
        job.id === selectedJobId
          ? {
            ...job,
            repairRequestId: repairRequest.id,
            repairRequestSourcePath: sourcePath,
          }
          : job
      )));
      setSelectedJobId("");
    } catch (error) {
      console.error("Error connecting job to repair request:", error);
      appAlert("Failed to connect the job to this repair request.");
    } finally {
      setConnectingJob(false);
    }
  };

  const handleDelete = async () => {
    if (!requirePermission("36", "delete repair requests")) return;

    const confirmed = await appConfirm({
      title: 'Delete Repair Request',
      message: 'Are you sure you want to delete this repair request?',
      confirmLabel: 'Delete Request',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const requestRef = getRequestRef();
      await deleteDoc(requestRef);
      navigate('/company/repair-requests');
    } catch (error) {
      console.error('Error deleting repair request:', error);
      appAlert('Failed to delete repair request.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-lg">Loading request details...</p>
      </div>
    );
  }

  if (!repairRequest) {
    return <div className="text-center p-8">Repair Request not found.</div>;
  }

  const photoUrls = repairRequest.photoUrls || [];
  const jobIds = repairRequest.jobIds || [];
  const connectedJobIds = new Set(jobIds);
  const connectableJobs = availableJobs.filter((job) => !connectedJobIds.has(job.id));
  const availableJobsById = new Map(availableJobs.map((job) => [job.id, job]));
  const partApprovalIds = repairRequest.partApprovalIds || [];
  const openCommentsCount = comments.filter((comment) => !comment.resolved).length;
  const commentFilters = ["All", "Open", "Resolved"];

  return (
    <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900 sm:px-3 lg:px-4">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              to={"/company/repair-requests"}
              className="app-back-link"
            >&larr; Back to Repair Requests</Link>
            <h2 className="text-3xl font-bold text-gray-800">Repair Request Details</h2>
            <p className="text-sm text-gray-500">{displayRepairRequestStatus(repairRequest.status)} request</p>
          </div>
          <ShareItemButton
            type="repairRequest"
            recordId={repairRequestId}
            title={repairRequest.description || repairRequest.notes || "Repair Request"}
            subtitle={[displayRepairRequestStatus(repairRequest.status), repairRequest.customerName || repairRequest.requesterName].filter(Boolean).join(" - ")}
            companyId={recentlySelectedCompany}
            customerId={repairRequest.customerId}
            customerUserId={repairRequest.customerUserId || repairRequest.homeownerId}
            collectionPath={sourcePath === "homeowner" ? "homeownerRepairRequests" : `companies/${recentlySelectedCompany}/repairRequests`}
            webPath={`/company/repair-requests/detail/${repairRequestId}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">Request Details</h3>
              </div>

              <div className="space-y-6">
                {/* Description (always editable) */}
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>

                    {can("34") && (
                      <button
                        type="button"
                        onClick={saveDescription}
                        disabled={savingDescription || descriptionDraft === (repairRequest.description || "")}
                        className={[
                          "px-3 py-1 rounded-lg text-sm font-semibold transition border",
                          savingDescription || descriptionDraft === (repairRequest.description || "")
                            ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                        ].join(" ")}
                      >
                        {savingDescription ? "Saving..." : "Save"}
                      </button>
                    )}
                  </div>

                  <textarea
                    className="mt-2 w-full min-h-[120px] rounded-md border border-slate-300 bg-white p-3 focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Add repair request description..."
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    readOnly={!can("34")}
                    onBlur={() => {
                      if (can("34") && descriptionDraft !== (repairRequest.description || "")) {
                        saveDescription();
                      }
                    }}
                  />
                </div>

                <div>
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="font-semibold text-gray-800">Attached Photos</h4>
                    {can("34") && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-slate-50">
                          Select Photos
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="sr-only"
                            onChange={handlePhotoSelection}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleAddPhotos}
                          disabled={!photoFiles.length || uploadingPhotos}
                          className={[
                            "rounded-md px-3 py-2 text-sm font-semibold transition",
                            photoFiles.length && !uploadingPhotos
                              ? "bg-slate-900 text-white hover:bg-slate-800"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed",
                          ].join(" ")}
                        >
                          {uploadingPhotos ? "Uploading..." : "Add Photos"}
                        </button>
                      </div>
                    )}
                  </div>
                  {photoFiles.length > 0 && (
                    <p className="mb-3 text-xs font-semibold text-gray-500">
                      {photoFiles.length} file{photoFiles.length > 1 ? "s" : ""} selected
                    </p>
                  )}
                  {photoUrls.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {photoUrls.map((photo, index) => {
                        const photoSrc = getRepairRequestPhotoUrl(photo);
                        const photoAlt = photo?.description || photo?.name || `Repair photo ${index + 1}`;
                        return photoSrc ? (
                          <button
                            key={`${photoSrc}-${index}`}
                            type="button"
                            onClick={() => setSelectedPhoto({ src: photoSrc, alt: photoAlt })}
                            className="group overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-left shadow-sm transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label={`Expand ${photoAlt}`}
                          >
                            <img
                              src={photoSrc}
                              alt={photoAlt}
                              className="aspect-square w-full object-cover transition duration-200 group-hover:scale-105"
                            />
                          </button>
                        ) : null;
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-700">No photos attached.</p>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-gray-800">Connected Jobs</h4>
                  {jobIds.length > 0 ? (
                    <div className="space-y-2">
                      {jobIds.map((id) => (
                        <Link
                          key={id}
                          to={`/company/jobs/detail/${id}`}
                          className="block text-blue-600 hover:underline font-medium"
                        >
                          {linkedReferenceText("Job", id, displayRecordReference(availableJobsById.get(id), ""))}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-700">No connected jobs.</p>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold mb-2 text-gray-800">Connected Part Approvals</h4>
                  {partApprovalIds.length > 0 ? (
                    <div className="space-y-2">
                      {partApprovalIds.map((id) => (
                        <Link
                          key={id}
                          to="/company/part-approvals"
                          className="block text-emerald-700 hover:underline font-medium"
                        >
                          {linkedReferenceText("Part Approval", id)}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-700">No connected part approvals.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Comments</h3>
                  <p className="text-xs font-semibold text-slate-500">
                    {openCommentsCount} open of {comments.length}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-1.5">
                  {commentFilters.map((filter) => {
                    const active = filter === commentFilter;
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setCommentFilter(filter)}
                        className={[
                          "rounded-md px-2 py-1 text-xs font-semibold transition",
                          active ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100",
                        ].join(" ")}
                      >
                        {filter}
                      </button>
                    );
                  })}
                </div>
              </div>

              {can("34") && (
                <div className="mt-4 space-y-2">
                  <textarea
                    className="min-h-[86px] w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Write a comment..."
                    value={newComment}
                    onChange={(event) => setNewComment(event.target.value)}
                  />
                  {repairRequest.customerId && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300"
                        checked={copyNewCommentToCustomerNotes}
                        disabled={addingComment}
                        onChange={(event) => setCopyNewCommentToCustomerNotes(event.target.checked)}
                      />
                      Add to Customer Notes
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={addComment}
                    disabled={addingComment || !newComment.trim()}
                    className={[
                      "w-full rounded-md px-3 py-2 text-xs font-semibold transition sm:w-auto",
                      addingComment || !newComment.trim()
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-blue-600 text-white hover:bg-blue-700",
                    ].join(" ")}
                  >
                    {addingComment ? "Adding..." : "Add Comment"}
                  </button>
                </div>
              )}

              <div className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
                {commentsLoading ? (
                  <div className="text-xs text-slate-500">Loading comments...</div>
                ) : filteredComments.length === 0 ? (
                  <div className="text-xs text-slate-500">No comments in this filter.</div>
                ) : (
                  filteredComments.map((comment) => {
                    const dt = comment.date?.toDate?.() || null;
                    const when = dt ? format(dt, "MMM d, h:mm a") : "-";
                    const canCopyCommentToCustomerNotes = Boolean(repairRequest.customerId && String(comment.comment || "").trim());
                    const isCopyingComment = copyingCommentToCustomerNoteId === comment.id;

                    return (
                      <div key={comment.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-800">
                          {comment.userName || comment.authorName || "Unknown"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{when}</div>
                        <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">
                          {comment.comment}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={!!comment.resolved}
                              disabled={!can("34")}
                              onChange={(event) => setCommentResolved(comment.id, event.target.checked)}
                            />
                            Resolved
                          </label>
                          {canCopyCommentToCustomerNotes && (
                            <button
                              type="button"
                              onClick={() => copyRepairRequestCommentToCustomerNotes(comment)}
                              disabled={!can("34") || isCopyingComment}
                              title={can("34") ? "Copy this comment to the customer notes" : "You need permission to update repair requests"}
                              className={[
                                "rounded-md border px-2 py-1 text-xs font-semibold transition",
                                can("34") && !isCopyingComment
                                  ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                  : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400",
                              ].join(" ")}
                            >
                              {isCopyingComment ? "Copying..." : "Copy to Customer Notes"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              {can("34") && (
                <div className="space-y-3 rounded-md border border-blue-100 bg-blue-50 p-3">
                  <div>
                    <p className="text-sm font-bold text-blue-950">Suggested Work</p>
                    <p className="text-xs text-blue-800">Keep this request as a customer recommendation instead of an active job.</p>
                  </div>

                  <select
                    value={suggestedWorkTier}
                    onChange={(event) => setSuggestedWorkTier(normalizeSuggestedWorkTier(event.target.value))}
                    disabled={convertingToSuggestedWork}
                    className="w-full rounded-md border border-blue-200 bg-white p-2 text-sm text-slate-800 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {SUGGESTED_WORK_TIER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value} - {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleConvertToSuggestedWork}
                    disabled={convertingToSuggestedWork}
                    className={[
                      "w-full rounded-md px-4 py-2 text-sm font-bold transition",
                      convertingToSuggestedWork
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-blue-600 text-white hover:bg-blue-700",
                    ].join(" ")}
                  >
                    {convertingToSuggestedWork ? "Moving..." : "Move to Suggested Work"}
                  </button>
                </div>
              )}

              <CreateJobFlowLauncher
                buttonLabel="Create Job from Request"
                buttonClassName="w-full rounded-md bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700"
                contextState={{
                  repairRequest: {
                    ...repairRequest,
                    sourcePath,
                  },
                  repairRequestSourcePath: sourcePath,
                }}
              />

              {can("34") && (
                <button
                  type="button"
                  onClick={() => setShowPartApprovalModal(true)}
                  disabled={!repairRequest.customerId}
                  className={[
                    "w-full rounded-md px-4 py-3 font-bold text-white transition",
                    repairRequest.customerId
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  {repairRequest.customerId ? "Create Part Approval" : "Add Customer Before Part Approval"}
                </button>
              )}

              {(can("34") && can("24")) && (
                <div className="border-t border-gray-200 pt-4 space-y-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800">Connect Existing Job</p>
                    <p className="text-xs text-gray-500">Attach an already-created job to this request.</p>
                  </div>

                  <select
                    value={selectedJobId}
                    onChange={(event) => setSelectedJobId(event.target.value)}
                    disabled={loadingJobs || connectingJob || connectableJobs.length === 0}
                    className="w-full rounded-md border border-slate-300 p-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="">
                      {loadingJobs
                        ? "Loading jobs..."
                        : connectableJobs.length === 0
                          ? "No unconnected jobs for this customer"
                          : "Select a job"}
                    </option>
                    {connectableJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {formatJobOption(job)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleConnectExistingJob}
                    disabled={!selectedJobId || connectingJob}
                    className={[
                      "w-full rounded-md px-4 py-2 text-sm font-bold transition",
                      selectedJobId && !connectingJob
                        ? "bg-slate-900 text-white hover:bg-slate-800"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed",
                    ].join(" ")}
                  >
                    {connectingJob ? "Connecting..." : "Connect Job"}
                  </button>
                </div>
              )}

              {can("36") && (
                <button
                  onClick={handleDelete}
                  className="w-full rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                  type="button"
                >
                  Delete Request
                </button>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Information</h3>
              <div className="space-y-3 text-gray-700">
                <div>
                  <strong>Status:</strong>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      name="status"
                      value={formData.status}
                      onChange={handleStatusChange}
                      disabled={!can("34") || savingStatus}
                      className="rounded-md border border-slate-300 bg-white p-2 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      {REPAIR_REQUEST_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <span
                      className={`px-3 py-1 text-sm font-bold rounded-full ${normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.RESOLVED)
                        ? 'bg-green-100 text-green-800'
                        : normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.CANCELLED)
                          ? 'bg-red-100 text-red-800'
                          : normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.CONVERTED_TO_JOB)
                            ? 'bg-gray-100 text-gray-700'
                            : normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.SUGGESTED_WORK) ||
                              normalizeRepairRequestStatus(repairRequest.status) === normalizeRepairRequestStatus(REPAIR_REQUEST_STATUS.LEGACY_IN_PROGRESS)
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-yellow-100 text-yellow-800'
                        }`}
                    >
                      {displayRepairRequestStatus(repairRequest.status)}
                    </span>
                    {savingStatus && (
                      <span className="text-xs font-semibold text-gray-500">Saving...</span>
                    )}
                  </div>
                </div>

                <p>
                  <strong>Date:</strong>{' '}
                  {repairRequest.date
                    ? format(repairRequest.date, 'PP')
                    : repairRequest.dateCreated
                      ? format(repairRequest.dateCreated, 'PP')
                      : 'N/A'}
                </p>

                <Link to={`/company/customers/details/${repairRequest.customerId}`}>
                  <p><strong>Customer:</strong> {repairRequest.customerName}</p>
                </Link>

                <p><strong>Requester:</strong> {repairRequest.requesterName || 'N/A'}</p>

                {repairRequest.locationId && (
                  <Link to={`/company/customers/details/${repairRequest.customerId}/locations`}>
                    <p><strong>Location:</strong> {linkedReferenceText("Service Location", repairRequest.locationId, repairRequest.locationName || repairRequest.serviceLocationName)}</p>
                  </Link>
                )}

                {repairRequest.equipmentId && (
                  <Link to={`/company/equipment/detail/${repairRequest.equipmentId}`}>
                    <p><strong>Equipment:</strong> {linkedReferenceText("Equipment", repairRequest.equipmentId, repairRequest.equipmentName || repairRequest.equipmentModel)}</p>
                  </Link>
                )}

                {repairRequest.equipmentId && (
                  <div>
                    <strong>Equipment Status:</strong>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={connectedEquipmentStatus}
                        onChange={handleConnectedEquipmentStatusChange}
                        disabled={!can("34") || savingEquipmentStatus}
                        className="rounded-md border border-slate-300 bg-white p-2 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        {EQUIPMENT_STATUS_OPTIONS.map((statusOption) => (
                          <option key={statusOption} value={statusOption}>
                            {statusOption}
                          </option>
                        ))}
                      </select>
                      {savingEquipmentStatus && (
                        <span className="text-xs font-semibold text-gray-500">Saving...</span>
                      )}
                    </div>
                  </div>
                )}

                {repairRequest.bodyOfWaterId && (
                  <Link to={`/company/bodiesOfWater/detail/${repairRequest.bodyOfWaterId}`}>
                    <p><strong>Body Of Water:</strong> {linkedReferenceText("Body Of Water", repairRequest.bodyOfWaterId, repairRequest.bodyOfWaterName)}</p>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setSelectedPhoto(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded repair photo"
        >
          <button
            type="button"
            onClick={() => setSelectedPhoto(null)}
            className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-white"
            aria-label="Close expanded photo"
          >
            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
          </button>
          <img
            src={selectedPhoto.src}
            alt={selectedPhoto.alt}
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      <PartApprovalCreateModal
        open={showPartApprovalModal}
        onClose={() => setShowPartApprovalModal(false)}
        fixedCustomer={partApprovalCustomer}
        fixedServiceLocation={partApprovalServiceLocation}
        defaultForm={partApprovalDefaultForm}
        workflowContext={partApprovalWorkflowContext}
        onCreated={handlePartApprovalCreated}
      />
    </div>
  );
};

export default RepairRequestDetailView;
