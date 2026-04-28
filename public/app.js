const svg = document.querySelector("#diagram");
const promptInput = document.querySelector("#prompt");
const refinePrompt = document.querySelector("#refinePrompt");
const generateBtn = document.querySelector("#generateBtn");
const refineBtn = document.querySelector("#refineBtn");
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
let clipCounter = 0;

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
  refineBtn.addEventListener("click", refineDiagram);
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

async function refineDiagram() {
  const refinement = refinePrompt.value.trim();
  if (!refinement || !latestDiagram) return;
  setBusy(true);
  try {
    const result = await fetchJson("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: promptInput.value,
        refinement,
        currentDiagram: latestDiagram
      })
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
  clipCounter = 0;
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
      width: "2460",
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

  const labelPoint = edgeLabelPoint(start, end);
  const labelText = String(label || "").slice(0, 28);
  const labelWidth = Math.max(42, measureText(labelText, 12, 700) + 18);
  svg.appendChild(element("rect", {
    x: labelPoint.x - labelWidth / 2,
    y: labelPoint.y - 17,
    width: labelWidth,
    height: "22",
    rx: "6",
    fill: "#ffffff",
    stroke: "#d8dee6",
    "stroke-width": "1"
  }));
  svg.appendChild(element("text", {
    x: labelPoint.x,
    y: labelPoint.y - 2,
    "text-anchor": "middle",
    "font-size": "12",
    "font-weight": "700",
    fill: "#4d5966"
  }, labelText));
}

function edgeLabelPoint(start, end) {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  if (horizontal) {
    return {
      x: (start.x + end.x) / 2,
      y: Math.min(start.y, end.y) - 18
    };
  }
  return {
    x: Math.max(start.x, end.x) + 58,
    y: (start.y + end.y) / 2
  };
}

function anchor(node, other, mode) {
  const box = bounds(node);
  if (Math.abs(other.y - node.y) > Math.abs(other.x - node.x)) {
    return other.y < node.y
      ? { x: box.cx, y: box.y }
      : { x: box.cx, y: box.y + box.h };
  }
  return other.x >= node.x
    ? { x: box.x + box.w, y: box.cy }
    : { x: box.x, y: box.cy };
}

function bounds(node) {
  const size = node.shape === "decision" ? { w: 166, h: 118 } : { w: 184, h: 92 };
  if (node.shape === "terminator") return { x: node.x, y: node.y, w: 142, h: 58, cx: node.x + 71, cy: node.y + 29 };
  return { x: node.x, y: node.y, w: size.w, h: size.h, cx: node.x + size.w / 2, cy: node.y + size.h / 2 };
}

function drawNode(node) {
  const [fill, stroke] = colors[node.type] || colors.process;
  const group = element("g", { tabindex: "0" });
  const b = bounds(node);
  drawShape(group, node, b, fill, stroke);
  addContainedText(group, node, b, stroke);

  svg.appendChild(group);
}

function addContainedText(group, node, b, stroke) {
  const clipId = `node-clip-${clipCounter++}`;
  const clipPath = element("clipPath", { id: clipId });
  clipPath.appendChild(clipShape(node, b));
  svg.querySelector("defs").appendChild(clipPath);

  const textGroup = element("g", { "clip-path": `url(#${clipId})` });
  const content = textContentForNode(node);
  const area = textArea(node, b);
  const layout = fitText(content, area.width, area.height, {
    maxFont: node.shape === "terminator" ? 13 : 12,
    minFont: 8,
    maxLines: node.shape === "terminator" ? 2 : node.shape === "decision" ? 3 : 5,
    weight: 780
  });

  const lineHeight = Math.ceil(layout.fontSize * 1.22);
  const totalHeight = lineHeight * layout.lines.length;
  const firstBaseline = area.y + Math.max(layout.fontSize, (area.height - totalHeight) / 2 + layout.fontSize);
  layout.lines.forEach((line, index) => {
    textGroup.appendChild(element("text", {
      x: area.x + area.width / 2,
      y: firstBaseline + index * lineHeight,
      "text-anchor": "middle",
      "font-size": String(layout.fontSize),
      "font-weight": index === 0 ? "800" : "650",
      fill: index === 1 && node.shape !== "decision" && node.shape !== "terminator" ? stroke : "#17202a",
      "dominant-baseline": "alphabetic"
    }, line));
  });
  group.appendChild(textGroup);
}

