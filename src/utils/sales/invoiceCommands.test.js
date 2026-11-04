import { httpsCallable } from 'firebase/functions';
import { recordManualSalesPayment } from './manualBilling';
import { newManualPaymentForm, persistManualPaymentDraft, clearManualPaymentDraft, invoiceActionRequestId, clearInvoiceActionRequest } from './invoiceCommands';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../config', () => ({ functions: {} }));
jest.mock('../callableAuth', () => ({ getCallableAuthPayload: async () => ({ idToken: 'test-token' }) }));
const scope = { companyId: 'company', invoiceId: 'invoice', userId: 'manager' };
beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); });

test('manual receipt retries send the same durable ID and date to the server, never client financial writes', async () => {
  const call = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: {paymentId:'payment',amountDueCents:7500} });
  httpsCallable.mockReturnValue(call);
  const form = newManualPaymentForm(scope, '25.00');
  form.receivedDate = '2026-10-30'; form.referenceNumber = 'CHECK-1';
  persistManualPaymentDraft(scope, form);
  const payment = { amountCents:2500,method:'check',referenceNumber:form.referenceNumber,receivedAtMillis:Date.parse('2026-10-30T12:00:00Z') };
  await expect(recordManualSalesPayment({},scope.invoiceId,payment,{...scope,requestId:form.requestId})).rejects.toThrow('offline');
  const restored = newManualPaymentForm(scope,'100.00');
  expect(restored).toEqual(form);
  const result = await recordManualSalesPayment({},scope.invoiceId,payment,{...scope,requestId:restored.requestId});
  expect(call.mock.calls[0][0]).toEqual(call.mock.calls[1][0]);
  expect(call.mock.calls[0][0]).toEqual(expect.objectContaining({action:'recordPayment',requestId:form.requestId,companyId:'company',payment:expect.objectContaining({amountCents:2500,receivedAtMillis:payment.receivedAtMillis})}));
  expect(result.paymentId).toBe('payment');expect(httpsCallable).toHaveBeenCalledWith({},'manageSalesInvoice');
  clearManualPaymentDraft(scope);expect(newManualPaymentForm(scope,'100.00').requestId).not.toBe(form.requestId);
});
test('receipt drafts are scoped to actor, invoice and selected company', () => {
  const form=newManualPaymentForm(scope,'25.00');persistManualPaymentDraft(scope,form);
  for (const change of [{companyId:'other'},{invoiceId:'other'},{userId:'other'}]) expect(newManualPaymentForm({...scope,...change},'50.00').requestId).not.toBe(form.requestId);
});
test('a missing request identity fails before calling the server', async () => {
  await expect(recordManualSalesPayment({},'invoice',{amountCents:2500},{companyId:'company'})).rejects.toThrow(/saved receipt request/);expect(httpsCallable).not.toHaveBeenCalled();
});
test('unavailable session storage still keeps retry identities in memory',()=>{
 const get=jest.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Storage disabled');});
 const set=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage disabled');});
 try {
  const local={...scope,invoiceId:'private-browser'};
  const form=newManualPaymentForm(local,'25.00');persistManualPaymentDraft(local,form);
  expect(newManualPaymentForm(local,'100.00').requestId).toBe(form.requestId);
  const id=invoiceActionRequestId(local,'void');expect(invoiceActionRequestId(local,'void')).toBe(id);
  clearInvoiceActionRequest(local,'void');expect(invoiceActionRequestId(local,'void')).not.toBe(id);
  clearManualPaymentDraft(local);
 } finally {get.mockRestore();set.mockRestore();}
});
