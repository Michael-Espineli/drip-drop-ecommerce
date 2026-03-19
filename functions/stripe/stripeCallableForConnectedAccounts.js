
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { defineSecret } = require('firebase-functions/params');
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");

const db = admin.firestore(); 

// CORRECTED: Use the Stripe API key from the environment variables loaded in index.js
const stripe = require("stripe")(process.env.STRIPE_API_KEY);



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
  exports.setUpConnectedAccountCustomer = functions.https.onCall(async(data,context) => {
    const receivedData = data.data
    console.log('-------------- receivedData -------------------')
  
    console.log(receivedData)
    try {
      const customer = await stripe.customers.create({
        name: receivedData.name,
        email: receivedData.email,
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
