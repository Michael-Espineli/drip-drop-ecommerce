import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { FaBell, FaCheckCircle, FaEdit, FaPlus, FaRegCircle, FaSave, FaTasks, FaTimes, FaUserCheck, FaUsers } from "react-icons/fa";
import { MdArchive, MdOutlineSchedule } from "react-icons/md";
import { db } from "../../../utils/config";
import { Context } from "../../../context/AuthContext";
import { salesCollectionNames } from "../../../utils/models/Sales";
import {
  TODO_PRIORITY,
  TODO_PRIORITY_LABELS,
  TODO_RELATED_ENTITY_TYPES,
  TODO_SCOPE,
  TODO_STATUS,
  TODO_STATUS_LABELS,
  buildTodoAlertText,
  compareTodosByUrgency,
  dateTimeInputValue,
  formatShortDateTime,
  normalizeTodo,
  todoDueState,
  todoIsOpen,
  todoNeedsAttention,
} from "../../../utils/models/TodoItem";
import { ALERT_SEVERITY } from "../../../utils/models/AlertNotification";

const filters = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "team", label: "Team" },
  { id: "done", label: "Done" },
];

const BOARD_FILTER_ALL = "all";
const BOARD_FILTER_UNASSIGNED = "unassigned";

const compact = (values) => values.map((value) => String(value || "").trim()).filter(Boolean);

const fullAddress = (address = {}) => (
  compact([address.streetAddress, address.city, address.state, address.zip]).join(", ")
);

const customerName = (data = {}, fallback = "") => {
  if (data.displayAsCompany) return data.company || data.companyName || fallback;
  return compact([data.firstName, data.lastName]).join(" ") || data.company || data.companyName || fallback;
};

const moneyFromCents = (value) => {
  const cents = Number(value || 0);
  if (!cents) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
};

const relatedEntityPickerConfig = {
  customer: {
    getRef: (companyId) => collection(db, "companies", companyId, "customers"),
    label: (data, id) => customerName(data, id),
    subtitle: (data) => compact([data.email, data.phoneNumber, data.active === false ? "Inactive" : "Active"]).join(" | "),
  },
  serviceLocation: {
    getRef: (companyId) => collection(db, "companies", companyId, "serviceLocations"),
    label: (data, id) => data.nickName || fullAddress(data.address) || data.customerName || id,
    subtitle: (data) => compact([data.customerName, fullAddress(data.address)]).join(" | "),
  },
  bodyOfWater: {
    getRef: (companyId) => collection(db, "companies", companyId, "bodiesOfWater"),
    label: (data, id) => data.name || data.bodyOfWaterName || data.poolName || data.nickName || data.type || id,
    subtitle: (data) => compact([data.customerName, data.type, data.status]).join(" | "),
  },
  equipment: {
    getRef: (companyId) => collection(db, "companies", companyId, "equipment"),
    label: (data, id) => compact([data.make, data.model]).join(" ") || data.name || data.type || id,
    subtitle: (data) => compact([data.customerName, data.serviceLocationName, data.type, data.status]).join(" | "),
  },
  job: {
    getRef: (companyId) => collection(db, "companies", companyId, "workOrders"),
    label: (data, id) => data.internalId || data.type || data.description || id,
    subtitle: (data) => compact([data.customerName, data.operationStatus, data.billingStatus]).join(" | "),
  },
  repairRequest: {
    getRef: (companyId) => collection(db, "companies", companyId, "repairRequests"),
    label: (data, id) => data.description || data.customerName || id,
    subtitle: (data) => compact([data.customerName, data.status, data.requesterName || data.userName, data.equipmentName]).join(" | "),
  },
  invoice: {
    getRef: (companyId) => query(collection(db, salesCollectionNames.invoices), where("companyId", "==", companyId)),
    label: (data, id) => data.invoiceNumber || data.internalId || data.name || `Invoice ${id}`,
    subtitle: (data) => compact([data.customerName, data.status, moneyFromCents(data.totalAmountCents)]).join(" | "),
  },
  todo: {
    getRef: (companyId) => collection(db, "companies", companyId, "todoItems"),
    label: (data, id) => data.title || data.name || id,
    subtitle: (data) => compact([data.assignedToName || "Team task", data.status, data.priority]).join(" | "),
  },
};

const normalizeRelatedEntityOption = (type, itemDoc) => {
  const config = relatedEntityPickerConfig[type];
  const data = itemDoc.data();
  const label = config.label(data, itemDoc.id);
  const subtitle = config.subtitle(data, itemDoc.id);

  return {
    id: itemDoc.id,
    type,
    label,
    subtitle,
    searchText: compact([itemDoc.id, label, subtitle]).join(" ").toLowerCase(),
  };
};

const emptyTodoForm = () => ({
  title: "",
  description: "",
  boardId: "",
  scope: TODO_SCOPE.team,
  assignedToUserId: "",
  priority: TODO_PRIORITY.normal,
  dueAt: "",
  reminderEnabled: false,
  reminderAt: "",
  relatedEntityType: "",
  relatedEntityId: "",
  relatedEntityLabel: "",
});

const emptyBoardForm = () => ({
  name: "",
  memberUserIds: [],
});

