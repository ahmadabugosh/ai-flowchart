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
const openaiDot = document.querySelector("#openaiDot");
const openaiStatus = document.querySelector("#openaiStatus");
const settingsIdentity = document.querySelector("#settingsIdentity");
const settingsForm = document.querySelector("#settingsForm");
const openaiApiKey = document.querySelector("#openaiApiKey");
const openaiModel = document.querySelector("#openaiModel");
const keyState = document.querySelector("#keyState");
const clearKeyBtn = document.querySelector("#clearKeyBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const loopsStatus = document.querySelector("#loopsStatus");
const requestCodeForm = document.querySelector("#requestCodeForm");
const verifyCodeForm = document.querySelector("#verifyCodeForm");
const emailInput = document.querySelector("#email");
const codeInput = document.querySelector("#code");
const authMessage = document.querySelector("#authMessage");

const tabs = {
  diagram: [document.querySelector("#diagramTab"), document.querySelector("#diagramPanel")],
  settings: [document.querySelector("#settingsTab"), document.querySelector("#settingsPanel")],
  login: [document.querySelector("#loginTab"), document.querySelector("#loginPanel")]
};

const colors = {
  actor: ["#e8f2ff", "#2866b1"],
  intake: ["#eaf7f3", "#0f7b6c"],
  process: ["#fff4df", "#9a5b00"],
  decision: ["#fff7d6", "#b58100"],
  data: ["#f1ecff", "#6841aa"],
  automation: ["#eaf2ef", "#3e715f"],
  external: ["#ffeceb", "#aa3e38"],
  document: ["#edf4ff", "#4d6f9f"],
  terminator: ["#eef1f5", "#5b6673"]
};

const samples = [
  "A commercial cleaning company takes leads from a website form, qualifies them by building size, creates quotes, routes approvals to managers, schedules crews, texts customers, tracks job completion photos, and invoices through QuickBooks.",
  "A medical device distributor receives hospital purchase orders, checks inventory, validates compliance documents, reserves stock, coordinates warehouse picking, sends shipment notices, and syncs invoices with the ERP.",
  "A SaaS support team receives tickets by email and chat, classifies urgency with AI, checks account health, escalates bugs to engineering, sends customer updates, and reports SLA breaches to operations."
];

let latestDiagram = null;
let appConfig = null;

init();

async function init() {
  bindEvents();
  await loadConfig();
  await generate();
}

function bindEvents() {
  Object.entries(tabs).forEach(([name, [button]]) => {
    button.addEventListener("click", () => showPanel(name));
  });
  generateBtn.addEventListener("click", generate);
  sampleBtn.addEventListener("click", () => {
    const current = samples.indexOf(promptInput.value);
    promptInput.value = samples[(current + 1 + samples.length) % samples.length] || samples[0];
  });
  fitBtn.addEventListener("click", () => stage.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  exportSvgBtn.addEventListener("click", () => download("workflow-flowchart.svg", serializeSvg(), "image/svg+xml"));
  exportPngBtn.addEventListener("click", exportPng);
  requestCodeForm.addEventListener("submit", requestLoginCode);
  verifyCodeForm.addEventListener("submit", verifyLoginCode);
  settingsForm.addEventListener("submit", saveSettings);
  clearKeyBtn.addEventListener("click", clearKey);
  logoutBtn.addEventListener("click", logout);
}

function showPanel(name) {
  Object.entries(tabs).forEach(([key, [button, panel]]) => {
    const active = key === name;
    button.classList.toggle("active", active);
    panel.classList.toggle("active", active);
  });
}

async function loadConfig() {
  appConfig = await fetchJson("/api/config");
  const isModelBacked = appConfig.provider !== "local";
  providerStatus.textContent = appConfig.user
    ? `Logged in as ${appConfig.user.email}`
    : "Not logged in";
  modelDetails.textContent = isModelBacked
    ? `Model-backed generation enabled with ${appConfig.model}.`
    : "Using local prototype engine. Login and add an OpenAI API key for model-backed diagrams.";
  openaiDot.classList.toggle("muted", !isModelBacked);
  openaiStatus.textContent = appConfig.user?.hasOpenAIKey
    ? "Using your saved OpenAI API key."
    : "No user key saved.";
  settingsIdentity.textContent = appConfig.user
    ? `Signed in as ${appConfig.user.email}`
    : "Login to save model settings.";
  loopsStatus.textContent = appConfig.loopsEnabled
    ? "Loops transactional email is configured."
    : "Loops variables are missing, so development codes are shown after request.";
  document.querySelector("#loginTab").textContent = appConfig.user ? "Account" : "Login";
  if (appConfig.user) await loadSettings();
}

async function loadSettings() {
  try {
    const settings = await fetchJson("/api/settings");
    openaiModel.value = settings.openaiModel;
    keyState.textContent = settings.hasOpenAIKey ? "A user OpenAI key is saved." : "No user key saved.";
  } catch {
    keyState.textContent = "Login to view settings.";
  }
}

async function requestLoginCode(event) {
  event.preventDefault();
  setAuthMessage("Sending code...");
  const result = await fetchJson("/api/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: emailInput.value })
  });
  setAuthMessage(result.devCode ? `${result.message} Code: ${result.devCode}` : result.message);
}

async function verifyLoginCode(event) {
  event.preventDefault();
  setAuthMessage("Verifying...");
  await fetchJson("/api/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: emailInput.value, code: codeInput.value })
  });
  setAuthMessage("Logged in.");
  await loadConfig();
  showPanel("settings");
}

