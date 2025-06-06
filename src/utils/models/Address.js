class Address {
    constructor(streetAddress, city, state, zip, latitude, longitude) {
        this.streetAddress = streetAddress;
        this.city = city;
        this.state = state;
        this.zip = zip;
        this.latitude = latitude;
        this.longitude = longitude;
    }

    get coordinates() {
        // In JavaScript, there's no direct equivalent to CLLocationCoordinate2D.
        // You might represent coordinates as an object with latitude and longitude properties.
        return {
            latitude: this.latitude,
            longitude: this.longitude
        };
    }
}