const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeTodoBoard = (boardDoc) => ({
  id: boardDoc.id,
  name: "Untitled Board",
  memberUserIds: [],
  memberCompanyUserDocIds: [],
  memberNames: [],
  ...boardDoc.data(),
});

const todoBoardId = (todo = {}) => String(todo.boardId || "").trim();

const todoMatchesBoardFilter = (todo, selectedBoardId) => {
  const boardId = todoBoardId(todo);

  if (selectedBoardId === BOARD_FILTER_ALL) return true;
  if (selectedBoardId === BOARD_FILTER_UNASSIGNED) return !boardId;

  return boardId === selectedBoardId;
};

const todoBoardName = (todo, boardById) => {
  const boardId = todoBoardId(todo);
  if (!boardId) return "No board";

  return boardById.get(boardId)?.name || todo.boardName || "Unknown board";
};

const memberSummary = (board = {}) => {
  const names = Array.isArray(board.memberNames) ? board.memberNames.filter(Boolean) : [];
  if (names.length === 0) return "No users selected";
  if (names.length <= 2) return names.join(", ");

  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
};

const buildTodoEditForm = (todo = {}) => ({
  title: todo.title || "",
  description: todo.description || "",
  boardId: todoBoardId(todo),
  status: todo.status || TODO_STATUS.open,
  scope: todo.scope || TODO_SCOPE.team,
  assignedToUserId: todo.assignedToUserId || "",
  priority: todo.priority || TODO_PRIORITY.normal,
  dueAt: dateTimeInputValue(todo.dueAt),
  reminderEnabled: Boolean(todo.reminderEnabled),
  reminderAt: dateTimeInputValue(todo.reminderAt),
});

const timestampFromInput = (value) => {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
};

const dueTone = (state) => {
  const tones = {
    overdue: "border-rose-200 bg-rose-50 text-rose-700",
    today: "border-amber-200 bg-amber-50 text-amber-700",
    upcoming: "border-blue-200 bg-blue-50 text-blue-700",
    complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
    none: "border-slate-200 bg-slate-50 text-slate-600",
  };

  return tones[state] || tones.none;
};

const dueLabel = (todo) => {
  const state = todoDueState(todo);

  if (state === "none") return "No due date";
  if (state === "complete") return "Complete";
  if (state === "overdue") return `Overdue ${formatShortDateTime(todo.dueAt)}`;
  if (state === "today") return `Due today ${formatShortDateTime(todo.dueAt)}`;
  return `Due ${formatShortDateTime(todo.dueAt)}`;
};

