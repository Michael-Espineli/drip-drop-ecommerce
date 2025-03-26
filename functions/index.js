
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');

// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");
admin.initializeApp();
const db = admin.firestore(); 

const stripe = require("stripe")(
  // This is your test secret API key.
  'sk_test_51P39vqAUNYvyj1aErKQhqLs42NbZ6ULG34noYN0EP8knF8TcS9DlFVkMvV6p1KFYuSaInhxU16MWWnJEHIkrioFd00KbIw3ogl',
  {
    apiVersion: "2023-10-16",
  }
);


//----------------Tester Functions --------------------




//-----------------Callable----------------------------
exports.createFirstRecurringServiceStop = functions.https.onCall( async(data, context) => {
  console.log('create FirstRecurring ServiceStop')
  console.log(data)

  let rssData = data.data.recurringServiceStop
  let companyId = data.data.companyId
  console.log(rssData)  
  try {

      console.log("Creating More Service Stops For Rss", rssData.id);
      // const counter = 0;
      // const monthCounter = 0;
      let numFrequency = 0;
      // const lastCreated = new Date();
      const standardFrequency = rssData.frequency;
      // const customFrequencyType = rssData.customFrequencyType;
      // let custom = false;
      // let skipWeekEnds = false;

      //Create RSS
      
    let counterPush = 0;
    const InCol = "companies/"+companyId+"/settings";
    const RSSCol = "companies/"+companyId+"/recurringServiceStop";
    const rssDocRef = "companies/"+companyId+"/serviceStops";
    const docRef = "companies/"+companyId+"/serviceStops";
    await getFirestore()
      .collection(rssDocRef).doc(rssData.id)
      .set(rssData);

    switch (standardFrequency) {
      // Daily
      case "Daily":
        const dateDaily = rssData.lastCreated.toDate();
        // const date = new Date();
        // parseInt(rssData.customFrequency);
        // date = date + (cusFreq*60);
        const yearDaily = dateDaily.getFullYear();
        const monthDaily = dateDaily.getMonth();
        const dayDaily = dateDaily.getDate();
        // const pushDate = new Date(year, month, day);
        dateDaily.setFullYear(yearDaily, monthDaily, dayDaily + 7);
        const newSSIdDaily = "S" + String(counterPush + 1);
        console.log("New SS ID =>", newSSIdDaily);
        counterPush = counterPush + 1;
        // Set the 'capital' field of the city

        await getFirestore()
            .collection(docRef).doc(newSSIdDaily)
            .set({
              address: {
                city: rssData.address.city,
                state: rssData.address.state,
                streetAddress: rssData.address.streetAddress,
                zip: rssData.address.zip,
                latitude: rssData.address.latitude,
                longitude:rssData.address.longitude,
              },
              customerId: rssData.customerId,
              customerName: rssData.customerName,
              description: rssData.description,
              duration: Int(rssData.estimatedTime),
              dateCreated: curDate,
              serviceDate: date,
                operationStatus: "Not Started",
                billingStatus: "Not Invoiced",
              rate: 0,
              recurringServiceStopId: rssData.id,
              tech: rssData.tech,
              serviceLocationId: rssData.serviceLocationId,
              techId: rssData.techId,
              type: rssData.type,
              typeId: rssData.typeId,
              typeImage: rssData.typeImage,
              jobId: "",
              jobName:"Cleaning - Update",
              id: newSSIdDaily,
              checkList: [],
              includeReadings:true,
              includeDosages:true,
                contractedCompanyId:rssData.contractedCompanyId,
                laborContractId:rssData.laborContractId,
                otherCompany:rssData.otherCompany,
            });

        break;
      case "WeekDay":
        numFrequency = 7;
        // monthly
        break;
      case "Weekly":
        console.log("Updating Weekly")
        const date = rssData.lastCreated.toDate();
        const serviceDate = rssData.lastCreated.toDate();
        const cityRefDaily = getFirestore().collection(RSSCol).doc(RssDoc.id);

        await cityRefDaily.update({lastCreated: date});

        const rssRef = getFirestore().collection(RSSCol).doc(RssDoc.id);
        // Set the 'capital' field of the city

        // const date = new Date();
        // parseInt(rssData.customFrequency);
        // date = date + (cusFreq*60);
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();
        // const pushDate = new Date(year, month, day);
        serviceDate.setFullYear(year, month, day + 7);
        const newSSId = "S" + String(counterPush + 1);
        console.log("Uploading New Service Stop =>", newSSId);
        counterPush = counterPush + 1;
        await rssRef.update({lastCreated: serviceDate});
        console.log("Last Updated RSS", RssDoc.id, "To Date", serviceDate);
        await getFirestore()
            .collection(docRef).doc(newSSId)
            .set({
                address: {
                  city: rssData.address.city,
                  state: rssData.address.state,
                  streetAddress: rssData.address.streetAddress,
                  zip: rssData.address.zip,
                  latitude: rssData.address.latitude,
                  longitude:rssData.address.longitude,
                },
                customerId: rssData.customerId,
                customerName: rssData.customerName,
                description: rssData.description,
                //duration: Int(rssData.estimatedTime),
                duration: 15,
                dateCreated: curDate,
                serviceDate: serviceDate,
                operationStatus: "Not Started",
                billingStatus: "Not Invoiced",
                rate: 0,
                recurringServiceStopId: rssData.id,
                tech: rssData.tech,
                serviceLocationId: rssData.serviceLocationId,
                techId: rssData.techId,
                type:rssData.type,
                  typeId: rssData.typeId,
                typeImage: rssData.typeImage,
                jobId: "",
                jobName:"Cleaning - Update",
                id: newSSId,
                checkList: [],
                includeReadings:true,
                includeDosages:true,
                contractedCompanyId:rssData.contractedCompanyId,
                laborContractId:rssData.laborContractId,
                otherCompany:rssData.otherCompany,

              });

        break;
      case "Monthly":
        numFrequency = 30;
        // everyweekday
        break;
      case "Yearly":
        numFrequency = 1;
        // skipWeekEnds = true;
        // Custom
        break;
      // case 5:
        // custom = true;
        // switch (customFrequencyType){
        //   case "Day":
        //     print("Day")
        //   case "Week":
        //     print("Day")
        //   case "Month":
        //     print("Day")
        //   case "Year":
        //     print("Year")
        //   default:
        //     print("Year")
        //   }
        // break;
      default:
        numFrequency = 100;
    }
    await getFirestore()
    .collection(InCol)
    .doc("serviceStops")
    .set({
      increment: counterPush,
      category: "serviceStops",
    });
    console.log("New Service Stop Count", counterPush);
    

    console.log('Successfully Created')
    return {
      status: 200,
      account: "Account Id"
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Stripe API to create an account",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

//-----------------CRUD Products-----------------------
exports.createNewProduct = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  try {
    const product = await stripe.products.create({
      name: receivedData.name,
      description: receivedData.description,
      active: receivedData.active
    },
    {
      stripeAccount: receivedData.connectedAccount,
    });
    return {
      product:product

    }
  } catch(error) {
    console.error(error)
  }
});

exports.getProductList = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  try {
    const products = await stripe.products.list({
      stripeAccount: receivedData.connectedAccount,
      active: receivedData.active,
    });
    return {
      productList:products
    }
  } catch(error) {
    console.error(error)
  }
});

