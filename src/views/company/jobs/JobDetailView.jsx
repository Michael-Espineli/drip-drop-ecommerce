import React, { useEffect, useMemo, useState, useContext } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { format } from "date-fns";
import Select from "react-select";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";

/**
 * JobDetailView
 * - Description is always editable (not tied to Edit mode)
 * - Adds Comments panel on the right (subcollection: workOrders/{jobId}/comments)
 * - Comments support filter: All / Open / Resolved
 *   - comment schema: { id, userId, userName, date, comment, resolved }
 */

const JobDetailView = () => {
  const { jobId } = useParams();
  const navigate = useNavigate();

  // Auth / company context
  const authCtx = useContext(Context);
  const { recentlySelectedCompany, dataBaseUser } = authCtx;

  // Try to infer user from context shape
  const currentUser =
    authCtx?.currentUser || authCtx?.user || authCtx?.currentuser || authCtx || {};

  const getUserId = () => currentUser?.uid || currentUser?.id || "";
  const getUserName = () =>
    currentUser?.displayName || currentUser?.userName || currentUser?.name || "Unknown";

  const [loading, setLoading] = useState(true);

  const [edit, setEdit] = useState(false);

  const [job, setJob] = useState({
    adminId: "",
    adminName: "",
    billingStatus: "",
    bodyOfWaterId: "",
    bodyOfWaterName: "",
    chemicals: "",
    customerId: "",
    customerName: "",
    description: "",
    electricalParts: "",
    equipmentId: "",
    equipmentName: "",
    id: "",
    internalId: "",
    installationParts: "",
    jobTemplateId: "",
    laborCost: "",
    miscParts: "",
    operationStatus: "",
    pvcParts: "",
    rate: 0,
    serviceLocationId: "",
    serviceStopIds: [],
    type: "",
    dateCreated: null,
  });

  const [customer, setCustomer] = useState({
    id: "",
    firstName: "",
    lastName: "",
    phoneNumber: "",
    email: "",
    billingStreetAddress: "",
    billingCity: "",
    billingState: "",
    billingZip: "",
    billingNotes: "",
    active: true,
    verified: false,
  });

  const [serviceLocation, setServiceLocation] = useState({
    bodiesOfWaterId: [],
    gateCode: "",
    nickName: "",
    streetAddress: "",
    city: "",
    state: "",
    zip: "",
    active: true,
    id: "",
  });

  // Edit pickers
  const [adminList, setAdminList] = useState([]);
  const [selectedAdmin, setSelectedAdmin] = useState(null);

  const billingStatusOptions = useMemo(
    () => ["Draft", "Estimate", "Accepted", "In Progress", "Invoiced", "Paid"].map((s) => ({ value: s, label: s })),
    []
  );

  const operationStatusOptions = useMemo(
    () =>
      ["Estimate Pending", "Unscheduled", "Scheduled", "In Progress", "Finished"].map((s) => ({
        value: s,
        label: s,
      })),
    []
  );

  const [selectedBillingStatus, setSelectedBillingStatus] = useState({ value: "Draft", label: "Draft" });
  const [selectedOperationStatus, setSelectedOperationStatus] = useState({
    value: "Estimate Pending",
    label: "Estimate Pending",
  });

  // Tabs to mimic iOS segmented nav
  const tabs = ["Info", "Tasks", "Shopping", "Schedule"];
  const [activeTab, setActiveTab] = useState("Info");

  // Tasks
  const [taskTypeList, setTaskTypeList] = useState([]);
  const [taskList, setTaskList] = useState([]);
  const [newTask, setNewTask] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState(null);
  const [taskDescription, setTaskDescription] = useState("");
  const [taskLaborCost, setTaskLaborCost] = useState("");
  const [estimatedTime, setEstimatedTime] = useState("");

  // Shopping list
  const [shoppingList, setShoppingList] = useState([]);
  const [newShoppingList, setNewShoppingList] = useState(false);

  const shoppingListTypes = useMemo(
    () => [
      { value: "Custom", label: "Custom" },
      { value: "Generic", label: "Generic" },
    ],
    []
  );
  const [newShoppingItemType, setNewShoppingItemType] = useState(null);
  const [genericItemList, setGenericItemList] = useState([]);
  const [selectedGenericItem, setSelectedGenericItem] = useState(null);

  const [itemId, setItemId] = useState("");
  const [itemQuantity, setItemQuantity] = useState("");
  const [itemCost, setItemCost] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemName, setItemName] = useState("");

  // PNL
  const [materialCost, setMaterialCost] = useState("0.00"); // USD string
  const [laborCost, setLaborCost] = useState("0.00"); // USD string
  const [totalCost, setTotalCost] = useState("0.00"); // USD string
  const [estimatedDuration, setEstimatedDuration] = useState("0.00"); // hours string
  const [estimatedProfit, setEstimatedProfit] = useState("$0.00");
  const [estimatedProfitPercentage, setEstimatedProfitPercentage] = useState("0.00");

  const [estimatedRate, setEstimatedRate] = useState("0.00"); // input dollars
  const [offeredRate, setOfferedRate] = useState(0); // cents

  // --- Description (always editable) ---
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  // --- Comments (right panel) ---
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [commentFilter, setCommentFilter] = useState("All"); // All | Open | Resolved

  const filteredComments = useMemo(() => {
    if (commentFilter === "Open") return (comments || []).filter((c) => !c.resolved);
    if (commentFilter === "Resolved") return (comments || []).filter((c) => !!c.resolved);
    return comments || [];
  }, [comments, commentFilter]);

  // --- helpers ---
  const formatCurrency = (number, locale = "en-US", currency = "USD") =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(number);

  const getStatusClass = (status) => {
    switch (status) {
      case "Draft":
      case "Estimate Pending":
      case "Unscheduled":
        return "bg-red-100 text-red-800";
      case "Estimate":
      case "In Progress":
        return "bg-yellow-100 text-yellow-800";
      case "Accepted":
      case "Scheduled":
      case "Finished":
      case "Paid":
        return "bg-green-100 text-green-800";
      case "Invoiced":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const selectTheme = (theme) => ({
    ...theme,
    borderRadius: 12,
    colors: {
      ...theme.colors,
      primary25: "#EFF6FF", // blue-50
      primary: "#2563EB", // blue-600
      neutral0: "#FFFFFF",
      neutral20: "#D1D5DB", // gray-300
      neutral30: "#9CA3AF", // gray-400
    },
  });

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? "#2563EB" : "#D1D5DB",
      boxShadow: state.isFocused ? "0 0 0 2px rgba(37,99,235,0.25)" : "none",
      "&:hover": { borderColor: state.isFocused ? "#2563EB" : "#9CA3AF" },
    }),
    menu: (base) => ({ ...base, borderRadius: 12, overflow: "hidden" }),
  };

  // --- initial load ---
  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    (async () => {
      try {
        setLoading(true);

        // Job
        const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
        const jobSnap = await getDoc(jobRef);
        if (!jobSnap.exists()) throw new Error("Job not found");

        const j = jobSnap.data();

        const dateCreated = j.dateCreated?.toDate?.() ?? null;

        setJob((prev) => ({
          ...prev,
          ...j,
          dateCreated,
          serviceStopIds: Array.isArray(j.serviceStopIds) ? j.serviceStopIds : j.serviceStopIds ? [j.serviceStopIds] : [],
        }));

        setDescriptionDraft(j.description || "");

        setOfferedRate(Number(j.rate || 0));
        setEstimatedRate(((Number(j.rate || 0) / 100) || 0).toFixed(2));

        setSelectedOperationStatus({ value: j.operationStatus, label: j.operationStatus });
        setSelectedBillingStatus({ value: j.billingStatus, label: j.billingStatus });

        // Customer
        const customerRef = doc(db, "companies", recentlySelectedCompany, "customers", j.customerId);
        const customerSnap = await getDoc(customerRef);
        if (customerSnap.exists()) {
          const c = customerSnap.data();
          setCustomer((prev) => ({
            ...prev,
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            phoneNumber: c.phoneNumber,
            email: c.email,
            billingStreetAddress: c.billingAddress?.streetAddress || "",
            billingCity: c.billingAddress?.city || "",
            billingState: c.billingAddress?.state || "",
            billingZip: c.billingAddress?.zip || "",
            billingNotes: c.billingNotes || "",
            active: c.active,
            verified: c.verified,
          }));
        }

        // Service location
        const locRef = doc(db, "companies", recentlySelectedCompany, "serviceLocations", j.serviceLocationId);
        const locSnap = await getDoc(locRef);
        if (locSnap.exists()) {
          const l = locSnap.data();
          setServiceLocation((prev) => ({
            ...prev,
            id: l.id,
            bodiesOfWaterId: l.bodiesOfWaterId || [],
            gateCode: l.gateCode || "",
            nickName: l.nickName || "",
            streetAddress: l.address?.streetAddress || "",
            city: l.address?.city || "",
            state: l.address?.state || "",
            zip: l.address?.zip || "",
            active: l.active,
          }));
        }

        // Task types
        const taskTypeQuery = query(collection(db, "universal", "settings", "taskTypes"));
        const taskTypeSnap = await getDocs(taskTypeQuery);
        const types = taskTypeSnap.docs.map((d) => {
          const t = d.data();
          return { value: t.name, label: t.name, id: t.id };
        });
        setTaskTypeList(types);

        // Tasks
        const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
        const tasksSnap = await getDocs(tasksRef);
        const tasks = tasksSnap.docs.map((d) => d.data());
        setTaskList(tasks);

        // Shopping items
        const itemsRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "items");
        const itemsSnap = await getDocs(itemsRef);
        const items = itemsSnap.docs.map((d) => d.data());
        setShoppingList(items);

        // PNL calc
        recomputePNL({
          rateCents: Number(j.rate || 0),
          tasks,
          items,
        });
      } catch (e) {
        console.error(e);
        toast.error("Failed to load job details");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentlySelectedCompany, jobId]);

  // --- comments subscription ---
  useEffect(() => {
    if (!recentlySelectedCompany || !jobId) return;

    const commentsRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments");
    const commentsQ = query(commentsRef, orderBy("date", "desc"));

    setCommentsLoading(true);

    const unsub = onSnapshot(
      commentsQ,
      (snap) => {
        const list = snap.docs.map((d) => d.data());
        setComments(list);
        setCommentsLoading(false);
      },
      (err) => {
        console.error(err);
        setCommentsLoading(false);
        toast.error("Failed to load comments");
      }
    );

    return () => unsub();
  }, [recentlySelectedCompany, jobId]);

  const recomputePNL = ({ rateCents, tasks, items }) => {
    // Labor
    let totalLaborCents = 0;
    let totalMinutes = 0;
    for (const t of tasks || []) {
      totalLaborCents += Number(t.contractedRate || 0);
      totalMinutes += Number(t.estimatedTime || 0);
    }

    // Material
    let totalMaterialCents = 0;
    for (const it of items || []) {
      const qty = Number(it.quantity || 0);
      const cost = Number(it.cost || 0);
      totalMaterialCents += cost * qty;
    }

    const totalCostCents = totalLaborCents + totalMaterialCents;
    const profitCents = rateCents - totalCostCents;
    const profitPct = rateCents > 0 ? profitCents / rateCents : 0;

    setLaborCost((totalLaborCents / 100).toFixed(2));
    setMaterialCost((totalMaterialCents / 100).toFixed(2));
    setTotalCost((totalCostCents / 100).toFixed(2));
    setEstimatedDuration((totalMinutes / 60).toFixed(2));
    setEstimatedProfit(formatCurrency(profitCents / 100));
    setEstimatedProfitPercentage((profitPct * 100).toFixed(2));
  };

  // --- Description save ---
  const saveDescription = async () => {
    try {
      if (!recentlySelectedCompany || !jobId) return;

      setSavingDescription(true);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

      await updateDoc(jobRef, { description: descriptionDraft });

      setJob((prev) => ({ ...prev, description: descriptionDraft }));
      toast.success("Description saved");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save description");
    } finally {
      setSavingDescription(false);
    }
  };

  // --- Comments actions ---
  const addComment = async () => {
    try {
      const userId = getUserId();
      const userName = getUserName();

      if (!userId) return toast.error("Missing userId (not signed in?)");
      if (!newComment.trim()) return toast.error("Write a comment first");
      if (!recentlySelectedCompany || !jobId) return;

      setAddingComment(true);

      const id = "comp_wo_com_" + uuidv4();
      const commentRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments", id);

      await setDoc(commentRef, {
        id,
        userId,
        userName:dataBaseUser.firstName + " " + dataBaseUser.lastName,
        date: serverTimestamp(),
        comment: newComment.trim(),
        resolved: false,
      });

      setNewComment("");
      toast.success("Comment added");
    } catch (err) {
      console.error(err);
      toast.error("Failed to add comment");
    } finally {
      setAddingComment(false);
    }
  };

  const setCommentResolved = async (commentId, resolved) => {
    try {
      if (!recentlySelectedCompany || !jobId) return;

      const commentRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "comments", commentId);
      await updateDoc(commentRef, { resolved });

      toast.success(resolved ? "Marked resolved" : "Re-opened");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update comment");
    }
  };

  // --- editing ---
  const editJob = async (e) => {
    e.preventDefault();
    try {
      setEdit(true);

      const userQuery = query(collection(db, "companies", recentlySelectedCompany, "companyUsers"));
      const userSnap = await getDocs(userQuery);
      const admins = userSnap.docs.map((d) => {
        const u = d.data();
        return {
          value: u.id,
          label: `${u.userName}${u.roleName ? ` — ${u.roleName}` : ""}`,
          id: u.id,
          name: u.userName,
        };
      });
      setAdminList(admins);

      const current = admins.find((a) => a.id === job.adminId) || null;
      setSelectedAdmin(current);
    } catch (err) {
      console.error(err);
      toast.error("Failed to enter edit mode");
    }
  };

  const cancelEditJob = () => {
    setEdit(false);
    setSelectedAdmin(null);
  };

  const saveEditChanges = async (e) => {
    e.preventDefault();
    try {
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);

      if (selectedAdmin?.id && (selectedAdmin.id !== job.adminId || selectedAdmin.name !== job.adminName || job.rate !== offeredRate)) {
        await updateDoc(jobRef, {
          adminId: selectedAdmin.id,
          adminName: selectedAdmin.name,
          rate:offeredRate
        });
        toast.success("Saved");
      } else {
        toast.success("No changes");
      }

      const jobSnap = await getDoc(jobRef);
      if (jobSnap.exists()) {
        const j = jobSnap.data();
        setJob((prev) => ({ ...prev, adminId: j.adminId, adminName: j.adminName }));
      }

      setEdit(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save changes");
    }
  };

  const deleteJob = async (e) => {
    e.preventDefault();
    try {
      const ok = window.confirm("Delete this job? This cannot be undone.");
      if (!ok) return;

      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId));
      toast.success("Deleted");
      navigate("/company/jobs");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete job");
    }
  };

  const handleSelectedOperationStatus = async (opt) => {
    try {
      setSelectedOperationStatus(opt);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      await updateDoc(jobRef, { operationStatus: opt.value });
      setJob((prev) => ({ ...prev, operationStatus: opt.value }));
      toast.success("Updated operation status");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update operation status");
    }
  };

  const handleSelectedBillingStatus = async (opt) => {
    try {
      setSelectedBillingStatus(opt);
      const jobRef = doc(db, "companies", recentlySelectedCompany, "workOrders", jobId);
      await updateDoc(jobRef, { billingStatus: opt.value });
      setJob((prev) => ({ ...prev, billingStatus: opt.value }));
      toast.success("Updated billing status");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update billing status");
    }
  };

  // --- tasks ---
  const showNewTaskItem = () => setNewTask(true);

  const clearNewTask = (e) => {
    e.preventDefault();
    setSelectedTaskType(null);
    setTaskDescription("");
    setTaskLaborCost("");
    setEstimatedTime("");
    setNewTask(false);
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    try {
      if (!selectedTaskType?.value) return toast.error("Pick a task type");
      if (!taskDescription) return toast.error("Add a description");
      if (!taskLaborCost) return toast.error("Add labor cost");
      if (!estimatedTime) return toast.error("Add estimated time (minutes)");

      const id = "comp_wo_tas_" + uuidv4();
      const costCents = Math.round(parseFloat(taskLaborCost) * 100);
      const estMin = parseFloat(estimatedTime);

      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id), {
        id,
        name: taskDescription,
        type: selectedTaskType.value,
        workerType: "",
        workerId: "",
        workerName: "",
        status: "Unassigned",
        customerApproval: false,
        contractedRate: costCents,
        laborContractId: "",
        estimatedTime: estMin,
        actualTime: "",
        equipmentId: "",
        serviceLocationId: "",
        bodyOfWaterId: "",
        serviceStopId: "",
      });

      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => d.data());
      setTaskList(tasks);

      recomputePNL({ rateCents: offeredRate, tasks, items: shoppingList });

      toast.success("Added task");
      clearNewTask({ preventDefault: () => {} });
    } catch (err) {
      console.error(err);
      toast.error("Failed to add task");
    }
  };

  const deleteTaskItem = async (e, id) => {
    e.preventDefault();
    try {
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks", id));

      const tasksRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "tasks");
      const tasksSnap = await getDocs(tasksRef);
      const tasks = tasksSnap.docs.map((d) => d.data());
      setTaskList(tasks);

      recomputePNL({ rateCents: offeredRate, tasks, items: shoppingList });

      toast.success("Deleted task");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete task");
    }
  };

  // --- shopping ---
  const showNewShoppingListItem = () => setNewShoppingList(true);
  const clearNewShoppingListItem = (e) => {
    e.preventDefault();
    setNewShoppingList(false);
    setNewShoppingItemType(null);
    setSelectedGenericItem(null);
    setItemName("");
    setItemQuantity("");
    setItemPrice("");
    setItemCost("");
    setItemId("");
  };

  const handleSelectedShoppingItemTypeChange = async (opt) => {
    setNewShoppingItemType(opt);

    if (opt?.value === "Generic") {
      try {
        const genericQ = query(collection(db, "companies", recentlySelectedCompany, "settings", "dataBase", "dataBase"));
        const genericSnap = await getDocs(genericQ);
        const list = genericSnap.docs.map((d) => {
          const it = d.data();
          return {
            value: it.id,
            label: `${it.name} — ${(Number(it.rate || 0) / 100).toFixed(2)}`,
            id: it.id,
            name: it.name,
            rate: it.rate,
          };
        });
        setGenericItemList(list);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load generic items");
      }
    }
  };

  const handleSelectedGenericItemChange = (opt) => {
    setSelectedGenericItem(opt);
    setItemId(opt?.id || "");
    const dollars = (Number(opt?.rate || 0) / 100).toFixed(2);
    setItemCost(dollars);
    setItemPrice(dollars);
    setItemName(opt?.name || "");
  };

  const handleAddShoppingListItem = async (e) => {
    e.preventDefault();
    try {
      if (!newShoppingItemType?.value) return toast.error("Pick item type");
      if (!itemQuantity) return toast.error("Add quantity");

      const id = "comp_wo_ite_" + uuidv4();

      const qty = parseInt(itemQuantity, 10);
      if (!qty || qty <= 0) return toast.error("Quantity must be > 0");

      let costCents = 0;
      let priceCents = 0;
      let name = itemName;
      let itemType = newShoppingItemType.value;

      if (itemType === "Custom") {
        if (!itemName) return toast.error("Add a description");
        if (!itemCost) return toast.error("Add item cost");
        if (!itemPrice) return toast.error("Add item price");
        costCents = Math.round(parseFloat(itemCost) * 100);
        priceCents = Math.round(parseFloat(itemPrice) * 100);
      } else {
        if (!selectedGenericItem?.id) return toast.error("Pick a generic item");
        costCents = Number(selectedGenericItem.rate || 0);
        priceCents = Number(selectedGenericItem.rate || 0);
        name = selectedGenericItem.name;
      }

      await setDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "items", id), {
        id,
        name,
        cost: costCents,
        price: priceCents,
        itemId: itemId || "",
        itemType,
        quantity: qty,
        status: "Not Purchased",
      });

      const itemsRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "items");
      const itemsSnap = await getDocs(itemsRef);
      const items = itemsSnap.docs.map((d) => d.data());
      setShoppingList(items);

      recomputePNL({ rateCents: offeredRate, tasks: taskList, items });

      toast.success("Added item");
      clearNewShoppingListItem({ preventDefault: () => {} });
    } catch (err) {
      console.error(err);
      toast.error("Failed to add item");
    }
  };

  const deleteShoppingListItem = async (e, id) => {
    e.preventDefault();
    try {
      await deleteDoc(doc(db, "companies", recentlySelectedCompany, "workOrders", jobId, "items", id));

      const itemsRef = collection(db, "companies", recentlySelectedCompany, "workOrders", jobId, "items");
      const itemsSnap = await getDocs(itemsRef);
      const items = itemsSnap.docs.map((d) => d.data());
      setShoppingList(items);

      recomputePNL({ rateCents: offeredRate, tasks: taskList, items });

      toast.success("Deleted item");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete item");
    }
  };

  // --- pnl ---
  const recalculatePNL = async (e) => {
    e.preventDefault();
    const rateCents = Math.round(parseFloat(estimatedRate || "0") * 100);
    setOfferedRate(rateCents);

    const totalCostCents = Math.round(parseFloat(totalCost || "0") * 100);
    const profitCents = rateCents - totalCostCents;
    const profitPct = rateCents > 0 ? profitCents / rateCents : 0;

    setEstimatedProfit(formatCurrency(profitCents / 100));
    setEstimatedProfitPercentage((profitPct * 100).toFixed(2));
  };

  const openInMaps = () => {
    const address = `${serviceLocation.streetAddress} ${serviceLocation.city} ${serviceLocation.state} ${serviceLocation.zip}`.trim();
    const urlAddress = encodeURIComponent(address);
    const url = `https://www.google.com/maps/place/${urlAddress}`;
    window.open(url, "_blank");
  };

  const formattedDateCreated = job.dateCreated ? format(job.dateCreated, "MMMM d, yyyy") : "N/A";

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-screen-xl mx-auto">
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-4 bg-gray-200 rounded w-2/3" />
              <div className="h-40 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const commentFilters = ["All", "Open", "Resolved"];

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-screen-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>

            <Link 
            to="/company/jobs" 
            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
            >&larr; Back to Jobs</Link>
            <h2 className="text-3xl font-bold text-gray-800">Job Details</h2>
            <p className="text-gray-600 mt-1">
              <span className="font-semibold text-gray-800">{job.internalId || "Job"}</span>{" "}
              <span className="text-gray-400">•</span> Created {formattedDateCreated}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!edit ? (
              <button
                onClick={editJob}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition"
              >
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={saveEditChanges}
                  className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition"
                >
                  Save
                </button>
                <button
                  onClick={cancelEditJob}
                  className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteJob}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl shadow-sm hover:bg-red-100 transition"                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs (iOS-style segmented) */}
        <div className="bg-white shadow-lg rounded-xl p-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => {
              const active = t === activeTab;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={[
                    "px-4 py-2 rounded-full text-sm font-semibold transition border",
                    active
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                  ].join(" ")}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* INFO TAB */}
        {activeTab === "Info" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Info */}
            <div className="lg:col-span-2 bg-white shadow-lg rounded-xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Overview</h3>
                  <p className="text-gray-600 mt-1">Core job details and statuses</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.billingStatus)}`}>
                    {job.billingStatus || "—"}
                  </span>
                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${getStatusClass(job.operationStatus)}`}>
                    {job.operationStatus || "—"}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link
                to={`/company/customers/details/${customer.id}`}
              >
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</p>
                    <p className="mt-1 text-gray-800 font-semibold">
                      {customer.firstName} {customer.lastName}
                    </p>
                  </div>
              </Link>
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</p>
                  <p className="mt-1 text-gray-800 font-semibold">{job.type || "—"}</p>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Admin</p>
                  {!edit ? (
                    <p className="mt-1 text-gray-800 font-semibold">{job.adminName || "—"}</p>
                  ) : (
                    <div className="mt-2">
                      <Select
                        value={selectedAdmin}
                        options={adminList}
                        onChange={setSelectedAdmin}
                        isSearchable
                        placeholder="Select an admin"
                        theme={selectTheme}
                        styles={selectStyles}
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Created</p>
                  <p className="mt-1 text-gray-800 font-semibold">{formattedDateCreated}</p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4">
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Billing Status</p>
                      <p className="mt-1 text-gray-800 font-semibold">{job.billingStatus || "—"}</p>
                    </div>
                    {edit && (
                      <div className="w-full max-w-sm">
                        <Select
                          value={selectedBillingStatus}
                          options={billingStatusOptions}
                          onChange={handleSelectedBillingStatus}
                          isSearchable
                          placeholder="Select billing status"
                          theme={selectTheme}
                          styles={selectStyles}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Operation Status</p>
                      <p className="mt-1 text-gray-800 font-semibold">{job.operationStatus || "—"}</p>
                    </div>
                    {edit && (
                      <div className="w-full max-w-sm">
                        <Select
                          value={selectedOperationStatus}
                          options={operationStatusOptions}
                          onChange={handleSelectedOperationStatus}
                          isSearchable
                          placeholder="Select operation status"
                          theme={selectTheme}
                          styles={selectStyles}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Description (always editable) */}
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</p>

                    <button
                      type="button"
                      onClick={saveDescription}
                      disabled={savingDescription || descriptionDraft === (job.description || "")}
                      className={[
                        "px-3 py-1 rounded-lg text-sm font-semibold transition border",
                        savingDescription || descriptionDraft === (job.description || "")
                          ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                      ].join(" ")}
                    >
                      {savingDescription ? "Saving…" : "Save"}
                    </button>
                  </div>

                  <textarea
                    className="mt-2 w-full min-h-[120px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-white"
                    placeholder="Add job description…"
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    onBlur={() => {
                      if (descriptionDraft !== (job.description || "")) saveDescription();
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Right column: Site Info + Comments */}
            <div className="space-y-6">
              {/* Site Info */}
              <div className="bg-white shadow-lg rounded-xl p-6">
                <h3 className="text-xl font-bold text-gray-800">Site Information</h3>
                <p className="text-gray-600 mt-1">Service location and access details</p>

                <div className="mt-6 space-y-4">
                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Address</p>
                    <button
                      onClick={openInMaps}
                      className="mt-1 text-left text-blue-600 hover:text-blue-800 font-semibold"
                      title="Open in Google Maps"
                    >
                      {serviceLocation.streetAddress} {serviceLocation.city} {serviceLocation.state} {serviceLocation.zip}
                    </button>
                  </div>

                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Gate Code</p>
                    <p className="mt-1 text-gray-800 font-semibold">{serviceLocation.gateCode || "—"}</p>
                  </div>

                  <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Service Stops</p>
                    <p className="mt-1 text-gray-700">
                      {(job.serviceStopIds || []).length ? (job.serviceStopIds || []).join(", ") : "—"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link
                      to={`/company/serviceStops/createNew/${jobId}`}
                      className="w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition text-center"
                    >
                      Schedule Service Stop
                    </Link>
                    <Link
                      to={`/company/laborContracts/createNew/${jobId}`}
                      className="w-full py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition text-center"
                    >
                      Create Labor Contract
                    </Link>
                  </div>
                </div>
              </div>

              {/* Comments */}
              <div className="bg-white shadow-lg rounded-xl p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Comments</h3>
                    <p className="text-gray-600 mt-1">Add notes, track follow-ups, mark resolved</p>
                  </div>
                </div>

                {/* Filter (All / Open / Resolved) */}
                <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-2 flex gap-2 flex-wrap">
                  {commentFilters.map((f) => {
                    const active = f === commentFilter;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setCommentFilter(f)}
                        className={[
                          "px-4 py-2 rounded-full text-sm font-semibold transition border",
                          active
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100",
                        ].join(" ")}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>

                {/* Add comment */}
                <div className="mt-4 space-y-3">
                  <textarea
                    className="w-full min-h-[90px] p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Write a comment…"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={addComment}
                      disabled={addingComment || !newComment.trim()}
                      className={[
                        "py-2 px-4 font-semibold rounded-lg shadow-md transition",
                        addingComment || !newComment.trim()
                          ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                          : "bg-blue-600 text-white hover:bg-blue-700",
                      ].join(" ")}
                    >
                      {addingComment ? "Adding…" : "Add Comment"}
                    </button>
                  </div>
                </div>

                {/* Previous comments */}
                <div className="mt-6">
                  {commentsLoading ? (
                    <div className="text-gray-500">Loading comments…</div>
                  ) : !filteredComments?.length ? (
                    <div className="text-gray-500">No comments in this filter.</div>
                  ) : (
                    <div className="space-y-3">
                      {filteredComments.map((c) => {
                        const dt = c.date?.toDate?.() || null;
                        const when = dt ? format(dt, "MMM d, yyyy • h:mm a") : "—";

                        return (
                          <div key={c.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-gray-800">
                                  {c.userName || "Unknown"}{" "}
                                  <span className="text-gray-400 font-normal">• {when}</span>
                                </div>
                                <div className="mt-2 text-gray-700 whitespace-pre-wrap">{c.comment}</div>
                              </div>

                              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 select-none">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={!!c.resolved}
                                  onChange={(e) => setCommentResolved(c.id, e.target.checked)}
                                />
                                Resolved
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TASKS TAB */}
        {activeTab === "Tasks" && (
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Tasks</h3>
                <p className="text-gray-600 mt-1">Track work items, costs, and assignments</p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/company/jobs/history/${jobId}`}
                  className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                >
                  See History
                </Link>
                {!newTask && (
                  <button
                    onClick={showNewTaskItem}
                    className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  >
                    + Add Task
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">
                      Worker
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">
                      Worker Type
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden lg:table-cell">
                      Customer Approval
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Labor</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Time (Hr)</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {taskList?.map((task) => (
                    <tr key={task.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 whitespace-nowrap text-gray-800 font-medium">{task.name}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700">{task.type}</td>
                      <td className="p-4 whitespace-nowrap">
                        <span className="px-3 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800">
                          {task.status || "—"}
                        </span>
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden md:table-cell">{task.workerName || "—"}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden md:table-cell">{task.workerType || "—"}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden lg:table-cell">
                        {String(task.customerApproval)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-800">
                        {formatCurrency((Number(task.contractedRate || 0) / 100) || 0)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {((Number(task.estimatedTime || 0) / 60) || 0).toFixed(2)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-right">
                        <button
                          onClick={(e) => deleteTaskItem(e, task.id)}
                          className="text-sm font-semibold text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!taskList?.length && (
                    <tr>
                      <td className="p-6 text-gray-500" colSpan={9}>
                        No tasks yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* New Task Row */}
            {newTask && (
              <div className="mt-6 p-4 rounded-xl border border-gray-200 bg-gray-50">
                <div className="flex flex-col lg:flex-row gap-3 items-stretch">
                  <div className="flex items-center justify-between lg:hidden">
                    <h4 className="font-bold text-gray-800">Add Task</h4>
                    <button
                      onClick={clearNewTask}
                      className="py-2 px-3 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                    >
                      Cancel
                    </button>
                  </div>

                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    type="text"
                    placeholder="Description"
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                  />

                  <div className="w-full">
                    <Select
                      value={selectedTaskType}
                      options={taskTypeList}
                      onChange={setSelectedTaskType}
                      isSearchable
                      placeholder="Select a Task Type"
                      theme={selectTheme}
                      styles={selectStyles}
                    />
                  </div>

                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    type="text"
                    placeholder="Labor Cost (USD)"
                    value={taskLaborCost}
                    onChange={(e) => setTaskLaborCost(e.target.value)}
                  />

                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    type="text"
                    placeholder="Estimated Time (Min)"
                    value={estimatedTime}
                    onChange={(e) => setEstimatedTime(e.target.value)}
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={handleAddTask}
                      className="w-full py-3 px-5 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                    >
                      Add
                    </button>
                    <button
                      onClick={clearNewTask}
                      className="w-full py-3 px-5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition hidden lg:block"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Link
                to={`/company/serviceStops/createNew/${jobId}`}
                className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition text-center"
              >
                Schedule Service Stop
              </Link>
              <Link
                to={`/company/laborContracts/createNew/${jobId}`}
                className="py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition text-center"
              >
                Create Labor Contract
              </Link>
            </div>
          </div>
        )}

        {/* SHOPPING TAB */}
        {activeTab === "Shopping" && (
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Shopping List</h3>
                <p className="text-gray-600 mt-1">Materials and parts required for the job</p>
              </div>
              {!newShoppingList && (
                <button
                  onClick={showNewShoppingListItem}
                  className="py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                >
                  + Add Item
                </button>
              )}
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Cost</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Qty</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Price</th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">
                      Item Id
                    </th>
                    <th className="p-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {shoppingList?.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4 whitespace-nowrap text-gray-800 font-medium">{item.name}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {formatCurrency((Number(item.cost || 0) / 100) || 0)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700">{item.quantity}</td>
                      <td className="p-4 whitespace-nowrap text-gray-700">
                        {formatCurrency((Number(item.price || 0) / 100) || 0)}
                      </td>
                      <td className="p-4 whitespace-nowrap text-gray-700 hidden md:table-cell">{item.itemId || "—"}</td>
                      <td className="p-4 whitespace-nowrap text-right">
                        <button
                          onClick={(e) => deleteShoppingListItem(e, item.id)}
                          className="text-sm font-semibold text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!shoppingList?.length && (
                    <tr>
                      <td className="p-6 text-gray-500" colSpan={6}>
                        No items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add Item */}
            {newShoppingList && (
              <div className="mt-6 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-4">
                <div className="flex flex-col md:flex-row gap-3 items-stretch">
                  <div className="w-full md:max-w-sm">
                    <Select
                      value={newShoppingItemType}
                      options={shoppingListTypes}
                      onChange={handleSelectedShoppingItemTypeChange}
                      isSearchable
                      placeholder="Select Item Type"
                      theme={selectTheme}
                      styles={selectStyles}
                    />
                  </div>

                  <div className="flex-1" />

                  <button
                    onClick={clearNewShoppingListItem}
                    className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>

                {newShoppingItemType?.value === "Custom" && (
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                    <input
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      type="text"
                      placeholder="Description"
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                    />
                    <input
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      type="text"
                      placeholder="Item Cost (USD)"
                      value={itemCost}
                      onChange={(e) => setItemCost(e.target.value)}
                    />
                    <input
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      type="text"
                      placeholder="Item Price (USD)"
                      value={itemPrice}
                      onChange={(e) => setItemPrice(e.target.value)}
                    />
                    <input
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      type="text"
                      placeholder="Quantity"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(e.target.value)}
                    />
                  </div>
                )}

                {newShoppingItemType?.value === "Generic" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="w-full lg:col-span-2">
                      <Select
                        value={selectedGenericItem}
                        options={genericItemList}
                        onChange={handleSelectedGenericItemChange}
                        isSearchable
                        placeholder="Select a Generic Item"
                        theme={selectTheme}
                        styles={selectStyles}
                      />
                    </div>
                    <input
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                      type="text"
                      placeholder="Quantity"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleAddShoppingListItem}
                    className="py-2 px-5 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  >
                    Add Item
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SCHEDULE TAB (placeholder, styled) */}
        {activeTab === "Schedule" && (
          <div className="bg-white shadow-lg rounded-xl p-6">
            <h3 className="text-xl font-bold text-gray-800">Schedule</h3>
            <p className="text-gray-600 mt-1">Service stops and labor contracts</p>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl border border-gray-200 bg-gray-50">
                <h4 className="font-bold text-gray-800">Service Stops</h4>
                <p className="text-gray-600 mt-1 text-sm">Use the button below to schedule a service stop.</p>

                <div className="mt-4">
                  <Link
                    to={`/company/serviceStops/createNew/${jobId}`}
                    className="inline-flex items-center justify-center py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
                  >
                    Schedule Service Stop
                  </Link>
                </div>

                <div className="mt-4 text-sm text-gray-600">
                  <p className="font-semibold text-gray-700">Service Stop Ids</p>
                  <p className="mt-1">{(job.serviceStopIds || []).length ? job.serviceStopIds.join(", ") : "—"}</p>
                </div>
              </div>

              <div className="p-5 rounded-xl border border-gray-200 bg-gray-50">
                <h4 className="font-bold text-gray-800">Labor Contracts</h4>
                <p className="text-gray-600 mt-1 text-sm">Create a labor contract for contractors.</p>

                <div className="mt-4">
                  <Link
                    to={`/company/laborContracts/createNew/${jobId}`}
                    className="inline-flex items-center justify-center py-2 px-4 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition"
                  >
                    Create Labor Contract
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PNL Card (always visible, matches aesthetic) */}
        <div className="bg-white shadow-lg rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-gray-800">Estimated PNL</h3>
              <p className="text-gray-600 mt-1">Profit estimate based on tasks + items</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="w-40 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                onChange={(e) => setEstimatedRate(e.target.value)}
                type="text"
                placeholder="Offered Rate"
                value={estimatedRate}
              />
              <button
                onClick={recalculatePNL}
                className="py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition"
              >
                Use Offered Rate
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rate</p>
              <p className="mt-1 text-gray-800 font-bold text-lg">{formatCurrency((offeredRate || 0) / 100)}</p>
              <p className="mt-2 text-sm text-gray-600">
                Suggested Rate:{" "}
                <span className="font-semibold">{formatCurrency((Number(job.rate || 0) / 100) || 0)}</span>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Profit</p>
              <p className="mt-1 text-gray-800 font-bold text-lg">
                {estimatedProfit}{" "}
                <span className="text-sm font-semibold text-gray-600">({estimatedProfitPercentage}%)</span>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Material Cost</p>
              <p className="mt-1 text-gray-800 font-semibold">{formatCurrency(Number(materialCost || 0))}</p>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Labor Cost</p>
              <p className="mt-1 text-gray-800 font-semibold">{formatCurrency(Number(laborCost || 0))}</p>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Cost</p>
              <p className="mt-1 text-gray-800 font-semibold">{formatCurrency(Number(totalCost || 0))}</p>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Estimated Duration</p>
              <p className="mt-1 text-gray-800 font-semibold">{estimatedDuration} hrs</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobDetailView;
