import { Storage } from "@google-cloud/storage";
import { config } from "./config.js";

let _storage = null;

function getStorage() {
  if (!_storage) {
    _storage = new Storage({ projectId: config.gcpProject });
  }
  return _storage;
}

function getBucket() {
  return getStorage().bucket(config.gcsBucket);
}

/**
 * Upload a file buffer to GCS.
 */
export async function uploadFile(projectId, fileId, filename, buffer, mimeType) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  const file = getBucket().file(gcsPath);
  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
  });
  return gcsPath;
}

/**
 * Download a file buffer from GCS.
 */
export async function downloadFile(projectId, fileId, filename) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  const [buffer] = await getBucket().file(gcsPath).download();
  return buffer;
}

/**
 * Delete a single file from GCS.
 */
export async function deleteFile(projectId, fileId, filename) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  try {
    await getBucket().file(gcsPath).delete();
  } catch (err) {
    if (err.code !== 404) throw err;
  }
}

/**
 * Delete all files for a project from GCS.
 */
export async function deleteProjectFiles(projectId) {
  await getBucket().deleteFiles({ prefix: `projects/${projectId}/` });
}

/**
 * Generate a signed download URL (1 hour expiry).
 */
export async function getSignedUrl(projectId, fileId, filename) {
  const gcsPath = `projects/${projectId}/${fileId}-${filename}`;
  const [url] = await getBucket().file(gcsPath).getSignedUrl({
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });
  return url;
}
