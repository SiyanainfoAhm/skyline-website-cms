/**
 * The "Enroll now" forms on the sign-in page: what a student or an agent types, and the checks run before anything is
 * sent. Pure and browser-free so the offline test script covers it; the Edge Function and database check again.
 */

import { validateAbn } from "../../supabase/functions/_shared/validation/abn";

export type EnrolKind = "student" | "agent" | "staff";

export interface StudentEnrolForm {
  firstName: string; lastName: string; email: string; mobile: string;
  /** DD/MM/YYYY as typed. */
  dateOfBirth: string; course: string; referralCode: string; agreed: boolean;
}

export interface AgentEnrolForm { businessName: string; abn: string; contactName: string; email: string; phone: string; agreed: boolean }

export const EMPTY_STUDENT_ENROL: StudentEnrolForm = { firstName: "", lastName: "", email: "", mobile: "", dateOfBirth: "", course: "", referralCode: "", agreed: false };
export const EMPTY_AGENT_ENROL: AgentEnrolForm = { businessName: "", abn: "", contactName: "", email: "", phone: "", agreed: false };

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
// eslint-disable-next-line no-control-regex -- control characters are never valid in names
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= 254 && !CONTROL.test(email) && EMAIL.test(email);
}

function nameProblem(value: string, what: string): string {
  const name = value.trim();
  if (!name) return `Enter your ${what}.`;
  if (CONTROL.test(name) || name.length > 100) return `The ${what} must be 100 characters or fewer.`;
  return "";
}

/** An Australian mobile in any common spelling, normalised to 04XX XXX XXX digits (04xxxxxxxx); null when it is not one. */
export function normaliseMobile(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "");
  const match = /^(?:\+?61|0)(4\d{8})$/.exec(digits);
  return match ? `0${match[1]}` : null;
}

/** DD/MM/YYYY (or YYYY-MM-DD) to an ISO date; null when it is not a real date or not 10 to 100 years ago. */
export function parseDateOfBirth(raw: string, today: Date = new Date()): string | null {
  const text = raw.trim();
  let year: number, month: number, day: number;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dmy) { day = Number(dmy[1]); month = Number(dmy[2]); year = Number(dmy[3]); }
  else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const youngest = new Date(Date.UTC(today.getUTCFullYear() - 10, today.getUTCMonth(), today.getUTCDate()));
  const oldest = new Date(Date.UTC(today.getUTCFullYear() - 100, today.getUTCMonth(), today.getUTCDate()));
  if (date > youngest || date < oldest) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The same ABN check the Edge Function runs; "" when valid, otherwise what is wrong. */
export function abnProblem(raw: string): string {
  const digits = raw.replace(/\s/g, "");
  if (!digits) return "Enter the business's ABN.";
  return validateAbn(digits);
}

/** 11 digits shown as 12 345 678 901. */
export function formatAbn(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8), digits.slice(8, 11)].filter(Boolean).join(" ");
}

export type EnrolErrors<T> = Partial<Record<keyof T | "form", string>>;

export function validateStudentEnrol(form: StudentEnrolForm, today?: Date): EnrolErrors<StudentEnrolForm> {
  const errors: EnrolErrors<StudentEnrolForm> = {};
  const first = nameProblem(form.firstName, "first name"); if (first) errors.firstName = first;
  const last = nameProblem(form.lastName, "last name"); if (last) errors.lastName = last;
  if (!validEmail(form.email)) errors.email = "Enter a valid email address.";
  if (!normaliseMobile(form.mobile)) errors.mobile = "Enter an Australian mobile number, like 04xx xxx xxx.";
  if (!parseDateOfBirth(form.dateOfBirth, today)) errors.dateOfBirth = "Enter your date of birth as DD/MM/YYYY.";
  if (form.referralCode.trim().length > 40 || CONTROL.test(form.referralCode)) errors.referralCode = "Check the referral code.";
  if (!form.agreed) errors.agreed = "Please agree to the terms and privacy policy.";
  return errors;
}

export function validateAgentEnrol(form: AgentEnrolForm): EnrolErrors<AgentEnrolForm> {
  const errors: EnrolErrors<AgentEnrolForm> = {};
  const business = form.businessName.trim();
  if (business.length < 2 || business.length > 200 || CONTROL.test(business)) errors.businessName = "Enter the agency or company name.";
  const abn = abnProblem(form.abn); if (abn) errors.abn = abn;
  const contact = nameProblem(form.contactName, "contact person's name"); if (contact) errors.contactName = contact;
  if (!validEmail(form.email)) errors.email = "Enter a valid work email address.";
  const phone = form.phone.replace(/[\s().-]/g, "");
  if (!/^\+?\d{6,15}$/.test(phone)) errors.phone = "Enter a phone number.";
  if (!form.agreed) errors.agreed = "Please agree to the terms and privacy policy.";
  return errors;
}

/** What the Edge Function receives for a student. */
export function studentEnrolPayload(form: StudentEnrolForm, today?: Date) {
  return {
    kind: "student" as const,
    firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim().toLowerCase(),
    phone: normaliseMobile(form.mobile) ?? form.mobile.trim(), dateOfBirth: parseDateOfBirth(form.dateOfBirth, today) ?? "",
    course: form.course.trim(), referralCode: form.referralCode.trim(),
  };
}

/** What the Edge Function receives for an agent. */
export function agentEnrolPayload(form: AgentEnrolForm) {
  return {
    kind: "agent" as const,
    businessName: form.businessName.trim(), abn: form.abn.replace(/\s/g, ""), contactName: form.contactName.trim(),
    email: form.email.trim().toLowerCase(), phone: form.phone.trim(),
  };
}
