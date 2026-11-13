import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { getDoc, getDocs } from 'firebase/firestore';
import { Context } from '../../../context/AuthContext';
import Reviews from './Reviews';
jest.mock('../../../context/AuthContext',()=>({Context:require('react').createContext({})}));
jest.mock('../../../utils/config',()=>({db:{}}));
jest.mock('firebase/firestore',()=>({collection:(_, ...parts)=>parts.join('/'),doc:(ref,id)=>`${ref}/${id}`,getDoc:jest.fn(),getDocs:jest.fn()}));
const future={v7_startTransition:true,v7_relativeSplatPath:true};
const review=(id,name)=>({id,exists:()=>true,data:()=>({reviewerName:name,description:'Pool looks great',rating:5,verified:true})});
function View({company='company-one',url='/company/reviews/company-one'}){return <Context.Provider value={{recentlySelectedCompany:company}}><MemoryRouter future={future} initialEntries={[url]}><Routes><Route path="/company/reviews/:companyId" element={<Reviews/>}/><Route path="/company/reviews/detail/:reviewId" element={<Reviews/>}/></Routes></MemoryRouter></Context.Provider>;}
beforeEach(()=>{getDoc.mockReset();getDocs.mockReset();});
test('reads selected company reviews and opens the real review detail',async()=>{
 getDocs.mockResolvedValue({docs:[review('x7QaB2cD9eF0gH1jK3mN','Actual customer')]});getDoc.mockResolvedValue(review('x7QaB2cD9eF0gH1jK3mN','Actual customer'));
 render(<View/>);expect(await screen.findByText('Actual customer')).toBeInTheDocument();
 expect(getDocs).toHaveBeenCalledWith('companies/company-one/reviews');
 expect(screen.queryByText('John Doe')).not.toBeInTheDocument();expect(screen.queryByText('x7QaB2cD9eF0gH1jK3mN')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('link',{name:'View review'}));
 expect(await screen.findByRole('heading',{name:'Customer review'})).toBeInTheDocument();
 expect(getDoc).toHaveBeenCalledWith('companies/company-one/reviews/x7QaB2cD9eF0gH1jK3mN');
});
test('shows a real empty state rather than fabricated reviews',async()=>{getDocs.mockResolvedValue({docs:[]});render(<View/>);expect(await screen.findByText('No customer reviews yet.')).toBeInTheDocument();});
test('does not query another company named in the URL',()=>{render(<View company="other-company"/>);expect(screen.getByRole('alert')).toHaveTextContent('Select this company');expect(getDocs).not.toHaveBeenCalled();});
test('a late response from the previous company cannot repopulate the page',async()=>{
 let resolve;getDocs.mockImplementation(()=>new Promise(done=>{resolve=done;}));const view=render(<View/>);
 view.rerender(<View company="other-company"/>);
 await act(async()=>resolve({docs:[review('old-id','Previous company customer')]}));
 expect(screen.queryByText('Previous company customer')).not.toBeInTheDocument();
});
test('failed review reads can be retried',async()=>{
 getDocs.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({docs:[]});const log=jest.spyOn(console,'error').mockImplementation(()=>{});
 try{render(<View/>);await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Try again'}));expect(await screen.findByText('No customer reviews yet.')).toBeInTheDocument();}finally{log.mockRestore();}
});
