import {
  TODO_SCOPE,
  todoAssignedToUser,
  todoAssigneeIds,
  todoBoardVisibleToUser,
  todoCreatedByUser,
  todoVisibleToUser,
  todoUserIdSet,
} from "./TodoItem";

describe("TodoItem assignment helpers", () => {
  it("matches the assigned auth user id", () => {
    expect(todoAssignedToUser({
      assignedToUserId: "auth-123",
      scope: TODO_SCOPE.specific,
    }, todoUserIdSet(["auth-123"]))).toBe(true);
  });

  it("matches the assigned company user document id", () => {
    expect(todoAssignedToUser({
      assignedToCompanyUserDocId: "company-user-123",
      scope: TODO_SCOPE.specific,
    }, todoUserIdSet(["company-user-123"]))).toBe(true);
  });

  it("does not treat another user's self-assigned todo as mine by scope alone", () => {
    expect(todoAssignedToUser({
      scope: TODO_SCOPE.me,
      assignedToUserId: "other-user",
    }, todoUserIdSet(["auth-123"]))).toBe(false);
  });

  it("supports the legacy self-created fallback only when no assignee id exists", () => {
    const legacyTodo = {
      scope: TODO_SCOPE.me,
      createdByUserId: "auth-123",
    };

    expect(todoAssigneeIds(legacyTodo)).toHaveLength(0);
    expect(todoCreatedByUser(legacyTodo, todoUserIdSet(["auth-123"]))).toBe(true);
  });

  it("matches a todo board member by auth user id", () => {
    expect(todoBoardVisibleToUser({
      memberUserIds: ["auth-123"],
    }, todoUserIdSet(["auth-123"]))).toBe(true);
  });

  it("matches a todo board member by company user document id", () => {
    expect(todoBoardVisibleToUser({
      memberCompanyUserDocIds: ["company-user-123"],
    }, todoUserIdSet(["company-user-123"]))).toBe(true);
  });

  it("shows todos assigned to me or on my board", () => {
    const userIds = todoUserIdSet(["auth-123", "company-user-123"]);

    expect(todoVisibleToUser({
      assignedToUserId: "auth-123",
    }, userIds)).toBe(true);

    expect(todoVisibleToUser({
      boardMemberCompanyUserDocIds: ["company-user-123"],
    }, userIds)).toBe(true);
  });

  it("hides todos that are not assigned to me and not on my board", () => {
    expect(todoVisibleToUser({
      assignedToUserId: "other-user",
      boardMemberUserIds: ["another-user"],
    }, todoUserIdSet(["auth-123"]))).toBe(false);
  });
});