//------------------CRUD Price------------------
exports.createNewPrice = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  try {
    const product = await stripe.price.create({
      name: receivedData.name,
      description: receivedData.description,
      active: receivedData.active
    },
    {
      stripeAccount: receivedData.connectedAccount,
    });
    return {
      product:product

    }
  } catch(error) {
    console.error(error)
  }
});

exports.getPriceList = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  console.log('-------------- receivedData -------------------')

  console.log(receivedData)
  try {
    const prices = await stripe.prices.list({
      product : receivedData.productId,
      active : receivedData.active
    },
    {
      stripeAccount: receivedData.connectedAccount,
    }
    );
    console.log('-------------- Prices -------------------')
    console.log(prices)
    return {
      priceList:prices
    }
  } catch(error) {

    console.error(error)
  }
});
exports.getDefaultPrice = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  console.log('-------------- receivedData -------------------')
  //priceId:String
  //connectedAccount:String
  console.log(receivedData)
  try {
    const price = await stripe.prices.retrieve(
      receivedData.priceId
      ,
      {
        stripeAccount: receivedData.connectedAccount,
      }
    );

    console.log('-------------- Prices -------------------')
    console.log(price)
    return {
      price:price
    }
  } catch(error) {

    console.error(error)
  }
});
//------------------CRUD Contract------------------

