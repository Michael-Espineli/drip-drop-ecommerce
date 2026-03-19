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
const db = admin.firestore(); 


//Callable Functions

//Express Functions



