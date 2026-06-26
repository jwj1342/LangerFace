export interface ExportPrivacyViolation {
  code: string;
  path: string;
}

export interface ExportPrivacyAudit {
  schema_version: string;
  passed: boolean;
  violation_count: number;
  violations: ExportPrivacyViolation[];
}

export function auditExportPayload(payload: unknown): ExportPrivacyAudit;
