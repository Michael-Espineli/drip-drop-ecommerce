#!/usr/bin/env node
// CRA uses NODE_ENV=production for every build; load only the development
// publishable key explicitly when building hosting for the development project.
const fs=require('node:fs'),path=require('node:path');
const dotenv=require('dotenv');
const file=path.resolve(__dirname,'../.env.development.local');
const env=fs.existsSync(file)?dotenv.parse(fs.readFileSync(file)):{};
const key=env.REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY || process.env.REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY || '';
if(key&&!key.startsWith('pk_test_'))throw Error('Development hosting requires a Stripe test publishable key.');
process.env.REACT_APP_FIREBASE_ENV='development';
process.env.REACT_APP_STRIPE_DEVELOPMENT_PUBLISHABLE_KEY=key;
require('react-scripts/scripts/build');
