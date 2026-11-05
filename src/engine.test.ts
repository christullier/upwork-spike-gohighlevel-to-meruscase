import { describe, expect, it } from "vitest";
import { runIntegration } from "./engine";
import { FIRM_CONFIG } from "./config";
import { LEAD_BY_ID } from "./fixtures/ghl";
import { initialMerusState } from "./fixtures/meruscase";
import type { Lead, Step } from "./types";

function lead(id: string): Lead {
  const found = LEAD_BY_ID.get(id);
  if (!found) throw new Error(`No lead ${id}`);
  return found;
}

function postSteps(steps: Step[]): Step[] {
  return steps.filter((step) => step.kind === "post");
}

function postBody(step: Step) {
  return step.detail as {
    contact_id: number | null;
    new_contact: Record<string, unknown> | null;
    injury: { body_parts: string[] };
    comments: string[];
  };
}

describe("GoHighLevel to MerusCase intake", () => {
  it("creates a new contact and one case for a new client", () => {
    const result = runIntegration(lead("88214"), initialMerusState(), FIRM_CONFIG);

    expect(result.status).toBe("created");
    expect(result.matchedExistingContact).toBe(false);
    expect(result.contactId).toBe(40356);
    expect(result.createdCaseNumbers).toEqual(["26-0501"]);
    expect(result.state.contacts).toHaveLength(4);
    expect(result.state.cases).toHaveLength(4);

    const dedupe = result.steps.find((step) => step.kind === "dedupe");
    expect(dedupe?.summary).toContain("No match for Carlos Ramirez");
    expect(dedupe?.summary).toContain("Create a new contact");

    const posts = postSteps(result.steps);
    expect(posts).toHaveLength(1);
    expect(postBody(posts[0]).contact_id).toBeNull();
    expect(postBody(posts[0]).new_contact?.first_name).toBe("Carlos");
    expect(result.steps.at(-1)?.kind).toBe("idempotency");
  });

  it("reuses contact 40112 for an existing client and creates one new case", () => {
    const result = runIntegration(lead("88190"), initialMerusState(), FIRM_CONFIG);

    expect(result.status).toBe("created");
    expect(result.matchedExistingContact).toBe(true);
    expect(result.contactId).toBe(40112);
    expect(result.createdContactIds).toEqual([]);
    expect(result.state.contacts).toHaveLength(3);
    expect(result.state.cases).toHaveLength(4);

    const dedupe = result.steps.find((step) => step.kind === "dedupe");
    expect(dedupe?.summary).toContain("Existing contact 40112");
    expect(dedupe?.summary).toContain("phone");
    expect(dedupe?.summary).toContain("date of birth");

    const posts = postSteps(result.steps);
    expect(posts).toHaveLength(1);
    expect(postBody(posts[0]).contact_id).toBe(40112);
    expect(postBody(posts[0]).new_contact).toBeNull();

    const created = result.state.cases.find(
      (record) => record.contactId === 40112 && record.caseNumber === "26-0501",
    );
    expect(created).toBeTruthy();
  });

  it("sends one POST per injury for a multi-injury lead", () => {
    const result = runIntegration(lead("88231"), initialMerusState(), FIRM_CONFIG);

    expect(result.status).toBe("created");
    expect(result.state.contacts).toHaveLength(4);
    expect(result.state.cases).toHaveLength(5);
    expect(result.createdCaseNumbers).toEqual(["26-0501", "26-0502"]);

    const posts = postSteps(result.steps);
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      const body = postBody(post);
      expect(Array.isArray(body.injury)).toBe(false);
      expect(body.injury.body_parts.length).toBeGreaterThan(0);
    }
    expect(postBody(posts[0]).injury.body_parts).toEqual(["Left knee"]);
    expect(postBody(posts[1]).injury.body_parts).toEqual(["Neck", "Psyche"]);

    const newCases = result.state.cases.filter(
      (record) => record.sourceLeadId === "88231",
    );
    expect(newCases).toHaveLength(2);
    expect(new Set(newCases.map((record) => record.contactId)).size).toBe(1);
  });

  it("creates the case and flags a missing employer", () => {
    const result = runIntegration(lead("88247"), initialMerusState(), FIRM_CONFIG);

    expect(result.status).toBe("created");
    expect(result.state.cases).toHaveLength(4);

    const created = result.state.cases.find(
      (record) => record.sourceLeadId === "88247",
    );
    expect(created?.flags).toContain("Employer: needs manual entry");

    const gap = result.steps.find((step) => step.id === "gap-employer");
    expect(gap?.tone).toBe("warn");
    expect(gap?.badge).toBe("manual review");
  });

  it("skips a replayed lead and writes nothing", () => {
    const first = runIntegration(lead("88214"), initialMerusState(), FIRM_CONFIG);
    const second = runIntegration(lead("88214"), first.state, FIRM_CONFIG);

    expect(second.status).toBe("skipped");
    expect(second.state).toBe(first.state);
    expect(second.state.cases).toHaveLength(first.state.cases.length);
    expect(second.createdCaseIds).toEqual([]);

    const skip = second.steps.find((step) => step.kind === "idempotency");
    expect(skip?.summary).toContain("already processed");
    expect(skip?.tone).toBe("skip");
    expect(second.steps.some((step) => step.kind === "post")).toBe(false);
  });

  it("puts referral source and signed date in the POST comments as proposals", () => {
    const result = runIntegration(lead("88214"), initialMerusState(), FIRM_CONFIG);
    const body = postBody(postSteps(result.steps)[0]);

    expect(body.comments).toEqual([
      "Referral source: Google Ads",
      "Signed date: 2026-10-30",
    ]);

    const gaps = result.steps.filter((step) => step.kind === "gap");
    expect(gaps).toHaveLength(3);
    expect(gaps[0].badge).toBe("proposal · confirm with firm");
    expect(gaps[1].badge).toBe("proposal · confirm with firm");
  });

  it("resolves the firm IDs from the config", () => {
    const result = runIntegration(lead("88214"), initialMerusState(), FIRM_CONFIG);
    const ids = result.steps.find((step) => step.kind === "firm-ids");

    expect(ids?.ids).toEqual([
      { role: "Case status", label: "Open", id: 101 },
      { role: "Venue", label: "WCAB San Francisco", id: 7 },
      { role: "Office", label: "San Rafael", id: 3 },
      { role: "Attorney", label: "D. Hegwer", id: 501 },
      { role: "Staff", label: "Intake", id: 612 },
    ]);
  });

  it("does not mutate the input state", () => {
    const input = initialMerusState();
    const snapshot = structuredClone(input);
    runIntegration(lead("88231"), input, FIRM_CONFIG);
    expect(input).toEqual(snapshot);
  });
});
