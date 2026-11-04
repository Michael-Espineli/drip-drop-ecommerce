// Presentation only. These tones never change a record's persisted status.
const normalized = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

export const jobStatusTone = value => {
    const status = normalized(value);
    if (['draft', 'unscheduled', 'rejected', 'unspecified'].includes(status)) return 'rose';
    if (['estimate', 'estimatepending', 'inprogress'].includes(status)) return 'amber';
    if (['accepted', 'scheduled', 'finished', 'paid', 'comped', 'customerresolved', 'completed', 'complete'].includes(status)) return 'emerald';
    if (['invoiced', 'sent', 'open'].includes(status)) return 'blue';
    if (['waitingforparts', 'blocked'].includes(status)) return 'violet';
    return 'slate';
};

export const jobStatusClass = value => `workspace-status workspace-status-${jobStatusTone(value)}`;