exports.acceptContract = functions.https.onCall(async(data,context) => {
  const receivedData = data.data

  console.log('-------------- Received Data -------------------')

  console.log(receivedData)

  try {

    const subscription = await stripe.subscriptions.create(
      {
        customer: receivedData.customerId,
        items: [
          {
            price: receivedData.priceId,
          },
        ],
        expand: ['latest_invoice.payment_intent'],
      },
      {
        stripeAccount: receivedData.connectedAccount,
      }
    );

    console.log('-------------- subscription -------------------')
    console.log(subscription)
    return {
      subscription:subscription
    }
  } catch(error) {

    console.error(error)
  }
});
exports.acceptContract2 = functions.https.onCall(async(data,context) => {
  const receivedData = data.data

  console.log('-------------- Received Data -------------------')

  console.log(receivedData)

  try {

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer:receivedData.customerId,
      line_items: [
        {
          price: receivedData.priceId,
          // For metered billing, do not pass quantity
          quantity: 1,
        },
      ],
      // {CHECKOUT_SESSION_ID} is a string literal; do not change it!
      // the actual Session ID is returned in the query parameter when your customer
      // is redirected to the success page.
      success_url: 'http://localhost:3000/success/sessionId/{CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:3000/canceled',
    },
    {
      stripeAccount: receivedData.connectedAccount,
    });

    console.log('-------------- subscription -------------------')
    console.log(session)
    return {
      session:session
    }
  } catch(error) {

    console.error(error)
  }
});
exports.getSubcriptionList = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  console.log('-------------- receivedData -------------------')

  console.log(receivedData)
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: receivedData.customerId,
    },
    {
      stripeAccount: receivedData.connectedAccount,
    });
    
    console.log('-------------- subscriptions -------------------')
    console.log(subscriptions)
    return {
      subscriptions:subscriptions
    }
  } catch(error) {

    console.error(error)
  }
}); 
//------------------CRUD Customer------------------
exports.setUpCustomer = functions.https.onCall(async(data,context) => {
  const receivedData = data.data
  console.log('-------------- receivedData -------------------')

  console.log(receivedData)
  try {
    const customer = await stripe.customers.create({
      name: 'Jenny Rosen',
      email: 'jennyrosen@example.com',
    },
     {
      stripeAccount: receivedData.connectedAccount,
    }
  );
 
    console.log('-------------- Prices -------------------')
    console.log(customer)
    return {
      customer:customer
    }
  } catch(error) {

    console.error(error)
  }
});
//------------------Create and Update Connected Account------------------
exports.createStripeAccountLink = functions.https.onCall(async(data,context) => {
  console.log(data)

  try {

    const account = data.data.account;
    console.log(account)

    const accountLink = await stripe.accountLinks.create({
      account: account,
      // return_url: `${data.data.headers.origin}/return/${account}`,
      // refresh_url: `${data.data.headers.origin}/refresh/${account}`,
      return_url: `http://localhost:3000/return/${account}`,
      refresh_url: `http://localhost:3000/refresh/${account}`,
      type: "account_onboarding",
    });
    console.log('-------------- Success ------------')
    return {
      status: 200,
      accountLink: accountLink
    };
  } catch (error) {
    console.log('-------------- ERROR ------------')
    console.error(
      "An error occurred when calling the Stripe API to create an account link:",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

exports.createNewStripeAccount = functions.https.onCall(async(data,context) => {
  console.log(data)
  try {
    const account = await stripe.accounts.create({
      controller: {
        stripe_dashboard: {
          type: "none",
        },
      },
      capabilities: {
        card_payments: {requested: true},
        transfers: {requested: true}
      },
      country: "US",
    });
    console.log('Successfully Created')
    return {
      status: 200,
      account: account.id
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Stripe API to create an account",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

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