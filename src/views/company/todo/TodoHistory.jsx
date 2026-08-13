import React, { useContext, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import toast from "react-hot-toast";
import { FaArrowLeft, FaCheckCircle, FaSearch, FaUserCheck, FaUsers } from "react-icons/fa";
import { MdHistory, MdOutlineSchedule } from "react-icons/md";
import { Link, useSearchParams } from "react-router-dom";
import { Context } from "../../../context/AuthContext";
import { db } from "../../../utils/config";
import { TODO_ALL_BOARDS_PERMISSION_ID } from "../../../utils/companyPermissions";
import {
  TODO_DONE_BOARD_LOOKBACK_DAYS,
  TODO_PRIORITY_LABELS,
  TODO_SCOPE,
  TODO_STATUS,
  TODO_STATUS_LABELS,
  formatShortDateTime,
  normalizeTodo,
  normalizeTodoHistoryDateRange,
  toDate,
  toMillis,
  todoBoardVisibleToUser,
  todoCompletedInDateRange,
  todoCompletionDate,
  todoUserIdSet,
  todoVisibleToUser,
} from "../../../utils/models/TodoItem";

const BOARD_FILTER_ALL = "all";
const BOARD_FILTER_UNASSIGNED = "unassigned";

const compact = (values) => values.map((value) => String(value || "").trim()).filter(Boolean);

const normalizeTodoBoard = (boardDoc) => ({
  id: boardDoc.id,
  name: "Untitled Board",
  memberUserIds: [],
  memberCompanyUserDocIds: [],
  memberNames: [],
  ...boardDoc.data(),
});

const todoBoardId = (todo = {}) => String(todo.boardId || "").trim();

const todoBoardName = (todo, boardById) => {
  const boardId = todoBoardId(todo);
  if (!boardId) return "No board";

  return boardById.get(boardId)?.name || todo.boardName || "Unknown board";
};

const todoIssueKey = (todo = {}) => {
  const compactId = String(todo.id || "")
    .replace(/^todo[_-]?/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-5)
    .toUpperCase();

  return `TODO-${compactId || "ITEM"}`;
};

const assignmentLabel = (todo = {}) => {
  if (todo.scope === TODO_SCOPE.team) return "Team task";
  if (todo.scope === TODO_SCOPE.me) return "Assigned to me";
  return `Assigned to ${todo.assignedToName || "Unassigned"}`;
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

const formatDateOnly = (value) => {
  const date = toDate(value);
  if (!date) return "No date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const StatCard = ({ icon: Icon, label, value, helper, tone = "slate" }) => {
  const tones = {
    slate: "border-slate-300 bg-slate-50 text-slate-600",
    blue: "border-blue-300 bg-blue-50 text-blue-700",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <span className={`rounded-md border p-2 ${tones[tone] || tones.slate}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {helper && <p className="mt-3 text-sm text-slate-500">{helper}</p>}
    </div>
  );
};

const TodoHistory = () => {
  const {
    recentlySelectedCompany,
    recentlySelectedCompanyName,
    user,
    dataBaseUser,
    companyUserAccess,
    companyRoleLoading,
    companyRoleLoaded,
    hasCompanyPermission,
  } = useContext(Context);
  const [searchParams, setSearchParams] = useSearchParams();
  const [todoItems, setTodoItems] = useState([]);
  const [todoBoards, setTodoBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBoardId, setSelectedBoardId] = useState(BOARD_FILTER_ALL);
  const [searchTerm, setSearchTerm] = useState("");

  const startParam = searchParams.get("start") || "";
  const endParam = searchParams.get("end") || "";

  const dateRange = useMemo(() => (
    normalizeTodoHistoryDateRange({ start: startParam, end: endParam })
  ), [endParam, startParam]);

  useEffect(() => {
    if (dateRange.startInput !== startParam || dateRange.endInput !== endParam) {
      setSearchParams({ start: dateRange.startInput, end: dateRange.endInput }, { replace: true });
    }
  }, [dateRange.endInput, dateRange.startInput, endParam, setSearchParams, startParam]);

  useEffect(() => {
    if (!recentlySelectedCompany) {
      setTodoItems([]);
      setTodoBoards([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const todoRef = query(
      collection(db, "companies", recentlySelectedCompany, "todoItems"),
      where("status", "==", TODO_STATUS.done)
    );
    const boardsRef = collection(db, "companies", recentlySelectedCompany, "todoBoards");

    const unsubscribeTodos = onSnapshot(
      todoRef,
      (snapshot) => {
        setTodoItems(snapshot.docs.map(normalizeTodo));
        setLoading(false);
      },
      (error) => {
        console.error("Error loading todo history:", error);
        toast.error("Failed to load todo history.");
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
      }
    );

    return () => {
      unsubscribeTodos();
      unsubscribeBoards();
    };
  }, [recentlySelectedCompany]);

  const currentTodoUserIds = useMemo(() => todoUserIdSet([
    user?.uid,
    user?.id,
    dataBaseUser?.id,
    dataBaseUser?.uid,
    dataBaseUser?.userId,
    companyUserAccess?.uid,
    companyUserAccess?.userId,
    companyUserAccess?.companyUserId,
    companyUserAccess?.companyUserDocId,
  ]), [
    companyUserAccess?.companyUserId,
    companyUserAccess?.companyUserDocId,
    companyUserAccess?.uid,
    companyUserAccess?.userId,
    dataBaseUser?.id,
    dataBaseUser?.uid,
    dataBaseUser?.userId,
    user?.id,
    user?.uid,
  ]);

  const canViewAllTodoBoards = useMemo(() => (
    companyRoleLoaded &&
    !companyRoleLoading &&
    hasCompanyPermission(TODO_ALL_BOARDS_PERMISSION_ID)
  ), [companyRoleLoaded, companyRoleLoading, hasCompanyPermission]);

  const visibleTodoBoards = useMemo(() => (
    canViewAllTodoBoards
      ? todoBoards
      : todoBoards.filter((board) => todoBoardVisibleToUser(board, currentTodoUserIds))
  ), [canViewAllTodoBoards, currentTodoUserIds, todoBoards]);

  const visibleTodoBoardIds = useMemo(() => (
    new Set(visibleTodoBoards.map((board) => board.id))
  ), [visibleTodoBoards]);

  const visibleTodoItems = useMemo(() => (
    canViewAllTodoBoards
      ? todoItems
      : todoItems.filter((todo) => (
        todoVisibleToUser(todo, currentTodoUserIds) ||
        visibleTodoBoardIds.has(todoBoardId(todo))
      ))
  ), [canViewAllTodoBoards, currentTodoUserIds, todoItems, visibleTodoBoardIds]);

  const boardById = useMemo(() => (
    new Map(visibleTodoBoards.map((board) => [board.id, board]))
  ), [visibleTodoBoards]);

  useEffect(() => {
    if (
      selectedBoardId !== BOARD_FILTER_ALL &&
      selectedBoardId !== BOARD_FILTER_UNASSIGNED &&
      !visibleTodoBoards.some((board) => board.id === selectedBoardId)
    ) {
      setSelectedBoardId(BOARD_FILTER_ALL);
    }
  }, [selectedBoardId, visibleTodoBoards]);

  const dateScopedTodos = useMemo(() => (
    visibleTodoItems.filter((todo) => todoCompletedInDateRange(todo, dateRange.startDate, dateRange.endDate))
  ), [dateRange.endDate, dateRange.startDate, visibleTodoItems]);

  const filteredTodos = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return dateScopedTodos
      .filter((todo) => {
        const boardId = todoBoardId(todo);
        const matchesBoard = selectedBoardId === BOARD_FILTER_ALL ||
          (selectedBoardId === BOARD_FILTER_UNASSIGNED ? !boardId : boardId === selectedBoardId);

        if (!matchesBoard) return false;
        if (!search) return true;

        return compact([
          todoIssueKey(todo),
          todo.title,
          todo.description,
          todo.assignedToName,
          todoBoardName(todo, boardById),
          todo.relatedEntity?.type,
          todo.relatedEntity?.id,
          todo.relatedEntity?.label,
        ]).join(" ").toLowerCase().includes(search);
      })
      .sort((left, right) => {
        const completedDiff = toMillis(todoCompletionDate(right)) - toMillis(todoCompletionDate(left));
        if (completedDiff !== 0) return completedDiff;

        return toMillis(right.updatedAt || right.createdAt) - toMillis(left.updatedAt || left.createdAt);
      });
  }, [boardById, dateScopedTodos, searchTerm, selectedBoardId]);

  const stats = useMemo(() => {
    const assignedUserIds = new Set(dateScopedTodos
      .map((todo) => todo.assignedToUserId || todo.assignedToCompanyUserDocId)
      .filter(Boolean));

    return {
      completed: dateScopedTodos.length,
      visible: filteredTodos.length,
      assignedUsers: assignedUserIds.size,
    };
  }, [dateScopedTodos, filteredTodos]);

  const updateDateRange = (field, value) => {
    const nextRange = normalizeTodoHistoryDateRange({
      start: field === "start" ? value : dateRange.startInput,
      end: field === "end" ? value : dateRange.endInput,
    });

    setSearchParams({ start: nextRange.startInput, end: nextRange.endInput });
  };

  const boardOptions = [
    { id: BOARD_FILTER_ALL, label: "All boards" },
    { id: BOARD_FILTER_UNASSIGNED, label: "No board" },
    ...visibleTodoBoards.map((board) => ({ id: board.id, label: board.name })),
  ];

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-500">Loading todo history...</div>;
  }

  return (
    <div className="min-h-screen bg-[#F7F8F9] px-3 py-5 text-slate-900 sm:px-4 lg:px-5">
      <div className="w-full space-y-6">
        <section className="rounded-md border border-[#0C66E4]/20 bg-[#0C66E4] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-100">{recentlySelectedCompanyName || "Selected company"}</p>
              <h1 className="mt-2 break-words text-3xl font-bold">Todo History</h1>
              <p className="mt-2 max-w-3xl text-sm text-blue-50">
                Completed todos from {formatDateOnly(dateRange.startDate)} through {formatDateOnly(dateRange.endDate)}.
              </p>
            </div>
            <Link
              to="/company/todo-list"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/30 bg-white px-4 py-3 text-sm font-bold text-[#0C66E4] shadow-sm transition hover:bg-blue-50"
            >
              <FaArrowLeft className="h-4 w-4" />
              Todo Board
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard icon={FaCheckCircle} label="Completed" value={stats.completed} helper="In selected dates" tone="emerald" />
          <StatCard icon={MdHistory} label="Visible" value={stats.visible} helper="After board/search filters" tone="blue" />
          <StatCard icon={FaUsers} label="Assignees" value={stats.assignedUsers} helper="People on completed work" />
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_minmax(180px,220px)_minmax(180px,240px)]">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-[#0C66E4] focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Search completed todos"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="todo-history-start">Start</label>
              <input
                id="todo-history-start"
                type="date"
                value={dateRange.startInput}
                onChange={(event) => updateDateRange("start", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0C66E4] focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="todo-history-end">End</label>
              <input
                id="todo-history-end"
                type="date"
                value={dateRange.endInput}
                onChange={(event) => updateDateRange("end", event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0C66E4] focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="todo-history-board">Board</label>
              <select
                id="todo-history-board"
                value={selectedBoardId}
                onChange={(event) => setSelectedBoardId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0C66E4] focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {boardOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="mt-3 text-xs font-semibold text-slate-500">
            The board Done column defaults to the last {TODO_DONE_BOARD_LOOKBACK_DAYS} days; this page stays bounded by the selected start and end dates.
          </p>
        </section>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#0C66E4]">Completed work</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{formatDateOnly(dateRange.startDate)} - {formatDateOnly(dateRange.endDate)}</h2>
          </div>

          {filteredTodos.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No completed todos found for this date range.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTodos.map((todo) => (
                <article key={todo.id} className="px-5 py-4 transition hover:bg-slate-50">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                          {todoIssueKey(todo)}
                        </span>
                        <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                          {TODO_STATUS_LABELS[todo.status] || "Done"}
                        </span>
                        <span className={`inline-flex rounded border px-2 py-1 text-[11px] font-bold ${priorityTone(todo.priority)}`}>
                          {TODO_PRIORITY_LABELS[todo.priority] || "Normal"}
                        </span>
                      </div>

                      <h3 className="mt-3 break-words text-base font-bold leading-6 text-slate-950">{todo.title}</h3>
                      {todo.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-500">{todo.description}</p>}

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                        <span>{todoBoardName(todo, boardById)}</span>
                        <span>{assignmentLabel(todo)}</span>
                        {todo.relatedEntity?.type && todo.relatedEntity?.id && (
                          <span>{todo.relatedEntity.type}: {todo.relatedEntity.label || todo.relatedEntity.id}</span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 xl:min-w-[220px]">
                      <div className="flex items-center gap-2 text-emerald-700">
                        <FaCheckCircle className="h-3.5 w-3.5" />
                        Completed {formatShortDateTime(todoCompletionDate(todo))}
                      </div>
                      <div className="flex items-center gap-2">
                        <FaUserCheck className="h-3.5 w-3.5 text-slate-400" />
                        {todo.assignedToName || "No specific owner"}
                      </div>
                      {todo.dueAt && (
                        <div className="flex items-center gap-2">
                          <MdOutlineSchedule className="h-3.5 w-3.5 text-slate-400" />
                          Due {formatShortDateTime(todo.dueAt)}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default TodoHistory;
