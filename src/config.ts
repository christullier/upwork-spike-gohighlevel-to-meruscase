import type { FirmConfig } from "./types";

// Placeholder IDs. The real values come from the firm's MerusCase instance.
export const FIRM_CONFIG: FirmConfig = {
  caseStatus: { open: 101 },
  venue: {
    "WCAB San Francisco": 7,
    "WCAB Oakland": 8,
  },
  office: { "San Rafael": 3 },
  attorney: { "D. Hegwer": 501 },
  staff: { Intake: 612 },
  caseType: "Workers' Compensation",
};
