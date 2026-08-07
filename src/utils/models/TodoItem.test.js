import {
  TODO_SCOPE,
  todoAssignedToUser,
  todoAssigneeIds,
  todoCreatedByUser,
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
});
