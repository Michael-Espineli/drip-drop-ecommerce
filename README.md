# Getting Started with Drip Drop

## Environments

The Firebase CLI project and the React app Firebase config are separate.

For local development against the development Firebase project:

```sh
npm run start:dev
```

For local development against the Firebase emulators:

```sh
npm run test:emulate
```

For a production-optimized build that still uses the development Firebase project:

```sh
npm run build:dev
```

To deploy the development website and functions to `the-pool-app-dev`:

```sh
npm run deploy:dev
```

For production:

```sh
npm run deploy:prod
```

`firebase use development` only changes which Firebase project CLI commands target. It does not change the Firebase config baked into the React browser bundle.

## Public repair requests

Share `/request-repair/<companyId>` with technicians from the external technician repair form panel on the company Repair Requests or Create Internal Repair Request page. `/public/repair-request/<companyId>` is an alias. This is separate from the homeowner `/request-service/<companyId>` intake.

Technicians select their name from active company users and select an existing customer. Service location, body of water, equipment, and equipment status follow the internal repair form. They can describe the issue and attach up to three JPG/PNG/WebP photos without creating an account. Each photo can be up to 2 MB, with a 5 MB combined limit. Requests appear in **External Requests** and retain company-side customer, equipment, and location links.

`getPublicRepairRequestCompany` exposes company details and only IDs/display names for active users and customers. `getPublicRepairRequestOptions` exposes display names for the selected customer's locations and their pools/equipment. It excludes emails, phone numbers, access codes, billing data, and private notes. Anyone with the company form link can use these pickers. Setting `publicRepairRequestsDisabled: true` on the company disables this form; deleted companies and companies with `publicProfileDisabled: true` are also unavailable.

`submitPublicRepairRequest` validates that the technician is still active and all selections belong to the company/customer/location. It resolves names server-side, rate limits submissions, uploads photos, and writes to `companies/<companyId>/repairRequests` with source `publicTechnician`. An optional equipment status update is committed with the request. Selecting a technician attributes the request to that person but does not verify identity; `requesterIdentityVerified` is false and `userId` remains blank. Firestore and Storage rules still deny anonymous direct access. The existing company repair notification workflow uses the same alert ID as the submission.

Deploy all three new functions before deploying the frontend. The normal `deploy:dev` and `deploy:prod` scripts include the functions and frontend; the hosting-only GitHub workflow does not deploy functions.

Focused checks:

```sh
CI=true npm run test:ci -- --runInBand src/views/public/PublicRepairRequest.test.jsx
firebase emulators:exec --only firestore --project demo-public-repair-requests "node --test functions/publicRepairRequests.test.js"
```

## Desktop sizing

At viewport widths of 1024px and above, the shared styles in `src/index.css` use an 80% root font size so desktop text, controls, and spacing are more compact at 100% browser zoom. Navigation widths and header clearance use rem units to scale with the content. Mobile/tablet and print sizing retain their normal scale.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
