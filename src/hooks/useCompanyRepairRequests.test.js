import { act, renderHook } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import useCompanyRepairRequests from './useCompanyRepairRequests';

jest.mock('../utils/config', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: (_, ...parts) => parts.join('/'),
  query: (path, ...filters) => ({ path, filters }),
  where: (field, operator, value) => ({ field, operator, value }),
  onSnapshot: jest.fn(),
}));

test('live requests keep source identities and ignore callbacks after company changes or unmount', () => {
  const subscriptions = [];
  onSnapshot.mockImplementation((query, callback) => {
    const unsubscribe = jest.fn();
    subscriptions.push({ query, callback, unsubscribe });
    return unsubscribe;
  });
  const emit = (subscription, description) => act(() => subscription.callback({ docs: [{
    id: 'shared-id', data: () => ({ id: 'stale-stored-id', status: 'Unresolved', description }),
  }] }));
  const view = renderHook(({ company }) => useCompanyRepairRequests(company), { initialProps: { company: 'one' } });
  emit(subscriptions[0], 'Company request');
  expect(view.result.current.loading).toBe(true);
  emit(subscriptions[1], 'Homeowner request');
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.requests.map(({ id, sourcePath }) => ({ id, sourcePath }))).toEqual([
    { id: 'shared-id', sourcePath: 'company' }, { id: 'shared-id', sourcePath: 'homeowner' },
  ]);
  view.rerender({ company: 'two' });
  expect(view.result.current.requests).toEqual([]);
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  expect(subscriptions[1].unsubscribe).toHaveBeenCalledTimes(1);
  emit(subscriptions[0], 'Late previous company result');
  expect(view.result.current.requests).toEqual([]);
  emit(subscriptions[2], 'Current company');
  expect(view.result.current.requests[0].description).toBe('Current company');
  view.unmount();
  expect(subscriptions[2].unsubscribe).toHaveBeenCalledTimes(1);
  expect(subscriptions[3].unsubscribe).toHaveBeenCalledTimes(1);
  emit(subscriptions[2], 'Late unmounted result');
});
