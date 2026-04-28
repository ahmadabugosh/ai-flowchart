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
  const channel = hasAny(lower, ["email"]) ? "Email / web intake" : hasAny(lower, ["form", "portal"]) ? "Portal intake" : "Request intake";
  const core = isSupport ? "Create support case" : isInventory ? "Create order record" : isSales ? "Create opportunity" : "Create workflow case";
  const record = isFinance ? "Billing ledger" : isInventory ? "Inventory database" : isSales ? "CRM records" : "Operations database";
  const external = isFinance ? "Payment provider" : isInventory ? "Carrier / ERP" : isSales ? "CRM / quoting tool" : "External system";

  const lanes = [
    { id: "customer", label: "Customer / requester", y: 42 },
    { id: "ops", label: "Operations team", y: 212 },
    { id: "system", label: "Workflow platform", y: 382 },
    { id: "external", label: "External systems", y: 552 }
  ];

  const nodes = [
    node("n1", "Start", "terminator", "terminator", "Workflow begins when a request arrives.", "Customer", 88, 78),
    node("n2", channel, "intake", "document", "Capture request details, files, and contact data.", "Customer", 330, 64),
    node("n3", "Review request", "process", "process", "Dispatcher or coordinator checks completeness.", "Operations", 330, 234),
    node("n4", "Complete?", "decision", "decision", "Decide whether the request has enough detail.", "Operations", 650, 222),
    node("n5", "Ask for details", "process", "document", "Send a clarification message and pause the case.", "Operations", 650, 64),
    node("n6", "Classify priority", "automation", "process", "AI suggests category, urgency, and owner.", "Workflow platform", 970, 404),
    node("n7", "Approval needed?", "decision", "decision", "Branch if quote, refund, exception, or manager approval is required.", "Workflow platform", 1280, 392),
    node("n8", "Manager approval", "process", "process", "Responsible manager approves, rejects, or requests changes.", "Operations", 1280, 234),
    node("n9", core, "process", "process", "Create the operational record and assign ownership.", "Workflow platform", 1600, 404),
    node("n10", record, "data", "database", "Persist state, audit events, and reference data.", "Workflow platform", 1900, 404),
    node("n11", external, "external", "external", "Sync updates with the required third-party system.", "External", 1900, 574),
    node("n12", "Notify requester", "process", "document", "Send status, schedule, quote, or completion update.", "Workflow platform", 2260, 404),
    node("n13", "Done", "terminator", "terminator", "Workflow reaches a tracked terminal state.", "Customer", 2660, 78)
  ];

  const edges = [
    edge("n1", "n2", "request"),
    edge("n2", "n3", "submitted"),
    edge("n3", "n4", "triage"),
    edge("n4", "n5", "No"),
    edge("n5", "n2", "resubmit"),
    edge("n4", "n6", "Yes"),
    edge("n6", "n7", "routed"),
    edge("n7", "n8", "Yes"),
    edge("n8", "n9", "approved"),
    edge("n7", "n9", "No"),
    edge("n9", "n10", "write state"),
    edge("n9", "n11", "sync"),
    edge("n10", "n12", "status"),
    edge("n11", "n12", "confirmation"),
    edge("n12", "n13", "closed")
  ];

  return {
    provider: "local",
    model: "local-workflow-parser",
    title: titleFromPrompt(prompt, isSales, isSupport, isInventory, isFinance),
    summary:
      "A swimlane flowchart showing intake, triage, decision branches, approvals, platform automation, data persistence, external sync, and customer notification.",
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
  return terms.some((term) => text.includes(term));
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
