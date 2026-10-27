import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import WorkOfferReview from './WorkOfferReview';
import {manageTechnicianWork} from '../../../utils/technicianWorkflow';
jest.mock('../../../utils/technicianWorkflow',()=>({manageTechnicianWork:jest.fn()}));
const scope={tasks:[{id:'task',name:'Install filter',description:'Replace seal',status:'Scheduled'}],services:[],products:[{id:'part',name:'Seal',quantity:2,status:'Purchased'}],stops:[]};
const quote={scope,totalCents:6000,baseCents:5000,incentiveCents:1000,revision:2,needsReview:false};
const offer={id:'offer',title:'Repair',customerName:'Customer',paySource:'Technician Rate'};
beforeAll(()=>{global.crypto={randomUUID:()=>"claim"};});
beforeEach(()=>manageTechnicianWork.mockReset());
test('loads the requested scope and personal pay before submitting an authoritative claim',async()=>{
 manageTechnicianWork.mockImplementation((company,action)=>Promise.resolve(action==='preview'?quote:{offerId:'offer',status:'Accepted'}));
 const onAccepted=jest.fn(),onClose=jest.fn();render(<WorkOfferReview companyId="company" offer={offer} onAccepted={onAccepted} onClose={onClose}/>);
 expect(screen.getByRole('button',{name:'Accept Work'})).toBeDisabled();
 expect(await screen.findByText('Install filter')).toBeInTheDocument();expect(screen.getByText('Quantity: 2 · Purchased')).toBeInTheDocument();expect(screen.getByText(/Your estimated pay: \$60.00/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Accept Work'}));await waitFor(()=>expect(onAccepted).toHaveBeenCalledWith({offerId:'offer',status:'Accepted'}));
 expect(manageTechnicianWork).toHaveBeenCalledWith('company','accept',expect.objectContaining({offerId:'offer',revision:2}));expect(onClose).toHaveBeenCalled();
});
test('missing pay setup blocks acceptance and server rejection leaves the review open',async()=>{
 manageTechnicianWork.mockResolvedValue({...quote,needsReview:true});const onClose=jest.fn();render(<WorkOfferReview companyId="company" offer={offer} onAccepted={jest.fn()} onClose={onClose}/>);
 expect(await screen.findByText(/Pay setup needs management/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Accept Work'})).toBeDisabled();expect(onClose).not.toHaveBeenCalled();
});
test('acceptance failure keeps scope visible and permits retry after the error',async()=>{
 manageTechnicianWork.mockImplementation((company,action)=>action==='preview'?Promise.resolve(quote):Promise.reject(Error('Already claimed')));const onClose=jest.fn();render(<WorkOfferReview companyId="company" offer={offer} onAccepted={jest.fn()} onClose={onClose}/>);
 await screen.findByText('Install filter');fireEvent.click(screen.getByRole('button',{name:'Accept Work'}));expect(await screen.findByRole('alert')).toHaveTextContent('Already claimed');expect(screen.getByText('Install filter')).toBeInTheDocument();expect(onClose).not.toHaveBeenCalled();
});
test('accepted work displays its frozen terms and scope without another acceptance action',async()=>{
 manageTechnicianWork.mockResolvedValue({pay:{...quote,hourlyPaySource:'workLogs'},scope});render(<WorkOfferReview companyId="company" offer={offer} readOnly onClose={jest.fn()}/>);
 expect(await screen.findByText(/Agreed estimated pay/)).toBeInTheDocument();expect(screen.getByText(/Hourly time source: workLogs/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Accept Work'})).not.toBeInTheDocument();expect(manageTechnicianWork).toHaveBeenCalledWith('company','details',{offerId:'offer'});
});
