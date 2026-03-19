require('dotenv').config({ path: `.env.${process.env.GCLOUD_PROJECT}` });
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');

// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();
const db = admin.firestore(); 

// Securely access the Stripe API key from the environment variables.
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

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
exports.sendServiceReportOnFinish = sendGridGeneral.sendServiceReportOnFinish;
exports.sendJobEstimateEmail = sendGridGeneral.sendJobEstimateEmail;
exports.sendInvoiceEmail = sendGridGeneral.sendInvoiceEmail;
exports.sendPaymentConfirmationEmail = sendGridGeneral.sendPaymentConfirmationEmail;

//-----------------General Callable----------------------------

const callableGeneral = require('./callableFunctions/general');
exports.createFirstRecurringServiceStop2 = callableGeneral.createFirstRecurringServiceStop2;

exports.createFirstRecurringServiceStop = callableGeneral.createFirstRecurringServiceStop;
exports.createCompanyAfterSignUp = callableGeneral.createCompanyAfterSignUp;
exports.updateCompanyHistory = callableGeneral.updateCompanyHistory;
exports.createCompanyAdminNotes = callableGeneral.createCompanyAdminNotes;
exports.deleteUser = callableGeneral.deleteUser;
exports.acceptTechInvite = callableGeneral.acceptTechInvite;
exports.acceptLinkedInvite = callableGeneral.acceptLinkedInvite;
exports.updateCompanyReadingsSettings = callableGeneral.updateCompanyReadingsSettings;
exports.updateServiceStopDayPermanently = callableGeneral.updateServiceStopDayPermanently;
exports.updateRecurringRouteOrderPermanently = callableGeneral.updateRecurringRouteOrderPermanently;
exports.createHomeOwnerCustomerBasedOnCompany = callableGeneral.createHomeOwnerCustomerBasedOnCompany;
exports.makeUpdatesToRecurringRoutes = callableGeneral.makeUpdatesToRecurringRoutes;

exports.deleteRecurringServiceStop = callableGeneral.deleteRecurringServiceStop;
exports.endRecurringServiceStop = callableGeneral.endRecurringServiceStop;


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
exports.getProductList = connectedAcctFunc.getProductList;
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
exports.onRssCreated = timeBasedGeneral.onRssCreated;
exports.onRssUpdated = timeBasedGeneral.onRssUpdated;
exports.onRssDeleted = timeBasedGeneral.onRssDeleted;




//------------------Create and Update Connected Account------------------
// ------------------On Document Create Contract------------------
exports.onContractCreate = functions1.firestore
  .document("/contracts/{documentId}")
  .onCreate(async (snap, context) => {

    const clientId = snap.data().clientId;
    const companyName = snap.data().companyName;

    console.log('ClientId : ' + clientId)
    
    if (clientId != ''){

      console.log('Has Client Id')
      const alertId = 'user_aler_' + uuidv4();
      console.log(alertId)
          // Perform asynchronous operations
      try {
        await db.collection('users').doc(clientId).collection('alerts').doc(alertId).set({
          id:alertId,
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
.onUpdate(async(change, context) => {

  // ...the new value after this update
  const newValue = change.after.data()||{};

  // ...the previous value before this update
  const previousValue = change.before.data()||{};

  // access a particular field as you would any JS property

  //The value after an update operation
  const newStatus = newValue.status;

  // the value before an update operation
  const oldStatus = previousValue.status;

console.log('Old Status ' + oldStatus)
console.log('New Status ' + newStatus)

  if(newStatus!==oldStatus){
   if (newStatus === 'Accepted'){
    // Sends Alert to Company
    try {
      const alertId = 'comp_aler_' + uuidv4();

      await db.collection('companies').doc(previousValue.companyId).collection('alerts').doc(alertId).set({
        id:alertId,
        route: 'Routes',
        hasItem: false,
        itemId: 'ItemId',
        name: 'Contracted Accepted By ' + previousValue.customerName,
        description:'Contracted Accepted By ' + previousValue.customerName,
        // date:admin.firestore.FieldValue.serverTimestamp()
      });
      console.log('Successsfully Uploaded Alert')
    } catch (error) {
      console.error('Error:', error);
      // Handle errors appropriately
    }
   } else if (newStatus === 'Rejected'){
    // Sends Alert to Company
    try {
      const alertId = 'comp_aler_' + uuidv4();

      await db.collection('companies').doc(previousValue.companyId).collection('alerts').doc(alertId).set({
        id:alertId,
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
  }else{
    console.log('No Change To Status')
  }
});