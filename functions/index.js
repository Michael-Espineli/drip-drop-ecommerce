require('dotenv').config({ path: process.env.GCLOUD_PROJECT ? `.env.${process.env.GCLOUD_PROJECT}` : '.env' });
const { onCall } = require('firebase-functions/v2/https');
const { HttpsError } = require('./appErrors');
const functions1 = require('firebase-functions/v1');
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');

// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();
const db = admin.firestore();

const { onAgreementWritten, writeCompanyWorkflowAlert, salesWorkflowFirstText } =
  require('./salesAgreementNotifications').createSalesAgreementNotifications(db);

const createCompanyRepairRequestCreatedAlert = async ({ companyId, repairRequestId, repairRequest = {} }) => {
  if (!companyId || !repairRequestId) return '';

  const alertId = `repair_request_created_${repairRequestId}`;
  const companyWebPath = `/company/repair-requests/detail/${repairRequestId}`;
  const customerName = salesWorkflowFirstText(repairRequest.customerName);
  const recordTitle = customerName || 'Repair Request';
  const requesterName = salesWorkflowFirstText(
    repairRequest.requesterName,
    repairRequest.createdByName,
    repairRequest.userName,
    'A team member'
  );
  const description = salesWorkflowFirstText(repairRequest.description, repairRequest.notes);
  const message = [
    `${requesterName} created a repair request${customerName ? ` for ${customerName}` : ''}.`,
    description,
  ].filter(Boolean).join(' ');
  const createdDate = repairRequest.date || repairRequest.createdAt || admin.firestore.FieldValue.serverTimestamp();

  const alertPayload = {
    id: alertId,
    companyId,
    recipientCompanyId: companyId,
    title: 'New repair request',
    name: 'New repair request',
    message,
    description: message,
    status: 'unread',
    read: false,
    severity: 'warning',
    type: 'repair_request_created',
    source: 'repairRequests',
    sourceId: repairRequestId,
    route: companyWebPath,
    category: 'repairRequest',
    hasItem: true,
    itemId: repairRequestId,
    itemName: recordTitle,
    targetScope: 'team',
    deliveryTargets: ['web', 'ios'],
    channels: {
      dashboard: true,
      ios: true,
      push: true,
    },
    relatedEntity: {
      type: 'repairRequest',
      id: repairRequestId,
      label: recordTitle,
      companyId,
      collectionPath: `companies/${companyId}/repairRequests`,
      webPath: companyWebPath,
      companyWebPath,
      clientWebPath: '',
    },
    share: {
      type: 'repairRequest',
      recordId: repairRequestId,
      title: recordTitle,
      subtitle: description || 'New repair request',
      companyId,
      customerId: repairRequest.customerId || '',
      customerUserId: repairRequest.customerUserId || repairRequest.homeownerId || repairRequest.homeownerUserId || '',
      collectionPath: `companies/${companyId}/repairRequests`,
      webPath: companyWebPath,
      companyWebPath,
      clientWebPath: '',
      mobileRoute: 'repairRequest',
      audience: 'company',
    },
    customerId: repairRequest.customerId || '',
    customerName,
    requesterId: repairRequest.requesterId || repairRequest.userId || '',
    requesterName,
    repairRequestStatus: repairRequest.status || '',
    repairRequestCreatedAt: createdDate,
    date: createdDate,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await writeCompanyWorkflowAlert({
    companyId,
    alertId,
    payload: alertPayload,
  });

  return alertId;
};

// =========================================================================
//   CORRECTED AUTOMATED FUNCTION: Create Stripe customer on new user signup
// =========================================================================
//I am going to move this somewhere else and keep it here for refrence
// exports.createNewUserInStripe = functions1.auth.user().onCreate(async (user) => {
//   try {
//     // 1. Create a customer in Stripe
//     const customer = await stripe.customers.create({
//       email: user.email,
//       name: user.displayName, 
//     });

//     const userDocRef = db.collection('users').doc(user.uid);
//     await userDocRef.set({
//       stripeId: customer.id, // CORRECTED FIELD NAME
//       email: user.email,
//       displayName: user.displayName || '',
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//     }, { merge: true }); 

//     console.log(`Successfully Created Stripe customer: ${customer.id}`);
//     //2. Create Connected Account. Check out createNewStripeAccount for refrence
//     const account = await stripe.accounts.create({
//       type: 'express', // or 'standard', 'custom'
//       country: 'US', // or the relevant country
//       email: user.email, // Collect email from your React app
//       capabilities: {
//         card_payments: { requested: true },
//         transfers: { requested: true },
//       },
//       // ... other account details as needed

//     });
//     console.log('account: ',account)

//     console.log('Successfully Created New Stripe Connected Account: ', account.id)
//     // 3. Save the Stripe customer ID to the user's document in Firestore
//     await userDocRef.set({
//       stripeConnectedAccountId: account.id,
//     }, { merge: true }); 

//     console.log(`Stripe customer ID ${customer.id} saved for user ${user.uid}`);


//     return { success: true };

//   } catch (error) {
//     console.error(`Error creating Stripe customer for user ${user.uid}:`, error);
//     return { success: false, error: error.message };
//   }
// });


//---------------- General Functions --------------------
//send Grid
const sendGridGeneral = require('./sendGrid/general');
exports.sendServiceAgreementEmail = sendGridGeneral.sendServiceAgreementEmail;
exports.getPublicServiceAgreement = sendGridGeneral.getPublicServiceAgreement;
exports.getPublicServiceAgreementInspectionReport = sendGridGeneral.getPublicServiceAgreementInspectionReport;
exports.getPublicSalesInvoice = sendGridGeneral.getPublicSalesInvoice;
exports.sendServiceReportOnFinish = sendGridGeneral.sendServiceReportOnFinish;
exports.sendJobEstimateEmail = sendGridGeneral.sendJobEstimateEmail;
exports.sendInvoiceEmail = sendGridGeneral.sendInvoiceEmail;
exports.sendSalesInvoiceEmail = sendGridGeneral.sendSalesInvoiceEmail;
exports.sendPaymentConfirmationEmail = sendGridGeneral.sendPaymentConfirmationEmail;
exports.sendAccountEmail = require('./accountEmails').sendAccountEmail;
exports.initializeCustomerEmailConfiguration = require('./customerEmailDefaults').initializeCustomerEmailConfiguration;

//-----------------General Callable----------------------------

const callableGeneral = require('./callableFunctions/general');
exports.createFirstRecurringServiceStop2 = callableGeneral.createFirstRecurringServiceStop2;

exports.createFirstRecurringServiceStop = callableGeneral.createFirstRecurringServiceStop; // Removed
exports.createCompanyAfterSignUp = callableGeneral.createCompanyAfterSignUp;
exports.updateCompanyHistory = callableGeneral.updateCompanyHistory;
exports.createCompanyAdminNotes = callableGeneral.createCompanyAdminNotes;
exports.updateCompanyAdminFlags = callableGeneral.updateCompanyAdminFlags;
exports.getAdminCompanyListStats = callableGeneral.getAdminCompanyListStats;
exports.getAdminUserListStats = callableGeneral.getAdminUserListStats;
exports.deleteUser = callableGeneral.deleteUser;
exports.acceptTechInvite = callableGeneral.acceptTechInvite;
exports.createCompanyUserInvite = callableGeneral.createCompanyUserInvite;
exports.manageCompanyUserInvite = callableGeneral.manageCompanyUserInvite;
exports.updateCompanyUserAccess = callableGeneral.updateCompanyUserAccess;
exports.getCompanyUserContactInfo = callableGeneral.getCompanyUserContactInfo;
exports.createCompanyAlertNotification = callableGeneral.createCompanyAlertNotification;
exports.populateBaseTechnicianRatesOnCompanyUserCreate = callableGeneral.populateBaseTechnicianRatesOnCompanyUserCreate;
exports.populateCustomerPipelineOnCustomerCreate = callableGeneral.populateCustomerPipelineOnCustomerCreate;
exports.populateCustomerPipelineOnLeadCreate = callableGeneral.populateCustomerPipelineOnLeadCreate;
exports.syncCustomerPipelineOnLeadUpdate = callableGeneral.syncCustomerPipelineOnLeadUpdate;
exports.migrateLegacyVendorsToCanonical = callableGeneral.migrateLegacyVendorsToCanonical;
exports.acceptLinkedInvite = callableGeneral.acceptLinkedInvite;
exports.createCustomerAccountInvite = callableGeneral.createCustomerAccountInvite;
exports.getCustomerAccountInvitePreview = callableGeneral.getCustomerAccountInvitePreview;
exports.listMyCustomerAccountInvites = require('./customerAccountInvites').listMyCustomerAccountInvites;
exports.indexCustomerPortalEmail = require('./customerPortalDiscovery').indexCustomerPortalEmail;
exports.convertHomeownerServiceRequestToCompanyCustomer = callableGeneral.convertHomeownerServiceRequestToCompanyCustomer;
exports.updateCompanyReadingsSettings = callableGeneral.updateCompanyReadingsSettings;
exports.updateServiceStopDayPermanently = callableGeneral.updateServiceStopDayPermanently;
exports.updateRecurringRouteOrderPermanently = callableGeneral.updateRecurringRouteOrderPermanently;
exports.updateRecurringServiceStopsRouteAssignment = callableGeneral.updateRecurringServiceStopsRouteAssignment;
exports.respondToCustomerPartApproval = callableGeneral.respondToCustomerPartApproval;
exports.createHomeOwnerCustomerBasedOnCompany = callableGeneral.createHomeOwnerCustomerBasedOnCompany;
exports.makeUpdatesToRecurringRoutes = callableGeneral.makeUpdatesToRecurringRoutes;

const testerStripProfiles = require('./testerStripProfiles');
exports.analyzeTesterStripScan = testerStripProfiles.analyzeTesterStripScan;
exports.seedAquaChekTesterStripProfile = testerStripProfiles.seedAquaChekTesterStripProfile;

exports.deleteRecurringServiceStop = callableGeneral.deleteRecurringServiceStop;
exports.deleteRecurringRoute = callableGeneral.deleteRecurringRoute;
exports.endRecurringServiceStop = callableGeneral.endRecurringServiceStop;
exports.updateRecurringServiceStop = callableGeneral.updateRecurringServiceStop;

const publicLeadIntake = require('./publicLeadIntake');
const publicRepairRequests = require('./publicRepairRequests');
exports.getPublicRepairRequestCompany = publicRepairRequests.getPublicRepairRequestCompany;
exports.getPublicRepairRequestOptions = publicRepairRequests.getPublicRepairRequestOptions;
exports.submitPublicRepairRequest = publicRepairRequests.submitPublicRepairRequest;
exports.getPublicLeadIntakeCompany = publicLeadIntake.getPublicLeadIntakeCompany;
exports.listPublicCompanies = publicLeadIntake.listPublicCompanies;
exports.submitPublicServiceRequestLead = publicLeadIntake.submitPublicServiceRequestLead;
exports.getPublicLeadVerificationPreview = publicLeadIntake.getPublicLeadVerificationPreview;
exports.claimPublicServiceRequestLead = publicLeadIntake.claimPublicServiceRequestLead;

const customerNameCascade = require('./customerNameCascade');
exports.syncCustomerNameReferencesOnCustomerUpdate = customerNameCascade.syncCustomerNameReferencesOnCustomerUpdate;
exports.syncCustomerNameReferencesForCustomer = customerNameCascade.syncCustomerNameReferencesForCustomer;


//-----------------Stripe Functions----------------------------

//Web Hooks
const stripeWebHooks = require('./stripe/stripeWebHooks');
exports.stripeWebHookExample = stripeWebHooks.stripeWebHookExample;
exports.stripeWebHook = stripeWebHooks.stripeWebHook;
//Main stripe functions

const stripeGeneral = require('./stripe/stripeCallableGeneral');
exports.createStripeCustomer = stripeGeneral.createStripeCustomer;
exports.createStripeAccountLink = stripeGeneral.createStripeAccountLink;
exports.createNewStripeAccount = stripeGeneral.createNewStripeAccount;
exports.createSubscriptionPaymentIntent = stripeGeneral.createSubscriptionPaymentIntent;
exports.getstripeSubscriptions = stripeGeneral.getstripeSubscriptions;
exports.createSubscriptionCheckoutSessionNewCustomer = stripeGeneral.createSubscriptionCheckoutSessionNewCustomer;

exports.createSubscriptionCheckoutSession = stripeGeneral.createSubscriptionCheckoutSession;
exports.createStripeSubscription = stripeGeneral.createStripeSubscription;
exports.updateStripeSubscription = stripeGeneral.updateStripeSubscription;
exports.cancelStripeSubscription = stripeGeneral.cancelStripeSubscription;
exports.getStripeSubscriptionInformation = stripeGeneral.getStripeSubscriptionInformation;
exports.getSubscriptionUpdatePreview = stripeGeneral.getSubscriptionUpdatePreview;

exports.getStripePaymentHistory = stripeGeneral.getStripePaymentHistory;
exports.createStripePortalSession = stripeGeneral.createStripePortalSession;
exports.getUpcomingInvoice = stripeGeneral.getUpcomingInvoice;




const connectedAcctFunc = require('./stripe/stripeCallableForConnectedAccounts');
exports.verifyConnectedAccountBillingReadiness = connectedAcctFunc.verifyConnectedAccountBillingReadiness;
exports.acceptSalesServiceAgreement = connectedAcctFunc.acceptSalesServiceAgreement;
exports.applyJobPlanWorkspace = connectedAcctFunc.applyJobPlanWorkspace;
exports.acceptPublicSalesServiceAgreement = connectedAcctFunc.acceptPublicSalesServiceAgreement;
exports.rejectSalesServiceAgreement = connectedAcctFunc.rejectSalesServiceAgreement;
exports.rejectPublicSalesServiceAgreement = connectedAcctFunc.rejectPublicSalesServiceAgreement;
exports.deleteSalesAgreement = connectedAcctFunc.deleteSalesAgreement;
exports.createSalesBillingSubscriptionCheckoutSession = connectedAcctFunc.createSalesBillingSubscriptionCheckoutSession;
exports.syncSalesBillingSubscriptionFromStripe = connectedAcctFunc.syncSalesBillingSubscriptionFromStripe;
exports.cancelSalesBillingSubscription = connectedAcctFunc.cancelSalesBillingSubscription;
exports.resumeSalesBillingSubscription = connectedAcctFunc.resumeSalesBillingSubscription;
exports.updateSalesBillingSubscriptionStripeItems = connectedAcctFunc.updateSalesBillingSubscriptionStripeItems;
exports.createStripeObjectForSalesCatalogItem = connectedAcctFunc.createStripeObjectForSalesCatalogItem;
exports.getProductList = connectedAcctFunc.getProductList;
exports.createNewProduct = connectedAcctFunc.createNewProduct;
exports.createNewPrice = connectedAcctFunc.createNewPrice;
exports.getPriceList = connectedAcctFunc.getPriceList;
exports.getDefaultPrice = connectedAcctFunc.getDefaultPrice;
exports.acceptContract = connectedAcctFunc.acceptContract;
exports.acceptContract2 = connectedAcctFunc.acceptContract2;
exports.getSubcriptionList = connectedAcctFunc.getSubcriptionList;
exports.setUpConnectedAccountCustomer = connectedAcctFunc.setUpConnectedAccountCustomer;


//---------------- Time Based Functions --------------------
//send Grid
const timeBasedGeneral = require('./timeBased/general');
exports.weeklySundayRSSCreate = timeBasedGeneral.weeklySundayRSSCreate;
exports.processRecurringServiceStopTask = timeBasedGeneral.processRecurringServiceStopTask;
exports.catchUpRecurringServiceStops = timeBasedGeneral.catchUpRecurringServiceStops;
exports.dailySalesManualInvoiceCreate = timeBasedGeneral.dailySalesManualInvoiceCreate;
exports.onRssCreated = timeBasedGeneral.onRssCreated;
exports.onRssUpdated = timeBasedGeneral.onRssUpdated;
exports.onRssDeleted = timeBasedGeneral.onRssDeleted;

const serviceStopDurationAverages = require('./serviceStopDurationAverages');
exports.onServiceStopDurationCompleted = serviceStopDurationAverages.onServiceStopDurationCompleted;
exports.onServiceStopDurationDeleted = serviceStopDurationAverages.onServiceStopDurationDeleted;
exports.deleteRecurringServiceStopDurationPoint = serviceStopDurationAverages.deleteRecurringServiceStopDurationPoint;
exports.clearRecurringServiceStopDurationHistory = serviceStopDurationAverages.clearRecurringServiceStopDurationHistory;
exports.recalculateRecurringServiceStopDurationEstimate = serviceStopDurationAverages.recalculateRecurringServiceStopDurationEstimate;
exports.setRecurringServiceStopEstimatedDuration = serviceStopDurationAverages.setRecurringServiceStopEstimatedDuration;

const serviceStopCompletion = require('./serviceStopCompletion');
exports.processServiceStopCompletionWork = serviceStopCompletion.processServiceStopCompletionWork;
exports.reconcileServiceStopPayroll = serviceStopCompletion.reconcileServiceStopPayroll;
exports.reconcileServiceStopTaskPayroll = serviceStopCompletion.reconcileServiceStopTaskPayroll;
exports.reconcileJobTaskPayroll = serviceStopCompletion.reconcileJobTaskPayroll;
exports.reconcileTechnicianRatePayroll = serviceStopCompletion.reconcileTechnicianRatePayroll;
exports.reconcileCompanyPaySettings = serviceStopCompletion.reconcileCompanyPaySettings;
exports.reconcileCompanyPayrollSwitch = serviceStopCompletion.reconcileCompanyPayrollSwitch;
exports.reconcileCompanyPayType = serviceStopCompletion.reconcileCompanyPayType;
exports.processPayrollReconcileWork = serviceStopCompletion.processPayrollReconcileWork;
exports.refreshServiceStopPayroll = serviceStopCompletion.refreshServiceStopPayroll;
exports.clearZeroDollarPayrollTasks = serviceStopCompletion.clearZeroDollarPayrollTasks;
exports.approvePayrollDateRange = serviceStopCompletion.approvePayrollDateRange;
exports.previewPayrollStatements = serviceStopCompletion.previewPayrollStatements;
exports.createPayrollStatement = serviceStopCompletion.createPayrollStatement;




//------------------Create and Update Connected Account------------------
// ------------------On Document Create Contract------------------
exports.onContractCreate = functions1.firestore
  .document("/contracts/{documentId}")
  .onCreate(async (snap, context) => {

    const clientId = snap.data().clientId;
    const companyName = snap.data().companyName;

    console.log('ClientId : ' + clientId)

    if (clientId != '') {

      console.log('Has Client Id')
      const alertId = 'user_aler_' + uuidv4();
      console.log(alertId)
      // Perform asynchronous operations
      try {
        await db.collection('users').doc(clientId).collection('alerts').doc(alertId).set({
          id: alertId,
          route: 'Routes',
          hasItem: false,
          itemId: '',
          title: 'New Contract',
          description: 'New Contract Offered by ' + companyName,
          // date:admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('Successsfully Uploaded Alert')
      } catch (error) {
        console.error('Error:', error);
        // Handle errors appropriately
      }

    } else {
      console.log('Does not have Client Id')
    }
  });

exports.updatedContract = functions1.firestore
  .document("/contracts/{documentId}")
  .onUpdate(async (change, context) => {

    // ...the new value after this update
    const newValue = change.after.data() || {};

    // ...the previous value before this update
    const previousValue = change.before.data() || {};

    // access a particular field as you would any JS property

    //The value after an update operation
    const newStatus = newValue.status;

    // the value before an update operation
    const oldStatus = previousValue.status;

    console.log('Old Status ' + oldStatus)
    console.log('New Status ' + newStatus)

    if (newStatus !== oldStatus) {
      if (newStatus === 'Accepted') {
        // Sends Alert to Company
        try {
          const alertId = 'comp_aler_' + uuidv4();

          await db.collection('companies').doc(previousValue.companyId).collection('alerts').doc(alertId).set({
            id: alertId,
            route: 'Routes',
            hasItem: false,
            itemId: 'ItemId',
            name: 'Contracted Accepted By ' + previousValue.customerName,
            description: 'Contracted Accepted By ' + previousValue.customerName,
            // date:admin.firestore.FieldValue.serverTimestamp()
          });
          console.log('Successsfully Uploaded Alert')
        } catch (error) {
          console.error('Error:', error);
          // Handle errors appropriately
        }
      } else if (newStatus === 'Rejected') {
        // Sends Alert to Company
        try {
          const alertId = 'comp_aler_' + uuidv4();

          await db.collection('companies').doc(previousValue.companyId).collection('alerts').doc(alertId).set({
            id: alertId,
            route: 'Routes',
            hasItem: false,
            itemId: 'ItemId',
            name: 'Contracted Rejected By ' + previousValue.customerName,
            description: 'Contracted Rejected By ' + previousValue.customerName,
            // date:admin.firestore.FieldValue.serverTimestamp()
          });
          console.log('Successsfully Uploaded Alert')
        } catch (error) {
          console.error('Error:', error);
          // Handle errors appropriately
        }
      }
    } else {
      console.log('No Change To Status')
    }
  });

exports.onSalesAgreementWorkflowNotifications = functions1.runWith({ failurePolicy: true }).firestore
  .document("/salesAgreements/{agreementId}")
  .onUpdate(onAgreementWritten);

exports.onCompanyRepairRequestCreatedNotification = functions1.firestore
  .document("/companies/{companyId}/repairRequests/{repairRequestId}")
  .onCreate(async (snap, context) => {
    const { companyId, repairRequestId } = context.params;
    const repairRequest = snap.data() || {};

    await createCompanyRepairRequestCreatedAlert({
      companyId,
      repairRequestId,
      repairRequest,
    });

    return null;
  });
const technicianWork = require('./technicianWork');
exports.manageRouteWork = technicianWork.manageRouteWork;
exports.manageTechnicianWork = technicianWork.manageTechnicianWork;
exports.scheduleTechnicianWork = technicianWork.scheduleTechnicianWork;
exports.manageTechnicianPayRequest = technicianWork.manageTechnicianPayRequest;
exports.manageTechnicianClock = technicianWork.manageTechnicianClock;
exports.reconcileShiftTime = technicianWork.reconcileShiftTime;
exports.reconcileWorkLogTime = technicianWork.reconcileWorkLogTime;
exports.reconcileRouteTime = technicianWork.reconcileRouteTime;
exports.reconcileRouteLogTime = technicianWork.reconcileRouteLogTime;
exports.finalizeTechnicianJob = technicianWork.finalizeTechnicianJob;
exports.reconcileJobEquipmentCompletion = technicianWork.reconcileJobEquipmentCompletion;
exports.reconcileJobTaskEquipmentCompletion = technicianWork.reconcileJobTaskEquipmentCompletion;
exports.reconcileStopTaskEquipmentCompletion = technicianWork.reconcileStopTaskEquipmentCompletion;
exports.manageTechnicianRates = technicianWork.manageTechnicianRates;
exports.syncWorkOfferStopProgress = technicianWork.syncWorkOfferStopProgress;
exports.syncWorkOfferTaskProgress = technicianWork.syncWorkOfferTaskProgress;
exports.syncWorkOfferProductProgress = technicianWork.syncWorkOfferProductProgress;

exports.syncWorkOfferStopTaskProgress = technicianWork.syncWorkOfferStopTaskProgress;
exports.reconcileWorkOfferPayroll = technicianWork.reconcileWorkOfferPayroll;
exports.reconcileWorkOfferIncentive = technicianWork.reconcileWorkOfferIncentive;

// Customer portal commands validate the homeowner and company relationship server-side.
exports.submitHomeownerRepairRequest = require('./homeownerRequests').submitHomeownerRepairRequest;
const homeownerPublishing = require('./homeownerServicePublishing');
exports.publishHomeownerServiceStop = homeownerPublishing.publishHomeownerServiceStop;
exports.publishHomeownerStopReadings = homeownerPublishing.publishHomeownerStopReadings;
exports.publishHomeownerStopTask = homeownerPublishing.publishHomeownerStopTask;
exports.publishHomeownerRelationship = homeownerPublishing.publishHomeownerRelationship;
const customerPortalBilling = require('./customerPortalBilling');
exports.createCustomerInvoiceCheckout = customerPortalBilling.createCustomerInvoiceCheckout;
exports.createCustomerBillingPortal = customerPortalBilling.createCustomerBillingPortal;
exports.manageSalesInvoice = require('./salesInvoiceCommands').manageSalesInvoice;
exports.manageStripeInvoice = require('./stripeInvoiceCommands').manageStripeInvoice;
exports.manageSalesPayment = require('./salesPaymentCommands').manageSalesPayment;
const savedCustomerPayments = require('./savedCustomerPayments');
exports.createSavedPaymentSetup = savedCustomerPayments.createSavedPaymentSetup;
exports.listSavedPaymentMethods = savedCustomerPayments.listSavedPaymentMethods;
exports.chargeSavedInvoice = savedCustomerPayments.chargeSavedInvoice;
exports.sendSalesPaymentReceipt = require('./salesPaymentReceipts').sendSalesPaymentReceipt;
exports.queueSalesPaymentReceipt = require('./salesPaymentReceipts').queueSalesPaymentReceipt;
exports.deliverSalesPaymentReceipt = require('./salesPaymentReceipts').deliverSalesPaymentReceipt;
exports.reviewSalesReceiptDeliveries = require('./salesPaymentReceipts').reviewSalesReceiptDeliveries;

exports.createManualSalesSubscriptionInvoice = require('./manualRecurringBilling').createManualSalesSubscriptionInvoice;
exports.refreshCompanyPayoutReconciliation = require('./payoutReconciliation').refreshCompanyPayoutReconciliation;
exports.getBillingReconciliationReport = require('./billingReconciliation').getBillingReconciliationReport;
exports.confirmStripePayoutDeposit = require('./billingReconciliation').confirmStripePayoutDeposit;
exports.configureCollectionReminders = require('./collectionReminders').configureCollectionReminders;
exports.queueCollectionReminders = require('./collectionReminders').queueCollectionReminders;
exports.deliverCollectionReminder = require('./collectionReminders').deliverCollectionReminder;
exports.createJobSalesInvoice = require('./jobBilling').createJobSalesInvoice;

exports.ensureOwnTechnicianRoute = require("./technicianWork").ensureOwnTechnicianRoute;

// Personal, read-only paysheet; identity comes from Firebase Auth.
exports.getTechnicianPaysheet = onCall({ timeoutSeconds: 120 }, require("./technicianPaysheet").createTechnicianPaysheet(admin.firestore()));

// Approved-part invoices follow customer timing across web and native fulfillment.
const partApprovalBilling = require('./partApprovalBilling');
exports.ensurePartApprovalInvoice = partApprovalBilling.ensurePartApprovalInvoice;
exports.reconcilePartApprovalInvoice = partApprovalBilling.reconcilePartApprovalInvoice;
exports.reconcileShoppingItemInvoice = partApprovalBilling.reconcileShoppingItemInvoice;
exports.processPartInvoiceEmail = partApprovalBilling.processPartInvoiceEmail;
exports.syncPartInvoiceLinks = partApprovalBilling.syncPartInvoiceLinks;

exports.getPartApprovalRecurringOptions = callableGeneral.getPartApprovalRecurringOptions;
exports.syncRecurringPartInvoice = require('./recurringPartCharges').syncRecurringPartInvoice;

exports.reviewStoppedPartBillingPlan = require('./recurringPartCharges').reviewStoppedPartBillingPlan;

// New pool service signup, invoice approval, and first-service readiness.
const serviceOnboarding = require('./serviceOnboarding');
exports.manageServiceOnboarding = serviceOnboarding.manageServiceOnboarding;
exports.onServiceOnboardingAgreementWritten = serviceOnboarding.onServiceOnboardingAgreementWritten;
exports.onServiceOnboardingSubscriptionWritten = serviceOnboarding.onServiceOnboardingSubscriptionWritten;
exports.onServiceOnboardingRouteWritten = serviceOnboarding.onServiceOnboardingRouteWritten;
exports.onServiceOnboardingStopWritten = serviceOnboarding.onServiceOnboardingStopWritten;
exports.createServiceOnboardingCheckout = require('./savedCustomerPayments').createServiceOnboardingCheckout;
exports.linkLeadToExistingCustomer = serviceOnboarding.linkLeadToExistingCustomer;
