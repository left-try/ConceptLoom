const data = JSON.parse(document.getElementById("view-data").textContent);
const app = document.getElementById("app");
const svgNS = "http://www.w3.org/2000/svg";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function downloadAttempt(attempt, filename) {
  const blob = new Blob([JSON.stringify(attempt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a", "download", "Download attempt JSON");
  link.href = url;
  link.download = filename;
  link.addEventListener("click", () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true });
  return link;
}

const header = element("header");
header.append(element("h1", "", data.course?.topic || "Learning graph"));
if (data.course) {
  header.append(element("p", "", data.course.goal));
  header.append(element("p", "muted", `Course ${data.course.uid} · ${data.course.status} · ${data.course.nextAction || ""}`));
}
app.replaceChildren(header);
const graphPanel = element("section", "panel graph-panel");
graphPanel.append(element("h2", "", "Concept map"), element("p", "muted", "Select a node to inspect its public note."));
if (data.graph.nodes.length) {
  const columns = Math.min(5, Math.max(1, data.graph.nodes.length));
  const rows = Math.ceil(data.graph.nodes.length / columns);
  const width = 920;
  const height = Math.max(180, rows * 132);
  const positions = new Map(data.graph.nodes.map((node, index) => [node.uid || node.path, { x: 100 + (index % columns) * 180, y: 75 + Math.floor(index / columns) * 132 }]));
  const svg = svgElement("svg", { class: "graph-svg", viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": "Interactive concept map" });
  const defs = svgElement("defs");
  const marker = svgElement("marker", { id: "arrow", markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: "auto" });
  marker.append(svgElement("path", { d: "M0,0 L0,6 L7,3 z", fill: "currentColor" }));
  defs.append(marker); svg.append(defs);
  for (const edge of data.graph.edges) {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) continue;
    svg.append(svgElement("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: "graph-edge", "marker-end": "url(#arrow)" }));
  }
  const details = element("p", "node-detail", "Choose a node to inspect its public summary.");
  for (const node of data.graph.nodes) {
    const key = node.uid || node.path, point = positions.get(key);
    const group = svgElement("g", { class: `graph-node type-${String(node.type || "note").toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`, role: "button", tabindex: 0, "aria-label": `${node.type || "note"}: ${node.title || key}` });
    group.append(svgElement("rect", { x: point.x - 74, y: point.y - 32, width: 148, height: 64, rx: 12 }));
    const type = svgElement("text", { x: point.x, y: point.y - 5, class: "graph-node-type" }); type.textContent = node.type || "Note";
    const label = svgElement("text", { x: point.x, y: point.y + 15, class: "graph-node-label" }); label.textContent = (node.title || key).slice(0, 22);
    group.append(type, label);
    const select = () => { details.textContent = node.body || node.excerpt || node.path; for (const candidate of svg.querySelectorAll(".graph-node")) candidate.classList.remove("selected"); group.classList.add("selected"); };
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
    svg.append(group);
  }
  const scroll = element("div", "graph-scroll"); scroll.append(svg);
  graphPanel.append(scroll, details);
  const textGraph = element("details", "text-graph"); textGraph.append(element("summary", "", "Node and connection list"));
  const list = element("ul");
  for (const node of data.graph.nodes) list.append(element("li", "", `${node.type || "note"}: ${node.title || node.uid || node.path}`));
  for (const edge of data.graph.edges) list.append(element("li", "", `${edge.from} —${edge.kind}→ ${edge.to}`));
  textGraph.append(list); graphPanel.append(textGraph);
} else graphPanel.append(element("p", "muted", "No indexed concepts are available yet."));
if (data.graph.truncated) graphPanel.append(element("p", "muted", "This is a bounded view. Open another node to explore more of the graph."));
app.append(graphPanel);

if (data.lesson) {
  const lessonPanel = element("section", "panel");
  lessonPanel.append(element("h2", "", `Lesson: ${data.lesson.title}`));
  for (const objective of data.lesson.objectives || []) lessonPanel.append(element("p", "", objective));
  app.append(lessonPanel);
}
for (const exercise of data.exercises || []) {
  const panel = element("section", "panel exercise");
  panel.append(element("h2", "", exercise.publicSpec.title || `Practice: ${exercise.kind}`));
  if (exercise.publicSpec.task) panel.append(element("p", "", exercise.publicSpec.task));
  if (exercise.publicSpec.prompt) panel.append(element("p", "", exercise.publicSpec.prompt));
  const choiceSpec = Array.isArray(exercise.publicSpec.choices) && exercise.publicSpec.choices.length > 1 ? exercise.publicSpec.choices : null;
  const reasoning = choiceSpec ? null : element("textarea", "answer", "");
  if (reasoning) { reasoning.setAttribute("aria-label", "Your answer and reasoning"); reasoning.placeholder = "Write your reasoning here…"; }
  if (reasoning) panel.append(reasoning);
  const output = element("div", "attempt-output");
  if (choiceSpec) {
    panel.append(element("p", "muted", "Choose one answer. No written explanation is required."));
    const options = element("fieldset", "choice-options"); options.append(element("legend", "", exercise.publicSpec.prompt || "Select the best answer"));
    for (const [index, choice] of [...choiceSpec, { key: "__gap__", label: "I don't know yet" }].entries()) {
      const label = element("label", "choice");
      const input = element("input", ""); input.type = "radio"; input.name = `choice-${exercise.uid}`; input.value = choice.key;
      label.append(input, element("span", "", choice.label)); options.append(label);
    }
    const submit = element("button", "primary", "Submit choice"); submit.type = "button";
    submit.addEventListener("click", () => {
      const selected = options.querySelector("input:checked");
      if (!selected) { output.textContent = "Select an answer, or choose ‘I don't know yet’."; return; }
      const selectedChoice = [...choiceSpec, { key: "__gap__", label: "I don't know yet" }].find((choice) => choice.key === selected.value);
      output.replaceChildren(element("p", "muted", "Choice recorded. The host will assess it and show the explanation."), downloadAttempt({ exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: selectedChoice.label, artifacts: [{ kind: "single-choice", selectedKey: selectedChoice.key }] }, `${exercise.uid}-attempt.json`));
    });
    panel.append(options, submit);
  } else if (Array.isArray(exercise.publicSpec.actions) && exercise.publicSpec.actions.length) {
    const action = element("select", ""); action.setAttribute("aria-label", "Simulation decision");
    action.append(new Option("Choose a decision…", ""));
    for (const item of exercise.publicSpec.actions) action.append(new Option(item.label, item.id));
    const transition = element("select", ""); transition.setAttribute("aria-label", "Predicted outcome");
    transition.append(new Option("Predict the next state…", ""));
    action.addEventListener("change", () => {
      transition.replaceChildren(new Option("Predict the next state…", ""));
      const selected = exercise.publicSpec.actions.find((item) => item.id === action.value);
      for (const value of selected?.transitions || []) transition.append(new Option(value, value));
    });
    const record = element("button", "primary", "Record prediction"); record.type = "button";
    let trace = [];
    let currentState = exercise.publicSpec.initialState || "start";
    record.addEventListener("click", () => {
      if (!action.value || !transition.value || !reasoning.value.trim()) { output.textContent = "Choose a decision, predict an outcome, and explain your reasoning first."; return; }
      trace.push({ actionId: action.value, from: currentState, to: transition.value, reasoning: reasoning.value.trim() });
      currentState = transition.value;
      reasoning.value = ""; action.value = ""; transition.replaceChildren(new Option("Predict the next state…", ""));
      output.textContent = `Prediction saved locally (${trace.length} decision${trace.length === 1 ? "" : "s"}). No outcome has been revealed.`;
      output.replaceChildren(element("p", "muted", output.textContent), downloadAttempt({ exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: trace.map((item) => item.reasoning).join("\n"), artifacts: [{ kind: "scenario-trace", actions: trace, seed: "conceptloom-ui", finalState: currentState }] }, `${exercise.uid}-attempt.json`));
    });
    panel.append(action, transition, record);
  } else {
    const exportButton = element("button", "primary", "Prepare attempt file"); exportButton.type = "button";
    exportButton.addEventListener("click", () => {
      if (!reasoning.value.trim()) { output.textContent = "Write your answer before preparing the attempt file."; return; }
      output.replaceChildren(element("p", "muted", "Attempt file is ready. Use the host's loom_submit_practice action with this attempt to persist and assess it; this local page cannot call the host directly."), downloadAttempt({ exerciseUid: exercise.uid, exerciseRevision: exercise.revision, response: reasoning.value.trim(), artifacts: [] }, `${exercise.uid}-attempt.json`));
    });
    panel.append(exportButton);
  }
  panel.append(output, element("p", "muted", "This local view does not grade or save to course progress. Use the host's loom_submit_practice action to persist a downloaded attempt."));
  app.append(panel);
}
const fallback = element("details", "fallback");
fallback.append(element("summary", "", "Text alternative"), element("pre", "", data.textFallback));
app.append(fallback);
