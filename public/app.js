const svg = document.querySelector("#diagram");
const promptInput = document.querySelector("#prompt");
const generateBtn = document.querySelector("#generateBtn");
const sampleBtn = document.querySelector("#sampleBtn");
const fitBtn = document.querySelector("#fitBtn");
const exportSvgBtn = document.querySelector("#exportSvgBtn");
const exportPngBtn = document.querySelector("#exportPngBtn");
const providerStatus = document.querySelector("#providerStatus");
const modelDetails = document.querySelector("#modelDetails");
const diagramTitle = document.querySelector("#diagramTitle");
const summary = document.querySelector("#summary");
const risks = document.querySelector("#risks");
const assumptions = document.querySelector("#assumptions");
const stage = document.querySelector("#stage");

const colors = {
  actor: ["#e8f2ff", "#2866b1"],
  channel: ["#eaf7f3", "#0f7b6c"],
  service: ["#fff4df", "#9a5b00"],
  data: ["#f1ecff", "#6841aa"],
  automation: ["#eaf2ef", "#3e715f"],
  external: ["#ffeceb", "#aa3e38"],
  control: ["#eef1f5", "#5b6673"]
};

const samples = [
  "A commercial cleaning company takes leads from a website form, qualifies them by building size, creates quotes, routes approvals to managers, schedules crews, texts customers, tracks job completion photos, and invoices through QuickBooks.",
  "A medical device distributor receives hospital purchase orders, checks inventory, validates compliance documents, reserves stock, coordinates warehouse picking, sends shipment notices, and syncs invoices with the ERP.",
  "A SaaS support team receives tickets by email and chat, classifies urgency with AI, checks account health, escalates bugs to engineering, sends customer updates, and reports SLA breaches to operations."
];

let latestDiagram = null;

init();

async function init() {
  await loadConfig();
  await generate();
}

async function loadConfig() {
  const config = await fetchJson("/api/config");
  providerStatus.textContent = config.provider === "openai"
    ? `Connected to ${config.model}`
    : "Using local prototype engine";
  modelDetails.textContent = config.provider === "openai"
    ? `OpenAI API is enabled with ${config.model}.`
    : "Local parser enabled. Add OPENAI_API_KEY on Railway to use model-backed generation.";
}

generateBtn.addEventListener("click", generate);

sampleBtn.addEventListener("click", () => {
  const current = samples.indexOf(promptInput.value);
  promptInput.value = samples[(current + 1 + samples.length) % samples.length] || samples[0];
});

fitBtn.addEventListener("click", () => {
  stage.scrollTo({ left: 0, top: 0, behavior: "smooth" });
});

exportSvgBtn.addEventListener("click", () => {
  download("workflow-architecture.svg", serializeSvg(), "image/svg+xml");
});

exportPngBtn.addEventListener("click", async () => {
  const blob = new Blob([serializeSvg()], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1320;
    canvas.height = 520;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((pngBlob) => {
      if (pngBlob) download("workflow-architecture.png", pngBlob, "image/png");
    });
  };
  image.src = url;
});

async function generate() {
  setBusy(true);
  try {
    const result = await fetchJson("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: promptInput.value })
    });
    latestDiagram = result;
    render(result);
  } catch (error) {
    summary.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function render(diagram) {
  diagramTitle.textContent = diagram.title;
  summary.textContent = diagram.summary;
  renderList(risks, diagram.risks);
  renderList(assumptions, diagram.assumptions);

  svg.replaceChildren();
  const defs = element("defs");
  defs.appendChild(marker());
  svg.appendChild(defs);

  for (const edge of diagram.edges) {
    const from = diagram.nodes.find((node) => node.id === edge.from);
    const to = diagram.nodes.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    drawEdge(from, to, edge.label);
  }

  for (const node of diagram.nodes) {
    drawNode(node);
  }
}

function drawEdge(from, to, label) {
  const start = { x: from.x + 155, y: from.y + 45 };
  const end = { x: to.x, y: to.y + 45 };
  const mid = Math.max(24, (end.x - start.x) / 2);
  const path = element("path", {
    d: `M ${start.x} ${start.y} C ${start.x + mid} ${start.y}, ${end.x - mid} ${end.y}, ${end.x - 8} ${end.y}`,
    fill: "none",
    stroke: "#8a96a3",
    "stroke-width": "2",
    "marker-end": "url(#arrow)"
  });
  svg.appendChild(path);

  const text = element("text", {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2 - 8,
    "text-anchor": "middle",
    "font-size": "12",
    fill: "#5e6b78"
  });
  text.textContent = label;
  svg.appendChild(text);
}

function drawNode(node) {
  const [fill, stroke] = colors[node.type] || colors.service;
  const group = element("g", { tabindex: "0" });
  group.appendChild(element("rect", {
    x: node.x,
    y: node.y,
    width: "155",
    height: "90",
    rx: "8",
    fill,
    stroke,
    "stroke-width": "2"
  }));
  group.appendChild(element("text", {
    x: node.x + 16,
    y: node.y + 28,
    "font-size": "14",
    "font-weight": "800",
    fill: "#17202a"
  }, node.label));
  group.appendChild(element("text", {
    x: node.x + 16,
    y: node.y + 51,
    "font-size": "11",
    "font-weight": "700",
    fill: stroke
  }, node.type.toUpperCase()));

  const wrapped = wrap(node.description, 23).slice(0, 2);
  wrapped.forEach((line, index) => {
    group.appendChild(element("text", {
      x: node.x + 16,
      y: node.y + 70 + index * 14,
      "font-size": "11",
      fill: "#4e5b67"
    }, line));
  });

  svg.appendChild(group);
}

function marker() {
  const markerEl = element("marker", {
    id: "arrow",
    markerWidth: "10",
    markerHeight: "10",
    refX: "8",
    refY: "3",
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  markerEl.appendChild(element("path", {
    d: "M0,0 L0,6 L9,3 z",
    fill: "#8a96a3"
  }));
  return markerEl;
}

function wrap(text, maxLength) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderList(target, items = []) {
  target.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  }));
}

function setBusy(isBusy) {
  generateBtn.disabled = isBusy;
  generateBtn.textContent = isBusy ? "Generating..." : "↳ Generate";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function serializeSvg() {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function element(name, attrs = {}, text = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  if (text) el.textContent = text;
  return el;
}