async function saveSettings(event) {
  event.preventDefault();
  await fetchJson("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      openaiApiKey: openaiApiKey.value,
      openaiModel: openaiModel.value
    })
  });
  openaiApiKey.value = "";
  await loadConfig();
  keyState.textContent = "Settings saved.";
}

async function clearKey() {
  await fetchJson("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clearOpenAIKey: true, openaiModel: openaiModel.value })
  });
  await loadConfig();
  keyState.textContent = "OpenAI key cleared.";
}

async function logout() {
  await fetchJson("/api/auth/logout", { method: "POST" });
  await loadConfig();
  showPanel("login");
}

function setAuthMessage(message) {
  authMessage.textContent = message;
}

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
  drawLanes(diagram.lanes || []);

  for (const edge of diagram.edges) {
    const from = diagram.nodes.find((node) => node.id === edge.from);
    const to = diagram.nodes.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    drawEdge(from, to, edge.label);
  }
  for (const node of diagram.nodes) drawNode(node);
}

function drawLanes(lanes) {
  lanes.forEach((lane, index) => {
    const y = lane.y;
    svg.appendChild(element("rect", {
      x: "24",
      y,
      width: "1990",
      height: "132",
      fill: index % 2 === 0 ? "#fbfcfd" : "#f4f7fa",
      stroke: "#d8dee6",
      "stroke-width": "1"
    }));
    svg.appendChild(element("text", {
      x: "44",
      y: y + 24,
      "font-size": "13",
      "font-weight": "800",
      fill: "#475464"
    }, lane.label));
  });
}

function drawEdge(from, to, label) {
  const start = anchor(from, to, "out");
  const end = anchor(to, from, "in");
  const mid = Math.max(28, Math.abs(end.x - start.x) / 2);
  const path = element("path", {
    d: `M ${start.x} ${start.y} C ${start.x + mid} ${start.y}, ${end.x - mid} ${end.y}, ${end.x} ${end.y}`,
    fill: "none",
    stroke: "#7d8895",
    "stroke-width": "2",
    "marker-end": "url(#arrow)"
  });
  svg.appendChild(path);

  const text = element("text", {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2 - 10,
    "text-anchor": "middle",
    "font-size": "12",
    "font-weight": "700",
    fill: "#4d5966"
  }, label);
  svg.appendChild(text);
}

function anchor(node, other, mode) {
  const box = bounds(node);
  if (Math.abs(other.y - node.y) > Math.abs(other.x - node.x)) {
    return other.y < node.y
      ? { x: box.cx, y: box.y }
      : { x: box.cx, y: box.y + box.h };
  }
  return mode === "out"
    ? { x: box.x + box.w, y: box.cy }
    : { x: box.x, y: box.cy };
}

function bounds(node) {
  const size = node.shape === "decision" ? { w: 150, h: 112 } : { w: 170, h: 86 };
  if (node.shape === "terminator") return { x: node.x, y: node.y, w: 142, h: 58, cx: node.x + 71, cy: node.y + 29 };
  return { x: node.x, y: node.y, w: size.w, h: size.h, cx: node.x + size.w / 2, cy: node.y + size.h / 2 };
}

