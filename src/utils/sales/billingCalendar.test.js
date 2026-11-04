import {addInterval,billingPeriod} from './billingCalendar';
test('billing calendar preserves month-end and local sending time over DST and leap February',()=>{
 const feb=addInterval(new Date('2028-01-31T18:15:00Z'),'month',1,'America/Los_Angeles',31);
 expect(feb.toISOString()).toBe('2028-02-29T18:15:00.000Z');
 expect(addInterval(feb,'month',1,'America/Los_Angeles',31).toISOString()).toBe('2028-03-31T17:15:00.000Z');
 const period=billingPeriod({id:'sub',billingTimeZone:'America/Los_Angeles',createdAt:new Date('2026-10-31T07:00:00Z'),interval:'month'});
 expect(period.invoiceId).toBe('si_sub_20261031');expect(period.periodEnd.toISOString()).toBe('2026-11-30T08:00:00.000Z');expect(period.nextPeriodEnd.toISOString()).toBe('2026-12-31T08:00:00.000Z');
});
