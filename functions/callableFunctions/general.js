const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const functions1 = require('firebase-functions/v1');
const { getFirestore } = require("firebase-admin/firestore");
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

const stripe = require("stripe")(process.env.STRIPE_API_KEY || 'sk_test_dummyApiKey');

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

    // MARK: - Date Helpers

    const parseDate = (value) => {
      if (!value) return null;

      // Firestore Timestamp from Admin SDK or client SDK
      if (typeof value?.toDate === "function") {
        return value.toDate();
      }

      // Firestore Timestamp-like object sent over HTTPS callable
      if (typeof value?._seconds === "number") {
        return new Date(value._seconds * 1000);
      }

      if (typeof value?.seconds === "number") {
        return new Date(value.seconds * 1000);
      }

      // Milliseconds
      if (typeof value === "number") {
        return new Date(value);
      }

      // ISO string or Date-compatible string
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const toFirestoreTimestamp = (value, fallbackDate = null) => {
      const parsed = parseDate(value) || fallbackDate;

      if (!parsed) {
        return null;
      }

      return admin.firestore.Timestamp.fromDate(parsed);
    };

    const normalizeToNoon = (date) => {
      const d = new Date(date);
      d.setHours(12, 0, 0, 0);
      return d;
    };

    // MARK: - Start / End Dates

    const startDate = parseDate(rssData.startDate) || new Date();
    const endDate = parseDate(rssData.endDate);
    const noEndDate = Boolean(rssData.noEndDate);

    const functionalStartDate = normalizeToNoon(startDate);

    let functionalEndDate;

    if (noEndDate) {
      functionalEndDate = new Date(functionalStartDate);
      functionalEndDate.setDate(functionalEndDate.getDate() + 28);
    } else {
      if (!endDate) {
        throw new Error("No endDate provided but noEndDate is false");
      }

      functionalEndDate = normalizeToNoon(endDate);

      // Seed-only 4 weeks: cap at start + 28 days if endDate extends longer.
      const cap = new Date(functionalStartDate);
      cap.setDate(cap.getDate() + 28);

      if (functionalEndDate > cap) {
        functionalEndDate = cap;
      }
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysBetween = Math.max(
      0,
      Math.floor((functionalEndDate.getTime() - functionalStartDate.getTime()) / msPerDay)
    );

    // MARK: - Load Counter

    let counterPush = 0;

    const settingsDoc = await db.collection(SSIncrementCol).doc("serviceStops").get();

    if (settingsDoc.exists) {
      counterPush = Number(settingsDoc.data()?.increment ?? 0);
    }

    // MARK: - Save RSS Doc

    const upLoadRSSData = { ...rssData };

    upLoadRSSData.dateCreated =
      toFirestoreTimestamp(rssData.dateCreated, new Date()) ||
      admin.firestore.Timestamp.now();

    upLoadRSSData.startDate =
      toFirestoreTimestamp(rssData.startDate, functionalStartDate) ||
      admin.firestore.Timestamp.fromDate(functionalStartDate);

    if (rssData.endDate) {
      upLoadRSSData.endDate = toFirestoreTimestamp(rssData.endDate);
    } else {
      upLoadRSSData.endDate = null;
    }

    await recurringServiceStopDoc.set(upLoadRSSData, { merge: true });

    // MARK: - Create Tasks For Recurring Service Stop

    console.log("create Tasks For Recurring Service Stops");

    const taskGroupId = "com_set_tg_recurring_service_stops";

    const tasksDoc = await db.collection("companies")
      .doc(companyId)
      .collection("settings")
      .doc("taskGroup")
      .collection("taskGroup")
      .doc(taskGroupId)
      .collection("taskItems")
      .get();

    const taskList = [];

    console.log("tasksDoc.length: ", tasksDoc.docs.length);

    for (const taskDoc of tasksDoc.docs) {
      const task = taskDoc.data();

      const taskId = "com_rss_tas_" + uuidv4();

      const recurringServiceStopTask = {
        id: taskId,
        name: String(task.name || "").trim(),
        description: String(task.description || "").trim(),
        type: task.type,
        contractedRate: Number(task.contractedRate || 0),
        estimatedTime: Number(task.estimatedTime || 0),
        status: "Accepted",
        isTaskGroup: true,
        taskGroupId: taskGroupId,
        taskGroupTaskId: task.id,
      };

      taskList.push(recurringServiceStopTask);

      await db.collection("companies")
        .doc(companyId)
        .collection("recurringServiceStop")
        .doc(rssData.id)
        .collection("tasks")
        .doc(taskId)
        .set(recurringServiceStopTask);
    }

    // MARK: - Shared Helpers

    const weekdayArray = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const normalizeDayName = (value) => {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, "");
    };

    const dayNameToIndex = (name) => {
      const normalized = normalizeDayName(name);

      return weekdayArray.findIndex((day) => {
        return normalizeDayName(day) === normalized;
      });
    };

    const buildServiceStop = (serviceDate) => {
      const idss = "com_ss_" + uuidv4();
      const internalId = "S" + String(counterPush + 1);
      counterPush += 1;

      return {
        id: idss,
        internalId,

        address: {
          city: rssData.address?.city ?? "",
          state: rssData.address?.state ?? "",
          streetAddress: rssData.address?.streetAddress ?? "",
          zip: rssData.address?.zip ?? "",
          latitude: rssData.address?.latitude ?? 0,
          longitude: rssData.address?.longitude ?? 0,
        },

        customerId: rssData.customerId ?? "",
        customerName: rssData.customerName ?? "",

        companyName: "",
        companyId: companyId,

        description: rssData.description ?? "",
        duration: rssData.estimatedTime ?? 15,
        estimatedDuration: rssData.estimatedTime ?? 15,

        isInvoiced: false,
        dateCreated: new Date(),
        serviceDate,

        operationStatus: "Not Finished",
        billingStatus: "Not Invoiced",
        rate: 0,

        recurringServiceStopId: rssData.id,
        tech: rssData.tech ?? "",
        techId: rssData.techId ?? "",

        serviceLocationId: rssData.serviceLocationId ?? "",

        type: rssData.type ?? "Recurring Service Stop",
        typeId: rssData.typeId ?? "system_recurring_service_stop",
        typeImage: rssData.typeImage ?? "figure.pool.swim",

        jobId: "",
        jobName: "",

        checkList: [],
        includeReadings: true,
        includeDosages: true,

        contractedCompanyId: rssData.contractedCompanyId ?? "",
        laborContractId: rssData.laborContractId ?? "",
        otherCompany: Boolean(rssData.otherCompany),
      };
    };

    const uploadStop = async (serviceDate) => {
      const normalizedServiceDate = normalizeToNoon(serviceDate);
      const stop = buildServiceStop(normalizedServiceDate);

      await db.collection(serviceStopsCol).doc(stop.id).set(stop);

      for (let i = 0; i < taskList.length; i++) {
        const task = taskList[i];

        const serviceStopTaskId = "com_ss_tas_" + uuidv4();

        const serviceStopTask = {
          id: serviceStopTaskId,
          name: String(task.name || "").trim(),
          type: task.type,
          status: task.status || "Not Finished",
          contractedRate: Number(task.contractedRate || 0),
          estimatedTime: Number(task.estimatedTime || 0),

          customerApproval: false,
          actualTime: 0,

          workerId: "",
          workerType: "",
          workerName: "",

          laborContractId: "",

          serviceStopId: {
            id: stop.id,
            internalId: stop.internalId || "",
          },

          jobId: {
            id: "",
            internalId: "",
          },

          recurringServiceStopId: {
            id: rssData.id ?? "",
            internalId: rssData.internalId || "",
          },

          jobTaskId: "",
          recurringServiceStopTaskId: task.id,

          equipmentId: "",
          serviceLocationId: stop.serviceLocationId || rssData.serviceLocationId || "",
          bodyOfWaterId: "",
          shoppingListItemId: "",
        };

        await db.collection(serviceStopsCol)
          .doc(stop.id)
          .collection("tasks")
          .doc(serviceStopTaskId)
          .set(serviceStopTask);
      }

      return normalizedServiceDate;
    };

    // MARK: - Frequency Helpers

    const seedDaily = async () => {
      let lastCreated = null;

      for (let counter = 0; counter <= daysBetween; counter++) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter);

        if (d.getTime() > functionalEndDate.getTime()) break;

        lastCreated = await uploadStop(d);
      }

      return lastCreated;
    };

    const seedWeekDay = async () => {
      let lastCreated = null;

      for (let counter = 0; counter <= daysBetween; counter++) {
        const d = new Date(functionalStartDate);
        d.setDate(d.getDate() + counter);

        if (d.getTime() > functionalEndDate.getTime()) break;

        const dow = d.getDay();

        if (dow === 0 || dow === 6) {
          continue;
        }

        lastCreated = await uploadStop(d);
      }

      return lastCreated;
    };

    // Weekly rule:
    // startDate is the first actual service day.
    // If startDate is today, it seeds today.
    // rssData.day is still validated/logged, but it does not push the first stop forward.
    const seedWeekly = async () => {
      const targetDow = dayNameToIndex(rssData.day);

      if (targetDow < 0) {
        throw new Error(`Invalid rssData.day: ${rssData.day}`);
      }

      const firstServiceDate = normalizeToNoon(functionalStartDate);
      const firstServiceDateDow = firstServiceDate.getDay();

      if (targetDow !== firstServiceDateDow) {
        console.warn("Weekly RSS startDate day does not match selected day", {
          rssDay: rssData.day,
          targetDow,
          firstServiceDateDow,
          firstServiceDate: firstServiceDate.toISOString(),
        });
      }

      console.log("Weekly seed debug:", {
        rssDay: rssData.day,
        targetDow,
        firstServiceDateDow,
        firstServiceDate: firstServiceDate.toISOString(),
        functionalEndDate: functionalEndDate.toISOString(),
      });

      let lastCreated = null;

      for (
        let d = new Date(firstServiceDate);
        d.getTime() <= functionalEndDate.getTime();
        d.setDate(d.getDate() + 7)
      ) {
        const serviceDate = normalizeToNoon(d);
        lastCreated = await uploadStop(serviceDate);
      }

      return lastCreated;
    };

    const seedBiWeekly = async () => {
      let lastCreated = null;

      for (
        let d = new Date(functionalStartDate);
        d.getTime() <= functionalEndDate.getTime();
        d.setDate(d.getDate() + 14)
      ) {
        const serviceDate = normalizeToNoon(d);
        lastCreated = await uploadStop(serviceDate);
      }

      return lastCreated;
    };

    const seedMonthly = async () => {
      let lastCreated = null;

      const first = normalizeToNoon(functionalStartDate);

      if (first.getTime() <= functionalEndDate.getTime()) {
        lastCreated = await uploadStop(first);
      }

      const second = new Date(functionalStartDate);
      second.setMonth(second.getMonth() + 1);
      const normalizedSecond = normalizeToNoon(second);

      if (normalizedSecond.getTime() <= functionalEndDate.getTime()) {
        lastCreated = await uploadStop(normalizedSecond);
      }

      return lastCreated;
    };

    // MARK: - Dispatch

    let lastCreated = null;

    let frequency = String(rssData.frequency || "");

    switch (frequency) {
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
        // Seed within 4 weeks usually means no yearly seed unless startDate is desired.
        // If you want yearly to create the startDate, uncomment:
        // lastCreated = await uploadStop(functionalStartDate);
        lastCreated = null;
        break;

      default:
        throw new Error(`Unsupported frequency: ${rssData.frequency}`);
    }

    // MARK: - Persist Last Created

    if (lastCreated) {
      await recurringServiceStopDoc.update({
        lastCreated: admin.firestore.Timestamp.fromDate(lastCreated),
      });
    }

    // MARK: - Persist Counter

    await db.collection(SSIncrementCol).doc("serviceStops").set(
      {
        increment: counterPush,
        category: "serviceStops",
      },
      { merge: true }
    );

    // MARK: - Update Recurring Route

    await updateRecurringRoute(db, companyId, rssData);

    return {
      status: 200,
      rssId: rssData.id,
      lastCreated,
    };
  } catch (error) {
    console.error("Error in createFirstRecurringServiceStop2", error);

    return {
      status: 500,
      error: error?.message ?? String(error),
    };
  }
});
// exports.createFirstRecurringServiceStop2 = functions.https.onCall(async (data, context) => {
//   console.log("createFirstRecurringServiceStop2 (refactored, seed 4 weeks)");

