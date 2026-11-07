const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createHash } = require('node:crypto');
const { billingActor } = require('./billingAccess');
const { documentId, fail } = require('./companyActor');
const { getStripe } = require('./stripe/stripeClient');

const text = value => String(value ?? '').trim();
const normalized = value => text(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
const hash = value => createHash('sha256').update(value).digest('hex');
const millis = value => value?.toMillis?.() ?? value?.getTime?.() ?? 0;
const MAX_CENTS = 999999999999;
const cents = (value, label, { signed = false } = {}) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS || (!signed && value < 0)) {
    fail('invalid-argument', `${label} must be a valid whole number of cents.`);
  }
  return value;
};
const boundedText = (value, label, max = 1000) => {
  if (value !== undefined && value !== null && typeof value !== 'string') fail('invalid-argument', `${label} must be text.`);
  const result = text(value);
  if (result.length > max) fail('invalid-argument', `${label} is too long.`);
  return result;
};
const stripeOwned = invoice => Boolean(invoice.stripeInvoiceId || invoice.stripeHostedInvoiceUrl || invoice.stripeSubscriptionId);
const closed = invoice => ['paid', 'void', 'voided', 'uncollectible', 'cancelled', 'canceled'].includes(normalized(invoice.status));

function normalizePayment(payment = {}, now) {
  const amountCents = cents(payment.amountCents, 'Payment amount');
  if (!amountCents) fail('invalid-argument', 'Payment amount must be greater than zero.');
  if (!['cash', 'check', 'externalCard', 'bankTransfer', 'other'].includes(payment.method)) fail('invalid-argument', 'Choose an external or manual payment method.');
  const receivedAtMillis = payment.receivedAtMillis;
  if (!Number.isSafeInteger(receivedAtMillis) || receivedAtMillis < Date.UTC(1900, 0, 1) || receivedAtMillis > now.getTime() + 86400000) {
    fail('invalid-argument', 'Choose a valid payment received date.');
  }
  return { amountCents, method: payment.method, receivedAtMillis,
    referenceNumber: boundedText(payment.referenceNumber, 'Reference', 300), memo: boundedText(payment.memo, 'Notes', 5000) };
}

function normalizeChanges(changes = {}) {
  const allowed = ['invoiceNumber', 'customerName', 'email', 'status', 'deliveryMethod', 'dueDateMillis', 'discountAmountCents', 'taxAmountCents', 'writeOffAmountCents', 'memo', 'lineItems'];
  if (Object.keys(changes).some(field => !allowed.includes(field))) fail('invalid-argument', 'Invoice changes contain a protected field.');
  const invoiceNumber = boundedText(changes.invoiceNumber, 'Invoice number', 200), email = boundedText(changes.email, 'Email', 320);
  if (!invoiceNumber || !email || !email.includes('@')) fail('invalid-argument', 'An invoice number and billing email are required.');
  if (!['draft', 'open', 'overdue', 'uncollectible'].includes(changes.status)) fail('invalid-argument', 'Use the payment or void action to close an invoice.');
  if (!['email', 'customerPortal', 'print', 'none', 'stripeHostedInvoice'].includes(changes.deliveryMethod)) fail('invalid-argument', 'Choose an invoice delivery method.');
  if (changes.deliveryMethod === 'stripeHostedInvoice') fail('failed-precondition', 'Manage Stripe invoices in Stripe.');
  const dueDateMillis = changes.dueDateMillis ?? null;
  if (dueDateMillis !== null && (!Number.isSafeInteger(dueDateMillis) || !Number.isFinite(new Date(dueDateMillis).getTime()))) fail('invalid-argument', 'Choose a valid due date.');
  if (!Array.isArray(changes.lineItems) || !changes.lineItems.length || changes.lineItems.length > 100) fail('invalid-argument', 'Add between 1 and 100 invoice lines.');
  const lineItems = changes.lineItems.map((line, index) => {
    const quantity = line.quantity, unitAmountCents = cents(line.unitAmountCents, 'Unit amount', { signed: true });
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) fail('invalid-argument', 'Invoice quantities must be positive numbers.');
    const totalAmountCents = cents(Math.round(unitAmountCents * quantity), 'Line total', { signed: true });
    const name = boundedText(line.name || line.description, 'Line name', 300);
    if (!name) fail('invalid-argument', 'Each invoice line needs a name.');
    const result = { id: boundedText(line.id || `line_${index}`, 'Line ID', 200), name,
      description: boundedText(line.description, 'Description', 3000), quantity, unitAmountCents, totalAmountCents, taxable: line.taxable === true };
    for (const field of ['catalogItemId', 'sourceType', 'sourceId', 'type', 'stripeProductId', 'stripePriceId']) result[field] = boundedText(line[field], field, 500);
    // Provenance metadata is copied from the saved line at commit, not trusted from the caller.
    return result;
  });
  if (new Set(lineItems.map(line => line.id)).size !== lineItems.length) fail('invalid-argument', 'Invoice line IDs must be unique.');
  const subtotalAmountCents = cents(lineItems.reduce((sum, line) => sum + line.totalAmountCents, 0), 'Subtotal');
  const discountAmountCents = cents(changes.discountAmountCents ?? 0, 'Discount'), taxAmountCents = cents(changes.taxAmountCents ?? 0, 'Tax');
  const totalAmountCents = cents(subtotalAmountCents - discountAmountCents + taxAmountCents, 'Total');
  return { invoiceNumber, customerName: boundedText(changes.customerName, 'Customer name', 300), email,
    status: changes.status, deliveryMethod: changes.deliveryMethod, dueDateMillis, lineItems,
    subtotalAmountCents, discountAmountCents, taxAmountCents, totalAmountCents,
    writeOffAmountCents: cents(changes.writeOffAmountCents ?? 0, 'Write-off'), memo: boundedText(changes.memo, 'Memo', 5000) };
}

