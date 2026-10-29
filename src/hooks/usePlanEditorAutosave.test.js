import { act, renderHook } from "@testing-library/react";
import usePlanEditorAutosave from "./usePlanEditorAutosave";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const advance = async () => act(async () => { jest.advanceTimersByTime(500); });
const setup = (save) => renderHook((props) => usePlanEditorAutosave(props), {
  initialProps: { documentKey: "plan-A", snapshot: "original", dirty: false, enabled: true, save },
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("groups rapid edits into one automatic save and ignores unchanged renders", async () => {
  const save = jest.fn();
  const view = setup(save);
  const edit = (snapshot) => ({ documentKey: "plan-A", snapshot, dirty: true, enabled: true, save: () => save(snapshot) });
  view.rerender(edit("first"));
  view.rerender(edit("latest"));
  expect(save).not.toHaveBeenCalled();
  await advance();
  expect(save.mock.calls).toEqual([["latest"]]);
  expect(view.result.current.status).toBe("saved");
  view.rerender(edit("latest"));
  await advance();
  expect(save).toHaveBeenCalledTimes(1);
});

test("opening an editor with an older plan snapshot does not write on read", async () => {
  const save = jest.fn();
  const view = renderHook(() => usePlanEditorAutosave({
    documentKey: "plan-A", snapshot: "live scope", dirty: true, enabled: true, save,
  }));
  await advance();
  expect(save).not.toHaveBeenCalled();
  expect(view.result.current.status).toBe("saved");
});

test("serializes changes made during a save and concurrent flushes wait for all edits", async () => {
  const first = deferred();
  const second = deferred();
  const save = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = setup(save);
  const edit = (snapshot) => ({ documentKey: "plan-A", snapshot, dirty: true, enabled: true, save: () => save(snapshot) });
  view.rerender(edit("first"));
  await advance();
  view.rerender(edit("latest"));
  let flushed = false;
  let flush;
  act(() => { flush = view.result.current.flush().then(() => { flushed = true; }); });
  expect(save.mock.calls).toEqual([["first"]]);
  await act(async () => { first.resolve(); });
  expect(save.mock.calls).toEqual([["first"], ["latest"]]);
  expect(flushed).toBe(false);
  expect(view.result.current.status).toBe("saving");
  await act(async () => { second.resolve(); await flush; });
  expect(flushed).toBe(true);
  expect(view.result.current.status).toBe("saved");
});

test("reverting during an in-flight save restores the original value on the server", async () => {
  const first = deferred();
  const save = jest.fn().mockReturnValueOnce(first.promise);
  const view = setup(save);
  view.rerender({ documentKey: "plan-A", snapshot: "changed", dirty: true, enabled: true, save: () => save("changed") });
  await advance();
  view.rerender({ documentKey: "plan-A", snapshot: "original", dirty: false, enabled: true, save: () => save("original") });
  await act(async () => { first.resolve(); });
  expect(save.mock.calls).toEqual([["changed"], ["original"]]);
});

test("a failed save retains the draft for an explicit retry", async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const view = setup(save);
  view.rerender({ documentKey: "plan-A", snapshot: "changed", dirty: true, enabled: true, save });
  await advance();
  expect(view.result.current.status).toBe("error");
  await advance();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { await view.result.current.flush(); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(view.result.current.hasPendingChanges).toBe(false);
});

test("returning to the value currently being saved cancels a newer queued edit", async () => {
  const first = deferred();
  const save = jest.fn().mockReturnValueOnce(first.promise);
  const view = setup(save);
  const edit = (snapshot) => ({ documentKey: "plan-A", snapshot, dirty: true, enabled: true, save: () => save(snapshot) });
  view.rerender(edit("first"));
  await advance();
  view.rerender(edit("second"));
  view.rerender(edit("first"));
  await act(async () => { first.resolve(); });
  expect(save.mock.calls).toEqual([["first"]]);
  expect(view.result.current.status).toBe("saved");
});

test("navigation flushes a pending save before the debounce expires", async () => {
  const save = jest.fn();
  const view = setup(save);
  view.rerender({ documentKey: "plan-A", snapshot: "changed", dirty: true, enabled: true, save });
  await act(async () => { view.unmount(); });
  expect(save).toHaveBeenCalledTimes(1);
});

test("read-only or loading editors do not save and a reverted pending edit is canceled", async () => {
  const save = jest.fn();
  const view = setup(save);
  view.rerender({ documentKey: "plan-A", snapshot: "changed", dirty: true, enabled: false, save });
  await advance();
  expect(save).not.toHaveBeenCalled();
  view.rerender({ documentKey: "plan-A", snapshot: "changed", dirty: true, enabled: true, save });
  view.rerender({ documentKey: "plan-A", snapshot: "original", dirty: false, enabled: true, save });
  await advance();
  expect(save).not.toHaveBeenCalled();
  expect(view.result.current.status).toBe("saved");
});
