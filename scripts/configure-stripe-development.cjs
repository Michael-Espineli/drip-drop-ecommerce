#!/usr/bin/env node
// Run in a terminal. Input is hidden and never passed in process arguments.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline/promises');
const {Writable}=require('node:stream');
const dotenv=require('../functions/node_modules/dotenv');
const target=path.resolve(__dirname,'../functions/.env.the-pool-app-dev');
const valid=key=>/^sk_test_[A-Za-z0-9]+$/.test(key)&&!key.includes('dummy');
async function main(){
 if(process.argv.includes('--check')){
  const env=fs.existsSync(target)?dotenv.parse(fs.readFileSync(target)):{};
  const configured=valid(env.STRIPE_API_KEY || env.STRIPE_SECRET_KEY || '');
  console.log(configured?'Development Stripe test key is configured locally. Real Stripe acceptance still needs to run.':'Development Stripe test key is missing. Run this script interactively to configure it.');
  process.exitCode=configured?0:1;return;
 }
 if(!process.stdin.isTTY)throw Error('Run node scripts/configure-stripe-development.cjs in an interactive terminal.');
 process.stdout.write('Paste the Stripe sandbox secret key (input hidden): ');
 const silent=new Writable({write(_chunk,_encoding,callback){callback();}});
 const prompt=readline.createInterface({input:process.stdin,output:silent,terminal:true});
 let key;try{key=(await prompt.question('')).trim();}finally{prompt.close();process.stdout.write('\n');}
 if(!valid(key))throw Error('Use the selected sandbox’s sk_test_ secret key. No file was changed.');
 const Stripe=require('../functions/node_modules/stripe'),stripe=Stripe(key,{apiVersion:'2025-02-24.acacia',maxNetworkRetries:1});
 await stripe.accounts.retrieve(); // Validate access before modifying the development environment file.
 let content=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
 content=/^STRIPE_API_KEY=.*$/m.test(content)?content.replace(/^STRIPE_API_KEY=.*$/m,`STRIPE_API_KEY=${key}`):content.trimEnd()+`\nSTRIPE_API_KEY=${key}\n`;
 fs.writeFileSync(target,content,{mode:0o600});fs.chmodSync(target,0o600);
 console.log('Validated and saved the test key in the ignored development environment file. Production configuration was not changed.');
}
main().catch(error=>{console.error(error.type?'Stripe could not validate the sandbox key. Check the selected sandbox and API-key permissions.':error.message);process.exitCode=1;});
