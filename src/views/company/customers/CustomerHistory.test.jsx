import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import CustomerHistory from './CustomerHistory';
import ReadingsAndDosagesHistory from './ReadingsAndDosagesHistory';
import ReadingsAndDosagesTable from './ReadingsAndDosagesTable';
const future={v7_startTransition:true,v7_relativeSplatPath:true};
const Timeline=()=> <p>Real timeline for {useParams().customerId}</p>;
test.each([CustomerHistory,ReadingsAndDosagesHistory])('legacy history opens the same customer real timeline',Component=>{
  render(<MemoryRouter future={future} initialEntries={['/legacy/customer-one']}><Routes><Route path="/legacy/:customerId" element={<Component/>}/><Route path="/company/customers/details/:customerId/history" element={<Timeline/>}/></Routes></MemoryRouter>);
  expect(screen.getByText('Real timeline for customer-one')).toBeInTheDocument();
  expect(screen.queryByText('123 Main St')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Load Test Data'})).not.toBeInTheDocument();
});
test('visit links preserve readable stop numbers without exposing raw document IDs',()=>{
  render(<MemoryRouter future={future}><ReadingsAndDosagesTable readingTemplates={[]} dosageTemplates={[]} stopData={[{id:'row',date:new Date(),readings:[],dosages:[],serviceStopId:'x7QaB2cD9eF0gH1jK3mN',serviceStopInternalId:'SS-123'}]}/></MemoryRouter>);
  expect(screen.getByRole('link',{name:'SS-123'})).toHaveAttribute('href','/company/serviceStops/detail/x7QaB2cD9eF0gH1jK3mN');
  expect(screen.queryByText('x7QaB2cD9eF0gH1jK3mN')).not.toBeInTheDocument();
});
