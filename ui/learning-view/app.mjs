const root = document.getElementById("nodes");
const svg = document.getElementById("graph");
const title = document.getElementById("title");
const eyebrow = document.getElementById("eyebrow");
const summary = document.getElementById("summary");
const count = document.getElementById("count");
const status = document.getElementById("status");
const roadmapSection = document.getElementById("roadmap");
const roadmapGoal = document.getElementById("roadmap-goal");
const roadmapRevision = document.getElementById("roadmap-revision");
const roadmapLessons = document.getElementById("roadmap-lessons");
const roadmapGraph = document.getElementById("roadmap-graph");
const roadmapGraphCaption = document.getElementById("roadmap-graph-caption");
const roadmapTruncated = document.getElementById("roadmap-truncated");
const knowledgeGraph = document.getElementById("knowledge-graph");
const practice = document.getElementById("practice");
const exerciseList = document.getElementById("exercises");
const svgNS = "http://www.w3.org/2000/svg";
let viewData = null;
let requestId = 1;
let hostReady = false;
const pending = new Map();

function make(tag, text, attributes = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function renderGraph(data) {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return;
  viewData = data;
  root.replaceChildren(); svg.replaceChildren(); exerciseList.replaceChildren();
  renderRoadmap(data.roadmap);
  const nodes = data.nodes.slice(0, 200);
  knowledgeGraph.hidden = !nodes.length && !data.focusUid;
  const width = Math.max(svg.clientWidth || 600, 320), height = 230;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const positions = new Map(nodes.map((node, index) => [node.id, { x: 48 + (index % 4) * (width - 96) / 3, y: 40 + Math.floor(index / 4) * 76 }]));
  for (const edge of data.edges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (from && to) svg.append(make("line", undefined, { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: "edge" }));
  }
  for (const [index, node] of nodes.entries()) {
    const point = positions.get(node.id);
    const group = make("g", undefined, { class: "node", transform: `translate(${point.x} ${point.y})` });
    group.append(make("circle", undefined, { r: 10 }));
    group.append(make("text", node.label.slice(0, 38), { y: 28 }));
    svg.append(group);
    const item = document.createElement("li");
    const label = document.createElement("span"); label.textContent = node.label;
    item.append(label);
    if (node.path) {
      const path = document.createElement("small"); path.textContent = ` · ${node.path}`; item.append(path);
    }
    root.append(item);
  }
  count.textContent = `${nodes.length} узлов${data.truncated ? " · показана часть графа" : ""}`;
  title.textContent = data.roadmap?.topic ?? (data.lessonUid ? `Урок ${data.lessonUid}` : data.focusUid || "Учебный граф");
  eyebrow.textContent = data.roadmap ? "CONCEPTLOOM · COURSE" : "CONCEPTLOOM · LEARNING";
  summary.textContent = data.roadmap
    ? "Ваш маршрут: цели каждого урока, необходимые связи и подходящие источники."
    : nodes.length ? "Изучайте связи и используйте упражнения для проверки понимания." : "Для этого контекста пока нет связанных заметок.";
  for (const exercise of data.exercises ?? []) renderExercise(exercise);
  practice.hidden = !(data.exercises?.length);
}

function renderRoadmap(roadmap) {
  roadmapLessons.replaceChildren();
  roadmapGraph.replaceChildren();
  roadmapSection.hidden = !roadmap;
  roadmapTruncated.hidden = !roadmap?.truncated;
  if (!roadmap) return;

  roadmapGoal.textContent = roadmap.goal ?? "";
  const revision = String(roadmap.roadmapRevision ?? "");
  roadmapRevision.textContent = revision ? `Версия · ${revision.slice(0, 19)}` : "Черновик";
  roadmapTruncated.textContent = "Показана первая часть маршрута. Откройте полный план в сообщении.";
  const titles = new Map(roadmap.lessons.map(lesson => [lesson.uid, lesson.title]));
  const diagramIds = new Set(roadmap.diagramLessonUids ?? roadmap.lessons.map(lesson => lesson.uid));
  const diagramLessons = roadmap.lessons.filter(lesson => diagramIds.has(lesson.uid));
  roadmapGraphCaption.textContent = roadmap.diagramTruncated
    ? `Схема показывает ${diagramLessons.length} из ${roadmap.lessons.length} уроков. Полный список, цели и источники приведены ниже.`
    : "Стрелки показывают prerequisite-зависимости между уроками.";
  roadmapGraph.setAttribute("viewBox", `0 0 720 ${Math.max(72, diagramLessons.length * 66 + 12)}`);
  roadmapGraph.setAttribute("aria-label", `Схема зависимостей курса: ${diagramLessons.length} уроков`);
  const diagramPositions = new Map(diagramLessons.map((lesson, index) => [lesson.uid, 42 + index * 66]));
  const defs = make("defs");
  const marker = make("marker", undefined, { id: "roadmap-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  marker.append(make("path", undefined, { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--accent)" })); defs.append(marker); roadmapGraph.append(defs);
  for (const lesson of diagramLessons) {
    const targetY = diagramPositions.get(lesson.uid);
    for (const dependencyUid of lesson.prerequisiteLessonUids ?? []) {
      const sourceY = diagramPositions.get(dependencyUid);
      if (sourceY === undefined) continue;
      roadmapGraph.append(make("path", undefined, { d: `M 110 ${sourceY} C 48 ${sourceY}, 48 ${targetY}, 110 ${targetY}`, class: "roadmap-edge" }));
    }
  }
  for (const [index, lesson] of diagramLessons.entries()) {
    const y = diagramPositions.get(lesson.uid);
    const group = make("g", undefined, { class: "roadmap-node" });
    group.append(make("rect", undefined, { x: 110, y: y - 22, width: 570, height: 44, rx: 11 }));
    group.append(make("text", String(index + 1).padStart(2, "0"), { x: 126, y: y + 4, class: "roadmap-node-number" }));
    group.append(make("text", lesson.title.slice(0, 72), { x: 158, y: y + 4 }));
    group.append(make("title", lesson.title)); roadmapGraph.append(group);
  }

  for (const [index, lesson] of roadmap.lessons.entries()) {
    const item = document.createElement("li"); item.className = "roadmap-item";
    const heading = document.createElement("header");
    const name = document.createElement("h3");
    const number = document.createElement("span"); number.className = "lesson-index"; number.textContent = String(index + 1);
    name.append(number, document.createTextNode(lesson.title));
    const duration = document.createElement("span"); duration.className = "duration"; duration.textContent = `${lesson.estimatedMinutes} мин`;
    heading.append(name, duration); item.append(heading);

    if (lesson.objectives?.length) {
      const label = document.createElement("p"); label.textContent = "После урока вы сможете"; item.append(label);
      const objectives = document.createElement("ul");
      for (const objective of lesson.objectives) { const row = document.createElement("li"); row.textContent = objective; objectives.append(row); }
      item.append(objectives);
    }

    if (lesson.prerequisiteLessonUids?.length) {
      const label = document.createElement("p"); label.textContent = "Опирается на"; item.append(label);
      const dependencies = document.createElement("div"); dependencies.className = "dependency-list";
      for (const uid of lesson.prerequisiteLessonUids) {
        const chip = document.createElement("span"); chip.className = "dependency-chip"; chip.textContent = titles.get(uid) ?? uid; dependencies.append(chip);
      }
      item.append(dependencies);
    }

    if (lesson.sources?.length) {
      const label = document.createElement("p"); label.textContent = "Материалы"; item.append(label);
      const sources = document.createElement("div"); sources.className = "source-list";
      for (const source of lesson.sources) {
        let chip;
        try {
          const url = new URL(source.canonicalResource);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported source protocol");
          chip = document.createElement("a"); chip.href = url.href; chip.target = "_blank"; chip.rel = "noopener noreferrer";
        } catch { chip = document.createElement("span"); }
        chip.className = "source-chip";
        const locator = formatLocator(source.locator);
        chip.textContent = `${source.title ?? source.sourceUid}${locator ? ` · ${locator}` : ""}`;
        sources.append(chip);
      }
      item.append(sources);
    }
    roadmapLessons.append(item);
  }
}

