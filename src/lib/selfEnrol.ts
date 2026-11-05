import { supabase } from "@/pages/admin/lib/supabase";
import { passwordRecoveryUrl } from "@/lib/siteUrl";
import { agentEnrolPayload, studentEnrolPayload, type AgentEnrolForm, type StudentEnrolForm } from "@/lib/enrolForm";

export interface AbnDetails { abn: string; legalName: string; businessNames: string[]; entityType: string; abnStatus: string; gstStatus: string; state: string; postcode: string }

export interface EnrolResult {
  kind: "student" | "agent";
  /** The password-setup email went out. */
  emailSent: boolean;
  /** The email already has a password: they sign in and the enrolment is linked on that sign-in. */
  existingIdentity: boolean;
  businessName: string | null;
  warning: string | null;
}

/** Calls the public portal-self-register function and surfaces the server's own error text. */
async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("portal-self-register", { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const parsed = (await context.clone().json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch { /* keep the generic message */ }
    }
    throw new Error(message || "We could not reach the enrolment service. Please try again.");
  }
  if (data?.error) throw new Error(String(data.error));
  return (data ?? {}) as Record<string, unknown>;
}

/** Throws the server's message when the ABN is already in the system (used when the business is entered by hand). */
export async function checkAbnFree(abn: string): Promise<void> {
  await invoke({ action: "check_abn", abn });
}

export async function lookupAbn(abn: string): Promise<AbnDetails> {
  const data = await invoke({ action: "lookup_abn", abn });
  const business = data.business as AbnDetails | undefined;
  if (!business || !business.legalName) throw new Error("The lookup returned no business for this ABN.");
  return business;
}

function result(data: Record<string, unknown>, kind: "student" | "agent"): EnrolResult {
  return {
    kind, emailSent: Boolean(data.emailSent), existingIdentity: Boolean(data.existingIdentity),
    businessName: data.businessName ? String(data.businessName) : null, warning: data.warning ? String(data.warning) : null,
  };
}

export async function enrolStudent(form: StudentEnrolForm, website = ""): Promise<EnrolResult> {
  return result(await invoke({ action: "register", ...studentEnrolPayload(form), agreed: form.agreed, redirectTo: passwordRecoveryUrl(), website }), "student");
}

export async function enrolAgent(form: AgentEnrolForm, website = ""): Promise<EnrolResult> {
  return result(await invoke({ action: "register", ...agentEnrolPayload(form), agreed: form.agreed, redirectTo: passwordRecoveryUrl(), website }), "agent");
}
