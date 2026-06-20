import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { DripDropStoredImage } from "./models/DripDropStoredImage";

const IMAGE_FALLBACK_EXTENSION = ".jpg";
const IMAGE_FALLBACK_CONTENT_TYPE = "image/jpeg";

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

export const buildCompanyRepairRequestPhotoPath = ({ companyId, repairRequestId, file }) => (
  `companies/${companyId}/repairRequests/${repairRequestId}/${Date.now()}_${uuidv4()}${fileExtensionFor(file)}`
);

export const getRepairRequestPhotoUrl = (photo) => {
  if (typeof photo === "string") return photo;

  return photo?.imageURL || photo?.url || "";
};

export const toRepairRequestStoredImageData = ({ imageURL, description = "" }) => (
  new DripDropStoredImage({
    id: "img_" + uuidv4(),
    description,
    imageURL,
  }).toFirestore()
);

export const uploadRepairRequestPhoto = async ({ storage, file, path, description }) => {
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file, {
    contentType: file?.type || IMAGE_FALLBACK_CONTENT_TYPE,
  });

  const imageURL = await getDownloadURL(storageRef);

  return toRepairRequestStoredImageData({
    imageURL,
    description: description || file?.name || "",
  });
};
