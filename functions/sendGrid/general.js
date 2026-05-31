
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const { getFirestore } = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");
if (process.env.SEND_GRID_API_KEY && process.env.SEND_GRID_API_KEY.startsWith('SG.')) {
    sgMail.setApiKey(process.env.SEND_GRID_API_KEY);
}

const db = admin.firestore();

//----------Send Grid Functions//----------Send Grid Functions
exports.sendServiceReportOnFinish = functions.https.onCall(async (data, context) => {
    console.log("Send Service Report On Finish");

    const email = "michaelespineli2000@gmail.com";

    try {
        const companyId = data?.data?.companyId || data?.companyId;
        const serviceStopId = data?.data?.serviceStopId || data?.serviceStopId;

        if (!companyId) {
            throw new Error("Missing companyId");
        }

        if (!serviceStopId) {
            throw new Error("Missing serviceStopId");
        }

        console.log("Company Id:", companyId);
        console.log("Service Stop Id:", serviceStopId);

        // 1. Get Service Stop
        const serviceStopRef = db
            .collection("companies")
            .doc(companyId)
            .collection("serviceStops")
            .doc(serviceStopId);

        const serviceStopDoc = await serviceStopRef.get();

        if (!serviceStopDoc.exists) {
            console.log("Did not Find Service Stop");
            return {
                status: 404,
                error: "Service stop not found"
            };
        }

        const serviceStopData = serviceStopDoc.data();
        console.log("Service Stop data:", serviceStopData);

        // If this service stop belongs to a main company, use that for stopData.
        // Otherwise fall back to companyId.
        const mainCompanyId = serviceStopData.mainCompanyId || companyId;

        console.log("Main Company Id:", mainCompanyId);

        // 2. Get StopData from companies/{mainCompanyId}/stopData
        // where stopData.serviceStopId == serviceStopId

        const stopDataSnapshot = await db
            .collection("companies")
            .doc(mainCompanyId)
            .collection("stopData")
            .where("serviceStopId", "==", serviceStopId)
            .limit(1)
            .get();

        if (stopDataSnapshot.empty) {
            console.log("Did not Find Stop Data");
            return {
                status: 404,
                error: "Stop data not found"
            };
        }

        const stopDataDoc = stopDataSnapshot.docs[0];
        const stopData = stopDataDoc.data();

        console.log("Stop Data Doc Id:", stopDataDoc.id);
        console.log("Stop Data:", stopData);

        // 3. Get Company
        const companyRef = db.collection("companies").doc(companyId);
        const companyDoc = await companyRef.get();

        if (!companyDoc.exists) {
            console.log("Company Doc DNE");
            return {
                status: 404,
                error: "Company not found"
            };
        }

        const companyData = companyDoc.data();
        const companyName = companyData.name || serviceStopData.companyName || "Your Pool Company";

        console.log("Company data:", companyData);

        // 4. Check company email config
        const emailConfigRef = db
            .collection("companies")
            .doc(companyId)
            .collection("settings")
            .doc("emailConfiguration");

        const emailConfigDoc = await emailConfigRef.get();

        if (!emailConfigDoc.exists) {
            console.log("Company Email Config DNE");
            return {
                status: 404,
                error: "Company email configuration not found"
            };
        }

        const emailConfigData = emailConfigDoc.data();

        if (!emailConfigData.emailIsOn) {
            console.log("Email Not Turned on for Company");
            return {
                status: 200,
                account: "Company email is turned off"
            };
        }

        // 5. Check customer email config
        const customerEmailConfigSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("settings")
            .doc("emailConfiguration")
            .collection("customerConfiguration")
            .where("customerId", "==", serviceStopData.customerId)
            .limit(1)
            .get();

        if (customerEmailConfigSnapshot.empty) {
            console.log("Customer Email Config Doc DNE");
            return {
                status: 404,
                error: "Customer email configuration not found"
            };
        }

        const customerEmailConfigDoc = customerEmailConfigSnapshot.docs[0];
        const customerEmailConfigData = customerEmailConfigDoc.data();

        if (!customerEmailConfigData.emailIsOn) {
            console.log("Email Not Turned on for Customer");
            return {
                status: 200,
                account: "Customer email is turned off"
            };
        }

        // Helpers
        const formatDate = (value) => {
            if (!value) return "";

            const date =
                typeof value.toDate === "function"
                    ? value.toDate()
                    : new Date(value);

            return date.toLocaleDateString("en-US", {
                month: "numeric",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Los_Angeles"
            });
        };

        const formatTime = (value) => {
            if (!value) return "";

            const date =
                typeof value.toDate === "function"
                    ? value.toDate()
                    : new Date(value);

            return date.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/Los_Angeles"
            });
        };

        const normalizePhotoUrls = (photoUrls) => {
            if (!Array.isArray(photoUrls)) return [];

            return photoUrls.map((photo) => ({
                id: photo.id || "",
                description: photo.description || "",
                // Swift model uses imageURL, but your email template used imageUrl.
                imageUrl: photo.imageUrl || photo.imageURL || ""
            }));
        };

        const normalizeReadings = (readings) => {
            if (!Array.isArray(readings)) return [];

            return readings.map((reading) => ({
                id: reading.id || "",
                templateId: reading.templateId || "",
                universalTemplateId: reading.universalTemplateId || "",
                dosageType: reading.dosageType || "",
                name: reading.name || "",
                amount: reading.amount || "",
                UOM: reading.UOM || "",
                bodyOfWaterId: reading.bodyOfWaterId || ""
            }));
        };

        const normalizeDosages = (dosages) => {
            if (!Array.isArray(dosages)) return [];

            return dosages.map((dosage) => ({
                id: dosage.id || "",
                templateId: dosage.templateId || "",
                universalTemplateId: dosage.universalTemplateId || "",
                name: dosage.name || "",
                amount: dosage.amount || "",
                UOM: dosage.UOM || "",
                rate: dosage.rate || "",
                linkedItem: dosage.linkedItem || "",
                bodyOfWaterId: dosage.bodyOfWaterId || ""
            }));
        };

        const normalizeEquipmentMeasurements = (equipmentMeasurements) => {
            if (!Array.isArray(equipmentMeasurements)) return [];

            return equipmentMeasurements.map((measurement) => ({
                id: measurement.id || "",
                equipmentId: measurement.equipmentId || "",
                date: formatDate(measurement.date),
                status: measurement.status || "",
                poundForcePerSquareInch:
                    measurement.poundForcePerSquareInch === undefined || measurement.poundForcePerSquareInch === null
                        ? ""
                        : String(measurement.poundForcePerSquareInch),
                revolutionsPerMinute:
                    measurement.revolutionsPerMinute === undefined || measurement.revolutionsPerMinute === null
                        ? ""
                        : String(measurement.revolutionsPerMinute)
            }));
        };

        const photoUrls = normalizePhotoUrls(serviceStopData.photoUrls);

        const emailStopData = {
            id: stopData.id || serviceStopId,
            date: formatDate(stopData.date),
            serviceStopId: stopData.serviceStopId || serviceStopId,
            readings: normalizeReadings(stopData.readings),
            dosages: normalizeDosages(stopData.dosages),
            observation: Array.isArray(stopData.observation) ? stopData.observation : [],
            bodyOfWaterId: stopData.bodyOfWaterId || "",
            customerId: stopData.customerId || serviceStopData.customerId || "",
            serviceLocationId: stopData.serviceLocationId || serviceStopData.serviceLocationId || "",
            userId: stopData.userId || serviceStopData.techId || "",
            equipmentMeasurements: normalizeEquipmentMeasurements(stopData.equipmentMeasurements)
        };

        // 6. Build SendGrid Message
        const msg = {
            to: email,
            from: "mespineli@dripdrop-poolapp.com",
            cc: "michaelespineli@murdockpoolservice.com",
            templateId: "d-a987a065df0e43378dafd14c1b7ee419",
            dynamicTemplateData: {
                subject: companyName + " Weekly Service Report",
                preHeader: "Your weekly pool service report is ready.",

                customer: serviceStopData.customerName || "",
                customerId: serviceStopData.customerId || "",

                technician: serviceStopData.tech || "",
                technicianId: serviceStopData.techId || "",

                companyName: companyName,

                stopData: emailStopData,

                address01: serviceStopData.address?.streetAddress || "",
                address02: serviceStopData.address?.address02 || "",
                city: serviceStopData.address?.city || "",
                state: serviceStopData.address?.state || "",
                zip: serviceStopData.address?.zip || "",

                serviceTime: formatTime(serviceStopData.endTime || serviceStopData.startTime || serviceStopData.serviceDate),
                serviceDate: formatDate(serviceStopData.serviceDate),

                photoUrls: photoUrls
            }
        };

        console.log("Msg data:", JSON.stringify(msg.dynamicTemplateData, null, 2));

        await sgMail.send(msg);

        console.log("Successfully Sent Service Stop Email");

        return {
            status: 200,
            account: "Successfully Sent"
        };
    } catch (error) {
        console.log("Failed To Send Service Stop Email");
        console.error(error);

        return {
            status: error.code || 500,
            error: error.response?.body || error.message
        };
    }
});
exports.sendJobEstimateEmail = functions.https.onCall(async (data, context) => {

    console.log('Send Job Estiamte Email')
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
                            // cc: "michaelespineli@murdockpoolservice.com", //Maybe Company Email
                            templateId: 'd-566087cd96864db0a07167e8a080cc12',
                            dynamicTemplateData: {
                                subject: companyName + " Job Estiamte",
                                preHeader: "Pre-header",
                                customer: serviceStopData.customerName,
                                customerId: serviceStopData.customerId,
                                technician: serviceStopData.tech,
                                technicianId: serviceStopData.techId,
                                stopData: {},
                                companyName: companyName,
                                address01: serviceStopData.address.streetAddress,
                                city: serviceStopData.address.city,
                                state: serviceStopData.address.state,
                                zip: serviceStopData.address.zip,
                                serviceTime: "12:35 PM",
                                serviceDate: "5/16/2025",
                                photoUrls: [
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

exports.sendInvoiceEmail = functions.https.onCall(async (data, context) => {

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
                                induvidualCost: (lineItem.induvidualCost / 100).toFixed(2),
                                itemId: lineItem.itemId,
                                total: ((lineItem.total / 100).toFixed(2)),
                                quantity: (lineItem.total / lineItem.induvidualCost)

                            })
                        }

                        console.log("Push line items:")
                        console.log(pushLineItems)
                        const msg = {
                            to: companyEmail,
                            from: 'mespineli@dripdrop-poolapp.com ',
                            cc: "michaelespineli@murdockpoolservice.com", //Maybe Company Email
                            templateId: 'd-16d13e4c5d7e4c6f91667c76a3513c41',
                            dynamicTemplateData: {
                                subject: companyName + " Invoice " + invoiceData.internalIdenifier + " for $" + (invoiceData.total / 100).toFixed(2),
                                invoiceId: invoiceData.internalIdenifier,
                                preHeader: "Pre-header",
                                receiverCompany: invoiceData.receiverName,
                                receiverCompanyId: invoiceData.receiverId,
                                senderCompany: invoiceData.senderName,
                                senderCompanyId: invoiceData.senderId,
                                terms: invoiceData.terms,
                                total: (invoiceData.total / 100).toFixed(2),
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

exports.sendPaymentConfirmationEmail = functions.https.onCall(async (data, context) => {

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
                                induvidualCost: lineItem.induvidualCost / 100,
                                itemId: lineItem.itemId,
                                total: lineItem.total / 100,
                                quantity: (lineItem.total / lineItem.induvidualCost)

                            })
                        }

                        const msg = {
                            to: companyEmail,
                            from: 'mespineli@dripdrop-poolapp.com ',
                            cc: "michaelespineli@murdockpoolservice.com", //Maybe Company Email
                            templateId: 'd-6f7f138176c747be80aabd671e67577a',
                            dynamicTemplateData: {
                                subject: companyName + "Invoice " + invoiceData.internalIdenifier + " for " + invoiceData.total / 100,
                                invoiceId: invoiceData.internalIdenifier,
                                preHeader: "Pre-header",
                                receiverCompany: invoiceData.receiverName,
                                receiverCompanyId: invoiceData.receiverId,
                                senderCompany: invoiceData.senderName,
                                senderCompanyId: invoiceData.senderId,
                                terms: invoiceData.terms,
                                total: invoiceData.total / 100,
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
