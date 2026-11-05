import "./style.css";
import { FIRM_CONFIG } from "./config";
import { LEAD_BY_ID } from "./fixtures/ghl";
import { initialMerusState } from "./fixtures/meruscase";
import { runIntegration } from "./engine";
import type {
  CaseRecord,
  Contact,
  Lead,
  MapRow,
  MerusState,
  Stage,
  Step,
} from "./types";

interface PipelineItem {
  leadId: string;
  stage: Stage;
}

const STAGES: Array<{ key: Stage; label: string }> = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "signed", label: "Signed" },
];

const DEFAULT_PIPELINE: PipelineItem[] = [
  { leadId: "88214", stage: "new" },
  { leadId: "88190", stage: "contacted" },
];

const EMPTY_LOG = `
  <div class="empty" id="log-empty">
    <div class="empty-icon" aria-hidden="true">↓</div>
    <p class="empty-title">Webhook is idle</p>
    <p>Mark a lead as signed. The steps appear here.</p>
  </div>`;

function el<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

const pipelineEl = el<HTMLDivElement>("#pipeline");
const logEl = el<HTMLDivElement>("#log");
const logScrollEl = el<HTMLDivElement>("#log-scroll");
const merusEl = el<HTMLDivElement>("#merus");
const merusCountEl = el<HTMLSpanElement>("#merus-count");
const scenarioEl = el<HTMLSelectElement>("#scenario");
const hintEl = el<HTMLParagraphElement>("#scenario-hint");
const skipEl = el<HTMLInputElement>("#skip");
const replayEl = el<HTMLButtonElement>("#replay");
const resetEl = el<HTMLButtonElement>("#reset");
const logTopEl = el<HTMLButtonElement>("#log-top");

let state: MerusState = initialMerusState();
let pipeline: PipelineItem[] = clonePipeline(DEFAULT_PIPELINE);
let lastLead: Lead | null = null;
let matchedContactId: number | null = null;
let recentCaseIds = new Set<string>();
let recentContactIds = new Set<number>();

let timer: number | null = null;
let playToken = 0;
let currentSteps: Step[] = [];
let revealed = 0;

