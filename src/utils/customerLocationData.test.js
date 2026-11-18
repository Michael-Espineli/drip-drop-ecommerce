import { formatAddressLabel, normalizeAddress } from "./customerLocationData";
import { Customer } from './models/Customer';
import { ServiceLocation } from './models/ServiceLocation';

describe("customer location address helpers", () => {
  it("normalizes service-location addresses from legacy iOS field names", () => {
    expect(normalizeAddress({
      StreetAddress: "123 Pool Lane",
      City: "Bakersfield",
      State: "CA",
      Zip: "93301",
      Latitude: 35.3733,
      Longitude: -119.0187,
    })).toEqual({
      streetAddress: "123 Pool Lane",
      city: "Bakersfield",
      state: "CA",
      zip: "93301",
      zipCode: "93301",
      latitude: 35.3733,
      longitude: -119.0187,
    });
  });

  it("formats normalized legacy addresses for search labels", () => {
    const address = normalizeAddress({
      StreetAddress: "456 Filter Court",
      City: "Fresno",
      State: "CA",
      Zip: "93722",
    });

    expect(formatAddressLabel(address)).toBe("456 Filter Court Fresno CA 93722");
  });
});

test('customer and location edits preserve server onboarding fields without adding them to legacy records', () => {
  const gate = {required: true, agreementId: 'agreement', status: 'pending'};
  const saved = new Customer({id: 'new', firstName: 'Before', onboardingRequired: true, lifecycleStatus: 'prospect', serviceOnboarding: gate});
  saved.firstName = 'Updated';
  expect(saved.toFirestore()).toMatchObject({firstName: 'Updated', onboardingRequired: true, lifecycleStatus: 'prospect', serviceOnboarding: gate});
  expect(new Customer({id: 'legacy'}).toFirestore()).not.toHaveProperty('onboardingRequired');
  expect(new ServiceLocation({id: 'site', serviceOnboarding: gate}).toFirestore()).toMatchObject({serviceOnboarding: gate});
});
