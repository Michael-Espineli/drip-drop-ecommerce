import { httpsCallable } from 'firebase/functions';
import { v4 as uuidv4 } from 'uuid';
import { functions, auth } from './config';

const pendingRequests = new Map();
export const routeMovePayload = ({ companyId, stops, techId, serviceDate }) => {
    const day = new Date(serviceDate);
    if (Number.isNaN(day.getTime())) throw new Error('Select a valid move date.');
    const serviceDateKey = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
    return {
        action: 'oneTime', companyId, techId, serviceDateKey,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        stops: stops.map(stop => ({
            id: stop.id, techId: stop.techId || '',
            serviceDateMillis: Math.trunc((stop.serviceDate?.toDate?.() || new Date(stop.serviceDate)).getTime()),
            ...(stop.assignmentRevision != null ? { assignmentRevision: stop.assignmentRevision } : {}),
        })).sort((a, b) => a.id.localeCompare(b.id)),
    };
};

export async function moveRouteStops(options) {
    const payload = routeMovePayload(options);
    const key = `${auth?.currentUser?.uid || ''}:${JSON.stringify(payload)}`;
    // Retain identity on transport failure so a retry can recover a committed
    // result even when its original response never reached the browser.
    if (!pendingRequests.has(key)) pendingRequests.set(key, uuidv4());
    const response = await httpsCallable(functions, 'manageRouteWork')({ ...payload, requestId: pendingRequests.get(key) });
    if (response.data?.status !== 200) throw new Error(response.data?.error || 'The move was not confirmed.');
    pendingRequests.delete(key);
    return response.data;
}
