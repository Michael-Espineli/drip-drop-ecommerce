const {onCall}=require('firebase-functions/v2/https');

// Firebase Functions 7 exports the v2 API by default. These older handlers still
// accept (data, context); adapt the SDK's verified request at the server boundary.
function legacyCallable(optionsOrHandler,maybeHandler){
 const handler=typeof optionsOrHandler==='function'?optionsOrHandler:maybeHandler;
 const options=typeof optionsOrHandler==='function'?{}:optionsOrHandler;
 return onCall(options,(request,legacyContext)=>{
  if(request?.rawRequest&&typeof request.rawRequest.on==='function'){
   return handler(request.data || {},{
    auth:request.auth,app:request.app,rawRequest:request.rawRequest,
    instanceIdToken:request.instanceIdToken,
   });
  }
  // Preserve direct legacy handler calls in existing unit tests. A JSON request
  // cannot forge the native HTTP request's .on function to promote payload auth.
  return handler(request,legacyContext || {});
 });
}
module.exports={legacyCallable};
