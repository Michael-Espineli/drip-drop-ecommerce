import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AddressAutocomplete from './AddressAutocomplete';

let selectPlace;
let getPlace;
let Autocomplete;
let clearInstanceListeners;

beforeEach(() => {
  getPlace = jest.fn();
  Autocomplete = jest.fn(function () {
    this.getPlace = getPlace;
    this.addListener = (_, callback) => { selectPlace = callback; };
  });
  clearInstanceListeners = jest.fn();
  window.google = { maps: { places: { Autocomplete }, event: { clearInstanceListeners } } };
});
afterEach(() => { delete window.google; });

test('keeps one widget through parent rerenders and calls the latest address callbacks', () => {
  const firstSelect = jest.fn();
  const nextSelect = jest.fn();
  const nextInput = jest.fn();
  const view = render(<AddressAutocomplete onAddressSelect={firstSelect} onInputChange={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '123 Main' } });
  view.rerender(<AddressAutocomplete onAddressSelect={nextSelect} onInputChange={nextInput} />);
  expect(Autocomplete).toHaveBeenCalledTimes(1);
  getPlace.mockReturnValue({
    formatted_address: '123 Main St, Austin, TX 78701, USA',
    geometry: { location: { lat: () => 30.2, lng: () => -97.7 } },
    address_components: [
      { types: ['route'], long_name: 'Main St' },
      { types: ['street_number'], long_name: '123' },
      { types: ['locality'], long_name: 'Austin' },
      { types: ['administrative_area_level_1'], short_name: 'TX' },
      { types: ['postal_code'], long_name: '78701' },
    ],
  });
  act(() => selectPlace());
  expect(firstSelect).not.toHaveBeenCalled();
  expect(nextSelect).toHaveBeenCalledWith({ streetAddress: '123 Main St', city: 'Austin', state: 'TX', zipCode: '78701', latitude: 30.2, longitude: -97.7 });
  expect(nextInput).toHaveBeenCalledWith('123 Main St');
  expect(screen.getByRole('textbox')).toHaveValue('123 Main St, Austin, TX 78701, USA');
  view.unmount();
  expect(clearInstanceListeners).toHaveBeenCalledTimes(1);
});

test('ignores selections without geometry and preserves manual address entry', () => {
  const onAddressSelect = jest.fn();
  const onInputChange = jest.fn();
  render(<AddressAutocomplete onAddressSelect={onAddressSelect} onInputChange={onInputChange} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Manual address' } });
  getPlace.mockReturnValue({ address_components: [] });
  act(() => selectPlace());
  expect(onAddressSelect).not.toHaveBeenCalled();
  expect(onInputChange).toHaveBeenCalledWith('Manual address');
  expect(screen.getByRole('textbox')).toHaveValue('Manual address');
});
