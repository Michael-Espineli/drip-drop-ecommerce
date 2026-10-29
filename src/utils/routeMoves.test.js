import { httpsCallable } from 'firebase/functions';
import { moveRouteStops, routeMovePayload } from './routeMoves';
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('./config', () => ({ functions: {} }));
const options = { companyId:'company',techId:'target',serviceDate:new Date(2026,9,28),stops:[{id:'stop',techId:'source',serviceDate:{toDate:()=>new Date(2026,9,27)},assignmentRevision:2}] };
test('uses calendar-date input and an expected assignment snapshot without client pay terms',()=>{
    const payload=routeMovePayload(options);
    expect(payload.serviceDateKey).toBe('2026-10-28');expect(payload.stops).toEqual([{id:'stop',techId:'source',serviceDateMillis:new Date(2026,9,27).getTime(),assignmentRevision:2}]);expect(payload).not.toHaveProperty('payrollAgreement');
});
test('a lost response retries the same server request and a confirmed later action gets a new identity',async()=>{
    const callable=jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({data:{status:200,movedStopIds:['stop']}});
    httpsCallable.mockReturnValue(callable);
    await expect(moveRouteStops(options)).rejects.toThrow('timeout');await moveRouteStops(options);await moveRouteStops(options);
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(),'manageRouteWork');
    expect(callable.mock.calls[0][0].requestId).toBe(callable.mock.calls[1][0].requestId);expect(callable.mock.calls[2][0].requestId).not.toBe(callable.mock.calls[1][0].requestId);
});
test('an unconfirmed server result remains an error with inputs available for retry',async()=>{
    httpsCallable.mockReturnValue(jest.fn().mockResolvedValue({data:{status:500,error:'Review coverage first'}}));
    await expect(moveRouteStops(options)).rejects.toThrow('Review coverage first');
});
