import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import WorkOfferSchedule from './WorkOfferSchedule';
import {technicianWorkflow} from '../../../utils/technicianWorkflow';
jest.mock('../../../utils/technicianWorkflow',()=>({technicianWorkflow:jest.fn()}));
const offer={id:'offer',title:'Estimate',workPurpose:'diagnostic',serviceStopTypeName:'Job Estimate'};
beforeEach(()=>technicianWorkflow.mockReset());
test('uses the atomic scheduler and disables repeated submissions until it finishes',async()=>{
 let finish;technicianWorkflow.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const onScheduled=jest.fn(),onClose=jest.fn();render(<WorkOfferSchedule companyId="company" offer={offer} onScheduled={onScheduled} onClose={onClose}/>);
 fireEvent.change(screen.getByLabelText('Service date and time'),{target:{value:'2026-11-01T10:00'}});fireEvent.click(screen.getByRole('button',{name:'Schedule Work'}));expect(screen.getByRole('button',{name:'Scheduling…'})).toBeDisabled();
 expect(technicianWorkflow).toHaveBeenCalledWith('scheduleTechnicianWork',expect.objectContaining({offerId:'offer',companyId:'company',serviceDateMillis:expect.any(Number)}));finish({serviceStopId:'stop'});await waitFor(()=>expect(onScheduled).toHaveBeenCalledWith({serviceStopId:'stop'}));expect(onClose).toHaveBeenCalled();
});
test('invalid scheduling leaves the selected date and modal available for correction',async()=>{
 technicianWorkflow.mockRejectedValue(Error('Schedule within the accepted window'));const onClose=jest.fn();render(<WorkOfferSchedule companyId="company" offer={offer} onScheduled={jest.fn()} onClose={onClose}/>);
 const date=screen.getByLabelText('Service date and time');fireEvent.change(date,{target:{value:'2026-11-01T10:00'}});fireEvent.click(screen.getByRole('button',{name:'Schedule Work'}));expect(await screen.findByRole('alert')).toHaveTextContent('accepted window');expect(date).toHaveValue('2026-11-01T10:00');expect(onClose).not.toHaveBeenCalled();
});
