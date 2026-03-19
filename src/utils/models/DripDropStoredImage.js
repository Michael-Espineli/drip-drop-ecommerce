
import { v4 as uuidv4 } from 'uuid';

class DripDropStoredImage {
  constructor(data) {
    if (typeof data === 'string') {
        this.id = 'img_' + uuidv4();
        this.description = '';
        this.imageURL = data;
    } else {
        const { id, description, imageURL } = data || {};
        this.id = id || 'img_' + uuidv4();
        this.description = description || '';
        this.imageURL = imageURL || '';
    }
  }

  toFirestore() {
    return {
      id: this.id,
      description: this.description,
      imageURL: this.imageURL,
    };
  }

  static fromData(data) {
    return new DripDropStoredImage(data);
  }
}

export { DripDropStoredImage };
