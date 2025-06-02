
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
const sgMail = require("@sendgrid/mail");
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


//---------------- General Functions --------------------

//----------Send Grid Functions
exports.sendServiceReportOnFinish = functions.https.onCall( async(data, context) => {

  console.log('Send Service Report On Finish')
  let email = "michaelespineli2000@gmail.com"

  try {
    let companyName = ""
    let companyId = data.data.companyId
    let mainCompanyId = data.data.companyId
    let serviceStopId = data.data.serviceStopId
    console.log(companyId)
    console.log(serviceStopId) 
    
    //Get Service Stop
    const ssRef = db.collection("companies").doc(mainCompanyId).collection("serviceStops").doc(serviceStopId)
    ssRef.get().then((ssdoc) => {
      if (ssdoc.exists) {
          console.log("Service Stop data:", ssdoc.data());
          let serviceStopData = ssdoc.data()
          if (serviceStopData.otherCompany) {
            companyId = serviceStopData.contractedCompanyId
          }

          //Get Company
          const companyRef = db.collection("companies").doc(companyId)
          companyRef.get().then((companyDoc) => {
            if (companyDoc.exists) {
              console.log("Company data:", companyDoc.data());
              let companyData = companyDoc.data()
              companyName = companyData.name

              //Get Stop Data
              sgMail.setApiKey("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")
              const msg = {
                  to: email,
                  from: 'mespineli@dripdrop-poolapp.com ',
                  cc:"michaelespineli@murdockpoolservice.com", //Maybe Company Email
                  templateId: 'd-a987a065df0e43378dafd14c1b7ee419',
                  dynamicTemplateData:{
                    subject: companyName + " Weekly Service Report",
                    preHeader: "Pre-header",
                    customer : serviceStopData.customerName,
                    customerId : serviceStopData.customerId,
                    technician : serviceStopData.tech,
                    technicianId : serviceStopData.techId,
                    stopData:
                    {
                        name:"$ 79.95",
                        bodyOfWaterId:"ibugfosd-345jbfdg-dfghjbd-iwndfgoi",
                        customerId:"ibugfosd-345jbfdg-dfghjbd-iwndfgoi",
                        dosages:[
                        {
                            UOM:"UOM",
                            amount:"2",
                            bodyOfWaterId:"UOM",
                            rate:"UOM",
                            id:"2",
                            name:"Liquid Chlorine",
                            templateId:"UOM"
                        },
                        {
                            UOM:"tab",
                            amount:"3",
                            bodyOfWaterId:"UOM",
                            rate:"UOM",
                            id:"1",
                            name:"Tabs",
                            "templateId":"UOM"
                        }
                        ],
                        id:"ibugfosd-345jbfdg-dfghjbd-iwndfgoi",
                        readings:[
                        {
                            UOM:"UOM",
                            amount:"350",
                            bodyOfWaterId:"UOM",
                            dosageType:"UOM",
                            id:"UOM",
                            name:"TDS",
                            templateId:"UOM"
                        },
                        {
                            UOM:"UOM",
                            amount:"5",
                            bodyOfWaterId:"UOM",
                            dosageType:"UOM",
                            id:"UOM",
                            name:"Total Chlorine",
                            templateId:"UOM"
                        },
                        {
                            UOM:"UOM",
                            amount:"5",
                            bodyOfWaterId:"UOM",
                            dosageType:"UOM",
                            id:"UOM",
                            name:"Free Chlorine",
                            templateId:"UOM"
                        },
                        {
                            UOM:"UOM",
                            amount:"7.6",
                            bodyOfWaterId:"UOM",
                            dosageType:"UOM",
                            id:"UOM",
                            name:"pH",
                            templateId:"UOM"
                        },
                        {
                            UOM:"UOM",
                            amount:"80",
                            bodyOfWaterId:"UOM",
                            dosageType:"UOM",
                            id:"UOM",
                            name:"Alkalinity",
                            templateId:"UOM"
                        },
                        {
                            UOM:"UOM",
                            amount:"50",
                            bodyOfWaterId:"UOM",
                            dosageType:"UOM",
                            id:"UOM",
                            name:"Cyanuric Acid",
                            templateId:"UOM"
                        }
                        ],
                        serviceLocationId:"ibugfosd-345jbfdg-dfghjbd-iwndfgoi",
                        serviceStopId:"S2704",
                        userId:"ibugfosd-345jbfdg-dfghjbd-iwndfgoi"
                    },
                    companyName:companyName,
                    address01 : serviceStopData.address.streetAddress,
                    city : serviceStopData.address.city,
                    state : serviceStopData.address.state,
                    zip : serviceStopData.address.zip,
                    serviceTime : "12:35 PM",
                    serviceDate : "5/16/2025",
                    photoUrls : [
                      {
                        id : "1",
                        description : "Imaqge",
                        imageUrl : "https://www.google.com/url?sa=i&url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FSwimming_pool&psig=AOvVaw0WaHLWGhT0VsA-bSQf1G3M&ust=1747595555134000&source=images&cd=vfe&opi=89978449&ved=0CBQQjRxqFwoTCNjU3fOaq40DFQAAAAAdAAAAABAE"
                      }
                    ]
                  }
              }
          
              sgMail
                .send(msg)
                .then(() => {
          
                  console.log('Successfully Sent')
                })
                .catch((error) => {
                  console.error(error)
                  return {
                    status: 500,
                    error: error.message
                  };
                })
            }
          })

      }
    })
    //Get Service Stop From 
    //Get Customer information VIA API Call to Firebase from service stop info using either company id or contractedcompanyId

      return {
        status: 200,
        account: "Successfully Sent"
      };
  } catch (error) {
    console.error(
      "An error occurred when calling the Create New Recurring Service Stop API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

//-----------------Stripe Functions----------------------------

//-----------------Callable----------------------------
exports.createFirstRecurringServiceStop = functions.https.onCall( async(data, context) => {

  console.log('create FirstRecurring ServiceStop')
  console.log(data)

  let weekdayArry = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
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

    let counterPush = 0;

    let serviceDate =  new Date()
    let date = new Date()
    let currentDayOfWeek = 0
    let serviceDayOfWeek = 0


    const InCol = "companies/"+companyId+"/settings";
    const RSSCol = "companies/"+companyId+"/recurringServiceStop";
    const rssDocRef = "companies/"+companyId+"/recurringServiceStop";
    const docRef = "companies/"+companyId+"/serviceStops";

    let recurringServiceStopDoc = getFirestore().collection(RSSCol).doc(rssData.id);
    //Gets Internal Service Stop Count

    await getFirestore()
    .collection(InCol)
    .doc("serviceStops")
    .get().then((doc) => {
        if (doc.exists) {
            console.log("Settings data:", doc.data());
            counterPush = doc.data().increment

        } else {
            // doc.data() will be undefined in this case
            console.log("No such document!");
        }
    }).catch((error) => {
        console.log("Error getting document:", error);
    });

    //Uploads Recurring Service Stop 
    await getFirestore()
      .collection(rssDocRef).doc(rssData.id)
      .set(rssData);

    switch (standardFrequency) {
      // Daily
      case "Daily":
        console.log('Creating Daily')
        numFrequency = 7;
        let date1 = new Date(rssData.lastCreated);

        let serviceDate1 = date1

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({lastCreated: date1});
   

        for (let i = 0; i < 28; i++) {

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          
          serviceDate1.setDate(serviceDate1.getDate() + 1);
          

            console.log('Week Day ',weekdayArry[serviceDate1.getDay()])
            const newInternalId = "S" + String(counterPush + 1);

            counterPush = counterPush + 1;
    
            //
            //Update Recurring Service Stop with last Created Service Stop 
            //
  
            await recurringServiceStopDoc.update({lastCreated: serviceDate1});
    
            const idss = 'com_ss_' + uuidv4()
    
            let serviceStop = {
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
              dateCreated: new Date(),
              serviceDate: serviceDate1,
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
              internalId: newInternalId,
              id: idss,
              checkList: [],
              includeReadings:true,
              includeDosages:true,
              contractedCompanyId:rssData.contractedCompanyId,
              laborContractId:rssData.laborContractId,
              otherCompany:rssData.otherCompany,
    
            }

            //
            //Uploading the service Stop
            //
  
            await getFirestore()
                .collection(docRef).doc(idss)
                .set(serviceStop);  
          

        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate2);
        break;
      case "Week Day":
        console.log('Creating Week Day')
        numFrequency = 7;
        let date2 = new Date(rssData.lastCreated);

        let serviceDate2 = date2

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({lastCreated: date2});
   

        for (let i = 0; i < 28; i++) {

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          
          serviceDate2.setDate(serviceDate2.getDate() + 1);
          
          if (serviceDate2.getDay()!=0 && serviceDate2.getDay()!=6 ) {

            console.log('Week Day ',weekdayArry[serviceDate2.getDay()])
            const newInternalId = "S" + String(counterPush + 1);

            counterPush = counterPush + 1;
    
            //
            //Update Recurring Service Stop with last Created Service Stop 
            //
  
            await recurringServiceStopDoc.update({lastCreated: serviceDate2});
    
            const idss = 'com_ss_' + uuidv4()
    
            let serviceStop = {
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
              dateCreated: new Date(),
              serviceDate: serviceDate2,
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
              internalId: newInternalId,
              id: idss,
              checkList: [],
              includeReadings:true,
              includeDosages:true,
              contractedCompanyId:rssData.contractedCompanyId,
              laborContractId:rssData.laborContractId,
              otherCompany:rssData.otherCompany,
    
            }

            //
            //Uploading the service Stop
            //
  
            await getFirestore()
                .collection(docRef).doc(idss)
                .set(serviceStop);  
          } else {
            console.log('Weekend  ',weekdayArry[serviceDate2.getDay()],' - Skip')
          }


        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate2);
        break;
      case "Weekly":
        console.log("Creating Weekly")
        date = new Date(rssData.lastCreated);

        serviceDate = date

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({lastCreated: date});

        //
        //  Get Day of week represented as number 0 - 6 (Sunday - Saturday)
        //
        currentDayOfWeek = date.getDay();

        //
        //  Gets Service Day as number
        //
        serviceDayOfWeek = 0
        
        console.log('Switch')

        switch (rssData.daysOfWeek){
          case 'Sunday':
            console.log('Sunday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 0
            break;
          case 'Monday':
            console.log('Monday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 1
            break;
          case 'Tuesday':
            console.log('Tuesday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 2
            break;
          case 'Wednesday':
            console.log('Wednesday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 3
            break;
          case 'Thursday':
            console.log('Thursday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 4
            break;
          case 'Friday':
            console.log('Friday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 5
            break;
          case 'Saturday':
            console.log('Saturday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 6
            break;
          default:
            console.log('Default - ',rssData.daysOfWeek)
            serviceDayOfWeek = 6
            break;
        }

        for (let i = 0; i < 4; i++) {

          //
          //  Compare the two to determine how to create the first service stop. If the difference is negative that day of week has already passed and creating the service stops will start next week by adding 6
          //  if it is positive, add the difference to count which should create the service stop this week
          //
          let differenceInServiceDays = (serviceDayOfWeek+1)-(currentDayOfWeek+1)
          let amountToIncrease = 0 

          if (differenceInServiceDays < 0){

            amountToIncrease = differenceInServiceDays + 7
          // } else if (differenceInServiceDays == 0) {
          //   amountToIncrease = 0
          } else {
            amountToIncrease = differenceInServiceDays
          } 
          
          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          let amountToIncreaseThisWeek = (amountToIncrease + (i*7))
          
          // serviceDate.setFullYear(year, month, day + amountToIncreaseThisWeek );
          let updatedDate = new Date()
          updatedDate.setDate(updatedDate.getDate() + amountToIncreaseThisWeek);
          serviceDate = updatedDate

          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;
  

          console.log('serviceDayOfWeek - Check - ',weekdayArry[serviceDate.getDay()],' ',serviceDate)
          console.log()

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({lastCreated: serviceDate});
  
  
          const idss = 'com_ss_' + uuidv4()
  
          let serviceStop = {
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
            dateCreated: new Date(),
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
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings:true,
            includeDosages:true,
            contractedCompanyId:rssData.contractedCompanyId,
            laborContractId:rssData.laborContractId,
            otherCompany:rssData.otherCompany,
  
          }
          //
          //Uploading the service Stop
          //

          await getFirestore()
              .collection(docRef).doc(idss)
              .set(serviceStop);  

        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate);
        break;
      case "Bi-Weekly":
        console.log("Creating Bi-Weekly")
        date = new Date(rssData.lastCreated);

        serviceDate = date

        //Update Recurring Service Stop with last Created Service Stop 

        await recurringServiceStopDoc.update({lastCreated: date});

        //
        //  Get Day of week represented as number 0 - 6 (Sunday - Saturday)
        //
        let currentDayOfWeek = date.getDay();

        //
        //  Gets Service Day as number
        //
        let serviceDayOfWeek = 0
        
        console.log('Switch')

        switch (rssData.daysOfWeek){
          case 'Sunday':
            console.log('Sunday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 0
            break;
          case 'Monday':
            console.log('Monday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 1
            break;
          case 'Tuesday':
            console.log('Tuesday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 2
            break;
          case 'Wednesday':
            console.log('Wednesday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 3
            break;
          case 'Thursday':
            console.log('Thursday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 4
            break;
          case 'Friday':
            console.log('Friday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 5
            break;
          case 'Saturday':
            console.log('Saturday - ',rssData.daysOfWeek)
            serviceDayOfWeek = 6
            break;
          default:
            console.log('Default - ',rssData.daysOfWeek)
            serviceDayOfWeek = 6
            break;
        }

        for (let i = 0; i < 4; i++) {

          //
          //  Compare the two to determine how to create the first service stop. If the difference is negative that day of week has already passed and creating the service stops will start next week by adding 6
          //  if it is positive, add the difference to count which should create the service stop this week
          //
          let differenceInServiceDays = (serviceDayOfWeek+1)-(currentDayOfWeek+1)
          let amountToIncrease = 0 

          if (differenceInServiceDays < 0){

            amountToIncrease = differenceInServiceDays + 7
          // } else if (differenceInServiceDays == 0) {
          //   amountToIncrease = 0
          } else {
            amountToIncrease = differenceInServiceDays
          } 
          
          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          let amountToIncreaseThisWeek = (amountToIncrease + (i*14))
          
          // serviceDate.setFullYear(year, month, day + amountToIncreaseThisWeek );
          let updatedDate = new Date()
          updatedDate.setDate(updatedDate.getDate() + amountToIncreaseThisWeek);
          serviceDate = updatedDate

          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;
  

          console.log('serviceDayOfWeek - Check - ',weekdayArry[serviceDate.getDay()],' ',serviceDate)
          console.log()

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({lastCreated: serviceDate});
  
  
          const idss = 'com_ss_' + uuidv4()
  
          let serviceStop = {
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
            dateCreated: new Date(),
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
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings:true,
            includeDosages:true,
            contractedCompanyId:rssData.contractedCompanyId,
            laborContractId:rssData.laborContractId,
            otherCompany:rssData.otherCompany,
  
          }
          //
          //Uploading the service Stop
          //

          await getFirestore()
              .collection(docRef).doc(idss)
              .set(serviceStop);  

        }
        console.log('------------')

        console.log("Last Updated RSS", rssData.id, "To Date", serviceDate);
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
    console.log("New Service Stop Count ", counterPush);
    

    console.log('Successfully Created')
    return {
      status: 200,
      account: "Account Id"
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Create New Recurring Service Stop API",
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