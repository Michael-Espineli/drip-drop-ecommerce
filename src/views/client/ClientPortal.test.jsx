import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {getDoc,getDocs,setDoc,updateDoc,writeBatch,onSnapshot} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {Context} from '../../context/AuthContext';
import ClientProfile from './account/ClientProfile';
import ClientSettings from './account/ClientSettings';
import NewRequest from './serviceRequests/NewRequest';
import NewRepairRequest from './repairRequests/NewRepairRequest';
import HomeownerServiceLocationForm from './serviceLocations/HomeownerServiceLocationForm';
import ClientHome from './ClientHome';
import ClientFinance from './finance/ClientFinance';
import {Routes,Route} from 'react-router-dom';
jest.mock('../../context/AuthContext',()=>({Context:require('react').createContext()}));
jest.mock('../../utils/config',()=>({db:{},functions:{},storage:{},auth:{currentUser:{getIdToken:async()=> 'fixture'}}}));
jest.mock('../../firebase',()=>({db:{},functions:{},storage:{}}));
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
jest.mock('firebase/storage',()=>({ref:(_,path)=>path,uploadBytes:jest.fn(),getDownloadURL:jest.fn()}));
jest.mock('firebase/firestore',()=>({
 collection:(_, ...parts)=>parts.join('/'),doc:(_, ...parts)=>parts.join('/'),where:(...args)=>args,orderBy:(...args)=>args,limit:()=>null,
 query:(path,...filters)=>({path,filters}),getDoc:jest.fn(),getDocs:jest.fn(),setDoc:jest.fn(),updateDoc:jest.fn(),writeBatch:jest.fn(),onSnapshot:jest.fn(),serverTimestamp:()=> 'server-time',
}));
const user={uid:'homeowner',email:'jordan@example.test',emailVerified:true};
const person={firstName:'Jordan',lastName:'Rivera',phoneNumber:'555-0100',settings:{emailNotifications:false}};
const snapshot=rows=>({docs:rows.map(({id,...data})=>({id,data:()=>data})),empty:!rows.length});
const company={id:'company',name:'Pool Company'};
let batch,command;
function Reporter(){return <output data-testid="destination">{useLocation().pathname}{useLocation().search}</output>;}
function mount(element,path='/client/profile'){
 function Provider(){const [profile,setProfile]=React.useState(person);return <Context.Provider value={{user,dataBaseUser:profile,setDataBaseUser:setProfile,name:'Jordan Rivera',featureFlagsLoaded:true,isFeatureEnabled:()=>true}}>{element}<Reporter/></Context.Provider>;}
 return render(<MemoryRouter initialEntries={[path]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Provider/></MemoryRouter>);
}
beforeEach(()=>{
 jest.clearAllMocks();sessionStorage.clear();batch={set:jest.fn(),commit:jest.fn().mockResolvedValue()};writeBatch.mockReturnValue(batch);command=jest.fn().mockResolvedValue({data:{requestId:'created-request'}});httpsCallable.mockReturnValue(command);
 getDoc.mockResolvedValue({exists:()=>true,id:'company',data:()=>company});getDocs.mockResolvedValue(snapshot([]));setDoc.mockResolvedValue();updateDoc.mockResolvedValue();
 onSnapshot.mockImplementation((q,callback)=>{queueMicrotask(()=>callback(snapshot([])));return()=>{};});
});
test('profile reads the stored first/last name and phone, and saves the canonical fields',async()=>{
 mount(<ClientProfile/>);expect(screen.getByText('Jordan Rivera')).toBeInTheDocument();expect(screen.getByText('555-0100')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Edit profile'}));fireEvent.change(screen.getByLabelText('First name'),{target:{value:'Jordana'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByText('Profile saved.');expect(updateDoc).toHaveBeenCalledWith('users/homeowner',expect.objectContaining({firstName:'Jordana',lastName:'Rivera',name:'Jordana Rivera'}));expect(screen.getByText('Jordana Rivera')).toBeInTheDocument();
});
test('failed profile saves preserve edits for retry',async()=>{
 updateDoc.mockRejectedValueOnce(new Error('offline'));mount(<ClientProfile/>);fireEvent.click(screen.getByRole('button',{name:'Edit profile'}));fireEvent.change(screen.getByLabelText('First name'),{target:{value:'Retry name'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByRole('alert');expect(screen.getByLabelText('First name')).toHaveValue('Retry name');fireEvent.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByText('Profile saved.');
});
test('notification preferences load the saved value, update the correct context and revert on failure',async()=>{
 mount(<ClientSettings/>);const toggle=screen.getByRole('switch',{name:'Email Notifications'});expect(toggle).toHaveAttribute('aria-checked','false');fireEvent.click(toggle);await waitFor(()=>expect(toggle).toHaveAttribute('aria-checked','true'));expect(updateDoc).toHaveBeenCalledWith('users/homeowner',{'settings.emailNotifications':true});await waitFor(()=>expect(toggle).not.toBeDisabled());updateDoc.mockRejectedValueOnce(new Error('offline'));fireEvent.click(toggle);await screen.findByRole('alert');expect(toggle).toHaveAttribute('aria-checked','true');
});
test('first-time service requests have an address creation route that preserves the company',async()=>{
 mount(<Routes><Route path="/client/service-requests/new/:companyId" element={<NewRequest/>}/></Routes>,'/client/service-requests/new/company');const add=await screen.findByRole('link',{name:'Add a service address'});expect(add.getAttribute('href')).toContain(encodeURIComponent('/client/service-requests/new/company'));expect(screen.getByRole('button',{name:'Submit Request'})).toBeDisabled();expect(screen.getByText(/Your draft will be kept/)).toBeInTheDocument();
});
test('a failed request save keeps its draft and offers a working retry',async()=>{
 getDocs.mockImplementation(async q=>snapshot(q.path==='homeownerServiceLocations'?[{id:'site',address:{streetAddress:'Example Street'}}]:[]));setDoc.mockRejectedValueOnce(new Error('offline'));
 mount(<Routes><Route path="/client/service-requests/new/:companyId" element={<NewRequest/>}/></Routes>,'/client/service-requests/new/company');await screen.findByRole('link',{name:'Add a service address'});const description=screen.getByRole('textbox',{name:'How can we help?'});fireEvent.change(description,{target:{value:'Weekly service please'}});fireEvent.submit(screen.getByRole('button',{name:'Submit Request'}).closest('form'));await screen.findByRole('alert');expect(description).toHaveValue('Weekly service please');expect(screen.getByRole('button',{name:'Submit Request'})).not.toBeDisabled();expect(JSON.parse(sessionStorage.getItem('client-service-request:homeowner:company')).description).toBe('Weekly service please');
});
test('a manually typed address saves without Google suggestions or invented equipment and returns to the request',async()=>{
 mount(<HomeownerServiceLocationForm/>,'/serviceLocation/create?returnTo=%2Fclient%2Fservice-requests%2Fnew%2Fcompany');fireEvent.change(screen.getByPlaceholderText('Enter service address'),{target:{value:'100 Example Street'}});fireEvent.change(screen.getByLabelText('City'),{target:{value:'Sample City'}});fireEvent.change(screen.getByLabelText('State'),{target:{value:'CA'}});fireEvent.change(screen.getByLabelText('ZIP code'),{target:{value:'90000'}});fireEvent.submit(screen.getByRole('button',{name:'Save Location'}).closest('form'));await waitFor(()=>expect(batch.commit).toHaveBeenCalledTimes(1));expect(batch.set).toHaveBeenCalledTimes(1);expect(batch.set.mock.calls[0][1]).toEqual(expect.objectContaining({userId:'homeowner',address:expect.objectContaining({streetAddress:'100 Example Street',city:'Sample City',state:'CA',zip:'90000'})}));await waitFor(()=>expect(screen.getByTestId('destination')).toHaveTextContent('/client/service-requests/new/company?locationId='));
});
test('repair submissions display a recipient and send the server-validated request only once',async()=>{
 getDocs.mockImplementation(async q=>snapshot(q.path==='homeownerServiceLocations'?[{id:'site',userId:'homeowner',linkedCompanyId:'company',nickName:'Home'}]:q.path==='customerCompanyRelationships'?[{id:'relation',companyId:'company',companyName:'Pool Company',status:'active'}]:[]));
 mount(<NewRepairRequest/>,'/client/repair-requests/new');await screen.findByRole('button',{name:'Send repair request'});await waitFor(()=>expect(screen.getByLabelText('Receiving company')).toHaveValue('company'));fireEvent.change(screen.getByLabelText('Describe the issue'),{target:{value:'The pump is loud'}});const form=screen.getByRole('button',{name:'Send repair request'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));expect(httpsCallable).toHaveBeenCalledWith(expect.anything(),'submitHomeownerRepairRequest');expect(command.mock.calls[0][0]).toEqual(expect.objectContaining({companyId:'company',locationId:'site',description:'The pump is loud'}));await waitFor(()=>expect(screen.getByTestId('destination')).toHaveTextContent('/client/repair-requests/created-request'));
});
test('the mobile home shows next service and a direct payment action before long account details',async()=>{
 onSnapshot.mockImplementation((q,callback)=>{let rows=[];if(q.path==='homeownerServiceStops')rows=[{id:'next',serviceDate:new Date(Date.now()+86400000),status:'Scheduled',companyName:'Pool Company'}];if(q.path==='salesInvoices')rows=[{id:'invoice',customerUserId:'homeowner',status:'open',amountDueCents:17500,invoiceNumber:'1001'}];if(q.path==='customerCompanyRelationships')rows=[{id:'r',status:'active',companyName:'Pool Company'}];queueMicrotask(()=>callback(snapshot(rows)));return()=>{};});
 mount(<ClientHome/>,'/client/dashboard');await screen.findAllByText('$175.00');expect(screen.getByRole('link',{name:'View & pay'})).toHaveAttribute('href','/client/billing/invoices/invoice');expect(screen.getByRole('link',{name:'Report a problem'})).toHaveAttribute('href','/client/repair-requests/new');expect(screen.queryByText('No visit scheduled')).not.toBeInTheDocument();
});

test('Finance includes verified email invoices before linking and retains the correct open balance',async()=>{
 onSnapshot.mockImplementation((q,callback)=>{let rows=[];
  if(q.path==='salesInvoices' && q.filters.some(filter=>filter[0]==='email')) rows=[{id:'unlinked',customerUserId:'',email:user.email,invoiceNumber:'EMAIL-100',status:'open',totalAmountCents:17500,amountDueCents:17500}];
  queueMicrotask(()=>callback(snapshot(rows)));return()=>{};
 });
 mount(<ClientFinance/>,'/client/finance');await screen.findAllByText('EMAIL-100');expect(screen.getAllByText('$175.00').length).toBeGreaterThan(0);expect(screen.queryByText('No invoices found.')).not.toBeInTheDocument();
});

test('Finance keeps loading until all five record types resolve despite multiple invoice emissions',async()=>{
 const callbacks=[];onSnapshot.mockImplementation((q,callback)=>{callbacks.push({q,callback});return()=>{};});
 mount(<ClientFinance/>,'/client/finance');
 await act(async()=>{callbacks.filter(({q})=>q.path==='salesInvoices').forEach(({callback})=>{for(let i=0;i<6;i++)callback(snapshot([]));});});
 expect(screen.getByText('Loading invoices...')).toBeInTheDocument();
 await act(async()=>{callbacks.forEach(({callback})=>callback(snapshot([])));});
 expect(await screen.findByText('No invoices found.')).toBeInTheDocument();
});