const priorityTone = (priority) => {
  const tones = {
    urgent: "border-rose-200 bg-rose-50 text-rose-700",
    high: "border-amber-200 bg-amber-50 text-amber-700",
    normal: "border-slate-200 bg-slate-50 text-slate-600",
    low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return tones[priority] || tones.normal;
};

const StatCard = ({ icon: Icon, label, value, helper, tone = "slate" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <span className={`rounded-md p-2 ${tones[tone] || tones.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
  );
};

const TodoList = () => {
  const { recentlySelectedCompany, recentlySelectedCompanyName, user, name } = useContext(Context);
  const [todoItems, setTodoItems] = useState([]);
  const [todoBoards, setTodoBoards] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBoard, setSavingBoard] = useState(false);
  const [savingTodoEdit, setSavingTodoEdit] = useState(false);
  const [filter, setFilter] = useState("open");
  const [selectedBoardId, setSelectedBoardId] = useState(BOARD_FILTER_ALL);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState(emptyTodoForm);
  const [boardForm, setBoardForm] = useState(emptyBoardForm);
  const [editingBoardId, setEditingBoardId] = useState("");
  const [selectedTodoId, setSelectedTodoId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [relatedEntityOptions, setRelatedEntityOptions] = useState([]);
  const [relatedEntityLoading, setRelatedEntityLoading] = useState(false);
  const [relatedEntitySearch, setRelatedEntitySearch] = useState("");

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTodoItems([]);
      setTodoBoards([]);
      setCompanyUsers([]);
      setSelectedBoardId(BOARD_FILTER_ALL);
      setSelectedTodoId("");
      setEditForm(null);
      setBoardForm(emptyBoardForm());
      setEditingBoardId("");
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const todoRef = collection(db, "companies", recentlySelectedCompany, "todoItems");
    const boardsRef = collection(db, "companies", recentlySelectedCompany, "todoBoards");
    const usersRef = collection(db, "companies", recentlySelectedCompany, "companyUsers");

    const unsubscribeTodos = onSnapshot(
      todoRef,
      (snapshot) => {
        setTodoItems(snapshot.docs.map(normalizeTodo));
        setLoading(false);
      },
      (error) => {
        console.error("Error loading todo items:", error);
        toast.error("Failed to load todo list.");
        setLoading(false);
      }
    );

    const unsubscribeBoards = onSnapshot(
      boardsRef,
      (snapshot) => {
        setTodoBoards(snapshot.docs
          .map(normalizeTodoBoard)
          .sort((left, right) => left.name.localeCompare(right.name)));
      },
      (error) => {
        console.error("Error loading todo boards:", error);
        toast.error("Failed to load todo boards.");
      }
    );

    const unsubscribeUsers = onSnapshot(
      usersRef,
      (snapshot) => {
        setCompanyUsers(snapshot.docs.map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        })));
      },
      (error) => {
        console.error("Error loading company users:", error);
      }
    );

    return () => {
      unsubscribeTodos();
      unsubscribeBoards();
      unsubscribeUsers();
    };
  }, [recentlySelectedCompany]);

  useEffect(() => {
    if (
      selectedBoardId !== BOARD_FILTER_ALL &&
      selectedBoardId !== BOARD_FILTER_UNASSIGNED &&
      !todoBoards.some((board) => board.id === selectedBoardId)
    ) {
      setSelectedBoardId(BOARD_FILTER_ALL);
    }
  }, [selectedBoardId, todoBoards]);

  useEffect(() => {
    if (selectedBoardId !== BOARD_FILTER_ALL && selectedBoardId !== BOARD_FILTER_UNASSIGNED) {
      setForm((current) => current.boardId ? current : { ...current, boardId: selectedBoardId });
    }
  }, [selectedBoardId]);

  useEffect(() => {
    const config = relatedEntityPickerConfig[form.relatedEntityType];

    if (!recentlySelectedCompany || !config) {
      setRelatedEntityOptions([]);
      setRelatedEntityLoading(false);
      return undefined;
    }

    let isActive = true;
    setRelatedEntityLoading(true);
    setRelatedEntityOptions([]);

    getDocs(config.getRef(recentlySelectedCompany))
      .then((snapshot) => {
        if (!isActive) return;

        setRelatedEntityOptions(snapshot.docs
          .map((itemDoc) => normalizeRelatedEntityOption(form.relatedEntityType, itemDoc))
          .sort((left, right) => left.label.localeCompare(right.label)));
      })
      .catch((error) => {
        console.error("Error loading related record options:", error);
        if (isActive) {
          setRelatedEntityOptions([]);
          toast.error("Failed to load record picker options.");
        }
      })
      .finally(() => {
        if (isActive) setRelatedEntityLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [form.relatedEntityType, recentlySelectedCompany]);

  const companyUserOptions = useMemo(() => companyUsers
    .map((companyUser) => ({
      id: companyUser.id,
      userId: companyUser.userId || companyUser.id,
      userName: companyUser.userName || companyUser.name || companyUser.email || "Company user",
      roleName: companyUser.roleName || "",
      status: companyUser.status || "",
    }))
    .sort((left, right) => left.userName.localeCompare(right.userName)), [companyUsers]);

  const boardById = useMemo(() => (
    new Map(todoBoards.map((board) => [board.id, board]))
  ), [todoBoards]);

  const boardScopedTodos = useMemo(() => (
    todoItems.filter((todo) => todoMatchesBoardFilter(todo, selectedBoardId))
  ), [selectedBoardId, todoItems]);

  const boardCounts = useMemo(() => {
    const counts = {
      all: 0,
      unassigned: 0,
      byBoard: {},
    };

    todoItems.forEach((todo) => {
      if (!todoIsOpen(todo)) return;

      counts.all += 1;
      const boardId = todoBoardId(todo);

      if (!boardId) {
        counts.unassigned += 1;
        return;
      }

      counts.byBoard[boardId] = (counts.byBoard[boardId] || 0) + 1;
    });

    return counts;
  }, [todoItems]);

  const selectedTodo = useMemo(() => (
    todoItems.find((todo) => todo.id === selectedTodoId) || null
  ), [selectedTodoId, todoItems]);

  useEffect(() => {
    if (selectedTodoId && !selectedTodo) {
      setSelectedTodoId("");
      setEditForm(null);
    }
  }, [selectedTodo, selectedTodoId]);

  const stats = useMemo(() => {
    const openItems = boardScopedTodos.filter(todoIsOpen);
    const attentionItems = openItems.filter((todo) => todoNeedsAttention(todo));

    return {
      open: openItems.length,
      team: openItems.filter((todo) => todo.scope === TODO_SCOPE.team).length,
      assigned: openItems.filter((todo) => todo.scope === TODO_SCOPE.specific).length,
      attention: attentionItems.length,
    };
  }, [boardScopedTodos]);

  const filteredTodos = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return boardScopedTodos
      .filter((todo) => {
        if (filter === "open" && !todoIsOpen(todo)) return false;
        if (filter === "done" && todo.status !== TODO_STATUS.done) return false;
        if (filter === "team" && (todo.scope !== TODO_SCOPE.team || !todoIsOpen(todo))) return false;
        if (filter === "mine") {
          const mine = todo.assignedToUserId === user?.uid || todo.createdByUserId === user?.uid;
          if (!mine || !todoIsOpen(todo)) return false;
        }

        if (!search) return true;

        return [
          todo.title,
          todo.description,
          todo.assignedToName,
          todoBoardName(todo, boardById),
          todo.relatedEntity?.type,
          todo.relatedEntity?.id,
          todo.relatedEntity?.label,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      })
      .sort(compareTodosByUrgency);
  }, [boardById, boardScopedTodos, filter, searchTerm, user?.uid]);

  const visibleRelatedEntityOptions = useMemo(() => {
    const terms = relatedEntitySearch.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (!terms.length) return relatedEntityOptions.slice(0, 30);

    return relatedEntityOptions
      .filter((option) => terms.every((term) => option.searchText.includes(term)))
      .slice(0, 30);
  }, [relatedEntityOptions, relatedEntitySearch]);

  const selectedRelatedEntity = useMemo(() => (
    relatedEntityOptions.find((option) => option.id === form.relatedEntityId) || null
  ), [form.relatedEntityId, relatedEntityOptions]);

  const updateForm = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "scope" && value === TODO_SCOPE.team ? { assignedToUserId: "" } : {}),
      ...(field === "relatedEntityType" ? { relatedEntityId: "", relatedEntityLabel: "" } : {}),
    }));
  };

  const updateRelatedEntityType = (value) => {
    setRelatedEntitySearch("");
    updateForm("relatedEntityType", value);
  };

  const selectRelatedEntity = (option) => {
    setForm((current) => ({
      ...current,
      relatedEntityId: option.id,
      relatedEntityLabel: option.label,
    }));
  };

  const updateBoardForm = (field, value) => {
    setBoardForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const toggleBoardMember = (memberUserId) => {
    setBoardForm((current) => {
      const selected = current.memberUserIds.includes(memberUserId);

      return {
        ...current,
        memberUserIds: selected
          ? current.memberUserIds.filter((userId) => userId !== memberUserId)
          : [...current.memberUserIds, memberUserId],
      };
    });
  };

  const resetBoardForm = () => {
    setBoardForm(emptyBoardForm());
    setEditingBoardId("");
  };

  const startEditBoard = (board) => {
    setEditingBoardId(board.id);
    setBoardForm({
      name: board.name || "",
      memberUserIds: Array.isArray(board.memberUserIds) ? board.memberUserIds : [],
    });
  };

  const saveBoard = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany || !user) {
      toast.error("Select a company before saving a board.");
      return;
    }

    const boardName = boardForm.name.trim();
    if (!boardName) {
      toast.error("Board name is required.");
      return;
    }

    const selectedMembers = companyUserOptions.filter((option) => boardForm.memberUserIds.includes(option.userId));
    const boardId = editingBoardId || makeId("board");
    const boardPayload = {
      id: boardId,
      companyId: recentlySelectedCompany,
      name: boardName,
      memberUserIds: selectedMembers.map((member) => member.userId),
      memberCompanyUserDocIds: selectedMembers.map((member) => member.id),
      memberNames: selectedMembers.map((member) => member.userName),
      updatedAt: serverTimestamp(),
      updatedByUserId: user.uid,
      updatedByName: name || user.email || "Company user",
      ...(!editingBoardId ? {
        createdAt: serverTimestamp(),
        createdByUserId: user.uid,
        createdByName: name || user.email || "Company user",
      } : {}),
    };

    setSavingBoard(true);

    try {
      await setDoc(doc(db, "companies", recentlySelectedCompany, "todoBoards", boardId), boardPayload, { merge: Boolean(editingBoardId) });
      setSelectedBoardId(boardId);
      setForm((current) => ({ ...current, boardId }));
      resetBoardForm();
      toast.success(editingBoardId ? "Board updated." : "Board created.");
    } catch (error) {
      console.error("Failed to save todo board:", error);
      toast.error("Failed to save board.");
    } finally {
      setSavingBoard(false);
    }
  };

  const openTodoDetails = (todo) => {
    setSelectedTodoId(todo.id);
    setEditForm(buildTodoEditForm(todo));
  };

  const updateEditForm = (field, value) => {
    setEditForm((current) => {
      if (!current) return current;

      return {
        ...current,
        [field]: value,
        ...(field === "scope" && value === TODO_SCOPE.team ? { assignedToUserId: "" } : {}),
      };
    });
  };

  const saveTodoEdit = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany || !selectedTodo || !editForm) return;

    const title = editForm.title.trim();
    if (!title) {
      toast.error("Todo title is required.");
      return;
    }

    const assignee = companyUserOptions.find((option) => option.userId === editForm.assignedToUserId);
    if (editForm.scope === TODO_SCOPE.specific && !assignee) {
      toast.error("Choose a team member for a specific task.");
      return;
    }

    const selectedBoard = editForm.boardId ? boardById.get(editForm.boardId) : null;
    if (editForm.boardId && !selectedBoard) {
      toast.error("Choose a valid board.");
      return;
    }

    const dueAt = timestampFromInput(editForm.dueAt);
    const reminderAt = timestampFromInput(editForm.reminderAt);

    if (editForm.reminderEnabled && !reminderAt && !dueAt) {
      toast.error("Choose an alert time or due date for the reminder.");
      return;
    }

    const nextStatus = editForm.status || TODO_STATUS.open;

    setSavingTodoEdit(true);

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "todoItems", selectedTodo.id), {
        title,
        description: editForm.description.trim(),
        boardId: selectedBoard?.id || "",
        boardName: selectedBoard?.name || "",
        boardMemberUserIds: selectedBoard?.memberUserIds || [],
        boardMemberNames: selectedBoard?.memberNames || [],
        status: nextStatus,
        scope: editForm.scope,
        assignmentType: editForm.scope,
        assignedToUserId: assignee?.userId || "",
        assignedToCompanyUserDocId: assignee?.id || "",
        assignedToName: assignee?.userName || "",
        priority: editForm.priority,
        dueAt,
        reminderEnabled: Boolean(editForm.reminderEnabled),
        reminderAt: editForm.reminderEnabled ? reminderAt : null,
        completedAt: nextStatus === TODO_STATUS.done
          ? (selectedTodo.status === TODO_STATUS.done && selectedTodo.completedAt ? selectedTodo.completedAt : serverTimestamp())
          : null,
        updatedByUserId: user?.uid || "",
        updatedByName: name || user?.email || "Company user",
        updatedAt: serverTimestamp(),
      });

      toast.success("Todo updated.");
    } catch (error) {
      console.error("Failed to update todo details:", error);
      toast.error("Failed to update todo.");
    } finally {
      setSavingTodoEdit(false);
    }
  };

  const createTodo = async (event) => {
    event.preventDefault();

    if (!recentlySelectedCompany || !user) {
      toast.error("Select a company before creating a todo.");
      return;
    }

    const title = form.title.trim();
    if (!title) {
      toast.error("Todo title is required.");
      return;
    }

    const assignee = companyUserOptions.find((option) => option.userId === form.assignedToUserId);
    if (form.scope === TODO_SCOPE.specific && !assignee) {
      toast.error("Choose a team member for a specific task.");
      return;
    }

    const selectedBoard = form.boardId ? boardById.get(form.boardId) : null;
    if (form.boardId && !selectedBoard) {
      toast.error("Choose a valid board.");
      return;
    }

    const dueAt = timestampFromInput(form.dueAt);
    const reminderAt = timestampFromInput(form.reminderAt);

    if (form.reminderEnabled && !reminderAt && !dueAt) {
      toast.error("Choose an alert time or due date for the reminder.");
      return;
    }

    if (form.relatedEntityType && form.relatedEntityType !== "other" && !form.relatedEntityId.trim()) {
      toast.error("Choose a record from the picker.");
      return;
    }

    if (form.relatedEntityType === "other" && !form.relatedEntityLabel.trim()) {
      toast.error("Add a reference for the related item.");
      return;
    }

    const relatedEntity = form.relatedEntityType === "other"
      ? {
        type: "other",
        id: `other_${Date.now()}`,
        label: form.relatedEntityLabel.trim(),
      }
      : form.relatedEntityType && form.relatedEntityId.trim()
        ? {
        type: form.relatedEntityType,
        id: form.relatedEntityId.trim(),
        label: form.relatedEntityLabel.trim(),
      }
        : null;

    const todoId = makeId("todo");
    const todoPayload = {
      id: todoId,
      companyId: recentlySelectedCompany,
      title,
      description: form.description.trim(),
      boardId: selectedBoard?.id || "",
      boardName: selectedBoard?.name || "",
      boardMemberUserIds: selectedBoard?.memberUserIds || [],
      boardMemberNames: selectedBoard?.memberNames || [],
      status: TODO_STATUS.open,
      scope: form.scope,
      assignmentType: form.scope,
      assignedToUserId: assignee?.userId || "",
      assignedToCompanyUserDocId: assignee?.id || "",
      assignedToName: assignee?.userName || "",
      priority: form.priority,
      dueAt,
      reminderEnabled: Boolean(form.reminderEnabled),
      reminderAt: form.reminderEnabled ? reminderAt : null,
      relatedEntity,
      source: "web",
      createdByUserId: user.uid,
      createdByName: name || user.email || "Company user",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    setSaving(true);

    try {
      const writes = [
        setDoc(doc(db, "companies", recentlySelectedCompany, "todoItems", todoId), todoPayload),
      ];

      if (form.reminderEnabled) {
        const alertId = makeId("alert");
        const scheduledFor = reminderAt || dueAt;
        const alertMessage = buildTodoAlertText({ ...todoPayload, dueAt: dueAt || null, reminderAt: reminderAt || null });
        const severity = form.priority === TODO_PRIORITY.urgent || form.priority === TODO_PRIORITY.high
          ? ALERT_SEVERITY.warning
          : ALERT_SEVERITY.info;

        writes.push(setDoc(doc(db, "companies", recentlySelectedCompany, "alerts", alertId), {
          id: alertId,
          companyId: recentlySelectedCompany,
          title: `Todo reminder: ${title}`,
          name: `Todo reminder: ${title}`,
          message: alertMessage,
          description: alertMessage,
          status: "unread",
          read: false,
          severity,
          type: "todo_reminder",
          source: "todoList",
          sourceId: todoId,
          todoId,
          route: "/company/todo-list",
          hasItem: true,
          itemId: todoId,
          itemName: title,
          deliveryTargets: ["web", "ios"],
          channels: {
            dashboard: true,
            ios: true,
            push: true,
          },
          assignedToUserId: assignee?.userId || "",
          assignedToName: assignee?.userName || "",
          scheduledFor,
          dueAt,
          relatedEntity,
          createdByUserId: user.uid,
          createdByName: name || user.email || "Company user",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      }

      await Promise.all(writes);
      setForm(emptyTodoForm());
      toast.success("Todo created.");
    } catch (error) {
      console.error("Failed to create todo:", error);
      toast.error("Failed to create todo.");
    } finally {
      setSaving(false);
    }
  };

  const updateTodoStatus = async (todo, status) => {
    if (!recentlySelectedCompany) return;

    try {
      await updateDoc(doc(db, "companies", recentlySelectedCompany, "todoItems", todo.id), {
        status,
        completedAt: status === TODO_STATUS.done ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update todo:", error);
      toast.error("Failed to update todo.");
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading todo list...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{recentlySelectedCompanyName || "Selected company"}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-950">Todo List</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Team tasks, specific assignments, linked records, due dates, and reminders.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={FaTasks} label="Open" value={stats.open} helper="Active todo items" tone="blue" />
          <StatCard icon={FaUsers} label="Team Tasks" value={stats.team} helper="General team work" />
          <StatCard icon={FaUserCheck} label="Assigned" value={stats.assigned} helper="Specific owner set" tone="emerald" />
          <StatCard icon={FaBell} label="Needs Attention" value={stats.attention} helper="Due today, overdue, or alerting" tone={stats.attention ? "amber" : "emerald"} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-6">
            <form onSubmit={createTodo} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-950">Create Todo</h2>
              <p className="mt-1 text-sm text-slate-500">Add team work or assign a specific owner.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="todo-title">Title</label>
                <input
                  id="todo-title"
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Follow up on customer estimate"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="todo-description">Notes</label>
                <textarea
                  id="todo-description"
                  value={form.description}
                  onChange={(event) => updateForm("description", event.target.value)}
                  className="mt-1 min-h-[92px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  placeholder="Add context for the team."
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700" htmlFor="todo-board">Board</label>
                <select
                  id="todo-board"
                  value={form.boardId}
                  onChange={(event) => updateForm("boardId", event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">No board</option>
                  {todoBoards.map((board) => (
                    <option key={board.id} value={board.id}>{board.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-700">Assignment</p>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => updateForm("scope", TODO_SCOPE.team)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${form.scope === TODO_SCOPE.team ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                  >
                    Team
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm("scope", TODO_SCOPE.specific)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${form.scope === TODO_SCOPE.specific ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                  >
                    Specific
                  </button>
                </div>
              </div>

              {form.scope === TODO_SCOPE.specific && (
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="todo-assignee">Assignee</label>
                  <select
                    id="todo-assignee"
                    value={form.assignedToUserId}
                    onChange={(event) => updateForm("assignedToUserId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Choose team member</option>
                    {companyUserOptions.map((option) => (
                      <option key={option.id} value={option.userId}>
                        {option.userName}{option.roleName ? ` - ${option.roleName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="todo-priority">Priority</label>
                  <select
                    id="todo-priority"
                    value={form.priority}
                    onChange={(event) => updateForm("priority", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {Object.entries(TODO_PRIORITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="todo-due">Due date</label>
                  <input
                    id="todo-due"
                    type="datetime-local"
                    value={form.dueAt}
                    onChange={(event) => updateForm("dueAt", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <input
                  type="checkbox"
                  checked={form.reminderEnabled}
                  onChange={(event) => updateForm("reminderEnabled", event.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Create alert notification</span>
                  <span className="block text-sm text-slate-500">Adds a dashboard/iOS-ready notification record.</span>
                </span>
              </label>

              {form.reminderEnabled && (
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="todo-reminder">Alert time</label>
                  <input
                    id="todo-reminder"
                    type="datetime-local"
                    value={form.reminderAt}
                    onChange={(event) => updateForm("reminderAt", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="todo-entity-type">Record type</label>
                  <select
                    id="todo-entity-type"
                    value={form.relatedEntityType}
                    onChange={(event) => updateRelatedEntityType(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {TODO_RELATED_ENTITY_TYPES.map((type) => (
                      <option key={type.value || "none"} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                {form.relatedEntityType && relatedEntityPickerConfig[form.relatedEntityType] && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="text-sm font-semibold text-slate-700" htmlFor="todo-entity-search">Select record</label>
                      <input
                        id="todo-entity-search"
                        value={relatedEntitySearch}
                        onChange={(event) => setRelatedEntitySearch(event.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Search by name, customer, status, or id"
                      />
                    </div>

                    {selectedRelatedEntity && (
                      <div className="flex items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-blue-950">{selectedRelatedEntity.label}</p>
                          {selectedRelatedEntity.subtitle && <p className="mt-0.5 truncate text-xs text-blue-700">{selectedRelatedEntity.subtitle}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, relatedEntityId: "", relatedEntityLabel: "" }))}
                          className="shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-900"
                        >
                          Clear
                        </button>
                      </div>
                    )}

                    <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white">
                      {relatedEntityLoading ? (
                        <div className="px-3 py-3 text-sm text-slate-500">Loading records...</div>
                      ) : visibleRelatedEntityOptions.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-slate-500">No matching records.</div>
                      ) : visibleRelatedEntityOptions.map((option) => {
                        const selected = option.id === form.relatedEntityId;

                        return (
                          <button
                            key={`${option.type}-${option.id}`}
                            type="button"
                            onClick={() => selectRelatedEntity(option)}
                            className={`block w-full border-b border-slate-100 px-3 py-2 text-left transition last:border-b-0 ${selected ? "bg-blue-50" : "hover:bg-slate-50"}`}
                          >
                            <span className={`block truncate text-sm font-semibold ${selected ? "text-blue-950" : "text-slate-900"}`}>{option.label}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">{option.subtitle || option.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {form.relatedEntityType === "other" && (
                  <div className="mt-3">
                    <label className="text-sm font-semibold text-slate-700" htmlFor="todo-entity-label">Reference</label>
                    <input
                      id="todo-entity-label"
                      value={form.relatedEntityLabel}
                      onChange={(event) => updateForm("relatedEntityLabel", event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Describe the related item"
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Creating..." : "Create Todo"}
              </button>
            </div>
            </form>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Boards</h2>
                  <p className="mt-1 text-sm text-slate-500">Name each board and choose its users.</p>
                </div>
                {editingBoardId && (
                  <button
                    type="button"
                    onClick={resetBoardForm}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    <FaTimes className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                )}
              </div>

              <form onSubmit={saveBoard} className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700" htmlFor="todo-board-name">Board name</label>
                  <input
                    id="todo-board-name"
                    value={boardForm.name}
                    onChange={(event) => updateBoardForm("name", event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    placeholder="Service team"
                  />
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-700">Users</p>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                    {companyUserOptions.length === 0 ? (
                      <div className="px-2 py-2 text-sm text-slate-500">No company users found.</div>
                    ) : companyUserOptions.map((option) => (
                      <label key={option.id} className="flex items-start gap-3 rounded-md bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                        <input
                          type="checkbox"
                          checked={boardForm.memberUserIds.includes(option.userId)}
                          onChange={() => toggleBoardMember(option.userId)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-900">{option.userName}</span>
                          {option.roleName && <span className="block truncate text-xs text-slate-500">{option.roleName}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingBoard}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editingBoardId ? <FaSave className="h-3.5 w-3.5" /> : <FaPlus className="h-3.5 w-3.5" />}
                  {savingBoard ? "Saving..." : editingBoardId ? "Save Board" : "Create Board"}
                </button>
              </form>

              {todoBoards.length > 0 && (
                <div className="mt-5 divide-y divide-slate-100 rounded-md border border-slate-200">
                  {todoBoards.map((board) => {
                    const selected = selectedBoardId === board.id;

                    return (
                      <div key={board.id} className={`flex items-start justify-between gap-3 px-3 py-3 ${selected ? "bg-blue-50" : "bg-white"}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedBoardId(board.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className={`block truncate text-sm font-bold ${selected ? "text-blue-950" : "text-slate-950"}`}>{board.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{memberSummary(board)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditBoard(board)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          <FaEdit className="h-3 w-3" />
                          Edit
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Board View</h2>
                  <p className="mt-1 text-sm text-slate-500">Choose a board to focus this task list.</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedBoardId(BOARD_FILTER_ALL)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${selectedBoardId === BOARD_FILTER_ALL ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  All Boards ({boardCounts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedBoardId(BOARD_FILTER_UNASSIGNED)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${selectedBoardId === BOARD_FILTER_UNASSIGNED ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  No Board ({boardCounts.unassigned})
                </button>
                {todoBoards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    onClick={() => setSelectedBoardId(board.id)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${selectedBoardId === board.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {board.name} ({boardCounts.byBoard[board.id] || 0})
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_390px]">
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Task Board</h2>
                  <p className="mt-1 text-sm text-slate-500">Review open work, owner-specific items, and completed todos.</p>
                </div>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 lg:w-64"
                  placeholder="Search todos"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${filter === item.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredTodos.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No todos match this view.</div>
              ) : filteredTodos.map((todo) => {
                const state = todoDueState(todo);
                const isOpen = todoIsOpen(todo);

                return (
                  <div key={todo.id} className="px-5 py-4 transition hover:bg-slate-50">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityTone(todo.priority)}`}>
                            {TODO_PRIORITY_LABELS[todo.priority] || "Normal"}
                          </span>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${dueTone(state)}`}>
                            {dueLabel(todo)}
                          </span>
                          {todo.reminderEnabled && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700">
                              <MdOutlineSchedule className="h-3.5 w-3.5" />
                              {todo.reminderAt ? formatShortDateTime(todo.reminderAt) : "Alert"}
                            </span>
                          )}
                        </div>

                        <h3 className="mt-3 break-words text-base font-bold text-slate-950">{todo.title}</h3>
                        {todo.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{todo.description}</p>}

                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                          <span>{TODO_STATUS_LABELS[todo.status] || "Open"}</span>
                          <span>{todoBoardName(todo, boardById)}</span>
                          <span>{todo.scope === TODO_SCOPE.specific ? `Assigned to ${todo.assignedToName || "Unassigned"}` : "Team task"}</span>
                          {todo.relatedEntity?.type && todo.relatedEntity?.id && (
                            <span>{todo.relatedEntity.type}: {todo.relatedEntity.label || todo.relatedEntity.id}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openTodoDetails(todo)}
                          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${selectedTodoId === todo.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                        >
                          <FaEdit className="h-3.5 w-3.5" />
                          Details
                        </button>
                        {isOpen && todo.status !== TODO_STATUS.inProgress && (
                          <button
                            type="button"
                            onClick={() => updateTodoStatus(todo, TODO_STATUS.inProgress)}
                            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                          >
                            <FaRegCircle className="h-3.5 w-3.5" />
                            Start
                          </button>
                        )}
                        {isOpen && (
                          <button
                            type="button"
                            onClick={() => updateTodoStatus(todo, TODO_STATUS.done)}
                            className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                          >
                            <FaCheckCircle className="h-3.5 w-3.5" />
                            Done
                          </button>
                        )}
                        {todo.status === TODO_STATUS.done && (
                          <button
                            type="button"
                            onClick={() => updateTodoStatus(todo, TODO_STATUS.open)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Reopen
                          </button>
                        )}
                        {todo.status !== TODO_STATUS.archived && (
                          <button
                            type="button"
                            onClick={() => updateTodoStatus(todo, TODO_STATUS.archived)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            <MdArchive className="h-4 w-4" />
                            Archive
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

              <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                {!selectedTodo || !editForm ? (
                  <div className="text-sm text-slate-500">
                    <h2 className="text-lg font-bold text-slate-950">Todo Details</h2>
                    <p className="mt-2">Select a todo to view details and make changes.</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{todoBoardName(selectedTodo, boardById)}</p>
                        <h2 className="mt-1 break-words text-lg font-bold text-slate-950">Todo Details</h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTodoId("");
                          setEditForm(null);
                        }}
                        className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-100"
                        aria-label="Close todo details"
                      >
                        <FaTimes className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
                      <div>Created by {selectedTodo.createdByName || "Company user"}</div>
                      <div>Created {formatShortDateTime(selectedTodo.createdAt)}</div>
                      <div>Updated {formatShortDateTime(selectedTodo.updatedAt)}</div>
                      {selectedTodo.relatedEntity?.type && selectedTodo.relatedEntity?.id && (
                        <div>{selectedTodo.relatedEntity.type}: {selectedTodo.relatedEntity.label || selectedTodo.relatedEntity.id}</div>
                      )}
                    </div>

                    <form onSubmit={saveTodoEdit} className="space-y-4">
                      <div>
                        <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-title">Title</label>
                        <input
                          id="edit-todo-title"
                          value={editForm.title}
                          onChange={(event) => updateEditForm("title", event.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-description">Notes</label>
                        <textarea
                          id="edit-todo-description"
                          value={editForm.description}
                          onChange={(event) => updateEditForm("description", event.target.value)}
                          className="mt-1 min-h-[92px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-1">
                        <div>
                          <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-status">Status</label>
                          <select
                            id="edit-todo-status"
                            value={editForm.status}
                            onChange={(event) => updateEditForm("status", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            {Object.entries(TODO_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-board">Board</label>
                          <select
                            id="edit-todo-board"
                            value={editForm.boardId}
                            onChange={(event) => updateEditForm("boardId", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">No board</option>
                            {todoBoards.map((board) => (
                              <option key={board.id} value={board.id}>{board.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-semibold text-slate-700">Assignment</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
                          <button
                            type="button"
                            onClick={() => updateEditForm("scope", TODO_SCOPE.team)}
                            className={`rounded-md px-3 py-2 text-sm font-semibold transition ${editForm.scope === TODO_SCOPE.team ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                          >
                            Team
                          </button>
                          <button
                            type="button"
                            onClick={() => updateEditForm("scope", TODO_SCOPE.specific)}
                            className={`rounded-md px-3 py-2 text-sm font-semibold transition ${editForm.scope === TODO_SCOPE.specific ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                          >
                            Specific
                          </button>
                        </div>
                      </div>

                      {editForm.scope === TODO_SCOPE.specific && (
                        <div>
                          <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-assignee">Assignee</label>
                          <select
                            id="edit-todo-assignee"
                            value={editForm.assignedToUserId}
                            onChange={(event) => updateEditForm("assignedToUserId", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="">Choose team member</option>
                            {companyUserOptions.map((option) => (
                              <option key={option.id} value={option.userId}>
                                {option.userName}{option.roleName ? ` - ${option.roleName}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-1">
                        <div>
                          <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-priority">Priority</label>
                          <select
                            id="edit-todo-priority"
                            value={editForm.priority}
                            onChange={(event) => updateEditForm("priority", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            {Object.entries(TODO_PRIORITY_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-due">Due date</label>
                          <input
                            id="edit-todo-due"
                            type="datetime-local"
                            value={editForm.dueAt}
                            onChange={(event) => updateEditForm("dueAt", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                      </div>

                      <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                        <input
                          type="checkbox"
                          checked={editForm.reminderEnabled}
                          onChange={(event) => updateEditForm("reminderEnabled", event.target.checked)}
                          className="mt-1"
                        />
                        <span className="text-sm font-semibold text-slate-800">Alert notification</span>
                      </label>

                      {editForm.reminderEnabled && (
                        <div>
                          <label className="text-sm font-semibold text-slate-700" htmlFor="edit-todo-reminder">Alert time</label>
                          <input
                            id="edit-todo-reminder"
                            type="datetime-local"
                            value={editForm.reminderAt}
                            onChange={(event) => updateEditForm("reminderAt", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={savingTodoEdit}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FaSave className="h-3.5 w-3.5" />
                        {savingTodoEdit ? "Saving..." : "Save Todo"}
                      </button>
                    </form>
                  </div>
                )}
              </aside>
        </section>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TodoList;
