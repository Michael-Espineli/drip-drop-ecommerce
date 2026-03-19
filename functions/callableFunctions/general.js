const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const {getFirestore} = require("firebase-admin/firestore");
const { v4: uuidv4 } = require('uuid');
const { Timestamp } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
// The Firebase Admin SDK to access Firestore.
const admin = require("firebase-admin");
const { title } = require("process");

const sgMail = require("@sendgrid/mail");

const db = admin.firestore(); 

const mySecret = defineSecret('stripe_secret_key');

//Live
// const publishableStripeKey = defineSecret('pk_live_51SR0FQAarMCMczenzad9KHz2dWM4tcMlSN1aquZVdN83md983TatYFy02H3usQAWeWldDMmlnPbVw5PvmhdjsXbn00sJx5TPCF');
//Test

const stripe = require("stripe")(process.env.STRIPE_API_KEY);

// Build to replace createFirstRecurringServiceStop
exports.createFirstRecurringServiceStop2 = functions.https.onCall(async (data, context) => {
  console.log("createFirstRecurringServiceStop2 (refactored, seed 4 weeks)");

  try {
    const companyId = data?.data?.companyId;
    const rssData = data?.data?.recurringServiceStop;

    if (!companyId) throw new Error("Missing Company Id");
    if (!rssData?.id) throw new Error("Missing Recurring Service Stop Id");

    const db = getFirestore();

    const SSIncrementCol = `companies/${companyId}/settings`;
    const RSSCol = `companies/${companyId}/recurringServiceStop`;
    const serviceStopsCol = `companies/${companyId}/serviceStops`;

    const recurringServiceStopDoc = db.collection(RSSCol).doc(rssData.id);

    // ---- Parse Firestore Timestamp / ISO / Date ----
    const parseDate = (d) => {
      if (!d) return null;
      if (typeof d?.toDate === "function") return d.toDate();
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt;
    };

    const startDate = parseDate(rssData.startDate) || new Date(); // iOS uses startDate
    const endDate = parseDate(rssData.endDate); // optional
    const noEndDate = Boolean(rssData.noEndDate);

    // ---- Determine functionalEndDate like iOS helpers ----
    // iOS: if noEndDate -> end = start + 28 days
    // else -> require endDate (but you said seed-only 4 weeks; we will cap anyway)
    const functionalStartDate = new Date(startDate);
    functionalStartDate.setHours(12, 0, 0, 0);

    let functionalEndDate;
    if (noEndDate) {
      functionalEndDate = new Date(functionalStartDate);
      functionalEndDate.setDate(functionalEndDate.getDate() + 28);
    } else {
      if (!endDate) throw new Error("No endDate provided but noEndDate is false");
      functionalEndDate = new Date(endDate);
      // Seed-only 4 weeks: cap at start+28 if endDate extends longer
      const cap = new Date(functionalStartDate);
      cap.setDate(cap.getDate() + 28);
      if (functionalEndDate > cap) functionalEndDate = cap;
    }

    // daysBetween like iOS: dateComponents day difference
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysBetween = Math.max(
      0,
      Math.floor((functionalEndDate.getTime() - functionalStartDate.getTime()) / msPerDay)
    );

    // ---- Load counter ----
    let counterPush = 0;
    const settingsDoc = await db.collection(SSIncrementCol).doc("serviceStops").get();
    if (settingsDoc.exists) {
      counterPush = Number(settingsDoc.data()?.increment ?? 0);
    }

    // ---- Save RSS doc (merge) ----

    let upLoadRSSData = rssData
    upLoadRSSData.dateCreated = admin.firestore.Timestamp.fromMillis(rssData.dateCreated);
    upLoadRSSData.startDate = admin.firestore.Timestamp.fromMillis(rssData.startDate);
    upLoadRSSData.endDate = admin.firestore.Timestamp.fromMillis(rssData.endDate);
    await recurringServiceStopDoc.set(upLoadRSSData, { merge: true });

    // ---- shared helpers ----
    const weekdayArry = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const dayNameToIndex = (name) => weekdayArry.indexOf(name);

    const buildServiceStop = (serviceDate) => {
      const idss = "com_ss_" + uuidv4();
      const internalId = "S" + String(counterPush + 1);
      counterPush += 1;

      return {
        id: idss,
        internalId,
        address: {
          city: rssData.address?.city,
          state: rssData.address?.state,
          streetAddress: rssData.address?.streetAddress,
          zip: rssData.address?.zip,
          latitude: rssData.address?.latitude,
          longitude: rssData.address?.longitude,
        },
        customerId: rssData.customerId,
        customerName: rssData.customerName,
        companyName: "",
        contractedCompanyId:"",
        companyId:companyId,
        customerName: rssData.customerName,
        description: rssData.description,
        duration: rssData.estimatedTime ?? 15,
        estimatedDuration:rssData.estimatedTime ?? 15,
        isInvoiced:false,
        dateCreated: new Date(),
        serviceDate,
        operationStatus: "Not Finished",
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
        jobName: "",
        checkList: [],
        includeReadings: true,
        includeDosages: true,
        contractedCompanyId: rssData.contractedCompanyId,
        laborContractId: rssData.laborContractId,
        otherCompany: Boolean(rssData.otherCompany),
      };
    };

    const uploadStop = async (serviceDate) => {
      const stop = buildServiceStop(serviceDate);
      await db.collection(serviceStopsCol).doc(stop.id).set(stop);
      return serviceDate;
    };

    // ---- Frequency helpers (mirror iOS) ----
    const seedDaily = async () => {
      let lastCreated = null;
      for (let counter = 0; counter < daysBetween; counter++) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter); // startDate + counter
        lastCreated = await uploadStop(d);
      }
      return lastCreated;
    };

    const seedWeekDay = async () => {
      let lastCreated = null;
      for (let counter = 0; counter < daysBetween; counter++) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue; // skip Sat/Sun
        lastCreated = await uploadStop(d);
      }
      return lastCreated;
    };

    // Intended iOS weekly behavior: choose next occurrence of rssData.day from startDate, then +7 each time
    const seedWeekly = async () => {
      const targetDow = dayNameToIndex(rssData.day);
      if (targetDow < 0) throw new Error(`Invalid rssData.day: ${rssData.day}`);

      const startDow = functionalStartDate.getDay();
      let diff = targetDow - startDow;
      if (diff < 0) diff += 7;

      let lastCreated = null;
      for (let counter = 0; counter < daysBetween; counter += 7) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + diff + counter);
        if (d.getTime() > functionalEndDate.getTime()) break;
        lastCreated = await uploadStop(d);
      }
      return lastCreated;
    };

    const seedBiWeekly = async () => {
      // iOS biweekly: startDate + 0, +14, (+28 if within range)
      let lastCreated = null;
      for (let counter = 0; counter < daysBetween; counter += 14) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter);
        lastCreated = await uploadStop(d);
      }
      return lastCreated;
    };

    const seedMonthly = async () => {
      // Fix iOS infinite loop: create startDate, then +1 month if still within window
      let lastCreated = null;

      const first = new Date(functionalStartDate);
      if (first.getTime() <= functionalEndDate.getTime()) {
        lastCreated = await uploadStop(first);
      }

      const second = new Date(functionalStartDate);
      second.setMonth(second.getMonth() + 1);

      if (second.getTime() <= functionalEndDate.getTime()) {
        lastCreated = await uploadStop(second);
      }

      return lastCreated;
    };

    // ---- Dispatch ----
    let lastCreated = null;
    switch (String(rssData.frequency)) {
      case "Daily":
        lastCreated = await seedDaily();
        break;
      case "Week Day":
        lastCreated = await seedWeekDay();
        break;
      case "Weekly":
        lastCreated = await seedWeekly();
        break;
      case "Bi-Weekly":
        lastCreated = await seedBiWeekly();
        break;
      case "Monthly":
        lastCreated = await seedMonthly();
        break;
      case "Yearly":
        // Not in iOS; seed within 4 weeks usually means just startDate if you want it.
        // Keep as no-op unless you want otherwise.
        lastCreated = null;
        break;
      default:
        throw new Error(`Unsupported frequency: ${rssData.frequency}`);
    }

    // ---- Persist lastCreated consistently (recommended) ----
    if (lastCreated) {

      await recurringServiceStopDoc.update({ lastCreated });
    }

    // ---- Persist counter ----
    await db.collection(SSIncrementCol).doc("serviceStops").set(
      { increment: counterPush, category: "serviceStops" },
      { merge: true }
    );


    //Call Update Recrurring Route.
    updateRecurringRoute(db, companyId, rssData)
    
    return {
      status: 200,
      rssId: rssData.id,
      createdCount:
        String(rssData.frequency) === "Daily"
          ? daysBetween
          : undefined, // optional: you can compute exact count if you want
      lastCreated,
    };
  } catch (error) {
    console.error("Error in createFirstRecurringServiceStop", error);
    return { status: 500, error: error?.message ?? String(error) };
  }
});
async function updateRecurringRoute({ db, companyId, rss }) {
  // Get Recurring Route based on day and Technician
  await getFirestore()
  .collection("companies")
  .doc(companyId)
  .collection("recurringRoute")
  .where("day", "==", rss.day)  
  .where("techId", "==", rss.techId)
  .get().then((querySnapshot) => {
      querySnapshot.forEach(async (doc) => {
        console.log("Recurring Route :", doc.id, " => ", doc.data());

        let documentData = doc.data()
        let rssOrder = documentData.order
        const addedOrder = {
          id: uuidv4(),
          customerId: rss.customerId,
          customerName: rss.customerName,
          locationId: rss.serviceLocationId,
          recurringServiceStopId: rss.id,
          order: oldOrder.length
        }
        oldOrder.push(addedOrder)
        const routeRef = db.collection("companies",companyId,"recurringRoute").doc(routeId);

        await updateDoc(routeRef, {
          recurringRouteOrder: rssOrder
        });
      });
  })
  .catch((error) => {
      console.log("Error getting Universal Dosagesdocuments: ", error);
  });
  // Update Recurring Route to have recurring service stop included
  // in the order
  const routesSnap = await db
    .collection(ROUTES_COL(companyId))
    .where("rssIds", "array-contains", rss.id)
    .get();

  return routesSnap.docs;
}

