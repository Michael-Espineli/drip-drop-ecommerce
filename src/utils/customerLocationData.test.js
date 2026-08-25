import { formatAddressLabel, normalizeAddress } from "./customerLocationData";

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
