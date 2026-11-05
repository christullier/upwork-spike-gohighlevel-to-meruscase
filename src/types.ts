export type Stage = "new" | "contacted" | "signed";

export interface Injury {
  id: string;
  type: "Specific injury" | "Cumulative trauma";
  dateOfInjury: string;
  endDate?: string;
  bodyParts: string[];
  claimNumber: string | null;
}

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  occupation: string;
  employer: string | null;
  referralSource: string;
  signedDate: string;
  venue: string;
  attorney: string;
  staff: string;
  office: string;
  tag: string;
  injuries: Injury[];
  defaultStage: Stage;
}

export interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  createdByRun: boolean;
}

export interface CaseRecord {
  id: string;
  caseNumber: string;
  contactId: number;
  injuryType: Injury["type"];
  dateOfInjury: string;
  endDate?: string;
  bodyParts: string[];
  venue: string;
  status: string;
  flags: string[];
  comments: string[];
  signedDate: string;
  sourceLeadId: string;
}

export interface MerusState {
  contacts: Contact[];
  cases: CaseRecord[];
  processedLeadIds: string[];
}

export interface FirmConfig {
  caseStatus: Record<string, number>;
  venue: Record<string, number>;
  office: Record<string, number>;
  attorney: Record<string, number>;
  staff: Record<string, number>;
  caseType: string;
}

export type StepKind =
  | "webhook"
  | "dedupe"
  | "map"
  | "firm-ids"
  | "post"
  | "gap"
  | "result"
  | "idempotency";

export type StepTone = "neutral" | "ok" | "warn" | "skip";

export interface MapRow {
  from: string;
  to: string;
}

export interface FirmIdRow {
  role: string;
  label: string;
  id: number | null;
}

export interface Step {
  id: string;
  kind: StepKind;
  icon: string;
  title: string;
  summary: string;
  tone: StepTone;
  badge?: string;
  detailLabel?: string;
  detail?: unknown;
  map?: MapRow[];
  ids?: FirmIdRow[];
}

export interface RunResult {
  steps: Step[];
  state: MerusState;
  status: "created" | "skipped";
  contactId: number | null;
  matchedExistingContact: boolean;
  createdCaseNumbers: string[];
  createdCaseIds: string[];
  createdContactIds: number[];
}
