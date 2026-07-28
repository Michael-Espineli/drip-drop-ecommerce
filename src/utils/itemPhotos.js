import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

const IMAGE_FALLBACK_CONTENT_TYPE = "image/jpeg";

export const safeItemPhotoFileName = (fileName = "item-photo") =>
  String(fileName || "item-photo")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-90) || "item-photo";

export const getItemPhotoUrl = (source = {}) => {
  if (!source) return "";
  if (typeof source === "string") return source;

  const directUrl =
    source.photoUrl ||
    source.photoURL ||
    source.imageUrl ||
    source.imageURL ||
    source.primaryPhotoUrl ||
    source.thumbnailUrl ||
    source.url ||
    "";

  if (directUrl) return directUrl;

  const photoList = Array.isArray(source.photoUrls)
    ? source.photoUrls
    : Array.isArray(source.photos)
      ? source.photos
      : [];

  return getItemPhotoUrl(photoList[0] || {});
};

export const itemPhotoFieldsFromUrl = (photoUrl = "", description = "Item photo", storagePath = "") => {
  const cleanPhotoUrl = String(photoUrl || "").trim();

  return {
    photoUrl: cleanPhotoUrl,
    imageUrl: cleanPhotoUrl,
    primaryPhotoUrl: cleanPhotoUrl,
    photoUrls: cleanPhotoUrl
      ? [
          {
            imageURL: cleanPhotoUrl,
            url: cleanPhotoUrl,
            description,
            storagePath,
          },
        ]
      : [],
  };
};

export const itemPhotoFieldsFromSource = (source = {}, description = "Item photo") => {
  const photoUrl = getItemPhotoUrl(source);
  const sourcePhotoUrls = Array.isArray(source.photoUrls) ? source.photoUrls : [];

  return {
    photoUrl,
    imageUrl: source.imageUrl || source.imageURL || photoUrl,
    primaryPhotoUrl: source.primaryPhotoUrl || photoUrl,
    photoUrls: sourcePhotoUrls.length
      ? sourcePhotoUrls
      : itemPhotoFieldsFromUrl(photoUrl, description).photoUrls,
  };
};

export const validateItemPhotoFile = (file, maxSizeMb = 8) => {
  if (!file) return "";
  if (!String(file.type || "").startsWith("image/")) {
    return "Please select an image file.";
  }

  if (file.size > maxSizeMb * 1024 * 1024) {
    return `Item photos must be smaller than ${maxSizeMb}MB.`;
  }

  return "";
};

export const uploadItemPhoto = async ({
  storage,
  companyId,
  file,
  itemType = "item",
  itemId,
}) => {
  const storagePath = [
    "companies",
    companyId,
    "itemPhotos",
    itemType,
    itemId,
    `${Date.now()}-${safeItemPhotoFileName(file?.name)}`,
  ]
    .filter(Boolean)
    .join("/");

  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, {
    contentType: file?.type || IMAGE_FALLBACK_CONTENT_TYPE,
  });

  const photoUrl = await getDownloadURL(storageRef);

  return {
    photoUrl,
    storagePath,
  };
};
