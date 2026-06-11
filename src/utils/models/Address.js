import { normalizeAddress } from '../customerLocationData';

class Address {
  constructor(streetAddress = '', city = '', state = '', zip = '', latitude = 0, longitude = 0) {
    const normalized = normalizeAddress({ streetAddress, city, state, zip, latitude, longitude });

    this.streetAddress = normalized.streetAddress;
    this.city = normalized.city;
    this.state = normalized.state;
    this.zip = normalized.zip;
    this.zipCode = normalized.zipCode;
    this.latitude = normalized.latitude;
    this.longitude = normalized.longitude;
  }

  static fromFirestore(address = {}) {
    const normalized = normalizeAddress(address);
    return new Address(
      normalized.streetAddress,
      normalized.city,
      normalized.state,
      normalized.zip,
      normalized.latitude,
      normalized.longitude
    );
  }

  toFirestore() {
    return normalizeAddress(this);
  }
}

export { Address };
export default Address;
