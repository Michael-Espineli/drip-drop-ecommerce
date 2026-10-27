import { httpsCallable } from 'firebase/functions';
import { functions } from './config';
export const workflowPayload = (value) => {
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(workflowPayload);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,workflowPayload(v)]));
  return value;
};
export const technicianWorkflow = async (name, payload) => (await httpsCallable(functions,name)(workflowPayload(payload))).data;
export const manageTechnicianWork = (companyId, action, extra={}) => technicianWorkflow('manageTechnicianWork',{companyId,action,...extra});
