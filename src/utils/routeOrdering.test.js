import {mergeStopsIntoRouteOrder} from './routeOrdering';
const stops=[{id:'one',recurringServiceStopId:'rss1'},{id:'two',recurringServiceStopId:'rss2'}];
const planned={rssIds:['rss1','rss2']};
test('an unstarted route retains saved daily order across synchronization',()=>{
    expect(mergeStopsIntoRouteOrder({status:'Did Not Start',serviceStopsIds:['two','one']},stops,planned).map(v=>v.id)).toEqual(['two','one']);
});
test('new routes initialize from permanent order',()=>{
    expect(mergeStopsIntoRouteOrder(null,[stops[1],stops[0]],planned).map(v=>v.id)).toEqual(['one','two']);
});
test('legacy order arrays survive refresh and stale membership is removed while new stops append',()=>{
    const route={order:[{serviceStopId:'gone',order:1},{serviceStopId:'two',order:2},{serviceStopId:'two',order:3},{serviceStopId:'one',order:4}]};
    expect(mergeStopsIntoRouteOrder(route,[...stops,{id:'new'}],planned).map(v=>v.id)).toEqual(['two','one','new']);
});
test('saved order takes precedence over membership arrays written by an older native client',()=>{
    const route={serviceStopsIds:['one','two'],order:[{serviceStopId:'two',order:1},{serviceStopId:'one',order:2}]};
    expect(mergeStopsIntoRouteOrder(route,stops,planned).map(v=>v.id)).toEqual(['two','one']);
});
