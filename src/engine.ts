import type {
  CaseRecord,
  Contact,
  FirmConfig,
  Lead,
  MapRow,
  MerusState,
  RunResult,
  Step,
} from "./types";

const digits = (value: string) => value.replace(/\D/g, "");
const norm = (value: string) => value.trim().toLowerCase();

export const FIELD_MAP: MapRow[] = [
  { from: "First name", to: "contact.first_name" },
  { from: "Last name", to: "contact.last_name" },
  { from: "Date of birth", to: "contact.date_of_birth" },
  { from: "Mobile phone", to: "contact.phone_mobile" },
  { from: "Email", to: "contact.email" },
  { from: "Street address", to: "contact.address1" },
  { from: "City", to: "contact.city" },
  { from: "State", to: "contact.state" },
  { from: "ZIP code", to: "contact.zip" },
  { from: "Occupation", to: "case_file.occupation" },
  { from: "Date of injury", to: "injury.date_of_injury" },
  { from: "Injury type", to: "injury.injury_type" },
  { from: "Body parts", to: "injury.body_parts" },
  { from: "Claim number", to: "injury.claim_number" },
  { from: "Venue", to: "case_file.venue_id (firm ID)" },
];

function webhookPayload(lead: Lead): unknown {
  return {
    event: "OpportunityStageUpdate",
    locationId: "hegwer-law-san-rafael",
    leadId: lead.id,
    stage: "Signed",
    contact: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      dateOfBirth: lead.dob,
      phone: lead.phone,
      email: lead.email,
      address: {
        street: lead.address.street,
        city: lead.address.city,
        state: lead.address.state,
        postalCode: lead.address.zip,
      },
    },
    customFields: {
      occupation: lead.occupation,
      employer: lead.employer,
      referralSource: lead.referralSource,
      signedDate: lead.signedDate,
      venue: lead.venue,
      attorney: lead.attorney,
      staff: lead.staff,
      office: lead.office,
    },
    injuries: lead.injuries.map((injury) => ({
      type: injury.type,
      dateOfInjury: injury.dateOfInjury,
      endDate: injury.endDate ?? null,
      bodyParts: injury.bodyParts,
      claimNumber: injury.claimNumber,
    })),
  };
}

function findContact(lead: Lead, state: MerusState): {
  contact: Contact | null;
  evidence: string[];
} {
  const candidates = state.contacts.filter(
    (contact) =>
      norm(contact.lastName) === norm(lead.lastName) &&
      norm(contact.firstName) === norm(lead.firstName),
  );

  for (const contact of candidates) {
    const evidence: string[] = [];
    if (lead.phone && digits(contact.phone) === digits(lead.phone)) evidence.push("phone");
    if (lead.email && norm(contact.email) === norm(lead.email)) evidence.push("email");
    if (lead.dob && contact.dob === lead.dob) evidence.push("date of birth");
    if (evidence.length > 0) return { contact, evidence };
  }

  return { contact: null, evidence: [] };
}

