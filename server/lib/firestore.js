/**
 * Firestore storage layer — ported from cbre_leases.
 *
 * Collections:
 * - leases: individual lease documents with full text
 * - properties: grouped by property address for per-property queries
 * - projects: project containers with persona + skills
 * - skills: reusable AI skill definitions
 *
 * All data stays within the configured GCP project.
 */
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { config } from "./config.js";

let db = null;

function getDb() {
  if (!db) {
    db = new Firestore({
      projectId: config.gcpProject,
    });
  }
  return db;
}

function leasesCol() {
  return getDb().collection(config.firestoreLeasesCollection);
}

function propertiesCol() {
  return getDb().collection(config.firestorePropertiesCollection);
}

function projectsCol() {
  return getDb().collection("projects");
}

function skillsCol() {
  return getDb().collection("skills");
}

// ── Property helpers ────────────────────────────────────────────────

function propertyIdFromAddress(address) {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function ensureProperty(address, name) {
  const propId = propertyIdFromAddress(address);
  const ref = propertiesCol().doc(propId);
  const doc = await ref.get();

  if (!doc.exists) {
    await ref.set({
      id: propId,
      name: name || address,
      address,
      leaseCount: 0,
      totalSquareFootage: 0,
      createdAt: new Date().toISOString(),
    });
  }

  return propId;
}

// ── Project CRUD ─────────────────────────────────────────────────────

function projectIdFromName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createProject(name, persona) {
  const id = projectIdFromName(name) + "-" + Date.now();
  const now = new Date().toISOString();
  const project = {
    id,
    name,
    persona,
    skillIds: [],
    leaseCount: 0,
    totalSquareFootage: 0,
    avgMonthlyRent: 0,
    createdAt: now,
    updatedAt: now,
  };
  await projectsCol().doc(id).set(project);
  return project;
}

export async function getProjects() {
  const snapshot = await projectsCol().orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function getProjectById(projectId) {
  const doc = await projectsCol().doc(projectId).get();
  return doc.exists ? doc.data() : null;
}

export async function updateProject(projectId, updates) {
  await projectsCol().doc(projectId).update({ ...updates, updatedAt: new Date().toISOString() });
}

export async function addSkillToProject(projectId, skillId) {
  await projectsCol().doc(projectId).update({
    skillIds: FieldValue.arrayUnion(skillId),
    updatedAt: new Date().toISOString(),
  });
}

export async function removeSkillFromProject(projectId, skillId) {
  await projectsCol().doc(projectId).update({
    skillIds: FieldValue.arrayRemove(skillId),
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteProject(projectId) {
  const leases = await getLeasesByProject(projectId);
  const batch = getDb().batch();
  leases.forEach((l) => batch.delete(leasesCol().doc(l.id)));
  batch.delete(projectsCol().doc(projectId));
  await batch.commit();
}

export async function recalculateProjectStats(projectId) {
  const leases = await getLeasesByProject(projectId);
  const totalSqft = leases.reduce((sum, l) => sum + (l.squareFootage || 0), 0);
  const rents = leases.filter((l) => l.monthlyRent).map((l) => l.monthlyRent);
  const avgRent = rents.length > 0 ? Math.round(rents.reduce((s, r) => s + r, 0) / rents.length) : 0;
  await projectsCol().doc(projectId).update({
    leaseCount: leases.length,
    totalSquareFootage: totalSqft,
    avgMonthlyRent: avgRent,
    updatedAt: new Date().toISOString(),
  });
}

// ── Skill CRUD ──────────────────────────────────────────────────────

export async function createSkill(name, description, instructions) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now();
  const now = new Date().toISOString();
  const skill = { id, name, description, instructions, createdAt: now, updatedAt: now };
  await skillsCol().doc(id).set(skill);
  return skill;
}

export async function getSkills() {
  const snapshot = await skillsCol().orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function getSkillsByIds(ids) {
  if (ids.length === 0) return [];
  const snapshot = await skillsCol().where("id", "in", ids).get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function updateSkill(skillId, updates) {
  await skillsCol().doc(skillId).update({ ...updates, updatedAt: new Date().toISOString() });
}

export async function deleteSkill(skillId) {
  await skillsCol().doc(skillId).delete();
}

// ── Lease CRUD ──────────────────────────────────────────────────────

export async function upsertLease(lease) {
  const col = leasesCol();

  // Use source file as a stable doc ID
  const docId = lease.sourceFile
    ? lease.sourceFile
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.pdf$/i, "")
    : `lease_${Date.now()}`;

  // Ensure property exists and link it (legacy)
  let propertyId = null;
  if (lease.propertyAddress) {
    propertyId = await ensureProperty(lease.propertyAddress);
  }

  const data = {
    ...lease,
    id: docId,
    propertyId,
    updatedAt: new Date().toISOString(),
    createdAt: lease.createdAt || new Date().toISOString(),
  };

  await col.doc(docId).set(data, { merge: true });

  // Update project stats if linked to a project
  if (lease.projectId) {
    await recalculateProjectStats(lease.projectId);
  } else if (propertyId) {
    await recalculatePropertyStats(propertyId);
  }

  return docId;
}

export async function getLeaseById(leaseId) {
  const doc = await leasesCol().doc(leaseId).get();
  return doc.exists ? doc.data() : null;
}

export async function getAllLeases() {
  const snapshot = await leasesCol().orderBy("tenantName").get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function getLeasesByProperty(propertyId) {
  const snapshot = await leasesCol()
    .where("propertyId", "==", propertyId)
    .orderBy("tenantName")
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function getLeasesByProject(projectId) {
  const snapshot = await leasesCol()
    .where("projectId", "==", projectId)
    .orderBy("tenantName")
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function searchLeases(query) {
  const all = await getAllLeases();
  const q = query.toLowerCase();
  return all.filter(
    (l) =>
      l.tenantName?.toLowerCase().includes(q) ||
      l.landlordName?.toLowerCase().includes(q) ||
      l.propertyAddress?.toLowerCase().includes(q) ||
      l.suiteNumber?.toLowerCase().includes(q) ||
      l.fullText?.toLowerCase().includes(q),
  );
}

export async function deleteLease(leaseId) {
  const doc = await leasesCol().doc(leaseId).get();
  const data = doc.exists ? doc.data() : null;
  await leasesCol().doc(leaseId).delete();
  if (data?.projectId) {
    await recalculateProjectStats(data.projectId);
  } else if (data?.propertyId) {
    await recalculatePropertyStats(data.propertyId);
  }
}

export async function deleteAllData() {
  const leaseSnap = await leasesCol().get();
  const propSnap = await propertiesCol().get();
  const batch = getDb().batch();
  leaseSnap.docs.forEach((doc) => batch.delete(doc.ref));
  propSnap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return { leases: leaseSnap.size, properties: propSnap.size };
}

// ── Property queries ────────────────────────────────────────────────

export async function getAllProperties() {
  const snapshot = await propertiesCol().orderBy("name").get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function getPropertyById(propertyId) {
  const doc = await propertiesCol().doc(propertyId).get();
  return doc.exists ? doc.data() : null;
}

async function recalculatePropertyStats(propertyId) {
  const leases = await getLeasesByProperty(propertyId);
  const totalSqft = leases.reduce(
    (sum, l) => sum + (l.squareFootage || 0),
    0,
  );
  await propertiesCol().doc(propertyId).update({
    leaseCount: leases.length,
    totalSquareFootage: totalSqft,
  });
}

// ── Dashboard ───────────────────────────────────────────────────────

export async function getDashboardStats() {
  const leases = await getAllLeases();
  const properties = await getAllProperties();

  const today = new Date();
  const d30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const d90 = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

  let expiring30 = 0;
  let expiring90 = 0;
  let totalRent = 0;
  let rentCount = 0;
  let totalSqft = 0;

  for (const lease of leases) {
    if (lease.leaseEndDate) {
      const endDate = new Date(lease.leaseEndDate);
      if (endDate >= today && endDate <= d30) expiring30++;
      if (endDate >= today && endDate <= d90) expiring90++;
    }
    if (lease.monthlyRent) {
      totalRent += lease.monthlyRent;
      rentCount++;
    }
    if (lease.squareFootage) {
      totalSqft += lease.squareFootage;
    }
  }

  return {
    totalLeases: leases.length,
    totalProperties: properties.length,
    expiring30Days: expiring30,
    expiring90Days: expiring90,
    avgMonthlyRent: rentCount > 0 ? Math.round(totalRent / rentCount) : 0,
    totalSquareFootage: Math.round(totalSqft),
  };
}