function savedAmounts(invoice) {
  const total = cents(invoice.totalAmountCents ?? invoice.totalCents ?? 0, 'Saved invoice total');
  const paid = cents(invoice.amountPaidCents ?? 0, 'Saved receipts');
  const writeOff = cents(invoice.writeOffAmountCents ?? 0, 'Saved write-off');
  const credit = require('./billingMath').invoiceCredits(invoice);
  const due = Math.max(total - paid - writeOff - credit, 0);
  if (paid + writeOff + credit > total || invoice.paymentReviewRequired || invoice.amountDueCents != null && invoice.amountDueCents !== due) {
    fail('failed-precondition', 'This invoice balance needs review before it can be changed.');
  }
  return { total, paid, writeOff, credit, due };
}

// Reserve, expire the external collection path, then re-read all money before committing.
// Stripe is deliberately called outside Firestore transactions; retries reuse its saved parameters.
function createSalesInvoiceCommands(db, stripeProvider = getStripe, now = () => new Date()) {
  async function manage(request) {
    if (!request.auth?.uid) fail('unauthenticated', 'Sign in to manage invoices.');
    const data = request.data || {}, uid = request.auth.uid;
    const companyId = documentId(data.companyId, 'Company'), invoiceId = documentId(data.invoiceId, 'Invoice');
    const requestId = documentId(data.requestId, 'Request');
    const action = data.action;
    if (!['recordPayment', 'update', 'void', 'delete', 'reversePayment', 'applyCredit'].includes(action)) fail('invalid-argument', 'Choose a supported invoice action.');
    const adjustment = ['reversePayment','applyCredit'].includes(action) ? {
      reason: boundedText(data.adjustment?.reason, 'Adjustment reason', 2000),
      ...(action==='reversePayment'?{paymentId:documentId(data.adjustment?.paymentId,'Receipt')}:{amountCents:cents(data.adjustment?.amountCents,'Credit amount')})
    } : null;
    if (adjustment && adjustment.reason.length < 8) fail('invalid-argument', 'Explain the reason for this adjustment.');
    const payment = action === 'recordPayment' ? normalizePayment(data.payment, now()) : null;
    const changes = action === 'update' ? normalizeChanges(data.changes) : null;
    const expectedRevision = action === 'update' ? data.expectedRevision : null;
    const expectedUpdatedAtMillis = action === 'update' ? data.expectedUpdatedAtMillis : null;
    if (action === 'update' && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(expectedUpdatedAtMillis) || expectedUpdatedAtMillis < 0)) {
      fail('invalid-argument', 'Reload the invoice before editing it.');
    }
    const commandId = hash(`${companyId}:${invoiceId}:${uid}:${requestId}`), fingerprint = hash(JSON.stringify({companyId, invoiceId, uid, action, payment, changes, adjustment, expectedRevision, expectedUpdatedAtMillis}));
    const invoiceRef = db.collection('salesInvoices').doc(invoiceId), commandRef = invoiceRef.collection('companyCommands').doc(commandId);
    const lockMillis = 120000;
    const reserve = await db.runTransaction(async tx => {
      await billingActor(db, tx, companyId, uid);
      const [snap, command] = await Promise.all([tx.get(invoiceRef), tx.get(commandRef)]);
      if (command.exists && command.data().fingerprint !== fingerprint) fail('already-exists', 'This request already belongs to a different invoice change. Retry the original request.');
      if (command.data()?.status === 'complete') return { result: command.data().result };
      if (!snap.exists) fail('not-found', 'Invoice not found.');
      const invoice = snap.data();
      if (invoice.companyId !== companyId) fail('permission-denied', 'Select the company that owns this invoice.');
      if (stripeOwned(invoice)) fail('failed-precondition', 'This invoice is managed by Stripe. Make payment, credit, or void changes in Stripe.');
      if (invoice.automationEmailStatus === 'sending' && Date.now() - millis(invoice.automationEmailStartedAt) < 300000) fail('failed-precondition', 'An invoice email is being sent. Wait for its result before changing this invoice.');
      if (invoice.paymentProcessing) fail('failed-precondition', 'A payment is being confirmed. Wait for its result before changing this invoice.');
      if (action === 'recordPayment') {
        const amounts = savedAmounts(invoice);
        if (closed(invoice) || !['open','overdue','partiallypaid'].includes(normalized(invoice.status))) fail('failed-precondition', 'Only an open invoice can receive a payment.');
        if (payment.amountCents > amounts.due) fail('failed-precondition', 'Payment exceeds the current balance. Record a customer credit separately.');
      }
      if (action === 'update' && (closed(invoice) || (invoice.billingRevision || 0) !== expectedRevision || millis(invoice.updatedAt) !== expectedUpdatedAtMillis)) {
        fail('failed-precondition', 'The invoice changed or is closed. Reload it before editing.');
      }
      if (invoice.billingMutation?.id !== commandId && millis(invoice.billingMutation?.startedAt) + lockMillis > now().getTime()) fail('aborted', 'Another invoice change is in progress. Please retry shortly.');
      const attempt = invoice.portalPaymentAttemptId ? await tx.get(invoiceRef.collection('portalPaymentAttempts').doc(documentId(invoice.portalPaymentAttemptId, 'Payment attempt'))) : null;
      tx.set(commandRef, { fingerprint, action, actorUserId: uid, companyId, status: 'pending', createdAt: command.data()?.createdAt || now() }, {merge:true});
      tx.set(invoiceRef, { billingMutation: { id: commandId, startedAt: now() } }, {merge:true});
      return { attempt: attempt?.exists ? {...attempt.data(), id:attempt.id} : null };
    });
    if (reserve.result) return reserve.result;
    try {
      const attempt = reserve.attempt;
      if (attempt && !['failed', 'expired'].includes(attempt.status)) {
        if (['posted', 'processing'].includes(attempt.status)) fail('failed-precondition', 'A payment is being confirmed. Wait for its result before changing this invoice.');
        if (attempt.sessionId || millis(attempt.expiresAt) > now().getTime()) {
          const stripe = stripeProvider(), options = {stripeAccount:attempt.connectedAccount};
          const session = attempt.sessionId ? await stripe.checkout.sessions.retrieve(attempt.sessionId, {}, options)
            : await stripe.checkout.sessions.create(attempt.params, {...options,idempotencyKey:attempt.id});
          if (session.status === 'complete') fail('failed-precondition', 'The customer completed payment. Refresh the invoice after confirmation.');
          if (session.status === 'open') await stripe.checkout.sessions.expire(session.id, {}, options);
          else if (session.status !== 'expired') fail('failed-precondition', 'Confirm the pending payment before changing this invoice.');
          await invoiceRef.collection('portalPaymentAttempts').doc(attempt.id).set({sessionId:session.id,status:'expired',updatedAt:now()},{merge:true});
        }
      }
      return await db.runTransaction(async tx => {
        await billingActor(db, tx, companyId, uid);
        const [snap, command] = await Promise.all([tx.get(invoiceRef),tx.get(commandRef)]);
        if (command.data()?.status === 'complete') return command.data().result;
        if (command.data()?.fingerprint !== fingerprint) fail('aborted', 'This invoice request changed. Reload it before saving.');
        const invoice = snap.data() || {};
        if (!snap.exists || invoice.companyId !== companyId || invoice.billingMutation?.id !== commandId) fail('aborted', 'This invoice changed. Refresh it and retry.');
        if (stripeOwned(invoice) || invoice.paymentProcessing) fail('failed-precondition', 'Confirm the Stripe payment before changing this invoice.');
        const timestamp = now(), revision = Number(invoice.billingRevision || 0) + 1;
        const {total,paid,writeOff,credit,due} = savedAmounts(invoice);
        const common = {billingMutation:null,billingRevision:revision,updatedAt:timestamp,updatedByUserId:uid};
        let patch, result;
        if (action === 'recordPayment') {
          if (closed(invoice) || !['open','overdue','partiallypaid'].includes(normalized(invoice.status))) fail('failed-precondition', 'Only an open invoice can receive a payment.');
          if (payment.amountCents > due) fail('failed-precondition', 'Payment exceeds the current balance. Record a customer credit separately.');
          const paymentId = `manual_${commandId}`, nextPaid = paid + payment.amountCents, nextDue = total - nextPaid - writeOff - credit;
          const row = {id:paymentId,invoiceId,companyId,customerId:invoice.customerId || '',customerUserId:invoice.customerUserId || null,
            relationshipId:invoice.relationshipId || invoice.customerCompanyRelationshipId || '',customerCompanyRelationshipId:invoice.customerCompanyRelationshipId || invoice.relationshipId || '',
            customerName:invoice.customerName || '',email:invoice.email || '',agreementId:invoice.agreementId || '',jobId:invoice.jobId || '',
            billingProfileId:invoice.billingProfileId || '',billingSubscriptionId:invoice.billingSubscriptionId || '',
            stripeConnectedAccountId:invoice.stripeConnectedAccountId || '',currency:invoice.currency || 'usd',
            amountCents:payment.amountCents,netAmountCents:payment.amountCents,grossPosted:true,method:payment.method,status:'posted',source:'manual',
            referenceNumber:payment.referenceNumber,memo:payment.memo,receivedAt:new Date(payment.receivedAtMillis),
            recordedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,recordedByUserId:uid,requestId,
            billingCollectionMethod:invoice.billingCollectionMethod || 'manualUntilAutopay',receiptUrl:'',
            receiptsEnabled:invoice.receiptsEnabled !== false,receiptDeliveryMethod:invoice.receiptDeliveryMethod || invoice.deliveryMethod || 'email'};
          tx.set(db.collection('salesPayments').doc(paymentId),row);
          tx.set(db.collection('salesPaymentEvents').doc(`manual_${commandId}`),{...row,id:`manual_${commandId}`,paymentId,type:'manualPaymentRecorded',actorUserId:uid});
          patch = {...common,amountPaidCents:nextPaid,amountDueCents:nextDue,status:nextDue === 0 ? 'paid':'partiallyPaid',
            paidAt:nextDue === 0 ? timestamp:null,lastPaymentAt:timestamp,lastPaymentId:paymentId};
          result = {invoiceId,paymentId,amountCents:payment.amountCents,amountDueCents:nextDue,status:patch.status};
        } else if (action === 'reversePayment' || action === 'applyCredit') {
          if (['void','voided','uncollectible','canceled','cancelled','draft'].includes(normalized(invoice.status))) fail('failed-precondition','Adjust an issued invoice before closing it.');
          let amount, nextPaid=paid, nextCredit=Number(invoice.creditAmountCents || 0), receipt=null;
          if (action === 'reversePayment') {
            receipt = await tx.get(db.collection('salesPayments').doc(adjustment.paymentId));
            const row=receipt.data() || {};
            if (!receipt.exists || row.companyId!==companyId || row.invoiceId!==invoiceId || row.source!=='manual' || row.stripePaymentIntentId || row.stripeChargeId || row.status!=='posted') fail('failed-precondition','Only an unreversed manual receipt on this invoice can be reversed.');
            amount=cents(row.amountCents,'Original receipt')-Number(row.refundedAmountCents || 0)-Number(row.reversedAmountCents || 0);
            if (amount<=0 || amount>paid) fail('failed-precondition','The receipt balance needs review.');
            nextPaid-=amount;
          } else {
            amount=adjustment.amountCents;
            if (!amount || amount>due) fail('failed-precondition','Credit cannot exceed this invoice’s open balance.');
            nextCredit+=amount;
          }
          const nextDue=total-nextPaid-writeOff-Number(invoice.refundCreditCents || 0)-Number(invoice.disputeCreditCents || 0)-nextCredit;
          const audit={id:commandId,companyId,invoiceId,customerId:invoice.customerId || '',customerUserId:invoice.customerUserId || '',email:invoice.email || '',kind:action,
            paymentId:receipt?.id || '',amountCents:amount,reason:adjustment.reason,actorUserId:uid,createdAt:timestamp};
          if (receipt) tx.set(receipt.ref,{status:'reversed',reversedAmountCents:Number(receipt.data().reversedAmountCents || 0)+amount,netAmountCents:0,grossPosted:true,reversedAt:timestamp,reversedByUserId:uid,reversalReason:adjustment.reason,updatedAt:timestamp},{merge:true});
          tx.set(db.collection('salesPaymentAdjustments').doc(`manual_${commandId}`),audit);
          tx.set(db.collection('salesPaymentEvents').doc(`adjustment_${commandId}`),{...audit,type:action});
          patch={...common,amountPaidCents:nextPaid,amountDueCents:nextDue,creditAmountCents:nextCredit,status:nextDue===0?'paid':nextPaid>0?'partiallyPaid':'open',paidAt:nextDue===0?invoice.paidAt||timestamp:null};
          result={invoiceId,status:patch.status,amountDueCents:nextDue,adjustmentId:commandId};
        } else if (action === 'update') {
          if (closed(invoice)) fail('failed-precondition', 'Closed invoices cannot be reopened by editing. Create an explicit new invoice or adjustment.');
          if ((invoice.billingRevision || 0) !== expectedRevision || millis(invoice.updatedAt) !== expectedUpdatedAtMillis) fail('aborted', 'This invoice changed after editing began. Reload it before saving.');
          const nextDue = changes.totalAmountCents - paid - changes.writeOffAmountCents - credit;
          if (nextDue < 0 || changes.status === 'draft' && paid > 0 || changes.status === 'uncollectible' && nextDue !== 0) fail('failed-precondition', 'The new total/write-off conflicts with recorded payments or invoice status.');
          const oldLines = new Map((invoice.lineItems || []).map(line => [line.id,line]));
          const {dueDateMillis,...fields} = changes;
          const nextStatus = changes.status === 'draft' && paid === 0 ? 'draft' : nextDue === 0
            ? paid > 0 ? 'paid' : changes.writeOffAmountCents > 0 || changes.status === 'uncollectible' ? 'uncollectible' : 'paid'
            : paid > 0 ? 'partiallyPaid' : changes.status;
          patch = {...fields,...common,dueDate:dueDateMillis === null ? null:admin.firestore.Timestamp.fromMillis(dueDateMillis),
            lineItems:changes.lineItems.map(line=>({...line,metadata:oldLines.get(line.id)?.metadata || {}})),
            amountDueCents:nextDue,status:nextStatus,
            paidAt:nextStatus === 'paid' ? invoice.paidAt || timestamp:null};
          result={invoiceId,status:patch.status,amountDueCents:nextDue};
        } else if (action === 'void') {
          if (paid > 0) fail('failed-precondition', 'This invoice has recorded payments. Resolve the refund or credit before voiding it.');
          patch={...common,status:'void',amountDueCents:0,voidedAt:invoice.voidedAt || timestamp,voidedByUserId:invoice.voidedByUserId || uid};
          result={invoiceId,status:'void',amountDueCents:0};
        } else {
          const receipts = await tx.get(db.collection('salesPayments').where('invoiceId','==',invoiceId).limit(1));
          if (paid > 0 || !receipts.empty || invoice.portalPaymentAttemptId || invoice.sentAt || invoice.emailDelivery?.reviewAccessToken || closed(invoice)) fail('failed-precondition', 'Only an unsent invoice with no payment activity can be deleted. Void it instead.');
          result={invoiceId,deleted:true};
        }
        tx.set(db.collection('salesInvoiceEvents').doc(commandId),{id:commandId,invoiceId,companyId,action,actorUserId:uid,createdAt:timestamp,
          previousStatus:invoice.status || '',previousAmountDueCents:invoice.amountDueCents ?? due,result});
        if (action === 'delete') tx.delete(invoiceRef); else tx.set(invoiceRef,patch,{merge:true});
        tx.set(commandRef,{status:'complete',completedAt:timestamp,result},{merge:true});
        return result;
      });
    } catch (error) {
      // A newer reservation must never be cleared by an older worker.
      await db.runTransaction(async tx => {
        const invoice = await tx.get(invoiceRef);
        if (invoice.data()?.billingMutation?.id === commandId) tx.set(invoiceRef,{billingMutation:null},{merge:true});
      }).catch(()=>{});
      throw error;
    }
  }
  return {manage};
}

exports.createSalesInvoiceCommands = createSalesInvoiceCommands;
exports.normalizePayment = normalizePayment;
exports.manageSalesInvoice = onCall({cors:true},request=>createSalesInvoiceCommands(admin.firestore()).manage(request));
