
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SEND_GRID_API_KEY)

const db = admin.firestore(); 

//----------Send Grid Functions
exports.sendServiceReportOnFinish = functions.https.onCall( async(data, context) => {

    console.log('Send Service Report On Finish')
    let email = "michaelespineli2000@gmail.com"
  
    try {
      let companyName = ""
      let companyId = data.data.companyId
      let mainCompanyId = data.data.companyId
      let serviceStopId = data.data.serviceStopId
      console.log("Company Id: " + companyId)
      console.log("Service Stop Id: " + serviceStopId) 
      
      //Get Service Stop
      const ssRef = db.collection("companies").doc(companyId).collection("serviceStops").doc(serviceStopId)
      ssRef.get().then((ssdoc) => {
        if (ssdoc.exists) {
            console.log("Service Stop data:", ssdoc.data());
            let serviceStopData = ssdoc.data()
  
            //Get Company
            const companyRef = db.collection("companies").doc(companyId)
            companyRef.get().then((companyDoc) => {
              if (companyDoc.exists) {
                console.log("Company data:", companyDoc.data());
                let companyData = companyDoc.data()
                companyName = companyData.name

                //Check to see if company emails are set up 
                const emailConfigRef = db.collection("companies").doc(companyId).collection("settings").doc("emailConfiguration")
                emailConfigRef.get().then((emailConfigDoc) => {
                    if (emailConfigDoc.exists) {
                        if (emailConfigDoc.data().emailIsOn) {
                            //Check if customer configuration is set up
                            const customerEmailConfigRef = db.collection("companies").doc(companyId).collection("settings").doc("emailConfiguration").collection("customerConfiguration")

                            .where("customerId", "==", serviceStopData.customerId)
                            .limit(1)
                            .get().then((querySnapshot) => {
                                querySnapshot.forEach(async(customerEmailConfigDoc) => {
                                    if (customerEmailConfigDoc.exists) {
                                        if (customerEmailConfigDoc.data().emailIsOn) {
    
                                            //Get Stop Data
                                            const msg = {
                                                to: email,
                                                from: 'mespineli@dripdrop-poolapp.com ',
                                                cc:"michaelespineli@murdockpoolservice.com", //Maybe Company Email
                                                templateId: 'd-a987a065df0e43378dafd14c1b7ee419',
                                                dynamicTemplateData:{
                                                subject: companyName + "Weekly Service Report",
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
                                                    description : "Image",
                                                    imageUrl : "https://www.google.com/url?sa=i&url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FSwimming_pool&psig=AOvVaw0WaHLWGhT0VsA-bSQf1G3M&ust=1747595555134000&source=images&cd=vfe&opi=89978449&ved=0CBQQjRxqFwoTCNjU3fOaq40DFQAAAAAdAAAAABAE"
                                                    }
                                                ]
                                                }
                                            }
                                            console.log("Msg data:", msg);
    
                                            sgMail
                                            .send(msg)
                                            .then(() => {
                                        
                                                console.log('Successfully Sent Service Stop Email')
                                            })
                                            .catch((error) => {
                                                console.log('Failed To Send Service Stop Email')
                                                console.error(error)
                                                return {
                                                status: 500,
                                                error: error.message
                                                };
                                            })
                                        } else {
                                            console.log("Email Not Turned on for Customer")
                                        }
                                    } else {
                                        console.log("Customer Email Config Doc DNE")
                                    }
                                })
                            })
                        } else {
                            console.log("Email Not Turned on for Company")
                        }
                    } else {
                        console.log("Comapny Email Config DNE")
                    }
                })
              }
            })
  
        } else {
            console.log("Did not Find Service Stop")
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
  
exports.sendJobEstimateEmail = functions.https.onCall( async(data, context) => {

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
            const msg = {
                to: email,
                from: 'mespineli@dripdrop-poolapp.com ',
                cc:"michaelespineli@murdockpoolservice.com", //Maybe Company Email
                templateId: 'd-566087cd96864db0a07167e8a080cc12',
                dynamicTemplateData:{
                    subject: companyName + " Weekly Service Report",
                    preHeader: "Pre-header",
                    customer : serviceStopData.customerName,
                    customerId : serviceStopData.customerId,
                    technician : serviceStopData.tech,
                    technicianId : serviceStopData.techId,
                    stopData : {},
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

exports.sendInvoiceEmail = functions.https.onCall( async(data, context) => {

console.log('Send Service Report On Finish')

try {
    let companyName = ""
    let companyId = data.data.companyId
    let invoiceId = data.data.invoiceId
    console.log(companyId)
    console.log(invoiceId) 
    
    //Get Invoice
    const invoiceRef = db.collection("invoices").doc(invoiceId)
    invoiceRef.get().then((invoiceDoc) => {
    if (invoiceDoc.exists) {
        console.log("Invoice data:", invoiceDoc.data());
        let invoiceData = invoiceDoc.data()
        
        console.log("Invoice Data")
        console.log(invoiceData)
        //Get Company
        const companyRef = db.collection("companies").doc(invoiceData.receiverId)
        companyRef.get().then((companyDoc) => {
            if (companyDoc.exists) {
            console.log("Company data:", companyDoc.data());
            let companyData = companyDoc.data()
            companyName = companyData.name
            let companyEmail = "Michaelespineli2000@gmail.com"
            //Get Stop Data

            let pushLineItems = []
            var lineItems = invoiceData.lineItems

            console.log("Line items: " + lineItems.length)
            console.log(invoiceData.lineItems)
            for (let i = 0; i < lineItems.length; i++) {
                let lineItem = lineItems[i]
                console.log("Line Item:")
                console.log(lineItem)
                pushLineItems.push({
                id: lineItem.id,
                description: lineItem.description,
                induvidualCost: (lineItem.induvidualCost/100).toFixed(2),
                itemId: lineItem.itemId,
                total: ((lineItem.total/100).toFixed(2)),
                quantity: (lineItem.total/lineItem.induvidualCost)

                })
            }

            console.log("Push line items:")
            console.log(pushLineItems)
            const msg = {
                to: companyEmail,
                from: 'mespineli@dripdrop-poolapp.com ',
                cc:"michaelespineli@murdockpoolservice.com", //Maybe Company Email
                templateId: 'd-16d13e4c5d7e4c6f91667c76a3513c41',
                dynamicTemplateData:{
                subject: companyName + " Invoice " + invoiceData.internalIdenifier + " for $" + (invoiceData.total/100).toFixed(2),
                invoiceId: invoiceData.internalIdenifier,
                preHeader: "Pre-header",
                receiverCompany : invoiceData.receiverName,
                receiverCompanyId : invoiceData.receiverId,
                senderCompany : invoiceData.senderName,
                senderCompanyId : invoiceData.senderId,
                terms : invoiceData.terms,
                total : (invoiceData.total/100).toFixed(2),
                lineItems: pushLineItems,
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

exports.sendPaymentConfirmationEmail = functions.https.onCall( async(data, context) => {

    console.log('Send Service Report On Finish')

    try {
        let companyName = ""
        let companyId = data.data.companyId
        let invoiceId = data.data.invoiceId
        console.log(companyId)
        console.log(invoiceId) 
        
        //Get Service Stop
        const invoiceRef = db.collection("invoices").collection("invoices").doc(invoiceId)
        invoiceRef.get().then((invoiceDoc) => {
        if (invoiceDoc.exists) {
            console.log("Service Stop data:", invoiceDoc.data());
            let invoiceData = invoiceDoc.data()

            //Get Company
            const companyRef = db.collection("companies").doc(invoiceData.receivedData)
            companyRef.get().then((companyDoc) => {
                if (companyDoc.exists) {
                console.log("Company data:", companyDoc.data());
                let companyData = companyDoc.data()
                companyName = companyData.name
                let companyEmail = "Michaelespineli2000@gmail.com"
                //Get Stop Data

                let pushLineItems = []
                for (let i = 0; i < invoiceData.lineItems; i++) {
                    let lineItem = invoiceData.lineItems[i]
                    
                    pushLineItems.push({
                    id: lineItem.id,
                    description: lineItem.description,
                    induvidualCost: lineItem.induvidualCost/100,
                    itemId: lineItem.itemId,
                    total: lineItem.total/100,
                    quantity: (lineItem.total/lineItem.induvidualCost)

                    })
                }

                const msg = {
                    to: companyEmail,
                    from: 'mespineli@dripdrop-poolapp.com ',
                    cc:"michaelespineli@murdockpoolservice.com", //Maybe Company Email
                    templateId: 'd-6f7f138176c747be80aabd671e67577a',
                    dynamicTemplateData:{
                    subject: companyName + "Invoice " + invoiceData.internalIdenifier + " for " + invoiceData.total/100,
                    invoiceId: invoiceData.internalIdenifier,
                    preHeader: "Pre-header",
                    receiverCompany : invoiceData.receiverName,
                    receiverCompanyId : invoiceData.receiverId,
                    senderCompany : invoiceData.senderName,
                    senderCompanyId : invoiceData.senderId,
                    terms : invoiceData.terms,
                    total : invoiceData.total/100,
                    lineItems: pushLineItems,
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
  