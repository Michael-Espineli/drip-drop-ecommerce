const express = require("express");
const app = express();
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions/v2");

const stripe = require("stripe")(
  // This is your test secret API key.
  'sk_test_51P39vqAUNYvyj1aErKQhqLs42NbZ6ULG34noYN0EP8knF8TcS9DlFVkMvV6p1KFYuSaInhxU16MWWnJEHIkrioFd00KbIw3ogl',
  {
    apiVersion: "2023-10-16",
  }
);
//Callable Functions

//Express Functions


// app.use(express.static("dist"));
// app.use(express.json());


// app.post("/account_link", async (req, res) => {
//   try {
//     const { account } = req.body;

//     const accountLink = await stripe.accountLinks.create({
//       account: account,
//       return_url: `${req.headers.origin}/return/${account}`,
//       refresh_url: `${req.headers.origin}/refresh/${account}`,
//       type: "account_onboarding",
//     });

//     res.json(accountLink);
//   } catch (error) {
//     console.error(
//       "An error occurred when calling the Stripe API to create an account link:",
//       error
//     );
//     res.status(500);
//     res.send({ error: error.message });
//   }
// });

// app.post("/account", async (req, res) => {
//   try {
//     const account = await stripe.accounts.create({
//       controller: {
//         stripe_dashboard: {
//           type: "none",
//         },
//       },
//       capabilities: {
//         card_payments: {requested: true},
//         transfers: {requested: true}
//       },
//       country: "US",
//     });

//     res.json({
//       account: account.id,
//     });
//   } catch (error) {
//     console.error(
//       "An error occurred when calling the Stripe API to create an account",
//       error
//     );
//     res.status(500);
//     res.send({ error: error.message });
//   }
// });

// app.get("/*", (_req, res) => {
//   res.sendFile(__dirname + "/dist/index.html");
// });

// app.listen(4242, () => console.log("Node server listening on port 4242! Visit http://localhost:4242 in your browser."));

// exports.widgets = onRequest(app);
