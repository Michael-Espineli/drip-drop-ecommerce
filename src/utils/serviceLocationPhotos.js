import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { DripDropStoredImage } from "./models/DripDropStoredImage";

const IMAGE_FALLBACK_EXTENSION = ".jpg";
const IMAGE_FALLBACK_CONTENT_TYPE = "image/jpeg";
const MAX_LOCATION_PHOTO_SIZE_MB = 10;

const fileExtensionFor = (file) => {
  const name = file?.name || "";
  const extensionIndex = name.lastIndexOf(".");

  if (extensionIndex >= 0 && extensionIndex < name.length - 1) {
    return name.slice(extensionIndex).toLowerCase();
  }

  if (file?.type === "image/png") return ".png";
  if (file?.type === "image/gif") return ".gif";
  if (file?.type === "image/webp") return ".webp";

  return IMAGE_FALLBACK_EXTENSION;
};

export const buildCompanyServiceLocationPhotoPath = ({ companyId, serviceLocationId, file }) => (
  `companies/${companyId}/serviceLocations/${serviceLocationId}/${Date.now()}_${uuidv4()}${fileExtensionFor(file)}`
);

export const getServiceLocationPhotoUrl = (photo) => {
  if (typeof photo === "string") return photo;

  return photo?.imageURL || photo?.imageUrl || photo?.url || photo?.photoUrl || photo?.photoURL || photo?.downloadURL || "";
};

export const validateServiceLocationPhotoFile = (file) => {
  if (!file) return "";
  if (!String(file.type || "").startsWith("image/")) {
    return "Please select an image file.";
  }
  if (file.size >= MAX_LOCATION_PHOTO_SIZE_MB * 1024 * 1024) {
    return `Location photos must be smaller than ${MAX_LOCATION_PHOTO_SIZE_MB}MB.`;
  }

  return "";
};

export const uploadServiceLocationPhoto = async ({ storage, file, path, description }) => {
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file, {
    contentType: file?.type || IMAGE_FALLBACK_CONTENT_TYPE,
  });

  const imageURL = await getDownloadURL(storageRef);

  return new DripDropStoredImage({
    id: "img_" + uuidv4(),
    description: description || file?.name || "",
    imageURL,
  }).toFirestore();
};
