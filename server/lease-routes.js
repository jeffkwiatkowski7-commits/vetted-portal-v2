/**
 * Lease-specific API routes — integrates cbre_leases functionality
 * into the vetted_portal_v2 Express backend.
 *
 * Routes:
 *   POST   /api/leases/ingest       — Upload + process PDF lease (SSE)
 *   POST   /api/leases/chat         — Chat with leases (SSE)
 *   GET    /api/leases              — List leases
 *   GET    /api/leases/:id          — Get single lease
 *   DELETE /api/leases/:id          — Delete lease
 *   DELETE /api/leases/all          — Delete all lease data
 *   GET    /api/leases/dashboard    — Dashboard stats
 *
 *   GET    /api/lease-projects           — List Firestore projects
 *   POST   /api/lease-projects           — Create project
 *   GET    /api/lease-projects/:id       — Get project
 *   PATCH  /api/lease-projects/:id       — Update project
 *   DELETE /api/lease-projects/:id       — Delete project
 *
 *   GET    /api/lease-skills             — List skills
 *   POST   /api/lease-skills             — Create skill
 *   PATCH  /api/lease-skills/:id         — Update skill
 *   DELETE /api/lease-skills/:id         — Delete skill
 *
 *   GET    /api/lease-properties         — List properties + stats
 *   GET    /api/lease-logs               — Get activity logs
 */
import { Router } from "express";
import multer from "multer";
import { ocrPdf, extractLeaseData, chatWithLeases as geminiChatWithLeases, chatCrossPortfolio as geminiChatCrossPortfolio } from "./lib/gemini.js";
import { chatWithLeases as claudeChatWithLeases, chatCrossPortfolio as claudeChatCrossPortfolio } from "./lib/claude.js";
import {
  upsertLease, getLeaseById, getAllLeases, getLeasesByProperty,
  getLeasesByProject, searchLeases, deleteLease, deleteAllData,
  getAllProperties, getDashboardStats,
  createProject, getProjects, getProjectById, updateProject, deleteProject,
  addSkillToProject, removeSkillFromProject,
  createSkill, getSkills, getSkillsByIds, updateSkill, deleteSkill,
} from "./lib/firestore.js";
import { addLog, getLogs, clearLogs } from "./lib/logger.js";

const router = Router();

// Multer for in-memory PDF uploads
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

// SSE helper
function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ══════════════════════════════════════════════════════════════════════
// LEASE INGESTION (PDF → Gemini → Firestore)
// ══════════════════════════════════════════════════════════════════════