//   try {
//     const companyId = data?.data?.companyId;
//     const rssData = data?.data?.recurringServiceStop;

//     console.log("check mark: " + 1)
//     if (!companyId) throw new Error("Missing Company Id");
//     if (!rssData?.id) throw new Error("Missing Recurring Service Stop Id");

//     console.log("check mark: " + 2)
//     const db = getFirestore();

//     const SSIncrementCol = `companies/${companyId}/settings`;
//     const RSSCol = `companies/${companyId}/recurringServiceStop`;
//     const serviceStopsCol = `companies/${companyId}/serviceStops`;

//     const recurringServiceStopDoc = db.collection(RSSCol).doc(rssData.id);
//     console.log("check mark: " + 3)
//     // ---- Parse Firestore Timestamp / ISO / Date ----
//     const parseDate = (d) => {
//       if (!d) return null;
//       if (typeof d?.toDate === "function") return d.toDate();
//       const dt = new Date(d);
//       return isNaN(dt.getTime()) ? null : dt;
//     };
//     console.log("check mark: " + 4)
//     const startDate = parseDate(rssData.startDate) || new Date(); // iOS uses startDate
//     const endDate = parseDate(rssData.endDate); // optional
//     const noEndDate = Boolean(rssData.noEndDate);
//     console.log("check mark: " + 5)
//     // ---- Determine functionalEndDate like iOS helpers ----
//     // iOS: if noEndDate -> end = start + 28 days
//     // else -> require endDate (but you said seed-only 4 weeks; we will cap anyway)
//     const functionalStartDate = new Date(startDate);
//     functionalStartDate.setHours(12, 0, 0, 0);
//     console.log("check mark: " + 6)
//     let functionalEndDate;
//     if (noEndDate) {
//       functionalEndDate = new Date(functionalStartDate);
//       functionalEndDate.setDate(functionalEndDate.getDate() + 28);
//     } else {
//       if (!endDate) throw new Error("No endDate provided but noEndDate is false");
//       functionalEndDate = new Date(endDate);
//       // Seed-only 4 weeks: cap at start+28 if endDate extends longer
//       const cap = new Date(functionalStartDate);
//       cap.setDate(cap.getDate() + 28);
//       if (functionalEndDate > cap) functionalEndDate = cap;
//     }
//     console.log("check mark: " + 7)

//     // daysBetween like iOS: dateComponents day difference
//     const msPerDay = 24 * 60 * 60 * 1000;
//     const daysBetween = Math.max(
//       0,
//       Math.floor((functionalEndDate.getTime() - functionalStartDate.getTime()) / msPerDay)
//     );

//     console.log("check mark: " + 8)
//     // ---- Load counter ----
//     let counterPush = 0;
//     const settingsDoc = await db.collection(SSIncrementCol).doc("serviceStops").get();
//     if (settingsDoc.exists) {
//       counterPush = Number(settingsDoc.data()?.increment ?? 0);
//     }

//     console.log("check mark: " + 9)
//     // ---- Save RSS doc (merge) ----

//     let upLoadRSSData = rssData
//     upLoadRSSData.dateCreated = admin.firestore.Timestamp.fromMillis(rssData.dateCreated);
//     upLoadRSSData.startDate = admin.firestore.Timestamp.fromMillis(rssData.startDate);
//     upLoadRSSData.endDate = admin.firestore.Timestamp.fromMillis(rssData.endDate);
//     await recurringServiceStopDoc.set(upLoadRSSData, { merge: true });


//     //Create Tasks for Recurring service stops
//     console.log("create Tasks For Recurring Service Stops")
//     let taskGroupId = "com_set_tg_recurring_service_stops"
//     console.log("create Tasks For Recurring Service Stops: " + 1)
//     //Get task group settings
//     // get tasks from task subcollection
//     const tasksDoc = await db.collection("companies")
//       .doc(companyId)
//       .collection("settings")
//       .doc("taskGroup")
//       .collection("taskGroup")
//       .doc(taskGroupId)
//       .collection("taskItems")
//       .get();
//     let taskList = []