function nextCaseNumber(state: MerusState, offset: number): string {
  const used = state.cases
    .map((record) => /^26-(\d+)$/.exec(record.caseNumber)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const base = used.length > 0 ? Math.max(...used) : 500;
  return `26-${String(base + offset).padStart(4, "0")}`;
}

export function runIntegration(
  lead: Lead,
  state: MerusState,
  config: FirmConfig,
): RunResult {
  const steps: Step[] = [];
  const name = `${lead.firstName} ${lead.lastName}`;

  steps.push({
    id: "webhook",
    kind: "webhook",
    icon: "↓",
    title: "Webhook received",
    summary: `GoHighLevel sent OpportunityStageUpdate for ${name}. Stage: Signed.`,
    tone: "neutral",
    detailLabel: "Webhook payload",
    detail: webhookPayload(lead),
  });

  if (state.processedLeadIds.includes(lead.id)) {
    steps.push({
      id: "idempotency-skip",
      kind: "idempotency",
      icon: "↺",
      title: "Idempotency check",
      summary: `Lead ${lead.id} is already processed. Skip. No duplicate case.`,
      tone: "skip",
      badge: "already processed",
      detailLabel: "Check result",
      detail: {
        lead_id: lead.id,
        decision: "skip",
        reason: "lead_id is in the processed set",
        meruscase_writes: 0,
      },
    });
    steps.push({
      id: "result-skip",
      kind: "result",
      icon: "✓",
      title: "Result",
      summary: "MerusCase is unchanged. No new contact and no new case.",
      tone: "neutral",
      detailLabel: "Result",
      detail: { contacts_created: 0, cases_created: 0 },
    });
    return {
      steps,
      state,
      status: "skipped",
      contactId: null,
      matchedExistingContact: false,
      createdCaseNumbers: [],
      createdCaseIds: [],
      createdContactIds: [],
    };
  }

  const match = findContact(lead, state);
  const matched = match.contact !== null;

  steps.push({
    id: "dedupe",
    kind: "dedupe",
    icon: "⊙",
    title: "Dedupe contact",
    summary: matched
      ? `Existing contact ${match.contact?.id} found. Match on ${match.evidence.join(" and ")}. Reuse this ID.`
      : `No match for ${name}. Create a new contact in the same POST.`,
    tone: matched ? "ok" : "neutral",
    badge: matched ? "contact reused" : "new contact",
    detailLabel: "Contact search",
    detail: {
      search: {
        first_name: lead.firstName,
        last_name: lead.lastName,
      },
      confirm_on: ["phone", "email", "date of birth"],
      name_matches: state.contacts
        .filter(
          (contact) =>
            norm(contact.lastName) === norm(lead.lastName) &&
            norm(contact.firstName) === norm(lead.firstName),
        )
        .map((contact) => ({
          contact_id: contact.id,
          matched_on:
            digits(contact.phone) === digits(lead.phone)
              ? "phone"
              : contact.dob === lead.dob
                ? "date of birth"
                : norm(contact.email) === norm(lead.email)
                  ? "email"
                  : "name only",
        })),
      decision: matched ? "reuse" : "create",
      contact_id: match.contact?.id ?? null,
    },
  });

  steps.push({
    id: "map",
    kind: "map",
    icon: "⇄",
    title: "Map fields",
    summary: "29 fields mapped. 15 representative fields are shown below.",
    tone: "neutral",
    badge: "subset of 29 fields",
    detailLabel: "Field map",
    map: FIELD_MAP,
  });

  const venueId = config.venue[lead.venue] ?? null;
  const officeId = config.office[lead.office] ?? null;
  const attorneyId = config.attorney[lead.attorney] ?? null;
  const staffId = config.staff[lead.staff] ?? null;
  const statusId = config.caseStatus.open;

  steps.push({
    id: "firm-ids",
    kind: "firm-ids",
    icon: "#",
    title: "Resolve firm IDs",
    summary: `Status ${statusId}. Venue ${venueId ?? "missing"}. Office ${officeId ?? "missing"}. Attorney ${attorneyId ?? "missing"}. Staff ${staffId ?? "missing"}.`,
    tone: "neutral",
    badge: "placeholder values",
    detailLabel: "Firm config",
    ids: [
      { role: "Case status", label: "Open", id: statusId },
      { role: "Venue", label: lead.venue, id: venueId },
      { role: "Office", label: lead.office, id: officeId },
      { role: "Attorney", label: lead.attorney, id: attorneyId },
      { role: "Staff", label: lead.staff, id: staffId },
    ],
    detail: {
      case_status_id: statusId,
      venue_id: venueId,
      office_id: officeId,
      attorney_id: attorneyId,
      staff_id: staffId,
      case_type: config.caseType,
      source: "firm config, not the API",
    },
  });

  const contactId = matched ? (match.contact?.id ?? null) : Math.max(...state.contacts.map((contact) => contact.id)) + 1;
  const createdContact: Contact | null = matched
    ? null
    : {
        id: contactId as number,
        firstName: lead.firstName,
        lastName: lead.lastName,
        dob: lead.dob,
        phone: lead.phone,
        email: lead.email,
        address1: lead.address.street,
        city: lead.address.city,
        state: lead.address.state,
        zip: lead.address.zip,
        createdByRun: true,
      };

  const comments = [
    `Referral source: ${lead.referralSource}`,
    `Signed date: ${lead.signedDate}`,
  ];

  const createdCases: CaseRecord[] = [];

  lead.injuries.forEach((injury, index) => {
    const caseNumber = nextCaseNumber(state, index + 1);
    const flags: string[] = [];
    if (venueId === null) flags.push("Venue: needs manual entry");
    if (!lead.employer) flags.push("Employer: needs manual entry");

    const body = {
      contact_id: matched ? contactId : null,
      comments,
      new_contact: matched
        ? null
        : {
            first_name: lead.firstName,
            last_name: lead.lastName,
            date_of_birth: lead.dob,
            phone_mobile: lead.phone,
            email: lead.email,
            address1: lead.address.street,
            city: lead.address.city,
            state: lead.address.state,
            zip: lead.address.zip,
          },
      case_file: {
        case_status_id: statusId,
        venue_id: venueId,
        office_id: officeId,
        attorney_id: attorneyId,
        staff_id: staffId,
        case_type: config.caseType,
        occupation: lead.occupation,
        date_of_injury: injury.dateOfInjury,
        injury_type: injury.type,
      },
      injury: {
        date_of_injury: injury.dateOfInjury,
        end_date: injury.endDate ?? null,
        injury_type: injury.type,
        body_parts: injury.bodyParts,
        claim_number: injury.claimNumber,
      },
    };

    steps.push({
      id: `post-${index + 1}`,
      kind: "post",
      icon: "↑",
      title: `POST ${index + 1} of ${lead.injuries.length}. caseFiles/add`,
      summary: `One injury in this request: ${injury.bodyParts.join(" and ")}. ${matched ? `Contact ${contactId} is reused.` : "Contact and case are created together."}`,
      tone: "neutral",
      badge: "payload illustrative",
      detailLabel: "Request body",
      detail: body,
    });

    createdCases.push({
      id: `case-${caseNumber}`,
      caseNumber,
      contactId: contactId as number,
      injuryType: injury.type,
      dateOfInjury: injury.dateOfInjury,
      endDate: injury.endDate,
      bodyParts: injury.bodyParts,
      venue: lead.venue,
      status: "Open",
      flags,
      comments,
      signedDate: lead.signedDate,
      sourceLeadId: lead.id,
    });
  });

  steps.push({
    id: "gap-referral",
    kind: "gap",
    icon: "!",
    title: "Gap · Referral source",
    summary: `No API field. Write "${comments[0]}" to the case comment.`,
    tone: "neutral",
    badge: "proposal · confirm with firm",
    detailLabel: "Proposal",
    detail: {
      missing_field: "Referral source",
      value: lead.referralSource,
      lands_in: "Case comment",
      comment_line: comments[0],
      alternatives: ["Case comment", "A custom field, if your instance has one"],
    },
  });

  steps.push({
    id: "gap-signed",
    kind: "gap",
    icon: "!",
    title: "Gap · Signed date",
    summary: `No API field. Write "${comments[1]}" to the case comment.`,
    tone: "neutral",
    badge: "proposal · confirm with firm",
    detailLabel: "Proposal",
    detail: {
      missing_field: "Signed date",
      value: lead.signedDate,
      lands_in: "Case comment",
      comment_line: comments[1],
      alternatives: ["Case comment", "A case custom date field, if one exists"],
    },
  });

  steps.push({
    id: "gap-employer",
    kind: "gap",
    icon: "!",
    title: "Gap · Employer",
    summary: lead.employer
      ? `No case API field. Add a party record: ${lead.employer}, role Employer.`
      : "Employer is blank on the lead. Create the case and flag it for manual entry.",
    tone: lead.employer ? "neutral" : "warn",
    badge: lead.employer ? "proposal · confirm with firm" : "manual review",
    detailLabel: "Proposal",
    detail: lead.employer
      ? {
          missing_field: "Employer",
          value: lead.employer,
          lands_in: "Party record",
          endpoint: "POST /parties/add",
          body: {
            case_number: createdCases[0]?.caseNumber ?? null,
            party_type: "Employer",
            name: lead.employer,
          },
        }
      : {
          missing_field: "Employer",
          value: null,
          lands_in: "Manual review",
          flag: "Employer: needs manual entry",
          note: "The case is not blocked. Office staff can add the employer later.",
        },
  });

  const reuseText = matched
    ? `Contact ${contactId} is reused.`
    : `New contact ${contactId} is created.`;
  const caseText =
    createdCases.length === 1
      ? `Case ${createdCases[0].caseNumber} is created.`
      : `${createdCases.length} cases are created: ${createdCases.map((record) => record.caseNumber).join(", ")}.`;
  const flagCount = createdCases.reduce((total, record) => total + record.flags.length, 0);

  steps.push({
    id: "result",
    kind: "result",
    icon: "✓",
    title: "Result",
    summary: `${caseText} ${reuseText}${flagCount > 0 ? " Manual-review flags added." : ""}`,
    tone: "ok",
    detailLabel: "Created records",
    detail: {
      contact_id: contactId,
      contact_action: matched ? "reused" : "created",
      cases_created: createdCases.map((record) => ({
        case_number: record.caseNumber,
        contact_id: record.contactId,
        injury_type: record.injuryType,
        date_of_injury: record.dateOfInjury,
        body_parts: record.bodyParts,
        flags: record.flags,
      })),
    },
  });

  const processedLeadIds = [...state.processedLeadIds, lead.id];
  steps.push({
    id: "idempotency",
    kind: "idempotency",
    icon: "↺",
    title: "Idempotency",
    summary: `Lead ${lead.id} is recorded as processed. A resend skips all MerusCase writes.`,
    tone: "ok",
    badge: "resend safe",
    detailLabel: "Processed set",
    detail: {
      processed_lead_ids: processedLeadIds,
      key: "GoHighLevel lead ID",
      resend_result: "skip",
    },
  });

  const newState: MerusState = {
    contacts: createdContact ? [...state.contacts, createdContact] : [...state.contacts],
    cases: [...state.cases, ...createdCases],
    processedLeadIds,
  };

  return {
    steps,
    state: newState,
    status: "created",
    contactId,
    matchedExistingContact: matched,
    createdCaseNumbers: createdCases.map((record) => record.caseNumber),
    createdCaseIds: createdCases.map((record) => record.id),
    createdContactIds: createdContact ? [createdContact.id] : [],
  };
}