function drawNode(node) {
  const [fill, stroke] = colors[node.type] || colors.process;
  const group = element("g", { tabindex: "0" });
  const b = bounds(node);
  drawShape(group, node, b, fill, stroke);

  const titleY = node.shape === "decision" ? node.y + 48 : node.y + 28;
  const titleLines = wrap(node.label, node.shape === "decision" ? 16 : 20).slice(0, 2);
  titleLines.forEach((line, index) => {
    group.appendChild(element("text", {
      x: b.cx,
      y: titleY + index * 15,
      "text-anchor": "middle",
      "font-size": "13",
      "font-weight": "800",
      fill: "#17202a"
    }, line));
  });

  if (node.shape !== "decision" && node.shape !== "terminator") {
    group.appendChild(element("text", {
      x: b.x + 14,
      y: b.y + 54,
      "font-size": "10",
      "font-weight": "800",
      fill: stroke
    }, node.owner || node.type.toUpperCase()));
    const wrapped = wrap(node.description, 24).slice(0, 1);
    wrapped.forEach((line, index) => {
      group.appendChild(element("text", {
        x: b.x + 14,
        y: b.y + 72 + index * 13,
        "font-size": "10",
        fill: "#4e5b67"
      }, line));
    });
  }

  svg.appendChild(group);
}

function drawShape(group, node, b, fill, stroke) {
  if (node.shape === "decision") {
    group.appendChild(element("polygon", {
      points: `${b.cx},${b.y} ${b.x + b.w},${b.cy} ${b.cx},${b.y + b.h} ${b.x},${b.cy}`,
      fill,
      stroke,
      "stroke-width": "2"
    }));
    return;
  }
  if (node.shape === "terminator") {
    group.appendChild(element("rect", {
      x: b.x,
      y: b.y,
      width: b.w,
      height: b.h,
      rx: "29",
      fill,
      stroke,
      "stroke-width": "2"
    }));
    return;
  }
  if (node.shape === "database") {
    group.appendChild(element("path", {
      d: `M ${b.x} ${b.y + 14} C ${b.x} ${b.y - 4}, ${b.x + b.w} ${b.y - 4}, ${b.x + b.w} ${b.y + 14} L ${b.x + b.w} ${b.y + b.h - 14} C ${b.x + b.w} ${b.y + b.h + 4}, ${b.x} ${b.y + b.h + 4}, ${b.x} ${b.y + b.h - 14} Z`,
      fill,
      stroke,
      "stroke-width": "2"
    }));
    group.appendChild(element("path", {
      d: `M ${b.x} ${b.y + 14} C ${b.x} ${b.y + 32}, ${b.x + b.w} ${b.y + 32}, ${b.x + b.w} ${b.y + 14}`,
      fill: "none",
      stroke,
      "stroke-width": "2"
    }));
    return;
  }
  if (node.shape === "document") {
    group.appendChild(element("path", {
      d: `M ${b.x} ${b.y} H ${b.x + b.w} V ${b.y + b.h - 16} C ${b.x + b.w - 42} ${b.y + b.h + 8}, ${b.x + 42} ${b.y + b.h - 34}, ${b.x} ${b.y + b.h - 10} Z`,
      fill,
      stroke,
      "stroke-width": "2"
    }));
    return;
  }
  if (node.shape === "external") {
    group.appendChild(element("path", {
      d: `M ${b.x + 18} ${b.y} H ${b.x + b.w} L ${b.x + b.w - 18} ${b.y + b.h} H ${b.x} Z`,
      fill,
      stroke,
      "stroke-width": "2"
    }));
    return;
  }
  group.appendChild(element("rect", {
    x: b.x,
    y: b.y,
    width: b.w,
    height: b.h,
    rx: "8",
    fill,
    stroke,
    "stroke-width": "2"
  }));
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
  markerEl.appendChild(element("path", { d: "M0,0 L0,6 L9,3 z", fill: "#7d8895" }));
  return markerEl;
}

function wrap(text, maxLength) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength && line) {
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

async function exportPng() {
  const blob = new Blob([serializeSvg()], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2050;
    canvas.height = 680;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((pngBlob) => {
      if (pngBlob) download("workflow-flowchart.png", pngBlob, "image/png");
    });
  };
  image.src = url;
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
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text) el.textContent = text;
  return el;
}