function formatLocator(locator) {
  if (!locator) return "";
  if (typeof locator === "string") return locator;
  if (typeof locator !== "object" || Array.isArray(locator)) return "";
  return Object.entries(locator)
    .filter(([key, value]) => value !== undefined && value !== null && !["contentHash", "sourceUid"].includes(key))
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

function renderExercise(exercise) {
  const section = document.createElement("article"); section.className = "exercise";
  const heading = document.createElement("h3"); heading.textContent = exercise.publicSpec.title ?? exercise.uid;
  const prompt = document.createElement("p"); prompt.textContent = exercise.publicSpec.instructions ?? exercise.publicSpec.prompt ?? "Выполните упражнение и объясните ход решения.";
  const label = document.createElement("label"); label.textContent = "Ваш ответ";
  const answer = document.createElement("textarea"); answer.setAttribute("aria-label", `Ответ: ${heading.textContent}`);
  const submit = document.createElement("button"); submit.type = "button"; submit.textContent = "Отправить попытку";
  const download = document.createElement("button"); download.type = "button"; download.className = "quiet"; download.textContent = "Скачать JSON ответа";
  const payload = () => ({ attemptId: `attempt-${crypto.randomUUID()}`, exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: answer.value, artifacts: [], hintUsed: false });
  submit.addEventListener("click", async () => {
    if (!answer.value.trim()) { status.textContent = "Сначала напишите ответ."; answer.focus(); return; }
    if (!hostReady) { status.textContent = "Host-инструменты недоступны. Скачайте ответ и передайте его через loom_submit_practice."; return; }
    try {
      await callTool("loom_submit_practice", payload());
      status.textContent = "Попытка сохранена. Дождитесь отдельной оценки.";
    } catch (error) { status.textContent = `Не удалось передать попытку: ${error.message}`; }
  });
  download.addEventListener("click", () => {
    if (!answer.value.trim()) { status.textContent = "Сначала напишите ответ."; answer.focus(); return; }
    const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${exercise.uid}-attempt.json`; anchor.click(); URL.revokeObjectURL(url);
    status.textContent = "Файл попытки подготовлен для явного импорта.";
  });
  section.append(heading, prompt, label, answer, submit, document.createTextNode(" "), download);
  exerciseList.append(section);
}

function callTool(name, args) {
  const id = requestId++;
  window.parent.postMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, "*");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function handleMessage(event) {
  if (event.source !== window.parent || !event.data || event.data.jsonrpc !== "2.0") return;
  const message = event.data;
  if (message.id && pending.has(message.id)) {
    const callback = pending.get(message.id); pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message ?? "Host request failed")); else callback.resolve(message.result);
    return;
  }
  if (message.method === "ui/notifications/tool-result") {
    const data = message.params?.structuredContent?.viewData;
    if (data) renderGraph(data);
  }
  if (message.method === "ui/notifications/host-context-changed" && message.params?.theme) document.documentElement.dataset.theme = message.params.theme;
}

document.getElementById("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
});

window.addEventListener("message", handleMessage);
const embedded = document.getElementById("view-data");
if (embedded) { try { renderGraph(JSON.parse(embedded.textContent)); } catch { status.textContent = "Не удалось прочитать сохранённый вид."; } }
if (window.parent !== window) {
  window.parent.postMessage({ jsonrpc: "2.0", id: requestId++, method: "ui/initialize", params: { appCapabilities: { availableDisplayModes: ["inline"] }, appInfo: { name: "ConceptLoom Learning View", version: "1.0.0" }, protocolVersion: "2026-01-26" } }, "*");
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.jsonrpc !== "2.0" || event.data?.id !== 1) return;
    window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
    hostReady = true;
  }, { once: true });
}