exports.createFirstRecurringServiceStop = functions.https.onCall( async(data, context) => {

    console.log('create FirstRecurring ServiceStop')
    console.log(data)
  
    let weekdayArry = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    let companyId = data.data.companyId
    let rssData = data.data.recurringServiceStop
  
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
  
  
      const SSIncrementCol = "companies/"+companyId+"/settings";
      const RSSCol = "companies/"+companyId+"/recurringServiceStop";
      const rssDocRef = "companies/"+companyId+"/recurringServiceStop";
      const docRef = "companies/"+companyId+"/serviceStops";
  
      let recurringServiceStopDoc = getFirestore().collection(RSSCol).doc(rssData.id);
      //Gets Internal Service Stop Count
      
      await getFirestore()
      .collection(SSIncrementCol)
      .doc("serviceStops")
      .get().then((doc) => {
          if (doc.exists) {
              console.log("Settings data:", doc.data());
              counterPush = doc.data().increment
          } else {
              // doc.data() will be undefined in this case
              console.log("No Service Stop Setting Docuement");
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
                duration: rssData.estimatedTime ?? 15,
                // duration: 15,
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
                duration: rssData.estimatedTime ?? 15,
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
  
          switch (rssData.day){
            case 'Sunday':
              console.log('Sunday - ',rssData.day)
              serviceDayOfWeek = 0
              break;
            case 'Monday':
              console.log('Monday - ',rssData.day)
              serviceDayOfWeek = 1
              break;
            case 'Tuesday':
              console.log('Tuesday - ',rssData.day)
              serviceDayOfWeek = 2
              break;
            case 'Wednesday':
              console.log('Wednesday - ',rssData.day)
              serviceDayOfWeek = 3
              break;
            case 'Thursday':
              console.log('Thursday - ',rssData.day)
              serviceDayOfWeek = 4
              break;
            case 'Friday':
              console.log('Friday - ',rssData.day)
              serviceDayOfWeek = 5
              break;
            case 'Saturday':
              console.log('Saturday - ',rssData.day)
              serviceDayOfWeek = 6
              break;
            default:
              console.log('Default - ',rssData.day)
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
    
  
            console.log('Service Day Of Week: ',weekdayArry[serviceDate.getDay()],' - Service Date: ',serviceDate)
  
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
              duration: rssData.estimatedTime ?? 15,
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
            console.log("Service Stop: ", serviceStop)
            //
            //Uploading the service Stop
            //
  
            await getFirestore()
                .collection(docRef).doc(idss)
                .set(serviceStop);  
              console.log("Successfully Adding New Service Stop")
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
          currentDayOfWeek = date.getDay();
  
          //
          //  Gets Service Day as number
          //
          serviceDayOfWeek = 0
          
          console.log('Switch')
  
          switch (rssData.day){
            case 'Sunday':
              console.log('Sunday - ',rssData.day)
              serviceDayOfWeek = 0
              break;
            case 'Monday':
              console.log('Monday - ',rssData.day)
              serviceDayOfWeek = 1
              break;
            case 'Tuesday':
              console.log('Tuesday - ',rssData.day)
              serviceDayOfWeek = 2
              break;
            case 'Wednesday':
              console.log('Wednesday - ',rssData.day)
              serviceDayOfWeek = 3
              break;
            case 'Thursday':
              console.log('Thursday - ',rssData.day)
              serviceDayOfWeek = 4
              break;
            case 'Friday':
              console.log('Friday - ',rssData.day)
              serviceDayOfWeek = 5
              break;
            case 'Saturday':
              console.log('Saturday - ',rssData.day)
              serviceDayOfWeek = 6
              break;
            default:
              console.log('Default - ',rssData.day)
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
    
  
            console.log('Service Day Of Week - Check - ',weekdayArry[serviceDate.getDay()],' ',serviceDate)
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
              duration: rssData.estimatedTime ?? 15,
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
      .collection(SSIncrementCol)
      .doc("serviceStops")
      .set({
        increment: counterPush,
        category: "serviceStops",
      });
      console.log("New Service Stop Count ", counterPush);
      
  
      console.log('Successfully Created')
      return {
        status: 200,
        rssId: rssData.id
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

exports.deleteUser = functions.https.onCall( async(data, context) => {
  try {
    console.log('Deleting User NOt Up and running')
  } catch {
    console.log(error)
  }
})

exports.createCompanyAfterSignUp = functions.https.onCall( async(data, context) => {
  /*
  Should Receive User Id, Company Name, Owner Name
  */

  try {
    console.log('Creating All functions for company')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let ownerId = receivedData.ownerId
    let ownerName = receivedData.ownerName
    let companyName = receivedData.companyName
    let email = receivedData.email
    let phoneNumber = receivedData.phoneNumber
    let zipCodes = receivedData.zipCodes
    let services = receivedData.services
    //Body Of function

    //Create Company
    const companyId = 'com_' + uuidv4()
    let company = {
        id: companyId,
        ownerId: ownerId,
        ownerName: ownerName,
        name: companyName,
        photoUrl: null,
        dateCreated: new Date(),
        email: email,
        phoneNumber: phoneNumber,
        verified: false,
        serviceZipCodes: zipCodes,
        services: services,
        accountType: "Free",
        paidUntil: new Date(),
        status: "Free",
        stripeConnectAccountStatus: "Not Started",
        yelpURL:"",
        websiteURL:""

    }
    await getFirestore()
    .collection("companies").doc(companyId)
    .set(company);
    console.log("Finished Creating Company")

    //Create First Company User
    const companyUserId = 'com_cu' + uuidv4()
    let companyUser = {
      id: companyUserId,
      userId: ownerId,
      userName: ownerName,
      roleId: "1",
      roleName: "Owner",
      dateCreated: new Date(),
      status: "Active",
      workerType: "Employee"
    }
    await getFirestore()
    .collection("companies").doc(companyId).collection("companyUsers").doc(companyUserId)
    .set(companyUser);
    console.log("Finished Creating Company User")

    //Create Company Settings
      //WO
      const WOIncrement = {category: "workOrders", increment: 0}
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("workOrders").set(WOIncrement);

      //SS
      const SSIncrement = {category: "serviceStops", increment: 0}
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("serviceStops").set(SSIncrement);

      //RSS
      const RIncrement = {category: "receipts", increment: 0}
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("receipts").set(RIncrement);

      //Route
      const RountIncrement = {category: "recurringServiceStops", increment: 0}
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("recurringServiceStops").set(RountIncrement);

      //Vender
      const StoreIncrement = {category: "venders", increment: 0}
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("venders").set(StoreIncrement);

      //To Do
      const ToDoIncrement = {category: "toDos", increment: 0}
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("toDos").set(ToDoIncrement);
    console.log("Finished Creating Company Settings")

    //Create Inital Work Order, Readings, and Dosages
      //Inital Work Order Templates
      //"companies/\(companyId)/settings/workOrders/workOrders"

      //Initial Service Stops 
      // "companies/\(companyId)/settings/serviceStops/serviceStops"

      //Inital Readings
      //Get Universal Readings Templates "universal/settings/readingTemplates
      await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("readingTemplates")
      .get().then((querySnapshot) => {
          querySnapshot.forEach(async(doc) => {
            console.log("Reading Template:", doc.id, " => ", doc.data());
            
            let documentData = doc.data()
            //Then Make local reaings
            let readingsTemplate = {
              id: 'com_set_rt_' + uuidv4(),
              readingsTemplateId: documentData.id,
              name: documentData.name,
              amount: documentData.amount,
              UOM: documentData.UOM,
              chemType: documentData.chemType,
              linkedDosage: documentData.linkedDosage,
              editable: documentData.editable,
              order: documentData.order,
              highWarning: documentData.highWarning,
              lowWarning: documentData.lowWarning,
            }
            //companies/\(companyId)/settings/readings/readings
            await getFirestore().collection("companies").doc(companyId).collection("settings").doc("readings").collection("readings").doc(readingsTemplate.id).set(readingsTemplate);

          });
      })
      .catch((error) => {
          console.log("Error getting Universal Readings documents: ", error);
      });

        //Inital Dosages
        //Get Universal Dosages Templates "universal/settings/dosageTemplates
        await getFirestore()
        .collection("universal")
        .doc("settings")
        .collection("dosageTemplates")
        .get().then((querySnapshot) => {
            querySnapshot.forEach(async (doc) => {
              console.log("Dosage Template:", doc.id, " => ", doc.data());

              let documentData = doc.data()

              let dosageTemplate = {
                id: 'com_set_dt_' + uuidv4(),
                dosageTemplateId: documentData.id,
                name: documentData.name,
                amount: documentData.amount,
                UOM: documentData.UOM,
                rate: documentData.rate,
                linkedItemId: "",
                strength: documentData.strength,
                editable: documentData.editable,
                chemType: documentData.chemType,
                order: documentData.order,
              }
              //"companies/\(companyId)/settings/dosages/dosages
              await getFirestore().collection("companies").doc(companyId).collection("settings").doc("dosages").collection("dosages").doc(dosageTemplate.id).set(dosageTemplate);

            });
        })
        .catch((error) => {
            console.log("Error getting Universal Dosagesdocuments: ", error);
        });
    
      //Create Generic Billing Templates
      //Create Generic Training Templates

      //Create Generic Roles

        let ownerRole = {
          id: "1",
          name: "Owner",
          permissionIdList: [
            "0","10","12","14","16","20","22","24","26","30","32","34","36",
            "40","42","44","46","50","52","54","56","60","62","64","66",
            "200","210","220","230","232","234","236","240","242","244","246",
            "250","252","254","256","260","262","264","266","280","282","284","286",
            "290","292","294","296",
            "400","410","412","414","416",
            "600","610","612","614","616","620","622","624","626",
            "800","810","812","814","816","820","822","824","826","830","832","834","836",
            "840","842","844","846","850","852","854","856","860","862","864","866",
            "870","872","874","876","880","882","884","886",
            "890","892","894","896"
        ],
          listOfUserIdsToManage: [],
          color: "red",
          description: "All Permissions Enabled"
        }
        await getFirestore().collection("companies").doc(companyId).collection("roles").doc(ownerRole.id).set(ownerRole);
        console.log("Role Created =>",ownerRole)

        let techRole = {
          id: "comp_role_" + uuidv4(),
          name: "Tech",
          permissionIdList: [
            "0","10","12","14","16","20","22","24","26","30","32","34","36",
            "40","42","44","46","50","52","54","56","60","62","64","66",
            "200","210","220","230","232","234","236","240","242","244","246",
            "250","252","254","256","260","262","264","266","280","282","284","286",
            "290","292","294","296",
            "400","410","412","414","416",
            "600","610","612","614","616","620","622","624","626",
            "800","810","812","814","816","820","822","824","826","830","832","834","836",
            "840","842","844","846","850","852","854","856","860","862","864","866",
            "870","872","874","876","880","882","884","886",
            "890","892","894","896"
        ],
          listOfUserIdsToManage: [],
          color: "red",
          description: "Basic Permissions For Techs"
        }
        await getFirestore().collection("companies").doc(companyId).collection("roles").doc(techRole.id).set(techRole);
        console.log("Role Created =>",techRole)

        let managerRole = {
          id: "comp_role_" + uuidv4(),
          name: "Manager",
          permissionIdList: [
            "0","10","12","14","16","20","22","24","26","30","32","34","36",
            "200","210","220","230","232","234","236","240","242","244","246",
            "250","252","254","256","260","262","264","266","280","282","284","286",
            "290","292","294","296",
            "400",
            "600","610","612","614","616","620","622","624","626",
            "800","810","812","814","816","820","822","824","826","830","832","834","836",
            "840","842","844","846","850","852","854","856","860","862","864","866",
            "870","872","874","876","880","882","884","886"
        ],
          listOfUserIdsToManage: [],
          color: "red",
          description: "Basic Permissions For Manager"
        }
        await getFirestore().collection("companies").doc(companyId).collection("roles").doc(managerRole.id).set(managerRole);
        console.log("Role Created =>",managerRole)

        let adminRole = {
          id: "comp_role_" + uuidv4(),
          name: "Admin",
          permissionIdList: [
            "0","10","12","14","16","20","22","24","26","30","32","34","36",
            "40","42","44","46","50","52","54","56","60","62","64","66",
            "200","210","220","230","232","234","236","240","242","244","246",
            "250","252","254","256","260","262","264","266","280","282","284","286",
            "290","292","294","296",
            "400","410","412","414","416",
            "600","610","612","614","616","620","622","624","626",
            "800","810","812","814","816","820","822","824","826","830","832","834","836",
            "840","842","844","846","850","852","854","856","860","862","864","866",
            "870","872","874","876","880","882","884","886",
            "890","892","894","896"
        ],
          listOfUserIdsToManage: [],
          color: "red",
          description: "Basic Permissions For Admin"
        }
        await getFirestore().collection("companies").doc(companyId).collection("roles").doc(adminRole.id).set(adminRole);
        console.log("Role Created =>",adminRole)

        let officeRole = {
          id: "comp_role_" + uuidv4(),
          name: "Office",
          permissionIdList: [
            "0","10","12","14","16","20","22","24","26","30","32","34","36",
            "40","42","44","46","50","52","54","56","60","62","64","66",
            "200","210","220","230","232","234","236","240","242","244","246",
            "250","252","254","256","260","262","264","266","280","282","284","286",
            "290","292","294","296",
            "400","410","412","414","416",
            "600","610","612","614","616","620","622","624","626",
            "800","810","812","814","816","820","822","824","826","830","832","834","836",
            "840","842","844","846","850","852","854","856","860","862","864","866",
            "870","872","874","876","880","882","884","886",
            "890","892","894","896"
        ],
          listOfUserIdsToManage: [],
          color: "red",
          description: "Basic Permissions For Office Personal"
        }
        await getFirestore().collection("companies").doc(companyId).collection("roles").doc(officeRole.id).set(officeRole);
        console.log("Role Created =>",officeRole)

      //Create User Access
        let userAccess = {
          id: companyId,
          companyId: companyId,
          companyName: companyName,
          roleId: "1",
          roleName: "Owner",
          dateCreated: new Date()
        }
        await getFirestore().collection("users").doc(ownerId).collection("userAccess").doc(userAccess.id).set(userAccess);

        //Set Up Company Email COnfiguration
        let emailConfiguration = {
          id: uuidv4(),
          emailIsOn: false,
          emailBody: "Thank you For letting "+ companyName + " service your pool",
          requirePhoto: false
        }
        await getFirestore().collection("companies").doc(companyId).collection("settings").doc("emailConfiguration").set(emailConfiguration);
        console.log("Set Up email Confirmation")
      // Moves to stripe function that does on user create. 

      // //Create Stripe Customer. Check out createStripeCustomer for refrence
    // 1. Create a customer in Stripe
      const customer = await stripe.customers.create({
        email: email,
        name: ownerName, 
      });

      const compDocRef2 = db.collection('companies').doc(companyId);
      await compDocRef2.set({
        stripeId: customer.id, // CORRECTED FIELD NAME
      }, { merge: true }); 

      console.log(`Successfully Created Stripe customer: ${customer.id}`);
      //2. Create Connected Account. Check out createNewStripeAccount for refrence
      const account = await stripe.accounts.create({
        type: 'express', // or 'standard', 'custom'
        country: 'US', // or the relevant country
        email: email, // Collect email from your React app
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        // ... other account details as needed
        
      });
      console.log('account: ',account)

      console.log('Successfully Created New Stripe Connected Account: ', account.id)
      // 3. Save the Stripe customer ID to the user's document in Firestore
      await compDocRef2.set({
        stripeConnectedAccountId: account.id,
      }, { merge: true }); 

      console.log(`Stripe customer ID ${customer.id} saved for user ${ownerId}`);


      //Get Subscriptions Start Company With Basic 
      await getFirestore()
      .collection("subscriptions")
      .where("name", "==", "Free")
      .limit(1)
      .get().then((querySnapshot) => {
          querySnapshot.forEach(async(doc) => {
            console.log("SubscriptionData:", doc.id, " => ", doc.data());
            
            let documentData = doc.data()
            //Then Make local reaings
            let startingSubscription = {
              currentPeriodEnd: null,
              currentPeriodStart: new Date(),
              description: "",
              dripDropSubscriptionId: documentData.id,
              id: 'com_s_' + uuidv4(),
              lastPaid: null,
              name: "Free",
              status: "active",
              price: 0,
              started: new Date(),
              status:"active",
              stripeCustomerId: "",
              stripePriceId: "",
              stripeProductId: "",
              stripeSubscriptionId: "",
              userId: ownerId,
            }
            //companies/\(companyId)/settings/readings/readings
            await getFirestore().collection("companies").doc(companyId).collection("subscriptions").doc(startingSubscription.id).set(startingSubscription);
            console.log("Sucessfully Created first Subscription")

          });
      })
      .catch((error) => {
          console.log("Error getting Universal Readings documents: ", error);
      });
    console.log("Sucessfully Created Company")

    return {
      status: 200,
      companyId: companyId
    };
  } catch (error) {

    console.error(
      "An error occurred when calling the Create Company After Sign up Stop API: Deleting Company",
      error
    );

    //Delete Company
    await getFirestore()
    .collection("companies").doc(companyId)
    .delete()

    return {
      status: 500,
      error: error.message
    };
  }
});

exports.updateCompanyHistory = functions.https.onCall( async(data, context) => {
  try {
    console.log('Updating Company History')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let updaterId = receivedData.updaterId
    let updaterName = receivedData.updaterName
    let companyId = receivedData.companyId
    let description = receivedData.description
    let tags = receivedData.tags

    //Body Of function

    //Create Company
    const id = 'com_his_' + uuidv4()
    let company = {
        id: id,
        updaterId: updaterId,
        updaterName: ownerName,
        date: new Date(),
        description: description,
        tags: ownerName,

    }
    await getFirestore()
    .collection("companies").doc(companyId).collection("companyHistory")
    .set(company);
    console.log("Finished Creating Company History")
    return {
      status: 200,
      companyId: companyId
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
exports.createCompanyAdminNotes = functions.https.onCall( async(data, context) => {
  try {
    console.log('Updating Company History')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let updaterId = receivedData.updaterId
    let updaterName = receivedData.updaterName
    let companyId = receivedData.companyId
    let description = receivedData.description
    let tags = receivedData.tags
    let needsResolution = receivedData.needsResolution
    let resolved = receivedData.resolved
    let resoloverId = receivedData.resoloverId
    let resolverName = receivedData.resolverName
    let dateResolved = receivedData.dateResolved

    
    //Body Of function

    //Create Company Notes
    const id = 'com_an_' + uuidv4()
    let company = {
        id: id,
        updaterId: updaterId,
        updaterName: updaterName,
        date: new Date(),
        description: description,
        tags: tags,
        needsResolution: needsResolution,
        resolved: resolved,
        resoloverId: resoloverId,
        resolverName: resolverName,
        dateResolved: dateResolved,
    }
    await getFirestore()
    .collection("companies").doc(companyId).collection("adminNotes").doc(id)
    .set(company);
    console.log("Finished Creating Company History")
    return {
      status: 200,
      companyId: companyId
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

exports.acceptLinkedInvite = functions.https.onCall( async(data, context) => {

  try {
    let companyId = data.data.companyId
    let invoiceId = data.data.customerId
    let userId = data.data.userId
    console.log(companyId)
    console.log(invoiceId) 
    console.log(userId) 
    
    // This needs to be a cloud Function So that this work request does not get interupted while in progress.

    //Accept Invite Information
    // Copy Over Location Information
    // Copy Over Body Of Water Information
    // Copy Over Equipment Information
    // Copy Over Historical Stop Data ( Maybe add a max Year Cap? At 5 Years if any)
    // Access To Contracts
    // Access To Payment Portal
    // Access To Make Repair Requests
    // Access To Approve Work Requests
    // Access To Approve Shopping List Item Requests
    // Update Company Customer Information To Link Accounts

    // const invoiceRef = db.collection("invoices").collection("invoices").doc(invoiceId)
    // invoiceRef.get().then((invoiceDoc) => {
    //   if (invoiceDoc.exists) {
    //       console.log("Service Stop data:", invoiceDoc.data());
    //       let invoiceData = invoiceDoc.data()

    //   }
    // })

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

exports.acceptTechInvite = functions.https.onCall( async(data, context) => {


  try {
    let inviteId = data.data.inviteId
    let userId = data.data.userId
    console.log(inviteId)
    console.log(userId) 
    const invite = null
    // Get invite 
    await getFirestore()
    .collection("invites")
    .doc(inviteId)
    .get().then((doc) => {
      if (doc.exists) {
          console.log("Settings data:", doc.data());
          invite = doc.data()
      } else {
          // doc.data() will be undefined in this case
          console.log("No Service Stop Setting Docuement");
      }
    }).catch((error) => {
        console.log("Error getting document:", error);
    });


    //Check If invite exists
    if (invite) {

      //Check if invite is pending
      if (invite.status != "pending" ){

        return {
          status: 500,
          error: "Invite Already Accepted"
        };

      } else {

        // Handle Invite set Up 
        // Create New CompanyUser
        const companyUserId = 'com_cu_' + uuidv4()
        const fullName = invite.firstName + " " + invite.lastName
        let companyUser = {
            id: companyUserId,
            userId: userId,
            userName: fullName,
            roleId: invite.roleId,
            roleName: invite.roleName,
            dateCreated: new Date(),
            status: "Active",
            workerType: "Employee",
            linkedCompanyId: null,
            linkedCompanyName: null,
        }

        await getFirestore()
        .collection("companies").doc(invite.companyId).collection("companyUsers").doc(id)
        .set(companyUser);


        // Create New UserAccess
        const userAccessId = 'use_us_' + uuidv4()
        let userAccess = {
            id: userAccessId,
            companyId: invite.companyId,
            companyName: invite.companyName,
            roleId: invite.roleId,
            roleName: invite.roleName,
            dateCreated: new Date(),
        }

        await getFirestore()
        .collection("companies").doc(userId).collection("userAccess").doc(id)
        .set(userAccess);

      }
    } else {
      return {
        status: 500,
        error: "No Invite Found"
      };
      
    }
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

exports.updateServiceStopDayPermanently = functions.https.onCall( async(data, context) => {

  const db = getFirestore();

  try {
    console.log('Creating All functions for company')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let companyId = receivedData.companyId
    let serviceStopList = receivedData.serviceStopList
    let newTech = receivedData.newTech
    let newDay = receivedData.newDay
    let currentDayOfWeek = new Date().getDay()
    let newDayOfWeek = 0 
    switch (newDay) {
      case "Sunday":
        newDayOfWeek = 0
        break;
      case "Monday":
        newDayOfWeek = 1
        break;
      case "Tuesday":
        newDayOfWeek = 2
        break;
      case "Wednesday":
        newDayOfWeek = 3
        break;
      case "Thursday":
        newDayOfWeek = 4
        break;
      case "Friday":
        newDayOfWeek = 5
          break;
      case "Saturday":
        newDayOfWeek = 6
        break;
    }
    let difference = newDayOfWeek-currentDayOfWeek
    let newServiceDate = new Date()
    newServiceDate.setDate(newServiceDate.getDate() + difference);

    if (newDayOfWeek >= currentDayOfWeek) {
      for (let i = 0; i < serviceStopList.length; i++) {
        let stop = serviceStopList[i]
        //Check Status
        if (stop.operationStatus == "Not Finished") {
          const ssRef = db
            .collection(`companies/${companyId}/serviceStops`)
            .doc(stop.id);
        
          //Update ss Data
          //Update techId
          //Update Tech
          //Update serviceDate
          await ssRef.update({ 
            serviceDate: newServiceDate,
            techId:newTech.userId,
            tech:newTech.userName 
          });

          //Update Recurring Routes?

        } else {
          // if status is anything but "Not Finished" do not move stops
        }
      }
    } else {
      //Only Change Future Stops and RSS
      //Skip ServiceStops list, just change future and rss
    }
    for (let i = 0; i < serviceStopList.length; i++) {
      updateRSSAndNextWeek(companyId, serviceStopList[i], newDay,newDayOfWeek,newTech)
    }
    //
    // check if service day has past. Can not move
    // if new day is earlier(less than) in week then do not move stops selected, but all future stops and update rss
    //if new day is today or later in the week move stop, rss and future stops. 
    //

    return {
      status: 200,
      companyId: companyId
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the updateServiceStopPermanently API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});


async function updateRSSAndNextWeek(
  companyId,
  ssData,
  newDay,
  newDayOfWeek,
  newUserData
) {
  const db = getFirestore();
  const serviceStopsCol = `companies/${companyId}/serviceStops`;




 let currentDayOfWeek = new Date().getDay()
 let differenceInDays = newDayOfWeek-currentDayOfWeek
 let nextSunday = new Date()

 nextSunday.setDate(nextSunday.getDate() + 7-currentDayOfWeek);

 const rssRef = db
  .collection(`companies/${companyId}/recurringServiceStop`)
  .doc(stop.recurringServiceStopId);

  //Get all future SS Data to update of service stops that share the same RSS ID. 
  serviceStopsCol
  .where("recurringServiceStopId", "==", stop.recurringServiceStopId)
  .where("serviceDate", ">=", nextSunday)
  .get().then((querySnapshot) => {
    querySnapshot.forEach(async(doc) => {
      // Update ss Data
      // Update techId
      // Update Tech
      // Update serviceDate
      console.log("ServiceStop:", doc.id, " => ", doc.data());
      let documentData = doc.data()
      //Add Difference in days to service stop
      let newServiceDate = new Date()
      newServiceDate.setDate(newServiceDate.getDate() + differenceInDays);
     
      const ssRef = db
      .collection(`companies/${companyId}/serviceStops`)
      .doc(documentData.id);
      await ssRef.update({ 
        serviceDate: newServiceDate,
        techId:newUserData.userId,
        tech:newUserData.userName 
      });
    });
  })
  .catch((error) => {
      console.log("Error getting Service Stop Documents: ", error);
  });

  // Update RSS doc
  // Update techId
  // Update Tech
  // Update day

  await rssRef.update({ 
    day: newDay,
    techId:newUserData.userId,
    tech:newUserData.userName 
  });
  //Update Recurring Routes?
}
  
//a Test Function
exports.updateCompanyReadingsSettings = functions.https.onCall( async(data, context) => {
  /*
  Should Receive User Id, Company Name, Owner Name
  */

  try {
    console.log('Creating All functions for company')
    let receivedData = data.data
    console.log("Received Data")
    console.log(receivedData)
    let companyId = receivedData.companyId

    //Create Company Settings
    //Inital Readings
    //Get Universal Readings Templates "universal/settings/readingTemplates
    await getFirestore()
    .collection("universal")
    .doc("settings")
    .collection("readingTemplates")
    .get().then((querySnapshot) => {
        querySnapshot.forEach(async(doc) => {
          console.log("Reading Template:", doc.id, " => ", doc.data());
          
          let documentData = doc.data()
          //Then Make local reaings
          let readingsTemplate = {
            id: 'com_set_rt_' + uuidv4(),
            readingsTemplateId: documentData.id,
            name: documentData.name,
            amount: documentData.amount,
            UOM: documentData.UOM,
            chemType: documentData.chemType,
            linkedDosage: documentData.linkedDosage,
            editable: documentData.editable,
            order: documentData.order,
            highWarning: documentData.highWarning,
            lowWarning: documentData.lowWarning,
          }
          //companies/\(companyId)/settings/readings/readings
          await getFirestore().collection("companies").doc(companyId).collection("settings").doc("readings").collection("readings").doc(readingsTemplate.id).set(readingsTemplate);
        });
      })
      .catch((error) => {
          console.log("Error getting Universal Readings documents: ", error);
      });
      //Inital Dosages
      //Get Universal Dosages Templates "universal/settings/dosageTemplates
      await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("dosageTemplates")
      .get().then((querySnapshot) => {
          querySnapshot.forEach(async (doc) => {
            console.log("Dosage Template:", doc.id, " => ", doc.data());
            let documentData = doc.data()
            let dosageTemplate = {
              id: 'com_set_dt_' + uuidv4(),
              dosageTemplateId: documentData.id,
              name: documentData.name,
              amount: documentData.amount,
              UOM: documentData.UOM,
              rate: documentData.rate,
              linkedItemId: "",
              strength: documentData.strength,
              editable: documentData.editable,
              chemType: documentData.chemType,
              order: documentData.order,
            }
            await getFirestore().collection("companies").doc(companyId).collection("settings").doc("dosages").collection("dosages").doc(dosageTemplate.id).set(dosageTemplate);
          });
      })
      .catch((error) => {
          console.log("Error getting Universal Dosagesdocuments: ", error);
      });

    return {
      status: 200,
      companyId: companyId
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


exports.updateRecurringRouteOrderPermanently = functions.https.onCall( async(data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let routeId = receivedData.routeId
  let recurringRouteOrder = receivedData.recurringRouteOrder
  let serviceStopOrders = receivedData.serviceStopOrders

  if (!routeId) {
    throw new functions.https.HttpsError("invalid-argument", "routeId required");
  }

  const routeRef = db.collection("companies",companyId,"recurringRoute").doc(routeId);
  const snap = await routeRef.get();

  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Route not found");
  }

  const recurring = recurringRouteOrder || [];
  const active = serviceStopOrders || [];

  // 1. Sort active by order
  const activeSorted = [...active].sort((a, b) => a.order - b.order);

  // 2. Map recurring by recurringServiceStopId
  const recurringMap = new Map(
    recurring.map(r => [r.recurringServiceStopId, { ...r }])
  );

  // 3. Build reordered recurring list
  const reordered = [];

  for (const stop of activeSorted) {
    const match = recurringMap.get(stop.recurringServiceStopId);
    if (match) {
      reordered.push(match);
      recurringMap.delete(stop.recurringServiceStopId);
    }
  }

  // 4. Append remaining recurring stops not in active
  const remaining = Array.from(recurringMap.values())
    .sort((a, b) => a.order - b.order);

  reordered.push(...remaining);

  // 5. Rewrite order indexes
  const finalRecurring = reordered.map((r, index) => ({
    ...r,
    order: index
  }));

  // 6. Save back to Firestore
  await updateDoc(routeRef, {
    recurringRouteOrder: finalRecurring
  });

  return {
    success: true,
    count: finalRecurring.length
  };
});

exports.createHomeOwnerCustomerBasedOnCompany = functions.https.onCall( async(data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let companyName = receivedData.companyName
  let customerId = receivedData.customerId
  let homeOwnerId = receivedData.homeOwnerId
  console.log("companyId ",companyId)
  console.log("companyName ",companyName)
  console.log("customerId ",customerId)
  console.log("homeOwnerId ",homeOwnerId)
 
  //Get all customers

  //get all locations
  await getFirestore()
  .collection("companies")
  .doc(companyId)
  .collection("serviceLocations")
  .where("customerId", "==", customerId)
  .get().then((querySnapshot) => {
      querySnapshot.forEach(async(doc) => {
        console.log("Service Location:", doc.id, " => ", doc.data());
        let serviceLocationData = doc.data()

        let hoslId = 'hosl_' + uuidv4()

        //Get BOW Info
        await getFirestore()
        .collection("companies")
        .doc(companyId)
        .collection("bodiesOfWater")
        .where("customerId", "==", customerId)
        .where("serviceLocationId", "==", serviceLocationData.serviceLocationId)
        .get().then((querySnapshot2) => {
            querySnapshot2.forEach(async(doc2) => {
              console.log("Body Of Water:", doc2.id, " => ", doc2.data());
              let bodyOfWaterData = doc2.data()
              let hobowId = 'hobow_' + uuidv4()
              
              //Get Equipment
              await getFirestore()
              .collection("companies")
              .doc(companyId)
              .collection("equipment")
              .where("customerId", "==", customerId)
              .where("bodyOfWaterId", "==", bodyOfWaterData.bodyOfWaterId)
              .get().then((querySnapshot3) => {
                  querySnapshot3.forEach(async(doc3) => {
                    console.log("Equipment:", doc3.id, " => ", doc3.data());
                    let equipmentData = doc3.data()

                    //Create Equipment
                    let hoEquId = 'hoequ_' + uuidv4()
                    let newEquipment = {
                      id: hoEquId,
                      serviceLocationId:hoslId,
                      bodyOfWaterId:hobowId,
                      homeOwnerId: user.uid,
                      dateInstalled: equipmentData.dateInstalled,
                      isActive: equipmentData.isActive,
                      make: equipmentData.make,
                      makeId: equipmentData.makeId,
                      model: equipmentData.model,
                      modelId: equipmentData.modelId,
                      name: equipmentData.isActive,
                      status: equipmentData.status,
                      type: equipmentData.type,
                      typeId: equipmentData.typeId,
                      // Ignore Notes
                      // Ignore Photo Urls
                      verified: true,
                      linkedCompanyId: companyId,
                      linkedCompanyName: companyName,
                      linkedLocationId: documentData.id,
                    }
                    //companies/\(companyId)/settings/readings/readings
                    await getFirestore().collection("homeOwnerEquipment").doc(hoEquId).set(newEquipment);

                  });
              })
              .catch((error) => {
                  console.log("Error getting Universal Readings documents: ", error);
              });
              //Create New BOW
              let newBOW = {
                id: hobowId,
                homeOwnerId: user.uid,
                serviceLocationId: hoslId,
                gallons: bodyOfWaterData.gallons,
                lastFilled: bodyOfWaterData.lastFilled,
                material: bodyOfWaterData.material,
                name: bodyOfWaterData.name,
                // Ignore Notes
                // Ignore Photo Urls
                verified: true,
                linkedCompanyId: companyId,
                linkedCompanyName: companyName,
                linkedLocationId: documentData.id,
              }
              //companies/\(companyId)/settings/readings/readings
              await getFirestore().collection("homeOwnerBodiesOfWater").doc(hobowId).set(newBOW);

            });
        })
        .catch((error) => {
            console.log("Error getting Universal Readings documents: ", error);
        });
        //Create new SL
        let newServiceLocation = {
          id: hoslId,
          address: documentData.address,
          bodiesOfWaterId: documentData.bodiesOfWaterId,
          customerId: documentData.customerId, // From company sl
          customerName: documentData.customerName, // From company sl
          dogName: documentData.dogName,
          estimatedTime: documentData.estimatedTime,
          nickName: documentData.nickName,
          // Ignore Notes
          // Ignore Photo Urls
          photoUrls: documentData.photoUrls,
          preText: documentData.preText,
          gateCode: documentData.gateCode,
          mainContact: documentData.mainContact,
          nickName: documentData.nickName,

          homeOwnerId: user.uid, //Instead of customerId
          verified: true,
          linkedCompanyId: companyId,
          linkedCompanyName: companyName,
          linkedLocationId: documentData.id,
        }
        //companies/\(companyId)/settings/readings/readings
        await getFirestore().collection("homeOwnerServiceLocations").doc(hoslId).set(newServiceLocation);

      });
  })
  .catch((error) => {
      console.log("Error getting Universal Readings documents: ", error);
  });



  //get all stopData (10 Years)

  // Set the homeowner's UID on the company customer document
  const customerDocRef = doc(db, 'companies', companyId, 'customers', customerId);      

  await updateDoc(customerDocRef, {
      linkedCustomerIds: [user.uid]
  });
  

  return {
    success: true,
    count: finalRecurring.length
  };
});

exports.makeUpdatesToRecurringRoutes = functions.https.onCall( async(data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyUserId
  console.log("companyId ",companyId)

  //Maybe its something like

  // On create of recurring service stop

  //Check to see if recurring Route exists

  // if exists make updates to route. 

  // if does not exist make a new route


  return {
    success: true,
    count: finalRecurring.length
  };
});


exports.deleteRecurringServiceStop = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  // Optional: require auth
  // if (!context.auth) {
  //   throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  // }

  const receivedData = data?.data ?? data; // supports either {data:{...}} or {...}
  const companyId = receivedData?.companyId;
  const stopId = receivedData?.stopId;

  if (!companyId || !stopId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing companyId or stopId."
    );
  }

  console.log("companyId", companyId);
  console.log("stopId", stopId);

  // ---- Customize these to your schema ----
  const SERVICE_STOPS_COL = `companies/${companyId}/serviceStops`;
  const RECURRING_STOPS_COL = `companies/${companyId}/recurringServiceStops`;

  // Field on each generated stop that links back to the recurring template
  const LINK_FIELD = "recurringServiceStopId";

  // Date field on the generated stops (Firestore Timestamp recommended)
  const DATE_FIELD = "serviceDate";
  // ---------------------------------------

  // "Today" (start of day) so we only delete future stops
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayTs = Timestamp.fromDate(startOfToday);

  // 1) Query all future service stops tied to this recurring stop
  // NOTE: If you store date as milliseconds number, use a number compare instead of Timestamp.
  const stopsQuery = db
    .collection(SERVICE_STOPS_COL)
    .where(LINK_FIELD, "==", stopId)
    .where(DATE_FIELD, ">=", todayTs);

  let totalDeleted = 0;

  // Helper: delete in batches of 500
  async function deleteQueryInBatches() {
    while (true) {
      const snap = await stopsQuery.limit(500).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      totalDeleted += snap.size;
    }
  }

  // 2) Delete the generated service stops
  await deleteQueryInBatches();

  // 3) Delete the recurring template doc
  const recurringRef = db.collection(RECURRING_STOPS_COL).doc(stopId);

  // If you prefer soft-delete instead of hard delete, swap to:
  // await recurringRef.set({ deleted: true, deletedAt: FieldValue.serverTimestamp() }, { merge: true });
  await recurringRef.delete();

  return {
    success: true,
    count: totalDeleted,
  };
});


exports.endRecurringServiceStop = functions.https.onCall( async(data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let stopId = receivedData.stopId
  console.log("companyId ",companyId)
  console.log("stopId ",stopId)




  return {
    success: true,
    count: finalRecurring.length
  };
});