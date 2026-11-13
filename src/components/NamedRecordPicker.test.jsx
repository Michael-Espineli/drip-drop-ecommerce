import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { fetchConversationLinkPickerItems } from '../utils/chatMessaging';
import NamedRecordPicker from './NamedRecordPicker';
jest.mock('../utils/config',()=>({db:{}}));
jest.mock('../utils/chatMessaging',()=>({fetchConversationLinkPickerItems:jest.fn()}));
beforeEach(()=>fetchConversationLinkPickerItems.mockReset());
test('shows names and sends the unchanged record identity to the caller',async()=>{
 fetchConversationLinkPickerItems.mockResolvedValue([{id:'x7QaB2cD9eF0gH1jK3mN',title:'Taylor Customer'}]);const onChange=jest.fn();
 render(<NamedRecordPicker companyId="company-one" type="customer" onChange={onChange}/>);
 await screen.findByRole('option',{name:'Taylor Customer'});fireEvent.change(screen.getByRole('combobox'),{target:{value:'x7QaB2cD9eF0gH1jK3mN'}});
 expect(onChange).toHaveBeenCalledWith({id:'x7QaB2cD9eF0gH1jK3mN',title:'Taylor Customer'});expect(screen.queryByText('x7QaB2cD9eF0gH1jK3mN')).not.toBeInTheDocument();
});
test('preserves an existing unavailable selection without displaying its ID',async()=>{
 fetchConversationLinkPickerItems.mockResolvedValue([]);render(<NamedRecordPicker companyId="company-one" type="customer" value="opaque-existing-id" currentLabel="Taylor Customer" onChange={()=>{}}/>);
 expect(await screen.findByRole('option',{name:'Taylor Customer'})).toHaveValue('opaque-existing-id');expect(screen.queryByText('opaque-existing-id')).not.toBeInTheDocument();
});
test('late results for a previous company do not appear in a new company picker',async()=>{
 let finish;fetchConversationLinkPickerItems.mockImplementationOnce(()=>new Promise(done=>{finish=done;})).mockResolvedValueOnce([{id:'new',title:'New company record'}]);
 const view=render(<NamedRecordPicker companyId="old" type="customer" onChange={()=>{}}/>);view.rerender(<NamedRecordPicker companyId="new" type="customer" onChange={()=>{}}/>);
 await screen.findByRole('option',{name:'New company record'});await act(async()=>finish([{id:'old',title:'Old company record'}]));expect(screen.queryByText('Old company record')).not.toBeInTheDocument();
});
test('failed reads can be retried',async()=>{
 fetchConversationLinkPickerItems.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([{id:'new',title:'Available record'}]);render(<NamedRecordPicker companyId="company-one" type="customer" onChange={()=>{}}/>);
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Try again'}));expect(await screen.findByRole('option',{name:'Available record'})).toBeInTheDocument();
});
