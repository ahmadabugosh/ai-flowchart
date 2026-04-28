import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = process.env.DATA_DIR || join("/tmp", "workflow-architect-data");
const dbPath = join(dataDir, "db.json");
const port = Number(process.env.PORT || 3000);
const defaultModel = process.env.OPENAI_MODEL || "gpt-5-mini";
const cookieName = "wa_session";
const appSecret = process.env.APP_SECRET || "dev-secret-change-me";
const codeTtlMs = 10 * 60 * 1000;
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const session = await getSession(req);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      const settings = session ? await getUserSettings(session.email) : null;
      const provider = settings?.openaiApiKey ? "user-openai" : process.env.OPENAI_API_KEY ? "openai" : "local";
      return sendJson(res, 200, {
        provider,
        model: provider === "local" ? "local-workflow-parser" : settings?.openaiModel || defaultModel,
        user: session ? { email: session.email, hasOpenAIKey: Boolean(settings?.openaiApiKey) } : null,
        loopsEnabled: loopsConfigured(),
        chatgptSubscriptionLoginSupported: false
      });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/request-code") {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      if (!email) return sendJson(res, 400, { error: "A valid email is required." });
      if (isProductionLike() && !loopsConfigured()) {
        return sendJson(res, 503, { error: "Loops is not configured for passwordless login." });
      }

      const code = String(crypto.randomInt(100000, 999999));
      const db = await readDb();
      db.loginCodes[email] = {
        codeHash: hashValue(code),
        expiresAt: Date.now() + codeTtlMs,
        attempts: 0
      };
      await writeDb(db);

      const sent = await sendLoginCode(email, code);
      return sendJson(res, 200, {
        ok: true,
        sent,
        devCode: sent || isProductionLike() ? undefined : code,
        message: sent
          ? "Login code sent."
          : "Loops is not configured, so the code is shown for development."
      });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify-code") {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const code = String(body.code || "").trim();
      const db = await readDb();
      const record = email ? db.loginCodes[email] : null;

      if (!record || record.expiresAt < Date.now()) {
        return sendJson(res, 400, { error: "Code expired or was not requested." });
      }
      if (record.attempts >= 5) {
        return sendJson(res, 429, { error: "Too many attempts. Request a fresh code." });
      }
      if (record.codeHash !== hashValue(code)) {
        record.attempts += 1;
        await writeDb(db);
        return sendJson(res, 400, { error: "Invalid code." });
      }

      delete db.loginCodes[email];
      const token = crypto.randomBytes(32).toString("base64url");
      db.sessions[hashValue(token)] = { email, expiresAt: Date.now() + sessionTtlMs };
      db.users[email] ||= { email, settings: {} };
      await writeDb(db);

      res.setHeader("set-cookie", serializeCookie(cookieName, token, sessionTtlMs));
      return sendJson(res, 200, { ok: true, user: { email } });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      if (session) {
        const db = await readDb();
        delete db.sessions[session.sessionHash];
        await writeDb(db);
      }
      res.setHeader("set-cookie", serializeCookie(cookieName, "", 0));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      if (!session) return sendJson(res, 401, { error: "Login required." });
      const settings = await getUserSettings(session.email);
      return sendJson(res, 200, {
        email: session.email,
        openaiModel: settings.openaiModel || defaultModel,
        hasOpenAIKey: Boolean(settings.openaiApiKey)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      if (!session) return sendJson(res, 401, { error: "Login required." });
      const body = await readJson(req);
      const db = await readDb();
      db.users[session.email] ||= { email: session.email, settings: {} };
      const settings = db.users[session.email].settings;

      settings.openaiModel = String(body.openaiModel || defaultModel).trim() || defaultModel;
      if (typeof body.openaiApiKey === "string" && body.openaiApiKey.trim()) {
        settings.openaiApiKey = encrypt(body.openaiApiKey.trim());
      }
      if (body.clearOpenAIKey) {
        delete settings.openaiApiKey;
      }

      await writeDb(db);
      return sendJson(res, 200, {
        ok: true,
        openaiModel: settings.openaiModel,
        hasOpenAIKey: Boolean(settings.openaiApiKey)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readJson(req);
      const prompt = String(body.prompt || "").trim();
      const refinement = String(body.refinement || "").trim();
      if (!prompt) return sendJson(res, 400, { error: "Prompt is required." });

      const settings = session ? await getUserSettings(session.email) : null;
      const userKey = settings?.openaiApiKey ? decrypt(settings.openaiApiKey) : null;
      const key = userKey || process.env.OPENAI_API_KEY;
      const model = settings?.openaiModel || defaultModel;
      const result = key
        ? await generateWithOpenAI({
          prompt,
          refinement,
          currentDiagram: body.currentDiagram,
          apiKey: key,
          model,
          provider: userKey ? "user-openai" : "openai"
        })
        : generateLocally(refinement ? `${prompt}\n\nRefinement: ${refinement}` : prompt);

      return sendJson(res, 200, result);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Unexpected server error." });
  }
});

server.listen(port, () => {
  console.log(`Workflow Architect running at http://localhost:${port}`);
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readDb() {
  await mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await readFile(dbPath, "utf8"));
  } catch {
    return { users: {}, sessions: {}, loginCodes: {} };
  }
}

async function writeDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

async function getSession(req) {
  const token = parseCookies(req.headers.cookie || "")[cookieName];
  if (!token) return null;
  const sessionHash = hashValue(token);
  const db = await readDb();
  const session = db.sessions[sessionHash];
  if (!session || session.expiresAt < Date.now()) {
    if (session) {
      delete db.sessions[sessionHash];
      await writeDb(db);
    }
    return null;
  }
  return { ...session, sessionHash };
}

async function getUserSettings(email) {
  const db = await readDb();
  return db.users[email]?.settings || {};
}

function parseCookies(header) {
  return Object.fromEntries(header.split(";").filter(Boolean).map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
}

function serializeCookie(name, value, maxAgeMs) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function normalizeEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

function hashValue(value) {
  return crypto.createHmac("sha256", appSecret).update(value).digest("hex");
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(appSecret).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value) {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  const key = crypto.createHash("sha256").update(appSecret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

async function sendLoginCode(email, code) {
  if (!loopsConfigured()) {
    if (isProductionLike()) {
      throw new Error("Loops is not configured for passwordless login.");
    }
    console.log(`Login code for ${email}: ${code}`);
    return false;
  }

  const response = await fetch("https://app.loops.so/api/v1/transactional", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.LOOPS_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      transactionalId: process.env.LOOPS_TRANSACTIONAL_ID,
      addToAudience: true,
      dataVariables: { code }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Loops email failed: ${response.status} ${detail}`);
  }
  return true;
}

function isProductionLike() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_PROJECT_ID);
}

function loopsConfigured() {
  return Boolean(process.env.LOOPS_API_KEY && process.env.LOOPS_TRANSACTIONAL_ID);
}

async function generateWithOpenAI({ prompt, refinement, currentDiagram, apiKey, model, provider }) {
  const schema = {
    name: "system_architecture_diagram",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "lanes", "nodes", "edges", "risks", "assumptions"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        lanes: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "y"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              y: { type: "number" }
            }
          }
        },
        nodes: {
          type: "array",
          minItems: 8,
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "type", "shape", "description", "owner", "x", "y"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: {
                type: "string",
                enum: ["actor", "intake", "process", "decision", "data", "automation", "external", "document", "terminator"]
              },
              shape: {
                type: "string",
                enum: ["terminator", "process", "decision", "data", "document", "database", "external", "actor"]
              },
              description: { type: "string" },
              owner: { type: "string" },
              x: { type: "number" },
              y: { type: "number" }
            }
          }
        },
        edges: {
          type: "array",
          minItems: 8,
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "label"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" }
            }
          }
        },
        risks: { type: "array", items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } }
      }
    },
    strict: true
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Convert business workflow descriptions into professional flowchart/system diagrams. Include swimlanes for responsible parties, flowchart shapes (terminator, process rectangle, decision diamond, document, database cylinder, external system), explicit decision branches like Yes/No, and operational handoffs. Return only JSON matching the schema. Use stable ids like n1. Keep node labels to 1-4 short words, owner labels to 1-3 words, and descriptions under 70 characters so text fits inside shapes. Space nodes generously: leave at least 90px between shape boundaries horizontally and 50px vertically, and place edge labels in open space between shapes."
        },
        { role: "user", content: buildGenerationPrompt(prompt, refinement, currentDiagram) }
      ],
      text: { format: { type: "json_schema", ...schema } }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not include JSON text.");
  return { ...JSON.parse(text), provider, model };
}

function buildGenerationPrompt(prompt, refinement, currentDiagram) {
  if (!refinement) return prompt;
  return [
    "Original workflow prompt:",
    prompt,
    "",
    "Current diagram JSON:",
    JSON.stringify(currentDiagram || {}, null, 2).slice(0, 12000),
    "",
    "Refinement request:",
    refinement,
    "",
    "Update the diagram to satisfy the refinement while preserving useful existing structure. Return the full revised diagram JSON."
  ].join("\n");
}

function generateLocally(prompt) {
  const lower = prompt.toLowerCase();
  const isSales = hasAny(lower, ["lead", "sales", "crm", "quote", "deal"]);
  const isSupport = hasAny(lower, ["ticket", "support", "customer service", "helpdesk"]);
  const isInventory = hasAny(lower, ["inventory", "warehouse", "fulfillment", "order", "shipment"]);
  const isFinance = hasAny(lower, ["invoice", "payment", "billing", "refund"]);
  const context = {
    isSales,
    isSupport,
    isInventory,
    isFinance,
    channel: hasAny(lower, ["email"]) ? "Email intake" : hasAny(lower, ["form", "portal", "website"]) ? "Portal intake" : "Request intake",
    fallbackCore: isSupport ? "Create case" : isInventory ? "Create order" : isSales ? "Create opportunity" : isFinance ? "Create billing case" : "Create workflow case",
    entity: detectPrimaryEntity(lower),
    hasExternalWords: hasAny(lower, ["erp", "crm", "payment", "carrier", "ship", "shipment", "vendor", "supplier", "quickbooks", "external", "sync"])
  };
  const clauses = extractActionClauses(prompt);
  const specs = clauses.map((clause, index) => buildLocalStepSpec(clause, index, context)).filter(Boolean);
  if (!specs.length) {
    specs.push({
      label: context.fallbackCore,
      type: "process",
      shape: "process",
      owner: "Workflow platform",
      lane: "system",
      description: "Create the main operational record and assign ownership.",
      edgeLabel: "continue"
    });
  }

  const hasOpsLane = specs.some((spec) => spec.lane === "ops");
  const hasExternalLane = specs.some((spec) => spec.lane === "external");
  const lanes = buildLanes(hasOpsLane, hasExternalLane);
  const laneY = Object.fromEntries(lanes.map((lane) => [lane.id, lane.y]));
  const nodes = [];
  const edges = [];
  let nodeIndex = 1;
  let x = 88;
  const gap = 280;

  const start = addStep(nodes, nodeIndex++, "Start", "terminator", "terminator", "Workflow begins when a request arrives.", "Customer", x, laneY.customer);
  let previousMain = start;
  specs.forEach((spec, index) => {
    x += gap;
    const ownerLabel = ownerLabelForLane(spec.lane);
    const step = addStep(
      nodes,
      nodeIndex++,
      spec.label,
      spec.type,
      spec.shape,
      spec.description,
      ownerLabel,
      x,
      laneY[spec.lane] || laneY.system
    );
    edges.push(edge(previousMain.id, step.id, index === 0 ? "request" : spec.edgeLabel));
    previousMain = step;
  });

  x += gap;
  const doneNode = addStep(nodes, nodeIndex++, "Done", "terminator", "terminator", "Workflow reaches a tracked terminal state.", "Customer", x, laneY.customer);
  edges.push(edge(previousMain.id, doneNode.id, "closed"));

  return {
    provider: "local",
    model: "local-workflow-parser",
    title: titleFromPrompt(prompt, isSales, isSupport, isInventory, isFinance),
    summary: localSummaryFromSpecs(specs),
    lanes,
    nodes,
    edges,
    risks: [
      "Approval thresholds and rejection paths should be mapped against actual policy.",
      "System-of-record ownership needs confirmation before connecting production integrations.",
      "Login email delivery requires Loops API variables and a published transactional template."
    ],
    assumptions: [
      "The workflow has one primary requester and one operational owner.",
      "Decision branches can be represented as Yes/No paths for the first prototype.",
      "The platform can store encrypted user API keys when APP_SECRET is stable."
    ]
  };
}

function hasAny(text, terms) {
  return terms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text));
}

function estimateActionCount(text) {
  const matches = text.match(/\b(receive|submit|check|review|validate|qualify|approve|route|create|sync|update|track|notify|email|text|schedule|ship|invoice|refund|classify|escalate)\b/g);
  return Math.max(1, matches?.length || 0);
}

function extractActionClauses(prompt) {
  const segments = prompt
    .replace(/[.]/g, ",")
    .replace(/\bthen\b/gi, ",")
    .split(/[,;]+/)
    .flatMap((segment) => segment.split(/\band\b(?=\s+(?:receives?|submits?|checks?|reviews?|validates?|qualifies?|approves?|routes?|creates?|syncs?|updates?|tracks?|notifies?|emails?|texts?|schedules?|ships?|invoices?|refunds?|classifies?|escalates?|reserves?|coordinates?|processes?|sends?)\b)/i))
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.slice(0, 8);
}

function buildLocalStepSpec(clause, index, context) {
  const lower = clause.toLowerCase();
  const lane = detectLane(lower, index, context);
  const description = sentenceCase(clause, 68);
  const label = labelFromClause(lower, index, context);

  if (hasAny(lower, ["classify", "priority", "score", "assign automatically", "ai"])) {
    return { label, type: "automation", shape: "process", lane: "system", description, edgeLabel: "classified" };
  }
  if (hasAny(lower, ["notify", "email", "text", "message", "send shipment notices", "send customer updates"])) {
    return { label, type: "process", shape: "document", lane, description, edgeLabel: "notified" };
  }
  if (hasAny(lower, ["sync", "ship", "shipment", "carrier", "payment provider", "supplier", "vendor"])) {
    return { label, type: "external", shape: "external", lane: "external", description, edgeLabel: "synced" };
  }
  if (label.endsWith("?")) {
    return { label, type: "decision", shape: "decision", lane, description, edgeLabel: "checked" };
  }
  if (hasAny(lower, ["ledger", "database", "track", "store", "record", "inventory", "crm", "erp"]) && !hasAny(lower, ["review", "check", "validate"])) {
    return { label, type: "data", shape: "database", lane: "system", description, edgeLabel: "updated" };
  }
  if (index === 0 && hasAny(lower, ["receive", "receives", "submit", "submits", "request", "ticket", "lead", "order", "invoice"])) {
    return { label, type: "intake", shape: "document", lane: "customer", description, edgeLabel: "submitted" };
  }
  return { label, type: "process", shape: "process", lane, description, edgeLabel: edgeLabelFromClause(lower) };
}

function detectLane(lower, index, context) {
  if (hasAny(lower, ["notify", "email", "text", "message"])) return "system";
  if (hasAny(lower, ["sync", "ship", "shipment", "carrier", "payment provider", "supplier", "vendor"])) return "external";
  if (hasAny(lower, ["approve", "approval", "review", "check", "validate", "qualify", "budget", "manager", "legal", "finance"])) return "ops";
  if (index === 0 && hasAny(lower, ["receive", "submit", "request", "ticket", "lead", "order"])) return "customer";
  return "system";
}

function labelFromClause(lower, index, context) {
  if (index === 0 && hasAny(lower, ["receive", "receives", "submit", "submits", "request", "ticket", "lead", "order", "invoice"])) {
    return context.channel;
  }
  if (hasAny(lower, ["eligible"])) return "Eligible?";
  if (hasAny(lower, ["complete", "missing"])) return "Complete?";
  if (hasAny(lower, ["valid", "validate", "validation"])) return "Valid?";
  if (hasAny(lower, ["available", "inventory"])) return "In stock?";
  return imperativeLabel(lower, context);
}

function imperativeLabel(lower, context) {
  const verbs = [
    ["receives", "Receive"], ["receive", "Receive"], ["submits", "Submit"], ["submit", "Submit"],
    ["checks", "Check"], ["check", "Check"], ["reviews", "Review"], ["review", "Review"],
    ["validates", "Validate"], ["validate", "Validate"], ["qualifies", "Qualify"], ["qualify", "Qualify"],
    ["approves", "Approve"], ["approve", "Approve"], ["routes", "Route"], ["route", "Route"],
    ["creates", "Create"], ["create", "Create"], ["syncs", "Sync"], ["sync", "Sync"],
    ["updates", "Update"], ["update", "Update"], ["tracks", "Track"], ["track", "Track"],
    ["notifies", "Notify"], ["notify", "Notify"], ["emails", "Email"], ["email", "Email"],
    ["texts", "Text"], ["text", "Text"], ["schedules", "Schedule"], ["schedule", "Schedule"],
    ["ships", "Ship"], ["ship", "Ship"], ["invoices", "Invoice"], ["invoice", "Invoice"],
    ["refunds", "Refund"], ["refund", "Refund"], ["classifies", "Classify"], ["classify", "Classify"],
    ["escalates", "Escalate"], ["escalate", "Escalate"], ["reserves", "Reserve"], ["reserve", "Reserve"],
    ["coordinates", "Coordinate"], ["coordinate", "Coordinate"], ["processes", "Process"], ["process", "Process"],
    ["sends", "Send"], ["send", "Send"]
  ];
  for (const [match, replacement] of verbs) {
    const matchResult = new RegExp(`\\b${escapeRegExp(match)}\\b`).exec(lower);
    if (matchResult) {
      const index = matchResult.index;
      const tail = lower.slice(index + match.length).trim();
      const words = tail
        .replace(/[^a-z0-9/\s-]/g, "")
        .split(/\s+/)
        .filter((word) => word && !["the", "a", "an", "to", "with", "through", "for", "by", "after", "before"].includes(word))
        .slice(0, 3)
        .map(formatToken);
      return [replacement, ...words].join(" ").trim() || context.fallbackCore;
    }
  }
  return context.fallbackCore;
}

function edgeLabelFromClause(lower) {
  if (hasAny(lower, ["approve"])) return "approved";
  if (hasAny(lower, ["review", "check", "validate"])) return "reviewed";
  if (hasAny(lower, ["sync", "ship"])) return "synced";
  if (hasAny(lower, ["notify", "email", "text", "send"])) return "notified";
  if (hasAny(lower, ["create"])) return "created";
  if (hasAny(lower, ["update", "track", "record"])) return "updated";
  return "continue";
}

function detectPrimaryEntity(lower) {
  if (hasAny(lower, ["ticket", "support"])) return "case";
  if (hasAny(lower, ["order", "purchase order"])) return "order";
  if (hasAny(lower, ["invoice", "billing", "refund"])) return "billing case";
  if (hasAny(lower, ["lead", "quote", "deal"])) return "opportunity";
  return "workflow case";
}

function ownerLabelForLane(lane) {
  if (lane === "customer") return "Customer";
  if (lane === "ops") return "Operations";
  if (lane === "external") return "External";
  return "Workflow platform";
}

function localSummaryFromSpecs(specs) {
  const descriptors = [];
  if (specs.some((spec) => spec.type === "decision")) descriptors.push("decision points");
  if (specs.some((spec) => spec.type === "external")) descriptors.push("external handoffs");
  if (specs.some((spec) => spec.type === "data")) descriptors.push("system-of-record updates");
  if (specs.some((spec) => spec.type === "automation")) descriptors.push("automation");
  return descriptors.length
    ? `A generated flowchart based on extracted workflow steps, with ${descriptors.join(", ")}.`
    : "A generated flowchart based on extracted workflow steps from the prompt.";
}

function sentenceCase(text, maxLength) {
  const value = String(text || "").trim();
  const capped = value.length > maxLength ? `${value.slice(0, maxLength - 3).trim()}...` : value;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function formatToken(token) {
  const upper = token.toUpperCase();
  if (["ERP", "CRM", "AI", "PO"].includes(upper)) return upper;
  return token.charAt(0).toLowerCase() === token.charAt(0)
    ? token.charAt(0).toUpperCase() + token.slice(1)
    : token;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLanes(hasOpsLane, hasExternalLane) {
  const lanes = [{ id: "customer", label: "Customer / requester", y: 42 }];
  if (hasOpsLane) lanes.push({ id: "ops", label: "Operations team", y: 212 });
  lanes.push({ id: "system", label: "Workflow platform", y: hasOpsLane ? 382 : 252 });
  if (hasExternalLane) lanes.push({ id: "external", label: "External systems", y: hasOpsLane ? 552 : 422 });
  return lanes;
}

function addStep(nodes, idNum, label, type, shape, description, owner, x, laneY) {
  const id = `n${idNum}`;
  const y = shape === "decision" ? laneY + 10 : shape === "terminator" ? laneY + 36 : laneY + 22;
  const created = node(id, label, type, shape, description, owner, x, y);
  nodes.push(created);
  return created;
}


function titleFromPrompt(prompt, isSales, isSupport, isInventory, isFinance) {
  if (isSales) return "Sales Workflow Flowchart";
  if (isSupport) return "Support Workflow Flowchart";
  if (isInventory) return "Order and Inventory Flowchart";
  if (isFinance) return "Billing Workflow Flowchart";
  const firstWords = prompt.split(/\s+/).slice(0, 6).join(" ");
  return firstWords ? `${capitalize(firstWords)} Flowchart` : "Workflow Flowchart";
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function node(id, label, type, shape, description, owner, x, y) {
  return { id, label, type, shape, description, owner, x, y };
}

function edge(from, to, label) {
  return { from, to, label };
}