router.post("/leases/ingest", pdfUpload.single("file"), async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");

  const file = req.file;
  const projectId = req.body.projectId || null;

  if (!file) {
    res.write(sseEvent("error", { message: "Please upload a PDF file" }));
    return res.end();
  }

  const filename = file.originalname;
  const buffer = file.buffer;
  const base64 = buffer.toString("base64");
  const sizeMb = (buffer.length / 1024 / 1024).toFixed(1);

  const OCR_THRESHOLD = 200;

  const emit = (msg, level = "info") => {
    addLog("ingest", msg, level);
    res.write(sseEvent("log", { message: msg }));
  };

  try {
    emit(`Processing: ${filename} (${sizeMb} MB)`);

    // Step 1: Text extraction
    let fullText = "";
    emit("Step 1/4 — Extracting text with pdf-parse...");
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      fullText = parsed.text || "";
      emit(`pdf-parse extracted ${fullText.length.toLocaleString()} characters`);
    } catch {
      emit("pdf-parse failed — will use Gemini OCR");
    }

    // Step 2: OCR if scanned
    if (fullText.trim().length < OCR_THRESHOLD) {
      emit(`Step 2/4 — Scanned PDF detected (only ${fullText.trim().length} chars) — sending to Gemini OCR...`);
      fullText = await ocrPdf(base64, req.headers['x-user-id'] || null);
      emit(`Gemini OCR complete: ${fullText.length.toLocaleString()} characters transcribed`);
    } else {
      emit("Step 2/4 — Text-based PDF, skipping OCR");
    }

    // Step 3: Structured extraction
    emit("Step 3/4 — Extracting structured lease data via Gemini...");
    const leaseData = await extractLeaseData(fullText, filename, req.headers['x-user-id'] || null);
    emit(`Extracted: tenant="${leaseData.tenantName}", suite="${leaseData.suiteNumber}", rent=$${leaseData.monthlyRent}`);

    // Step 4: Store in Firestore
    emit("Step 4/4 — Saving to Firestore...");
    if (projectId) leaseData.projectId = projectId;
    const docId = await upsertLease(leaseData);
    emit(`Stored as document: ${docId}`, "success");

    res.write(sseEvent("done", {
      success: true,
      id: docId,
      tenantName: leaseData.tenantName,
      propertyAddress: leaseData.propertyAddress,
      suiteNumber: leaseData.suiteNumber,
      monthlyRent: leaseData.monthlyRent,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    emit(`ERROR: ${message}`, "error");
    res.write(sseEvent("error", { message }));
  }

  res.end();
});

// ══════════════════════════════════════════════════════════════════════
// LEASE CHAT (Gemini Q&A over lease data)
// ══════════════════════════════════════════════════════════════════════

function needsWebSearch(message) {
  const lower = message.toLowerCase();
  const marketKeywords = [
    "market rate", "market rent", "market price", "below market", "above market",
    "at market", "market comparison", "market data", "market report",
    "comparable", "comparables", "comp ", "comps",
    "benchmark", "benchmarking",
    "vacancy rate", "vacancy data", "cap rate", "going rate",
    "what are rents", "current rents in", "average rent in",
    "industry average", "industry benchmark",
  ];
  return marketKeywords.some((kw) => lower.includes(kw));
}

router.post("/leases/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");

  const { message, projectId, propertyId, history = [], model } = req.body;
  const useClaude = model === 'claude';
  const chatFn = useClaude ? claudeChatWithLeases : geminiChatWithLeases;
  const crossFn = useClaude ? claudeChatCrossPortfolio : geminiChatCrossPortfolio;
  const scopeId = projectId || propertyId;

  if (!message?.trim()) {
    res.write(sseEvent("error", { message: "Empty message" }));
    return res.end();
  }

  const emit = (msg) => {
    addLog("chat", msg);
    res.write(sseEvent("step", { message: msg }));
  };

  try {
    let response;
    let sources = [];
    const useSearch = needsWebSearch(message);
    if (useSearch) emit("Market data question detected — web search enabled");

    if (scopeId && scopeId !== "all") {
      // Load project persona + attached skills
      const project = await getProjectById(scopeId);
      const skills = project?.skillIds?.length
        ? await getSkillsByIds(project.skillIds)
        : [];
      const skillBlock = skills.length > 0
        ? "\n\n## Active Skills\n\n" + skills.map((s) => `### ${s.name}\n${s.instructions}`).join("\n\n")
        : "";
      const persona = project
        ? (project.persona || "") + skillBlock
        : undefined;
      if (project) emit(`Project: ${project.name}${skills.length > 0 ? ` (${skills.length} skill${skills.length !== 1 ? "s" : ""} active)` : ""}`);

      emit("Loading leases from Firestore...");
      let leases = await getLeasesByProject(scopeId);
      if (leases.length === 0) {
        leases = await getLeasesByProperty(scopeId);
      }

      if (leases.length === 0) {
        res.write(sseEvent("done", {
          response: "No leases found for this project. Upload some lease PDFs first.",
        }));
        return res.end();
      }

      emit(`Loaded ${leases.length} lease(s) into context`);

      const leaseTexts = leases.map((l) => ({
        tenantName: l.tenantName || "Unknown",
        suiteNumber: l.suiteNumber || "N/A",
        text: l.fullText || "",
      }));

      sources = leases.map((l) => ({
        id: l.id || l.sourceFile,
        tenantName: l.tenantName || "Unknown",
        suiteNumber: l.suiteNumber || "N/A",
        propertyAddress: l.propertyAddress || "Unknown",
        leaseStartDate: l.leaseStartDate,
        leaseEndDate: l.leaseEndDate,
        monthlyRent: l.monthlyRent,
        squareFootage: l.squareFootage,
        rentEscalationTerms: l.rentEscalationTerms,
        renewalOptions: l.renewalOptions,
      }));

      const totalChars = leaseTexts.reduce((sum, l) => sum + l.text.length, 0);
      emit(`Building prompt — ${totalChars.toLocaleString()} chars of lease text`);

      emit(useClaude ? "Calling Claude..." : "Calling Gemini...");
      const result = await chatFn(leaseTexts, message, history, useSearch, persona, req.headers['x-user-id'] || null);
      for (const q of result.searchQueries) {
        emit(`Web search: "${q}"`);
      }
      response = result.text;
    } else {
      emit("Loading portfolio data from Firestore...");
      const allLeases = await getAllLeases();

      if (allLeases.length === 0) {
        res.write(sseEvent("done", {
          response: "No leases in the system yet. Upload some lease PDFs first.",
        }));
        return res.end();
      }

      emit(`Loaded summaries for ${allLeases.length} lease(s)`);

      sources = allLeases.map((l) => ({
        id: l.id || l.sourceFile,
        tenantName: l.tenantName || "Unknown",
        suiteNumber: l.suiteNumber || "N/A",
        propertyAddress: l.propertyAddress || "Unknown",
        leaseStartDate: l.leaseStartDate,
        leaseEndDate: l.leaseEndDate,
        monthlyRent: l.monthlyRent,
        squareFootage: l.squareFootage,
        rentEscalationTerms: l.rentEscalationTerms,
        renewalOptions: l.renewalOptions,
      }));

      const summaries = allLeases.map((l) => ({
        tenantName: l.tenantName || "Unknown",
        suiteNumber: l.suiteNumber || "N/A",
        propertyAddress: l.propertyAddress || "Unknown",
        leaseStartDate: l.leaseStartDate,
        leaseEndDate: l.leaseEndDate,
        monthlyRent: l.monthlyRent,
        squareFootage: l.squareFootage,
        renewalOptions: l.renewalOptions,
        specialProvisions: l.specialProvisions,
      }));

      emit("Building cross-portfolio prompt...");
      emit(useClaude ? "Calling Claude..." : "Calling Gemini...");
      const result = await crossFn(summaries, message, history, useSearch, req.headers['x-user-id'] || null);
      for (const q of result.searchQueries) {
        emit(`Web search: "${q}"`);
      }
      response = result.text;
    }

    emit("Response received");
    addLog("chat", `Response: ${response.length} chars`, "success");

    res.write(sseEvent("done", { response, sources }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    addLog("chat", `ERROR: ${msg}`, "error");
    res.write(sseEvent("error", { message: msg }));
  }

  res.end();
});

// ══════════════════════════════════════════════════════════════════════
// LEASE CRUD
// ══════════════════════════════════════════════════════════════════════

router.get("/leases", async (req, res) => {
  try {
    const { property, project, search } = req.query;
    let leases;

    if (search) {
      leases = await searchLeases(search);
    } else if (project) {
      leases = await getLeasesByProject(project);
    } else if (property) {
      leases = await getLeasesByProperty(property);
    } else {
      leases = await getAllLeases();
    }

    // Strip fullText for listing performance
    const result = leases.map(({ fullText, ...rest }) => rest);
    res.json({ leases: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/leases/dashboard", async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/leases/:id", async (req, res) => {
  try {
    const lease = await getLeaseById(req.params.id);
    if (!lease) return res.status(404).json({ error: "Lease not found" });
    res.json({ lease });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/leases/all", async (req, res) => {
  try {
    const result = await deleteAllData();
    res.json({ success: true, deleted: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/leases/:id", async (req, res) => {
  try {
    await deleteLease(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// LEASE PROJECTS (Firestore-backed)
// ══════════════════════════════════════════════════════════════════════

router.get("/lease-projects", async (req, res) => {
  try {
    const projects = await getProjects();
    res.json({ projects });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/lease-projects", async (req, res) => {
  try {
    const { name, persona } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const project = await createProject(name, persona || "");
    res.status(201).json({ project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/lease-projects/:id", async (req, res) => {
  try {
    const project = await getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const leases = await getLeasesByProject(req.params.id);
    const skills = project.skillIds?.length ? await getSkillsByIds(project.skillIds) : [];
    res.json({ project, leases: leases.map(({ fullText, ...rest }) => rest), skills });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/lease-projects/:id", async (req, res) => {
  try {
    const { name, persona, addSkill, removeSkill } = req.body;
    if (addSkill) {
      await addSkillToProject(req.params.id, addSkill);
    } else if (removeSkill) {
      await removeSkillFromProject(req.params.id, removeSkill);
    } else {
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (persona !== undefined) updates.persona = persona;
      await updateProject(req.params.id, updates);
    }
    const project = await getProjectById(req.params.id);
    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/lease-projects/:id", async (req, res) => {
  try {
    await deleteProject(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// LEASE SKILLS
// ══════════════════════════════════════════════════════════════════════

router.get("/lease-skills", async (req, res) => {
  try {
    const skills = await getSkills();
    res.json({ skills });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/lease-skills", async (req, res) => {
  try {
    const { name, description, instructions } = req.body;
    if (!name || !instructions) return res.status(400).json({ error: "Name and instructions required" });
    const skill = await createSkill(name, description || "", instructions);
    res.status(201).json({ skill });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/lease-skills/:id", async (req, res) => {
  try {
    const { name, description, instructions } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (instructions !== undefined) updates.instructions = instructions;
    await updateSkill(req.params.id, updates);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/lease-skills/:id", async (req, res) => {
  try {
    await deleteSkill(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// PROPERTIES
// ══════════════════════════════════════════════════════════════════════

router.get("/lease-properties", async (req, res) => {
  try {
    const properties = await getAllProperties();
    const stats = await getDashboardStats();
    res.json({ properties, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// LOGS
// ══════════════════════════════════════════════════════════════════════

router.get("/lease-logs", (req, res) => {
  const since = req.query.since;
  const logs = getLogs(since);
  res.json({ logs });
});

router.delete("/lease-logs", (req, res) => {
  clearLogs();
  res.json({ success: true });
});

export default router;
