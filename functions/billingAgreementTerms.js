const {millis,key}=require('./billingMath');
const {dayStart,addInterval}=require('./billingCalendar');
const {fail}=require('./companyActor');

function agreementTerms(subscription,agreement={},company={}) {
  const timeZone=subscription.billingTimeZone || agreement.billingTimeZone || company.billingTimeZone || company.timeZone || 'UTC';
  const savedEnd=millis(subscription.billingEndAt);
  const endDate=agreement.endDate || subscription.agreementSnapshot?.endDate || subscription.endDate;
  const atWill=agreement.atWill ?? subscription.agreementSnapshot?.atWill ?? subscription.atWill;
  const endAt=savedEnd || (endDate && atWill!==true?addInterval(dayStart(endDate,timeZone),'day',1,timeZone).getTime():0);
  return {endAt,closed:['canceled','cancelled','expired','superseded','rejected'].includes(key(agreement.status)),timeZone};
}

async function readAgreement(reader,db,subscription) {
  if(!subscription.agreementId)return {};
  const snapshot=await reader.get(db.collection('salesAgreements').doc(subscription.agreementId));
  if(!snapshot.exists)fail('failed-precondition','The linked service agreement is missing. Review billing before collecting.');
  const agreement=snapshot.data();
  if(agreement.companyId!==subscription.companyId || agreement.customerId && agreement.customerId!==subscription.customerId)
    fail('permission-denied','The service agreement does not match this billing customer/company.');
  return agreement;
}
module.exports={agreementTerms,readAgreement};