//     console.log("create Tasks For Recurring Service Stops: " + 2)
//     console.log(tasksDoc)

//     //Add Tasks to Task Group

//     console.log("tasksDoc.length: ", tasksDoc.docs.length)
//     for (const taskDoc of tasksDoc.docs) {
//       const task = taskDoc.data();
//       console.log("task: ", task)
//       let taskId = "com_rss_tas_" + uuidv4()
//       let recurringServiceStopTask = {
//         id: taskId,
//         name: task.name.trim(),
//         description: task.description.trim(),
//         type: task.type,
//         contractedRate: Number(task.contractedRate || 0),
//         estimatedTime: Number(task.estimatedTime || 0),
//         status: "Accepted",
//         isTaskGroup: true,
//         taskGroupId: taskGroupId,
//         taskGroupTaskId: task.id
//       }
//       taskList.push(recurringServiceStopTask)

//       await db.collection("companies").doc(companyId)
//         .collection("recurringServiceStop").doc(rssData.id)
//         .collection("tasks").doc(taskId).set(recurringServiceStopTask);
//     }

//     //create recurring service stop tasks

//     // ---- shared helpers ----
//     const weekdayArry = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
//     const dayNameToIndex = (name) => weekdayArry.indexOf(name);

//     const buildServiceStop = (serviceDate) => {
//       const idss = "com_ss_" + uuidv4();
//       const internalId = "S" + String(counterPush + 1);
//       counterPush += 1;

//       return {
//         id: idss,
//         internalId,
//         address: {
//           city: rssData.address?.city,
//           state: rssData.address?.state,
//           streetAddress: rssData.address?.streetAddress,
//           zip: rssData.address?.zip,
//           latitude: rssData.address?.latitude,
//           longitude: rssData.address?.longitude,
//         },
//         customerId: rssData.customerId,
//         customerName: rssData.customerName,
//         companyName: "",
//         contractedCompanyId: "",
//         companyId: companyId,
//         customerName: rssData.customerName,
//         description: rssData.description,
//         duration: rssData.estimatedTime ?? 15,
//         estimatedDuration: rssData.estimatedTime ?? 15,
//         isInvoiced: false,
//         dateCreated: new Date(),
//         serviceDate,
//         operationStatus: "Not Finished",
//         billingStatus: "Not Invoiced",
//         rate: 0,
//         recurringServiceStopId: rssData.id,
//         tech: rssData.tech,
//         serviceLocationId: rssData.serviceLocationId,
//         techId: rssData.techId,
//         type: rssData.type,
//         typeId: rssData.typeId,
//         typeImage: rssData.typeImage,
//         jobId: "",
//         jobName: "",
//         checkList: [],
//         includeReadings: true,
//         includeDosages: true,
//         contractedCompanyId: rssData.contractedCompanyId ?? "",
//         laborContractId: rssData.laborContractId ?? "",
//         otherCompany: Boolean(rssData.otherCompany) ?? false,
//       };
//     };

//     const uploadStop = async (serviceDate) => {
//       //upload service stop
//       const stop = buildServiceStop(serviceDate);
//       await db.collection(serviceStopsCol).doc(stop.id).set(stop);

//       //upload tasks
//       for (let i = 0; i < taskList.length; i++) {
//         console.log("task: ", taskList[i])
//         let task = taskList[i];
//         const serviceStopTaskId = "com_ss_tas_" + uuidv4();
//         const serviceStopTask = {
//           id: serviceStopTaskId,
//           name: task.name.trim(),
//           type: task.type,
//           status: task.status || "Not Finished",
//           contractedRate: Number(task.contractedRate || 0),
//           estimatedTime: Number(task.estimatedTime || 0),
//           customerApproval: false,
//           actualTime: 0,

//           workerId: "",
//           workerType: "",
//           workerName: "",

//           laborContractId: "",

//           serviceStopId: {
//             id: stop.id,
//             internalId: stop.internalId || "",
//           },
//           jobId: {
//             id: "",
//             internalId: "",
//           },
//           recurringServiceStopId: {
//             id: rssData.id ?? "",
//             internalId: rssData.internalId || "",
//           },
//           jobTaskId: "",
//           recurringServiceStopTaskId: task.id,
//           equipmentId: "",
//           serviceLocationId: stop.serviceLocationId || rssData.serviceLocationId || "",
//           bodyOfWaterId: "",
//           shoppingListItemId: "",
//         };
//         await db.collection(serviceStopsCol).doc(stop.id).collection("tasks").doc(serviceStopTaskId).set(serviceStopTask);
//       }
//       return serviceDate;
//     };

