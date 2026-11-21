import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppDialogProvider from './AppDialogProvider';
import { saveWithCurrentWeekReview } from './CurrentWeekRouteReview';

const preview = {
  reviewRequired: true, previewId: 'review', today: '2026-11-05', weekStart: '2026-11-01', weekEnd: '2026-11-07', effectiveDate: '2026-11-08',
  technicians: [{ id: 'tech', name: 'Technician B' }],
  schedules: [{ id: 'rss', customer: 'Pool customer', nextDay: 'Monday', nextTech: 'Technician B',
    nextDates: ['2026-11-09'], visits: [{ id: 'stop', dateKey: '2026-11-06', state: 'open', status: 'Not Finished', technician: 'Technician A' }] }],
};

async function openReview(callable) {
  render(<AppDialogProvider><span>Route</span></AppDialogProvider>);
  let result;
  await act(async () => { result = saveWithCurrentWeekReview(callable, { companyId: 'company' }); });
  return { result };
}

test('Cancel keeps the form open and makes only a read-only preview request', async () => {
  const callable = jest.fn().mockResolvedValue({ data: preview });
  const { result } = await openReview(callable);
  expect(screen.getByRole('button', { name: 'Save change' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Keep as scheduled' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Move this week' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await result).toBeNull();
  expect(callable).toHaveBeenCalledTimes(1);
  expect(callable).toHaveBeenCalledWith({ companyId: 'company', currentWeekReview: { action: 'preview' } });
});

test('a move requires both fields and a failed confirmation can retry with the same request ID', async () => {
  const callable = jest.fn().mockResolvedValueOnce({ data: preview }).mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ data: { success: true } });
  const { result } = await openReview(callable);
  fireEvent.click(screen.getByRole('radio', { name: 'Move this week' }));
  fireEvent.change(screen.getByLabelText('New visit date'), { target: { value: '2026-11-07' } });
  expect(screen.getByRole('button', { name: 'Save change' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Technician for this visit'), { target: { value: 'tech' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(await result).toEqual({ success: true });
  const review = callable.mock.calls[1][0].currentWeekReview;
  expect(review).toMatchObject({ action: 'commit', previewId: 'review',
    choices: [{ stopId: 'stop', action: 'move', dateKey: '2026-11-07', techId: 'tech' }] });
  expect(callable.mock.calls[2][0].currentWeekReview).toEqual(review);
});
