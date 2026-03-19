/**
 * GCP / Lease configuration — reads from environment variables.
 * GCP credentials come from Application Default Credentials (ADC).
 */
export const config = {
  gcpProject: process.env.GCP_PROJECT || "bill-leases",
  gcpLocation: process.env.GCP_LOCATION || "us-central1",
  modelId: process.env.MODEL_ID || "gemini-2.0-flash-preview",
  apiVersion: process.env.API_VERSION || "v1beta1",
  firestoreLeasesCollection:
    process.env.FIRESTORE_LEASES_COLLECTION || "leases",
  firestorePropertiesCollection:
    process.env.FIRESTORE_PROPERTIES_COLLECTION || "properties",
};