function clonePipeline(source: PipelineItem[]): PipelineItem[] {
  return source.map((item) => ({ ...item }));
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${month}/${day}/${year}` : iso;
}

function formatDateRange(record: CaseRecord): string {
  const start = formatDate(record.dateOfInjury);
  return record.endDate ? `${start} – ${formatDate(record.endDate)}` : start;
}

/* ---------- Pipeline ---------- */

function leadCard(lead: Lead, stage: Stage): string {
  const signed = stage === "signed";
  const caseNumbers = state.cases
    .filter((record) => record.sourceLeadId === lead.id)
    .map((record) => record.caseNumber);
  const sentLine = caseNumbers.length
    ? `✓ Sent · ${caseNumbers[0]}${caseNumbers.length > 1 ? ` +${caseNumbers.length - 1}` : ""}`
    : "✓ Signed";
  const injuryText = lead.injuries
    .map((injury) => injury.bodyParts.join(" & "))
    .join(" · ");
  const injuryCount = lead.injuries.length;

  return `
    <article class="lead-card ${signed ? "stage-signed-card" : ""}" draggable="${signed ? "false" : "true"}" data-lead="${lead.id}">
      <div class="lead-name">${esc(lead.firstName)} ${esc(lead.lastName)}</div>
      <p class="lead-injury">${esc(injuryText)}</p>
      <div class="lead-tags">
        <span class="mini">${esc(lead.tag)}</span>
        <span class="mini">${injuryCount} injur${injuryCount === 1 ? "y" : "ies"}</span>
      </div>
      ${signed ? `<div class="sent">${esc(sentLine)}</div>` : `<button class="btn-sign" type="button" data-sign="${lead.id}">Mark signed</button>`}
    </article>`;
}

function renderPipeline(): void {
  const byStage = new Map<Stage, Lead[]>();
  for (const stage of STAGES) byStage.set(stage.key, []);

  for (const item of pipeline) {
    const lead = LEAD_BY_ID.get(item.leadId);
    if (lead) byStage.get(item.stage)?.push(lead);
  }

  pipelineEl.innerHTML = STAGES.map((stage) => {
    const leads = byStage.get(stage.key) ?? [];
    const emptyText = stage.key === "signed" ? "Drop a card here" : "No leads";
    return `
      <div class="stage ${stage.key === "signed" ? "stage-signed" : ""}" data-stage="${stage.key}">
        <div class="stage-head"><span>${stage.label}</span><span class="stage-count">${leads.length}</span></div>
        <div class="stage-cards">
          ${leads.length ? leads.map((lead) => leadCard(lead, stage.key)).join("") : `<p class="stage-empty">${emptyText}</p>`}
        </div>
      </div>`;
  }).join("");
}

/* ---------- MerusCase ---------- */

function caseCard(record: CaseRecord): string {
  const isNew = recentCaseIds.has(record.id);
  return `
    <div class="case ${isNew ? "new" : ""}">
      <div class="case-head">
        <span class="case-no">${esc(record.caseNumber)}</span>
        ${isNew ? '<span class="tag-new">NEW</span>' : ""}
        <span class="case-type">${esc(record.injuryType)}</span>
      </div>
      <div class="case-meta"><strong>DOI</strong> ${formatDateRange(record)} · ${esc(record.bodyParts.join(", "))}</div>
      <div class="case-meta"><strong>${esc(record.venue)}</strong> · ${esc(record.status)}</div>
      ${record.flags.map((flag) => `<span class="flag">${esc(flag)}</span>`).join("")}
      ${
        record.comments.length
          ? `<div class="case-comments">${record.comments.map((line) => `<span>${esc(line)}</span>`).join("")}</div>`
          : ""
      }
    </div>`;
}

function contactCard(contact: Contact): string {
  const isNew = recentContactIds.has(contact.id);
  const isMatched = matchedContactId === contact.id;
  const cases = state.cases
    .filter((record) => record.contactId === contact.id)
    .sort(
      (a, b) =>
        Number(recentCaseIds.has(b.id)) - Number(recentCaseIds.has(a.id)),
    );

  return `
    <div class="contact ${isMatched ? "matched" : ""} ${isNew ? "new-contact" : ""}">
      <div class="contact-head">
        <div>
          <div class="contact-name">
            ${esc(contact.firstName)} ${esc(contact.lastName)}
            ${isNew ? '<span class="tag-new">NEW CONTACT</span>' : ""}
          </div>
          <div class="contact-meta">Contact ${contact.id} · DOB ${formatDate(contact.dob)}</div>
          <div class="contact-meta">${esc(contact.phone)} · ${esc(contact.email)}</div>
        </div>
        ${isMatched ? '<span class="tag-match">MATCHED</span>' : ""}
      </div>
      ${cases.length ? `<div class="cases">${cases.map(caseCard).join("")}</div>` : ""}
    </div>`;
}

function renderMerus(): void {
  merusCountEl.textContent = `${state.contacts.length} contacts · ${state.cases.length} cases`;

  const contacts = [...state.contacts].sort((a, b) => {
    const freshA = recentContactIds.has(a.id) ? 0 : 1;
    const freshB = recentContactIds.has(b.id) ? 0 : 1;
    return freshA - freshB || a.id - b.id;
  });

  merusEl.innerHTML = `
    <div class="merus-intro"><span>Contacts &amp; cases</span><span>read-only view</span></div>
    ${contacts.map(contactCard).join("")}`;
}

/* ---------- Run log ---------- */

function highlightJson(value: unknown): string {
  const json = esc(JSON.stringify(value, null, 2) ?? "null");
  return json.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "j-num";
      if (match.startsWith('"')) cls = match.endsWith(":") ? "j-key" : "j-str";
      else if (match === "true" || match === "false") cls = "j-bool";
      else if (match === "null") cls = "j-null";
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function mapTable(rows: MapRow[]): string {
  return `
    <div class="map-table">
      <div class="map-row map-head"><span>GoHighLevel field</span><span>MerusCase field</span></div>
      ${rows
        .map(
          (row) =>
            `<div class="map-row"><span class="map-from">${esc(row.from)}</span><span class="map-to">${esc(row.to)}</span></div>`,
        )
        .join("")}
    </div>`;
}

function badgeClass(badge: string): string {
  if (/proposal|manual review|already processed/i.test(badge)) return "chip chip-warn";
  if (/reused|safe/i.test(badge)) return "chip chip-ok";
  return "chip chip-muted";
}

function appendStep(step: Step): void {
  const li = document.createElement("div");
  li.className = `step tone-${step.tone}`;
  li.dataset.kind = step.kind;

  const badge = step.badge
    ? `<span class="${badgeClass(step.badge)}">${esc(step.badge)}</span>`
    : "";

  const ids = step.ids
    ? `<div class="ids">${step.ids
        .map(
          (row) => `
            <div class="id-chip">
              <div>
                <span class="id-role">${esc(row.role)}</span>
                <span class="id-label">${esc(row.label)}</span>
              </div>
              <span class="id-value">${row.id ?? "—"}</span>
            </div>`,
        )
        .join("")}</div>`
    : "";

  let details = "";
  if (step.map) {
    details = `<details open><summary>${esc(step.detailLabel ?? "Field map")}</summary>${mapTable(step.map)}</details>`;
  } else if (step.detail !== undefined) {
    details = `<details><summary>${esc(step.detailLabel ?? "Details")}</summary><pre>${highlightJson(step.detail)}</pre></details>`;
  }

  li.innerHTML = `
    <div class="step-icon" aria-hidden="true">${esc(step.icon)}</div>
    <div class="step-body">
      <div class="step-title">${esc(step.title)} ${badge}</div>
      <p class="step-summary">${esc(step.summary)}</p>
      ${ids}
      ${details}
    </div>`;

  logEl.appendChild(li);
  logScrollEl.scrollTo({ top: logScrollEl.scrollHeight, behavior: "smooth" });
}

function cancelPlayback(): void {
  playToken += 1;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  currentSteps = [];
  revealed = 0;
}

function finishPlayback(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  playToken += 1;
  for (let index = revealed; index < currentSteps.length; index += 1) {
    appendStep(currentSteps[index]);
  }
  revealed = currentSteps.length;
}

function play(steps: Step[]): void {
  cancelPlayback();
  currentSteps = steps;
  revealed = 0;
  logEl.innerHTML = "";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (skipEl.checked || reducedMotion) {
    for (const step of steps) appendStep(step);
    revealed = steps.length;
    return;
  }

  const token = playToken;
  const tick = (): void => {
    if (token !== playToken) return;
    appendStep(steps[revealed]);
    revealed += 1;
    if (revealed < steps.length) {
      timer = window.setTimeout(tick, 480);
    } else {
      timer = null;
    }
  };
  timer = window.setTimeout(tick, 120);
}

/* ---------- Actions ---------- */

function updateControls(): void {
  replayEl.disabled = lastLead === null;
  replayEl.title = lastLead
    ? `Replay the webhook for ${lastLead.firstName} ${lastLead.lastName}`
    : "Sign a lead first";
}

function clearLog(): void {
  cancelPlayback();
  logEl.innerHTML = EMPTY_LOG;
  logTopEl.hidden = true;
}

function revealRunOnMobile(): void {
  if (!window.matchMedia("(max-width: 900px)").matches) return;
  document
    .querySelector(".panel-run")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleSign(leadId: string): void {
  const item = pipeline.find((entry) => entry.leadId === leadId);
  if (!item || item.stage === "signed") return;
  const lead = LEAD_BY_ID.get(leadId);
  if (!lead) return;

  finishPlayback();
  item.stage = "signed";

  const result = runIntegration(lead, state, FIRM_CONFIG);
  state = result.state;
  lastLead = lead;

  if (result.status === "created") {
    matchedContactId = result.matchedExistingContact ? result.contactId : null;
    recentCaseIds = new Set(result.createdCaseIds);
    recentContactIds = new Set(result.createdContactIds);
    renderMerus();
    merusEl.scrollTo({ top: 0, behavior: "smooth" });
    hintEl.textContent =
      result.createdCaseIds.length > 1
        ? `${result.createdCaseIds.length} cases created. Send webhook again to test idempotency.`
        : "Case created. Send webhook again to test idempotency.";
  } else {
    hintEl.textContent = "Resend skipped. MerusCase is unchanged.";
  }

  renderPipeline();
  updateControls();
  play(result.steps);
  revealRunOnMobile();
}

function replayWebhook(): void {
  if (!lastLead) return;
  finishPlayback();
  const result = runIntegration(lastLead, state, FIRM_CONFIG);
  hintEl.textContent =
    result.status === "skipped"
      ? "Resend skipped. MerusCase is unchanged."
      : "Webhook replayed.";
  play(result.steps);
  revealRunOnMobile();
}

function resetAll(): void {
  cancelPlayback();
  state = initialMerusState();
  pipeline = clonePipeline(DEFAULT_PIPELINE);
  lastLead = null;
  matchedContactId = null;
  recentCaseIds = new Set();
  recentContactIds = new Set();
  scenarioEl.value = "default";
  hintEl.textContent = "Drag a card into Signed, or press Mark signed.";
  renderPipeline();
  renderMerus();
  clearLog();
  updateControls();
}

function startScenario(leadId: string): void {
  if (leadId === "default") {
    resetAll();
    return;
  }
  const lead = LEAD_BY_ID.get(leadId);
  if (!lead) return;

  cancelPlayback();
  state = initialMerusState();
  pipeline = [{ leadId: lead.id, stage: "contacted" }];
  lastLead = null;
  matchedContactId = null;
  recentCaseIds = new Set();
  recentContactIds = new Set();
  scenarioEl.value = leadId;
  hintEl.textContent = `${lead.firstName} ${lead.lastName} is in Contacted. Press Mark signed.`;
  renderPipeline();
  renderMerus();
  clearLog();
  updateControls();
}

/* ---------- Events ---------- */

pipelineEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("[data-sign]");
  if (button?.dataset.sign) handleSign(button.dataset.sign);
});

pipelineEl.addEventListener("dragstart", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".lead-card");
  if (!card || card.getAttribute("draggable") === "false") return;
  const leadId = card.dataset.lead;
  if (!leadId) return;
  event.dataTransfer?.setData("text/plain", leadId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});

pipelineEl.addEventListener("dragend", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".lead-card");
  card?.classList.remove("dragging");
  pipelineEl
    .querySelectorAll(".drop-target")
    .forEach((node) => node.classList.remove("drop-target"));
});

pipelineEl.addEventListener("dragover", (event) => {
  const stage = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-stage="signed"]',
  );
  if (!stage) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  stage.classList.add("drop-target");
});

pipelineEl.addEventListener("dragleave", (event) => {
  const stage = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-stage="signed"]',
  );
  if (stage && !stage.contains(event.relatedTarget as Node | null)) {
    stage.classList.remove("drop-target");
  }
});

pipelineEl.addEventListener("drop", (event) => {
  const stage = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-stage="signed"]',
  );
  if (!stage) return;
  event.preventDefault();
  stage.classList.remove("drop-target");
  const leadId = event.dataTransfer?.getData("text/plain");
  if (leadId) handleSign(leadId);
});

scenarioEl.addEventListener("change", () => startScenario(scenarioEl.value));
skipEl.addEventListener("change", () => {
  if (skipEl.checked) finishPlayback();
});
replayEl.addEventListener("click", replayWebhook);
resetEl.addEventListener("click", resetAll);

logScrollEl.addEventListener("scroll", () => {
  logTopEl.hidden = logScrollEl.scrollTop < 120;
});

logTopEl.addEventListener("click", () => {
  logScrollEl.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- Start ---------- */

renderPipeline();
renderMerus();
updateControls();