//     // ---- Frequency helpers (mirror iOS) ----
//     const seedDaily = async () => {
//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter++) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + counter); // startDate + counter
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     const seedWeekDay = async () => {
//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter++) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + counter);
//         const dow = d.getDay();
//         if (dow === 0 || dow === 6) continue; // skip Sat/Sun
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     // Intended iOS weekly behavior: choose next occurrence of rssData.day from startDate, then +7 each time
//     const seedWeekly = async () => {
//       const targetDow = dayNameToIndex(rssData.day);
//       if (targetDow < 0) throw new Error(`Invalid rssData.day: ${rssData.day}`);

//       const startDow = functionalStartDate.getDay();
//       let diff = targetDow - startDow;
//       if (diff < 0) diff += 7;

//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter += 7) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + diff + counter);
//         if (d.getTime() > functionalEndDate.getTime()) break;
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     const seedBiWeekly = async () => {
//       // iOS biweekly: startDate + 0, +14, (+28 if within range)
//       let lastCreated = null;
//       for (let counter = 0; counter < daysBetween; counter += 14) {
//         const d = new Date(functionalStartDate);
//         d.setDate(d.getDate() + counter);
//         lastCreated = await uploadStop(d);
//       }
//       return lastCreated;
//     };

//     const seedMonthly = async () => {
//       // Fix iOS infinite loop: create startDate, then +1 month if still within window
//       let lastCreated = null;

//       const first = new Date(functionalStartDate);
//       if (first.getTime() <= functionalEndDate.getTime()) {
//         lastCreated = await uploadStop(first);
//       }

//       const second = new Date(functionalStartDate);
//       second.setMonth(second.getMonth() + 1);

//       if (second.getTime() <= functionalEndDate.getTime()) {
//         lastCreated = await uploadStop(second);
//       }

//       return lastCreated;
//     };

//     // ---- Dispatch ----
//     let lastCreated = null;
//     switch (String(rssData.frequency)) {
//       case "Daily":
//         lastCreated = await seedDaily();
//         break;
//       case "Week Day":
//         lastCreated = await seedWeekDay();
//         break;
//       case "Weekly":
//         lastCreated = await seedWeekly();
//         break;
//       case "Bi-Weekly":
//         lastCreated = await seedBiWeekly();
//         break;
//       case "Monthly":
//         lastCreated = await seedMonthly();
//         break;
//       case "Yearly":
//         // Not in iOS; seed within 4 weeks usually means just startDate if you want it.
//         // Keep as no-op unless you want otherwise.
//         lastCreated = null;
//         break;
//       default:
//         throw new Error(`Unsupported frequency: ${rssData.frequency}`);
//     }

//     // ---- Persist lastCreated consistently (recommended) ----
//     if (lastCreated) {

//       await recurringServiceStopDoc.update({ lastCreated });
//     }

//     // ---- Persist counter ----
//     await db.collection(SSIncrementCol).doc("serviceStops").set(
//       { increment: counterPush, category: "serviceStops" },
//       { merge: true }
//     );


//     //Call Update Recrurring Route.
//     updateRecurringRoute(db, companyId, rssData)

//     return {
//       status: 200,
//       rssId: rssData.id,
//       createdCount:
//         String(rssData.frequency) === "Daily"
//           ? daysBetween
//           : undefined, // optional: you can compute exact count if you want
//       lastCreated,
//     };
//   } catch (error) {
//     console.error("Error in createFirstRecurringServiceStop", error);
//     return { status: 500, error: error?.message ?? String(error) };
//   }
// });

async function updateRecurringRoute({ db, companyId, rss }) {
  try {
    // Match the same collection/fields used by handleSaveTemplate
    const querySnapshot = await db
      .collection("companies")
      .doc(companyId)
      .collection("recurringRoutes")
      .where("day", "==", rss.day)
      .where("techId", "==", rss.techId)
      .get();

    for (const routeDoc of querySnapshot.docs) {
      const documentData = routeDoc.data();
      const currentOrder = Array.isArray(documentData.order) ? documentData.order : [];

      // Avoid duplicate insertion if this RSS is already present
      const alreadyExists = currentOrder.some(
        (item) => item.recurringServiceStopId === rss.id
      );

      if (alreadyExists) {
        continue;
      }

      const addedOrder = {
        id: uuidv4(),
        order: currentOrder.length + 1,
        recurringServiceStopId: rss.id,
        customerId: rss.customerId,
        customerName: rss.customerName,
        locationId: rss.serviceLocationId,
      };

      const updatedOrder = [...currentOrder, addedOrder];

      const routeRef = db
        .collection("companies")
        .doc(companyId)
        .collection("recurringRoutes")
        .doc(routeDoc.id);

      await routeRef.update({
        order: updatedOrder,
      });
    }

    // Preserve your existing return behavior
    const routesSnap = await db
      .collection(ROUTES_COL(companyId))
      .where("rssIds", "array-contains", rss.id)
      .get();

    return routesSnap.docs;
  } catch (error) {
    console.log("Error updating recurring route:", error);
    throw error;
  }
}

exports.createFirstRecurringServiceStop = functions.https.onCall(async (data, context) => {

  console.log('create FirstRecurring ServiceStop')
  console.log(data)

  let weekdayArry = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
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

    let serviceDate = new Date()
    let date = new Date()
    let currentDayOfWeek = 0
    let serviceDayOfWeek = 0


    const SSIncrementCol = "companies/" + companyId + "/settings";
    const RSSCol = "companies/" + companyId + "/recurringServiceStop";
    const rssDocRef = "companies/" + companyId + "/recurringServiceStop";
    const docRef = "companies/" + companyId + "/serviceStops";

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

        await recurringServiceStopDoc.update({ lastCreated: date1 });


        for (let i = 0; i < 28; i++) {

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //

          serviceDate1.setDate(serviceDate1.getDate() + 1);


          console.log('Week Day ', weekdayArry[serviceDate1.getDay()])
          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({ lastCreated: serviceDate1 });

          const idss = 'com_ss_' + uuidv4()

          let serviceStop = {
            address: {
              city: rssData.address.city,
              state: rssData.address.state,
              streetAddress: rssData.address.streetAddress,
              zip: rssData.address.zip,
              latitude: rssData.address.latitude,
              longitude: rssData.address.longitude,
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
            type: rssData.type,
            typeId: rssData.typeId,
            typeImage: rssData.typeImage,
            jobId: "",
            jobName: "Cleaning - Update",
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings: true,
            includeDosages: true,
            contractedCompanyId: rssData.contractedCompanyId,
            laborContractId: rssData.laborContractId,
            otherCompany: rssData.otherCompany,

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

        await recurringServiceStopDoc.update({ lastCreated: date2 });


        for (let i = 0; i < 28; i++) {

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //

          serviceDate2.setDate(serviceDate2.getDate() + 1);

          if (serviceDate2.getDay() != 0 && serviceDate2.getDay() != 6) {

            console.log('Week Day ', weekdayArry[serviceDate2.getDay()])
            const newInternalId = "S" + String(counterPush + 1);

            counterPush = counterPush + 1;

            //
            //Update Recurring Service Stop with last Created Service Stop 
            //

            await recurringServiceStopDoc.update({ lastCreated: serviceDate2 });

            const idss = 'com_ss_' + uuidv4()

            let serviceStop = {
              address: {
                city: rssData.address.city,
                state: rssData.address.state,
                streetAddress: rssData.address.streetAddress,
                zip: rssData.address.zip,
                latitude: rssData.address.latitude,
                longitude: rssData.address.longitude,
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
              type: rssData.type,
              typeId: rssData.typeId,
              typeImage: rssData.typeImage,
              jobId: "",
              jobName: "Cleaning - Update",
              internalId: newInternalId,
              id: idss,
              checkList: [],
              includeReadings: true,
              includeDosages: true,
              contractedCompanyId: rssData.contractedCompanyId,
              laborContractId: rssData.laborContractId,
              otherCompany: rssData.otherCompany,

            }

            //
            //Uploading the service Stop
            //

            await getFirestore()
              .collection(docRef).doc(idss)
              .set(serviceStop);
          } else {
            console.log('Weekend  ', weekdayArry[serviceDate2.getDay()], ' - Skip')
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

        await recurringServiceStopDoc.update({ lastCreated: date });

        //
        //  Get Day of week represented as number 0 - 6 (Sunday - Saturday)
        //
        currentDayOfWeek = date.getDay();

        //
        //  Gets Service Day as number
        //
        serviceDayOfWeek = 0

        console.log('Switch')

        switch (rssData.day) {
          case 'Sunday':
            console.log('Sunday - ', rssData.day)
            serviceDayOfWeek = 0
            break;
          case 'Monday':
            console.log('Monday - ', rssData.day)
            serviceDayOfWeek = 1
            break;
          case 'Tuesday':
            console.log('Tuesday - ', rssData.day)
            serviceDayOfWeek = 2
            break;
          case 'Wednesday':
            console.log('Wednesday - ', rssData.day)
            serviceDayOfWeek = 3
            break;
          case 'Thursday':
            console.log('Thursday - ', rssData.day)
            serviceDayOfWeek = 4
            break;
          case 'Friday':
            console.log('Friday - ', rssData.day)
            serviceDayOfWeek = 5
            break;
          case 'Saturday':
            console.log('Saturday - ', rssData.day)
            serviceDayOfWeek = 6
            break;
          default:
            console.log('Default - ', rssData.day)
            serviceDayOfWeek = 6
            break;
        }

        for (let i = 0; i < 4; i++) {

          //
          //  Compare the two to determine how to create the first service stop. If the difference is negative that day of week has already passed and creating the service stops will start next week by adding 6
          //  if it is positive, add the difference to count which should create the service stop this week
          //
          let differenceInServiceDays = (serviceDayOfWeek + 1) - (currentDayOfWeek + 1)
          let amountToIncrease = 0

          if (differenceInServiceDays < 0) {

            amountToIncrease = differenceInServiceDays + 7
            // } else if (differenceInServiceDays == 0) {
            //   amountToIncrease = 0
          } else {
            amountToIncrease = differenceInServiceDays
          }

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          let amountToIncreaseThisWeek = (amountToIncrease + (i * 7))

          // serviceDate.setFullYear(year, month, day + amountToIncreaseThisWeek );
          let updatedDate = new Date()
          updatedDate.setDate(updatedDate.getDate() + amountToIncreaseThisWeek);
          serviceDate = updatedDate

          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;


          console.log('Service Day Of Week: ', weekdayArry[serviceDate.getDay()], ' - Service Date: ', serviceDate)

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({ lastCreated: serviceDate });


          const idss = 'com_ss_' + uuidv4()

          let serviceStop = {
            address: {
              city: rssData.address.city,
              state: rssData.address.state,
              streetAddress: rssData.address.streetAddress,
              zip: rssData.address.zip,
              latitude: rssData.address.latitude,
              longitude: rssData.address.longitude,
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
            type: rssData.type,
            typeId: rssData.typeId,
            typeImage: rssData.typeImage,
            jobId: "",
            jobName: "Cleaning - Update",
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings: true,
            includeDosages: true,
            contractedCompanyId: rssData.contractedCompanyId,
            laborContractId: rssData.laborContractId,
            otherCompany: rssData.otherCompany,

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

        await recurringServiceStopDoc.update({ lastCreated: date });

        //
        //  Get Day of week represented as number 0 - 6 (Sunday - Saturday)
        //
        currentDayOfWeek = date.getDay();

        //
        //  Gets Service Day as number
        //
        serviceDayOfWeek = 0

        console.log('Switch')

        switch (rssData.day) {
          case 'Sunday':
            console.log('Sunday - ', rssData.day)
            serviceDayOfWeek = 0
            break;
          case 'Monday':
            console.log('Monday - ', rssData.day)
            serviceDayOfWeek = 1
            break;
          case 'Tuesday':
            console.log('Tuesday - ', rssData.day)
            serviceDayOfWeek = 2
            break;
          case 'Wednesday':
            console.log('Wednesday - ', rssData.day)
            serviceDayOfWeek = 3
            break;
          case 'Thursday':
            console.log('Thursday - ', rssData.day)
            serviceDayOfWeek = 4
            break;
          case 'Friday':
            console.log('Friday - ', rssData.day)
            serviceDayOfWeek = 5
            break;
          case 'Saturday':
            console.log('Saturday - ', rssData.day)
            serviceDayOfWeek = 6
            break;
          default:
            console.log('Default - ', rssData.day)
            serviceDayOfWeek = 6
            break;
        }

        for (let i = 0; i < 4; i++) {

          //
          //  Compare the two to determine how to create the first service stop. If the difference is negative that day of week has already passed and creating the service stops will start next week by adding 6
          //  if it is positive, add the difference to count which should create the service stop this week
          //
          let differenceInServiceDays = (serviceDayOfWeek + 1) - (currentDayOfWeek + 1)
          let amountToIncrease = 0

          if (differenceInServiceDays < 0) {

            amountToIncrease = differenceInServiceDays + 7
            // } else if (differenceInServiceDays == 0) {
            //   amountToIncrease = 0
          } else {
            amountToIncrease = differenceInServiceDays
          }

          //
          // Amount to crease to create Service stops for the first 4 weeks
          //
          let amountToIncreaseThisWeek = (amountToIncrease + (i * 14))

          // serviceDate.setFullYear(year, month, day + amountToIncreaseThisWeek );
          let updatedDate = new Date()
          updatedDate.setDate(updatedDate.getDate() + amountToIncreaseThisWeek);
          serviceDate = updatedDate

          const newInternalId = "S" + String(counterPush + 1);

          counterPush = counterPush + 1;


          console.log('Service Day Of Week - Check - ', weekdayArry[serviceDate.getDay()], ' ', serviceDate)
          console.log()

          //
          //Update Recurring Service Stop with last Created Service Stop 
          //

          await recurringServiceStopDoc.update({ lastCreated: serviceDate });


          const idss = 'com_ss_' + uuidv4()

          let serviceStop = {
            address: {
              city: rssData.address.city,
              state: rssData.address.state,
              streetAddress: rssData.address.streetAddress,
              zip: rssData.address.zip,
              latitude: rssData.address.latitude,
              longitude: rssData.address.longitude,
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
            type: rssData.type,
            typeId: rssData.typeId,
            typeImage: rssData.typeImage,
            jobId: "",
            jobName: "Cleaning - Update",
            internalId: newInternalId,
            id: idss,
            checkList: [],
            includeReadings: true,
            includeDosages: true,
            contractedCompanyId: rssData.contractedCompanyId,
            laborContractId: rssData.laborContractId,
            otherCompany: rssData.otherCompany,

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

exports.deleteUser = functions.https.onCall(async (data, context) => {
  try {
    console.log('Deleting User NOt Up and running')
  } catch {
    console.log(error)
  }
})

exports.createCompanyAfterSignUp = functions.https.onCall(async (data, context) => {
  /*
  Should Receive User Id, Company Name, Owner Name
  */

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
  const companyId = 'com_' + uuidv4()
  try {
    //Body Of function

    //Create Company
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
      yelpURL: "",
      websiteURL: ""

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
    //Pay Statements
    const PayStatementsIncrement = { category: "payStatements", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("payStatements").set(PayStatementsIncrement);
    //Pay Line Items
    const PayLineItemsIncrement = { category: "payLineItems", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("payLineItems").set(PayLineItemsIncrement);
    //Payroll Settings
    const CompanyPaySettings = {
      companyId: companyId,
      payMode: "productionOnly",
      routePaySource: "serviceStopAndCompletedTasks",
      taskPaySource: "technicianRateThenTaskContractedRate",
      hourlyPaySource: "none",
      allowMultipleWorkTypesPerStop: true,
      defaultStackBehavior: "stackable",
      allowTechnicianRateOverrides: true,
      allowManualPayAdjustments: false,
      payCommercialAsSeparateWorkType: true,
      paySpaAsSeparateWorkType: true,
      payPerBodyOfWater: true,
      commercialMultiBodyPayStyle: "basePlusAdditionalBodyRate",
      lockPayAfterApproval: true,
      recalculateUnapprovedPayWhenRatesChange: true
    }
    await getFirestore().collection("companies").doc(companyId).collection("paySettings").doc("main").set(CompanyPaySettings);
    //WO
    const WOIncrement = { category: "workOrders", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("workOrders").set(WOIncrement);

    //SS
    const SSIncrement = { category: "serviceStops", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("serviceStops").set(SSIncrement);

    //RSS
    const RIncrement = { category: "receipts", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("receipts").set(RIncrement);

    //Route
    const RountIncrement = { category: "recurringServiceStops", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("recurringServiceStops").set(RountIncrement);

    // Vendor
    const StoreIncrement = { category: "vendors", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("vendors").set(StoreIncrement);

    //To Do
    const ToDoIncrement = { category: "toDos", increment: 0 }
    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("toDos").set(ToDoIncrement);
    console.log("Finished Creating Company Settings")

    // Create initial work-order settings, readings, and dosages.
    // Reusable job templates live at companies/{companyId}/jobTemplates.
    // Internal work-order identifiers/increments live under settings/workOrders.

    //Initial Service Stops 
    // "companies/\(companyId)/settings/serviceStops/serviceStops"

    //Inital Readings
    console.log("Initial Reading Template Created")

    //Get Universal Readings Templates "universal/settings/readingTemplates
    await getFirestore()
      .collection("universal")
      .doc("settings")
      .collection("readingTemplates")
      .get().then((querySnapshot) => {
        querySnapshot.forEach(async (doc) => {
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
    console.log("Initial Dosage Template Created")

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
        console.log("Error getting Universal Dosages documents: ", error);
      });

    //Create Generic Billing Templates
    //Create Generic Training Templates

    //Creat first set of task groups
    console.log("Initial Task Group Created")
    const taskList = [
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Brush",
        description: "Brush pool surface",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Skim",
        description: "Skim pool surface",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Vacuum",
        description: "Vacuum pool surface",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Empty Baskets",
        description: "Empty skimmer and pump baskets",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
      ,
      {
        id: 'com_set_tg_tas_' + uuidv4(),
        name: "Check Equipment",
        description: "Check equipment",
        typeId: "univ_tt_XN5ZMDfEiqGfFiCYoZWr",
        type: "Clean",
        contractedRate: 0,
        estimatedTime: 0,
      }
    ]

    console.log("Number of tasks: ", taskList.length)
    const groupId = 'com_set_tg_recurring_service_stops'

    await getFirestore().collection("companies").doc(companyId).collection("settings").doc("taskGroups").collection("taskGroups").doc(groupId).set({
      id: groupId,
      groupName: "Weekly Service",
      numberOfTasks: taskList.length,
      canDelete: false,
    });

    console.log("Add Tasks to Task Group")
    //Add Tasks to Task Group
    for (let i = 0; i < taskList.length; i++) {
      let task = taskList[i];
      console.log("Tasks:", task.id, " => ", task);
      await getFirestore().collection("companies").doc(companyId).collection("settings").doc("taskGroups").collection("taskGroups").doc(groupId).collection("taskItems").doc(task.id).set({
        id: task.id,
        name: task.name,
        description: task.description,
        typeId: task.typeId,
        type: task.type,
        contractedRate: task.contractedRate,
        estimatedTime: task.estimatedTime,
      });
    }
    //Create Generic Roles

    let ownerRole = {
      id: "1",
      name: "Owner",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "All Permissions Enabled"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(ownerRole.id).set(ownerRole);
    console.log("Role Created =>", ownerRole)

    let techRole = {
      id: "comp_role_" + uuidv4(),
      name: "Tech",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Techs"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(techRole.id).set(techRole);
    console.log("Role Created =>", techRole)

    let managerRole = {
      id: "comp_role_" + uuidv4(),
      name: "Manager",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Manager"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(managerRole.id).set(managerRole);
    console.log("Role Created =>", managerRole)

    let adminRole = {
      id: "comp_role_" + uuidv4(),
      name: "Admin",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Admin"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(adminRole.id).set(adminRole);
    console.log("Role Created =>", adminRole)

    let officeRole = {
      id: "comp_role_" + uuidv4(),
      name: "Office",
      permissionIdList: [
        "0", "10", "12", "14", "16", "20", "22", "24", "26", "30", "32", "34", "36",
        "40", "42", "44", "46", "50", "52", "54", "56", "60", "62", "64", "66",
        "200", "210", "220", "230", "232", "234", "236", "240", "242", "244", "246",
        "250", "252", "254", "256", "260", "262", "264", "266", "280", "282", "284", "286",
        "290", "292", "294", "296",
        "400", "410", "412", "414", "416",
        "600", "610", "612", "614", "616", "620", "622", "624", "626",
        "800", "810", "812", "814", "816", "820", "822", "824", "826", "830", "832", "834", "836",
        "840", "842", "844", "846", "850", "852", "854", "856", "860", "862", "864", "866",
        "870", "872", "874", "876", "880", "882", "884", "886",
        "890", "892", "894", "896"
      ],
      listOfUserIdsToManage: [],
      color: "red",
      description: "Basic Permissions For Office Personal"
    }
    await getFirestore().collection("companies").doc(companyId).collection("roles").doc(officeRole.id).set(officeRole);
    console.log("Role Created =>", officeRole)

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
      emailBody: "Thank you For letting " + companyName + " service your pool",
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
    console.log('account: ', account)

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
        querySnapshot.forEach(async (doc) => {
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
            status: "active",
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
    );

    console.error(
      error
    );

    //Delete Company
    await getFirestore()
      .collection("companies")
      .doc(companyId)
      .delete()

    return {
      status: 500,
      error: error.message
    };
  }
});

exports.updateCompanyHistory = functions.https.onCall(async (data, context) => {
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
exports.createCompanyAdminNotes = functions.https.onCall(async (data, context) => {
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

exports.acceptLinkedInvite = functions.https.onCall(async (data, context) => {

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

exports.acceptTechInvite = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const inviteId = payload.inviteId;
    const requestedUserId = payload.userId;
    const authUserId = context.auth?.uid;
    const userId = requestedUserId || authUserId;
    const profile = payload.profile || {};

    if (!authUserId) {
      return {
        status: 401,
        error: "You must be signed in to accept an invite"
      };
    }

    if (!inviteId || !userId) {
      return {
        status: 400,
        error: "Missing inviteId or userId"
      };
    }

    if (authUserId !== userId) {
      return {
        status: 403,
        error: "Authenticated user does not match invite user"
      };
    }

    const db = getFirestore();
    const inviteRef = db.collection("invites").doc(inviteId);
    const inviteSnap = await inviteRef.get();

    if (!inviteSnap.exists) {
      return {
        status: 404,
        error: "No Invite Found"
      };
    }

    const invite = inviteSnap.data();
    const status = String(invite.status || "").toLowerCase();

    if (status !== "pending") {
      return {
        status: 409,
        error: "Invite Already Accepted"
      };
    }

    if (invite.userId && invite.userId !== userId) {
      return {
        status: 403,
        error: "Invite is assigned to a different user"
      };
    }

    const authEmail = context.auth?.token?.email?.toLowerCase();
    const inviteEmail = invite.email?.toLowerCase();

    if (authEmail && inviteEmail && authEmail !== inviteEmail) {
      return {
        status: 403,
        error: "Authenticated email does not match invite email"
      };
    }

    const acceptedStatus = invite.status === "Pending" ? "Accepted" : "accepted";
    const now = admin.firestore.FieldValue.serverTimestamp();
    const fullName = `${profile.firstName || invite.firstName || ""} ${profile.lastName || invite.lastName || ""}`.trim();
    const workerType = invite.workerType || "Employee";
    const batch = db.batch();

    if (profile.email || invite.email) {
      const userRef = db.collection("users").doc(userId);
      batch.set(userRef, {
        id: userId,
        email: profile.email || invite.email,
        firstName: profile.firstName || invite.firstName || "",
        lastName: profile.lastName || invite.lastName || "",
        accountType: profile.accountType || "Company",
        photoUrl: profile.photoUrl || null,
        profileImagePath: profile.profileImagePath || null,
        color: profile.color || null,
        bio: profile.bio || "",
        exp: profile.exp || 0,
        dateCreated: now,
      }, { merge: true });
    }

    const companyUserRef = db
      .collection("companies")
      .doc(invite.companyId)
      .collection("companyUsers")
      .doc(userId);

    batch.set(companyUserRef, {
      id: userId,
      userId: userId,
      userName: fullName || invite.email || userId,
      roleId: invite.roleId,
      roleName: invite.roleName,
      dateCreated: now,
      status: "Active",
      workerType: workerType,
      linkedCompanyId: invite.linkedCompanyId || null,
      linkedCompanyName: invite.linkedCompanyName || null,
    }, { merge: true });

    const userAccessRef = db
      .collection("users")
      .doc(userId)
      .collection("userAccess")
      .doc(invite.companyId);

    batch.set(userAccessRef, {
      id: invite.companyId,
      companyId: invite.companyId,
      companyName: invite.companyName,
      roleId: invite.roleId,
      roleName: invite.roleName,
      dateCreated: now,
    }, { merge: true });

    batch.update(inviteRef, {
      status: acceptedStatus,
      userId: userId,
      acceptedAt: now,
    });

    await batch.commit();

    return {
      status: 200,
      inviteId: inviteId,
      userId: userId,
      companyId: invite.companyId,
      account: "Successfully Accepted"
    };
  } catch (error) {
    console.error(
      "An error occurred when calling the Accept Tech Invite API",
      error
    );
    return {
      status: 500,
      error: error.message
    };
  }
});

exports.migrateLegacyVendorsToCanonical = functions.https.onCall(async (data, context) => {
  try {
    const payload = data?.data ?? data ?? {};
    const companyId = payload.companyId;
    const dryRun = Boolean(payload.dryRun);
    const deleteLegacy = Boolean(payload.deleteLegacy);
    const authUserId = context.auth?.uid;

    if (!authUserId) {
      return { status: 401, error: "You must be signed in to migrate vendors." };
    }

    if (!companyId) {
      return { status: 400, error: "Missing companyId." };
    }

    const db = getFirestore();
    const userSnap = await db.collection("users").doc(authUserId).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isCompanyUser = userData.accountType === "Company" && userData.recentlySelectedCompany === companyId;
    const isAdmin = userData.accountType === "Admin";

    if (!isCompanyUser && !isAdmin) {
      return { status: 403, error: "You do not have permission to migrate this company's vendors." };
    }

    const legacyRef = db.collection("companies").doc(companyId).collection("settings").doc("venders").collection("vender");
    const canonicalRef = db.collection("companies").doc(companyId).collection("settings").doc("vendors").collection("vendor");
    const legacySnap = await legacyRef.get();

    let copied = 0;
    let skipped = 0;
    let deleted = 0;
    const preview = [];
    let batch = db.batch();
    let writes = 0;

    const commitIfNeeded = async (force = false) => {
      if (!dryRun && writes > 0 && (force || writes >= 400)) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    };

    for (const legacyDoc of legacySnap.docs) {
      const legacyData = legacyDoc.data();
      const canonicalId = legacyData.id || legacyDoc.id;
      const canonicalDocRef = canonicalRef.doc(canonicalId);
      const canonicalSnap = await canonicalDocRef.get();

      if (canonicalSnap.exists) {
        skipped += 1;
        continue;
      }

      const nextVendor = {
        ...legacyData,
        id: canonicalId,
        migratedFromLegacyVendorPath: true,
        legacyVendorDocId: legacyDoc.id,
        migratedAt: new Date(),
        migratedByUserId: authUserId,
      };

      copied += 1;
      if (preview.length < 20) {
        preview.push({ id: canonicalId, name: nextVendor.name || "" });
      }

      if (!dryRun) {
        batch.set(canonicalDocRef, nextVendor, { merge: true });
        writes += 1;

        if (deleteLegacy) {
          batch.delete(legacyDoc.ref);
          writes += 1;
          deleted += 1;
        }

        await commitIfNeeded();
      }
    }

    await commitIfNeeded(true);

    if (!dryRun) {
      await db.collection("companies").doc(companyId).collection("settings").doc("vendors").set({
        category: "vendors",
        migratedFromLegacyVendorsAt: new Date(),
        migratedFromLegacyVendorsByUserId: authUserId,
      }, { merge: true });
    }

    return {
      status: 200,
      copied,
      skipped,
      deleted,
      dryRun,
      deleteLegacy,
      preview,
    };
  } catch (error) {
    console.error("Error migrating legacy vendors:", error);
    return { status: 500, error: error.message || "Could not migrate vendors." };
  }
});

exports.updateServiceStopDayPermanently = functions.https.onCall(async (data, context) => {

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
    let difference = newDayOfWeek - currentDayOfWeek
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
            techId: newTech.userId,
            tech: newTech.userName
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
      updateRSSAndNextWeek(companyId, serviceStopList[i], newDay, newDayOfWeek, newTech)
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
  let differenceInDays = newDayOfWeek - currentDayOfWeek
  let nextSunday = new Date()

  nextSunday.setDate(nextSunday.getDate() + 7 - currentDayOfWeek);

  const rssRef = db
    .collection(`companies/${companyId}/recurringServiceStop`)
    .doc(stop.recurringServiceStopId);

  //Get all future SS Data to update of service stops that share the same RSS ID. 
  serviceStopsCol
    .where("recurringServiceStopId", "==", stop.recurringServiceStopId)
    .where("serviceDate", ">=", nextSunday)
    .get().then((querySnapshot) => {
      querySnapshot.forEach(async (doc) => {
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
          techId: newUserData.userId,
          tech: newUserData.userName
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
    techId: newUserData.userId,
    tech: newUserData.userName
  });
  //Update Recurring Routes?
}

//a Test Function
exports.updateCompanyReadingsSettings = functions.https.onCall(async (data, context) => {
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
        querySnapshot.forEach(async (doc) => {
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


exports.updateRecurringRouteOrderPermanently = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let routeId = receivedData.routeId
  let recurringRouteOrder = receivedData.recurringRouteOrder
  let serviceStopOrders = receivedData.serviceStopOrders

  if (!routeId) {
    throw new functions.https.HttpsError("invalid-argument", "routeId required");
  }

  const routeRef = db.collection("companies", companyId, "recurringRoute").doc(routeId);
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

exports.createHomeOwnerCustomerBasedOnCompany = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let companyName = receivedData.companyName
  let customerId = receivedData.customerId
  let homeownerId = receivedData.homeownerId
  console.log("companyId ", companyId)
  console.log("companyName ", companyName)
  console.log("customerId ", customerId)
  console.log("homeownerId ", homeownerId)

  //Get all customers

  //get all locations
  await getFirestore()
    .collection("companies")
    .doc(companyId)
    .collection("serviceLocations")
    .where("customerId", "==", customerId)
    .get().then((querySnapshot) => {
      querySnapshot.forEach(async (doc) => {
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
            querySnapshot2.forEach(async (doc2) => {
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
                  querySnapshot3.forEach(async (doc3) => {
                    console.log("Equipment:", doc3.id, " => ", doc3.data());
                    let equipmentData = doc3.data()

                    //Create Equipment
                    let hoEquId = 'hoequ_' + uuidv4()
                    let newEquipment = {
                      id: hoEquId,
                      serviceLocationId: hoslId,
                      bodyOfWaterId: hobowId,
                      homeownerId: user.uid,
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
                    await getFirestore().collection("homeownerEquipment").doc(hoEquId).set(newEquipment);

                  });
                })
                .catch((error) => {
                  console.log("Error getting Universal Readings documents: ", error);
                });
              //Create New BOW
              let newBOW = {
                id: hobowId,
                homeownerId: user.uid,
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
              await getFirestore().collection("homeownerBodiesOfWater").doc(hobowId).set(newBOW);

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

          homeownerId: user.uid, //Instead of customerId
          verified: true,
          linkedCompanyId: companyId,
          linkedCompanyName: companyName,
          linkedLocationId: documentData.id,
        }
        //companies/\(companyId)/settings/readings/readings
        await getFirestore().collection("homeownerServiceLocations").doc(hoslId).set(newServiceLocation);

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

exports.makeUpdatesToRecurringRoutes = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyUserId
  console.log("companyId ", companyId)

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
  const RECURRING_STOPS_COL = `companies/${companyId}/recurringServiceStop`;

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

  // 3) Get the recurring template doc before deleting it.
  // We need this data for removeRSSFromRecurringRoute.
  const recurringRef = db.collection(RECURRING_STOPS_COL).doc(stopId);
  const recurringSnap = await recurringRef.get();

  if (!recurringSnap.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "Recurring service stop was not found."
    );
  }

  const rss = {
    id: recurringSnap.id,
    ...recurringSnap.data(),
  };

  // 4) Remove RSS from recurring routes before deleting the template.
  await removeRSSFromRecurringRoute({ db, companyId, rss });

  // 5) Delete the recurring template doc.
  await recurringRef.delete();
  return {
    success: true,
    count: totalDeleted,
  };
});


async function removeRSSFromRecurringRoute({ db, companyId, rss }) {
  try {
    // Match the same collection/fields used by handleSaveTemplate
    const ROUTES_COL = `companies/${companyId}/recurringRoutes`;

    const querySnapshot = await db
      .collection(ROUTES_COL)
      .where("day", "==", rss.day)
      .where("techId", "==", rss.techId)
      .get();

    for (const routeDoc of querySnapshot.docs) {
      const documentData = routeDoc.data();
      const currentOrder = Array.isArray(documentData.order) ? documentData.order : [];

      const filteredOrder = currentOrder.filter(
        (item) => item.recurringServiceStopId !== rss.id
      );

      // Re-index order to keep it aligned with handleSaveTemplate
      const updatedOrder = filteredOrder.map((item, index) => ({
        ...item,
        order: index + 1,
      }));

      const routeRef = db
        .collection("companies")
        .doc(companyId)
        .collection("recurringRoutes")
        .doc(routeDoc.id);

      await routeRef.update({
        order: updatedOrder,
      });
    }

    // Preserve your existing return behavior
    const routesSnap = await db
      .collection(ROUTES_COL)
      .where("rssIds", "array-contains", rss.id)
      .get();

    return routesSnap.docs;
  } catch (error) {
    console.log("Error removing RSS from recurring route:", error);
    throw error;
  }
}



exports.endRecurringServiceStop = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data
  let companyId = receivedData.companyId
  let stopId = receivedData.stopId
  console.log("companyId ", companyId)
  console.log("stopId ", stopId)




  return {
    success: true,
    count: finalRecurring.length
  };
});


exports.updateRecurringServiceStop = functions.https.onCall(async (data, context) => {
  const db = getFirestore();

  let receivedData = data.data;

  const companyId = receivedData.companyId;
  const recurringServiceStop = receivedData.recurringServiceStop;

  if (!companyId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "companyId is required."
    );
  }

  if (!recurringServiceStop || !recurringServiceStop.id) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "recurringServiceStop with a valid id is required."
    );
  }

  const companyRef = db.collection("companies").doc(companyId);

  const recurringServiceStopRef = companyRef
    .collection("recurringServiceStop")
    .doc(recurringServiceStop.id);

  const serviceStopsRef = companyRef.collection("serviceStops");

  function removeUndefinedValues(obj) {
    const cleaned = {};

    Object.keys(obj).forEach((key) => {
      if (obj[key] !== undefined) {
        cleaned[key] = obj[key];
      }
    });

    return cleaned;
  }

  function toFirestoreTimestamp(value) {
    if (value === undefined || value === null) {
      return null;
    }

    if (value && typeof value.toDate === "function") {
      return value;
    }

    if (value instanceof Date) {
      return admin.firestore.Timestamp.fromDate(value);
    }

    if (typeof value === "string") {
      const parsedDate = new Date(value);

      if (!isNaN(parsedDate.getTime())) {
        return admin.firestore.Timestamp.fromDate(parsedDate);
      }
    }

    if (typeof value === "number") {
      return admin.firestore.Timestamp.fromMillis(value);
    }

    if (typeof value === "object") {
      if (
        typeof value._seconds === "number" &&
        typeof value._nanoseconds === "number"
      ) {
        return new admin.firestore.Timestamp(value._seconds, value._nanoseconds);
      }

      if (
        typeof value.seconds === "number" &&
        typeof value.nanoseconds === "number"
      ) {
        return new admin.firestore.Timestamp(value.seconds, value.nanoseconds);
      }

      if (typeof value.seconds === "number") {
        return new admin.firestore.Timestamp(value.seconds, 0);
      }
    }

    return value;
  }

  function normalizeRecurringServiceStopForFirestore(rss) {
    return removeUndefinedValues({
      id: rss.id,
      internalId: rss.internalId,
      type: rss.type,
      typeId: rss.typeId,
      typeImage: rss.typeImage,
      customerName: rss.customerName,
      customerId: rss.customerId,
      address: rss.address,

      tech: rss.tech,
      techId: rss.techId,

      dateCreated: toFirestoreTimestamp(rss.dateCreated),
      startDate: toFirestoreTimestamp(rss.startDate),
      endDate: rss.noEndDate ? null : toFirestoreTimestamp(rss.endDate),
      noEndDate: rss.noEndDate,

      frequency: rss.frequency,
      day: rss.day,
      description: rss.description,

      lastCreated: toFirestoreTimestamp(rss.lastCreated),
      serviceLocationId: rss.serviceLocationId,
      estimatedTime: rss.estimatedTime,

      otherCompany: rss.otherCompany,
      laborContractId: rss.laborContractId ?? null,
      contractedCompanyId: rss.contractedCompanyId ?? null,
      mainCompanyId: rss.mainCompanyId ?? null,

      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  function buildServiceStopPatch(rss) {
    return removeUndefinedValues({
      tech: rss.tech,
      techId: rss.techId,
      description: rss.description,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  async function commitInBatches(writeOperations) {
    const batchSize = 450;
    let committedWrites = 0;

    for (let i = 0; i < writeOperations.length; i += batchSize) {
      const batch = db.batch();
      const chunk = writeOperations.slice(i, i + batchSize);

      chunk.forEach((operation) => {
        if (operation.type === "set") {
          batch.set(operation.ref, operation.data, operation.options || {});
        }

        if (operation.type === "update") {
          batch.update(operation.ref, operation.data);
        }
      });

      await batch.commit();
      committedWrites += chunk.length;
    }

    return committedWrites;
  }

  try {
    const existingRecurringSnap = await recurringServiceStopRef.get();

    if (!existingRecurringSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Recurring service stop was not found."
      );
    }

    const previousRSS = {
      id: existingRecurringSnap.id,
      ...existingRecurringSnap.data()
    };

    const normalizedRecurringServiceStop =
      normalizeRecurringServiceStopForFirestore(recurringServiceStop);

    const serviceStopPatch = buildServiceStopPatch(recurringServiceStop);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

    const futureServiceStopsSnapshot = await serviceStopsRef
      .where("recurringServiceStopId", "==", recurringServiceStop.id)
      .where("serviceDate", ">=", todayTimestamp)
      .get();

    const writeOperations = [];

    writeOperations.push({
      type: "set",
      ref: recurringServiceStopRef,
      data: normalizedRecurringServiceStop,
      options: { merge: true }
    });

    futureServiceStopsSnapshot.docs.forEach((serviceStopDoc) => {
      writeOperations.push({
        type: "update",
        ref: serviceStopDoc.ref,
        data: serviceStopPatch
      });
    });

    const committedWrites = await commitInBatches(writeOperations);

    const recurringRouteResult = await updateRecurringRouteOrderForRSS({
      db,
      companyId,
      previousRSS,
      updatedRSS: recurringServiceStop
    });

    return {
      success: true,
      recurringServiceStopId: recurringServiceStop.id,
      updatedServiceStopCount: futureServiceStopsSnapshot.size,
      committedWrites: committedWrites,
      recurringRouteResult: recurringRouteResult
    };
  } catch (error) {
    console.error("[updateRecurringServiceStop] Error:", error);

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Unable to update recurring service stop."
    );
  }
});
async function updateRecurringRouteOrderForRSS({
  db,
  companyId,
  previousRSS,
  updatedRSS
}) {
  const recurringRoutesRef = db
    .collection("companies")
    .doc(companyId)
    .collection("recurringRoutes");

  const rssId = updatedRSS.id;

  if (!rssId) {
    throw new Error("Missing updatedRSS.id.");
  }

  const updatedDay = updatedRSS.day;
  const updatedTech = updatedRSS.tech;
  const updatedTechId = updatedRSS.techId;

  if (!updatedDay || !updatedTechId) {
    console.log("[updateRecurringRouteOrderForRSS] Missing day or techId. Skipping route update.", {
      rssId,
      updatedDay,
      updatedTechId
    });

    return {
      skipped: true,
      reason: "Missing day or techId."
    };
  }

  const previousDay = previousRSS?.day;
  const previousTechId = previousRSS?.techId;

  const routeChanged =
    previousDay !== updatedDay ||
    previousTechId !== updatedTechId;

  const updatedOrderItem = {
    id: rssId,
    recurringServiceStopId: rssId,
    customerId: updatedRSS.customerId,
    customerName: updatedRSS.customerName,
    locationId: updatedRSS.serviceLocationId,
    order: 0
  };

  let removedFromRouteIds = [];
  let updatedRouteId = null;
  let createdRouteId = null;

  // 1) Remove this RSS from every route where it currently appears.
  // This prevents duplicates and handles day/tech moves cleanly.
  const allRoutesSnap = await recurringRoutesRef.get();

  for (const routeDoc of allRoutesSnap.docs) {
    const routeData = routeDoc.data();

    const currentOrder = Array.isArray(routeData.order)
      ? routeData.order
      : [];

    const filteredOrder = currentOrder.filter((item) => {
      return item.recurringServiceStopId !== rssId;
    });

    if (filteredOrder.length !== currentOrder.length) {
      const reIndexedOrder = filteredOrder.map((item, index) => ({
        ...item,
        order: index + 1
      }));

      await routeDoc.ref.update({
        order: reIndexedOrder,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      removedFromRouteIds.push(routeDoc.id);
    }
  }

  // 2) Find the destination route: same day + techId as the updated RSS.
  const destinationRoutesSnap = await recurringRoutesRef
    .where("day", "==", updatedDay)
    .where("techId", "==", updatedTechId)
    .limit(1)
    .get();

  // 3) If destination route exists, add this RSS at the end.
  if (!destinationRoutesSnap.empty) {
    const routeDoc = destinationRoutesSnap.docs[0];
    const routeData = routeDoc.data();

    const currentOrder = Array.isArray(routeData.order)
      ? routeData.order
      : [];

    const nextOrder = [
      ...currentOrder,
      {
        ...updatedOrderItem,
        order: currentOrder.length + 1
      }
    ].map((item, index) => ({
      ...item,
      order: index + 1
    }));

    await routeDoc.ref.update({
      tech: updatedTech,
      techId: updatedTechId,
      day: updatedDay,
      order: nextOrder,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    updatedRouteId = routeDoc.id;
  }

  // 4) If destination route does not exist, create it.
  else {
    const newRouteRef = recurringRoutesRef.doc();

    await newRouteRef.set({
      id: newRouteRef.id,
      tech: updatedTech,
      techId: updatedTechId,
      day: updatedDay,
      description: "",
      order: [
        {
          ...updatedOrderItem,
          order: 1
        }
      ],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    createdRouteId = newRouteRef.id;
  }

  return {
    skipped: false,
    routeChanged,
    removedFromRouteIds,
    updatedRouteId,
    createdRouteId
  };
}
