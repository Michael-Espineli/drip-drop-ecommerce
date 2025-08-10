class DripDropStoredImage {
  constructor({ id, description, imageURL }) {
    this.id = id;
    this.description = description;
    this.imageURL = imageURL;
  }

  // You can add methods here if needed, similar to other models.

  static fromData(data) {
    return new DripDropStoredImage(data);
  }
}

export { DripDropStoredImage };
