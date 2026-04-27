import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || "gpt-5-mini";

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

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        provider: process.env.OPENAI_API_KEY ? "openai" : "local",
        model: process.env.OPENAI_API_KEY ? model : "local-workflow-parser",
        chatgptSubscriptionLoginSupported: false
      });
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readJson(req);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) {
        return sendJson(res, 400, { error: "Prompt is required." });
      }

      const result = process.env.OPENAI_API_KEY
        ? await generateWithOpenAI(prompt)
        : generateLocally(prompt);

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

  if (!filePath.startsWith(publicDir)) {
    return sendText(res, 403, "Forbidden");
  }

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

async function generateWithOpenAI(prompt) {
  const schema = {
    name: "system_architecture_diagram",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "nodes", "edges", "risks", "assumptions"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        nodes: {
          type: "array",
          minItems: 4,
          maxItems: 16,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "type", "description", "x", "y"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: {
                type: "string",
                enum: ["actor", "channel", "service", "data", "automation", "external", "control"]
              },
              description: { type: "string" },
              x: { type: "number" },
              y: { type: "number" }
            }
          }
        },
        edges: {
          type: "array",
          minItems: 3,
          maxItems: 24,
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
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Convert business workflow descriptions into concise system architecture diagrams. Return only valid JSON that matches the requested schema. Use stable ids like n1, n2. Lay nodes left-to-right from actors/channels to services/data/external systems. Keep labels short."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      text: {
        format: {
          type: "json_schema",
          ...schema
        }
      }
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
  return { ...JSON.parse(text), provider: "openai", model };
}

function generateLocally(prompt) {
  const lower = prompt.toLowerCase();
  const isSales = hasAny(lower, ["lead", "sales", "crm", "quote", "deal"]);
  const isSupport = hasAny(lower, ["ticket", "support", "customer service", "helpdesk"]);
  const isInventory = hasAny(lower, ["inventory", "warehouse", "fulfillment", "order", "shipment"]);
  const isFinance = hasAny(lower, ["invoice", "payment", "billing", "refund"]);
  const channel = hasAny(lower, ["email"]) ? "Email intake" : hasAny(lower, ["form", "portal"]) ? "Web portal" : "Business intake";
  const external = isFinance ? "Payment provider" : isInventory ? "Shipping carrier" : isSales ? "CRM" : "External system";
  const core = isSupport ? "Case management" : isInventory ? "Order orchestration" : isSales ? "Pipeline service" : "Workflow service";
  const record = isFinance ? "Billing ledger" : isInventory ? "Inventory database" : isSales ? "Customer records" : "Operational database";

  const nodes = [
    node("n1", "Business user", "actor", "Starts or monitors the workflow.", 80, 170),
    node("n2", channel, "channel", "Captures the initial request and required context.", 280, 170),
    node("n3", "Validation rules", "control", "Checks completeness, policy, and routing criteria.", 500, 95),
    node("n4", core, "service", "Coordinates tasks, status, ownership, and exceptions.", 500, 245),
    node("n5", "AI classifier", "automation", "Summarizes intent and proposes the next best action.", 735, 95),
    node("n6", record, "data", "Stores source-of-truth records, audit events, and state.", 735, 245),
    node("n7", external, "external", "Receives updates or enriches the workflow with third-party data.", 965, 170),
    node("n8", "Ops dashboard", "service", "Shows queue health, cycle time, blockers, and handoffs.", 1180, 170)
  ];

  const edges = [
    edge("n1", "n2", "submits request"),
    edge("n2", "n3", "normalizes input"),
    edge("n3", "n4", "approved payload"),
    edge("n4", "n5", "classification request"),
    edge("n5", "n4", "recommended action"),
    edge("n4", "n6", "read/write state"),
    edge("n4", "n7", "sync event"),
    edge("n6", "n8", "metrics feed"),
    edge("n4", "n8", "workflow status")
  ];

  return {
    provider: "local",
    model: "local-workflow-parser",
    title: titleFromPrompt(prompt, isSales, isSupport, isInventory, isFinance),
    summary:
      "A generated architecture starting from intake, applying validation and AI-assisted routing, then coordinating state, integrations, and operational visibility.",
    nodes,
    edges,
    risks: [
      "Human approval paths and exception handling need business-specific detail.",
      "Data ownership between the workflow service and existing systems should be confirmed.",
      "Security, retention, and audit requirements may add additional controls."
    ],
    assumptions: [
      "The workflow has a single primary intake channel.",
      "A central orchestration service owns status transitions.",
      "External integrations can exchange events through APIs or webhooks."
    ]
  };
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function titleFromPrompt(prompt, isSales, isSupport, isInventory, isFinance) {
  if (isSales) return "Sales Workflow Architecture";
  if (isSupport) return "Support Workflow Architecture";
  if (isInventory) return "Order and Inventory Architecture";
  if (isFinance) return "Billing Workflow Architecture";
  const firstWords = prompt.split(/\s+/).slice(0, 6).join(" ");
  return firstWords ? `${capitalize(firstWords)} Architecture` : "Workflow Architecture";
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function node(id, label, type, description, x, y) {
  return { id, label, type, description, x, y };
}

function edge(from, to, label) {
  return { from, to, label };
}
