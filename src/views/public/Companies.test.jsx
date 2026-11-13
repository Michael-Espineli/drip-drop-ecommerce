import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import Companies from './Companies';
jest.mock('../../utils/config',()=>({functions:{}}));
jest.mock('../../layout/PublicHeader',()=>()=>null);
jest.mock('../../layout/Footer',()=>()=>null);
jest.mock('firebase/functions',()=>({httpsCallable:jest.fn()}));
test('directory shows useful recovery and retry loads profiles after a callable failure',async()=>{
  const call=jest.fn().mockRejectedValueOnce(new Error('internal')).mockResolvedValueOnce({data:{status:200,companies:[{id:'opaque-company-id',name:'Pool Care',services:[],serviceAreas:[],serviceZipCodes:[],profileUrl:'/companies/profile/opaque-company-id'}]}});
  httpsCallable.mockReturnValue(call);
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});
  try{
    render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Companies/></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
    expect(screen.queryByText('internal',{exact:true})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Try again'}));
    expect(await screen.findByText('Pool Care')).toBeInTheDocument();
    expect(call).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('opaque-company-id')).not.toBeInTheDocument();
  }finally{log.mockRestore();}
});