function textContentForNode(node) {
  if (node.shape === "terminator") return node.label;
  if (node.shape === "decision") return node.label;
  const owner = node.owner || node.type;
  return `${node.label}\n${owner}\n${node.description || ""}`;
}

function textArea(node, b) {
  if (node.shape === "decision") {
    return {
      x: b.x + b.w * 0.25,
      y: b.y + b.h * 0.25,
      width: b.w * 0.5,
      height: b.h * 0.5
    };
  }
  if (node.shape === "terminator") {
    return { x: b.x + 18, y: b.y + 12, width: b.w - 36, height: b.h - 24 };
  }
  if (node.shape === "external") {
    return { x: b.x + 28, y: b.y + 12, width: b.w - 56, height: b.h - 24 };
  }
  if (node.shape === "document") {
    return { x: b.x + 16, y: b.y + 12, width: b.w - 32, height: b.h - 30 };
  }
  if (node.shape === "database") {
    return { x: b.x + 18, y: b.y + 22, width: b.w - 36, height: b.h - 34 };
  }
  return { x: b.x + 14, y: b.y + 12, width: b.w - 28, height: b.h - 24 };
}

function fitText(text, maxWidth, maxHeight, options) {
  for (let fontSize = options.maxFont; fontSize >= options.minFont; fontSize -= 1) {
    const lineHeight = Math.ceil(fontSize * 1.22);
    const maxLines = Math.min(options.maxLines, Math.floor(maxHeight / lineHeight));
    const lines = wrapSvgText(text, maxWidth, fontSize, maxLines);
    if (lines.length <= maxLines && lines.every((line) => measureText(line, fontSize, options.weight) <= maxWidth)) {
      return { fontSize, lines };
    }
  }
  const lineHeight = Math.ceil(options.minFont * 1.22);
  const maxLines = Math.max(1, Math.min(options.maxLines, Math.floor(maxHeight / lineHeight)));
  return {
    fontSize: options.minFont,
    lines: wrapSvgText(text, maxWidth, options.minFont, maxLines)
  };
}

function wrapSvgText(text, maxWidth, fontSize, maxLines) {
  const sourceLines = String(text || "").split(/\n+/).flatMap((line) => line.trim().split(/\s+/).filter(Boolean));
  const lines = [];
  let line = "";
  for (const word of sourceLines) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = fitWord(word, maxWidth, fontSize);
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    lines[maxLines - 1] = ellipsize(lines[maxLines - 1], maxWidth, fontSize);
  }
  return lines.length ? lines : [""];
}

function fitWord(word, maxWidth, fontSize) {
  if (measureText(word, fontSize) <= maxWidth) return word;
  return ellipsize(word, maxWidth, fontSize);
}

function ellipsize(text, maxWidth, fontSize) {
  let value = String(text || "");
  while (value.length > 1 && measureText(`${value}...`, fontSize) > maxWidth) {
    value = value.slice(0, -1);
  }
  return value.length > 1 ? `${value}...` : "...";
}

function measureText(text, fontSize, fontWeight = 650) {
  const weightFactor = Number(fontWeight) >= 750 ? 0.59 : 0.54;
  return String(text || "").length * fontSize * weightFactor;
}

function clipShape(node, b) {
  if (node.shape === "decision") {
    return element("polygon", {
      points: `${b.cx},${b.y + 4} ${b.x + b.w - 4},${b.cy} ${b.cx},${b.y + b.h - 4} ${b.x + 4},${b.cy}`
    });
  }
  if (node.shape === "terminator") {
    return element("rect", { x: b.x + 4, y: b.y + 4, width: b.w - 8, height: b.h - 8, rx: "25" });
  }
  if (node.shape === "external") {
    return element("path", { d: `M ${b.x + 22} ${b.y + 4} H ${b.x + b.w - 6} L ${b.x + b.w - 22} ${b.y + b.h - 4} H ${b.x + 6} Z` });
  }
  return element("rect", { x: b.x + 4, y: b.y + 4, width: b.w - 8, height: b.h - 8, rx: "6" });
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
  refineBtn.disabled = isBusy;
  generateBtn.textContent = isBusy ? "Generating..." : "↳ Generate";
  refineBtn.textContent = isBusy ? "Refining..." : "Refine diagram";
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
    canvas.width = 2520;
    canvas.height = 720;
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
