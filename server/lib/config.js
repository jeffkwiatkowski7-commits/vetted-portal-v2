/**
 * GCP / Lease configuration — reads from environment variables.
 * GCP credentials come from Application Default Credentials (ADC).
 */
export const config = {
  gcpProject: process.env.GCP_PROJECT || "bill-leases",
  gcpLocation: process.env.GCP_LOCATION || "global",
  modelId: process.env.MODEL_ID || "gemini-3.1-pro-preview",
  apiVersion: process.env.API_VERSION || "v1beta1",
  firestoreLeasesCollection:
    process.env.FIRESTORE_LEASES_COLLECTION || "leases",
  firestorePropertiesCollection:
    process.env.FIRESTORE_PROPERTIES_COLLECTION || "properties",
  gcsBucket: process.env.GCS_BUCKET || "vetted-portal-files",
  firestoreChunksCollection: process.env.FIRESTORE_CHUNKS_COLLECTION || "project_file_chunks",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-005",
};
