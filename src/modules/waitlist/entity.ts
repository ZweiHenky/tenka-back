export const WAITLIST_ROLES = ['ORGANIZADOR', 'CAPITAN', 'AFICIONADO'] as const;
export const WAITLIST_SOURCES = ['LANDING_HERO', 'LANDING_PRICING', 'LANDING_FINAL_CTA'] as const;

export type WaitlistRoleValue = typeof WAITLIST_ROLES[number];
export type WaitlistSource = typeof WAITLIST_SOURCES[number];

export interface WaitlistEntryCreateData {
  email: string;
  emailNormalized: string;
  role?: WaitlistRoleValue;
  source?: WaitlistSource;
  consentAt: Date;
  consentNoticeVersion: string;
}
