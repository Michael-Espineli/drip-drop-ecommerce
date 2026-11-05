import { jobStatusClass, jobStatusTone } from './statusPresentation';

describe('shared job status presentation', () => {
    test.each([
        ['Draft', 'rose'], ['Unscheduled', 'rose'], ['Rejected', 'rose'],
        ['Estimate Pending', 'amber'], ['In Progress', 'amber'],
        ['Scheduled', 'emerald'], ['Accepted', 'emerald'], ['Finished', 'emerald'],
        ['Paid', 'emerald'], ['Comped', 'emerald'], ['Customer Resolved', 'emerald'],
        ['Invoiced', 'blue'], ['Open', 'blue'],
        ['Waiting for Parts', 'violet'], ['Blocked', 'violet'],
        ['Canceled', 'slate'], ['Cancelled', 'slate'], ['Expired', 'slate'],
        ['  IN_PROGRESS ', 'amber'], ['waiting-for-parts', 'violet'],
        [null, 'slate'], ['new server state', 'slate'],
    ])('%s has the same semantic tone in each job surface', (status, tone) => {
        expect(jobStatusTone(status)).toBe(tone);
        expect(jobStatusClass(status)).toBe(`workspace-status workspace-status-${tone}`);
    });
});
