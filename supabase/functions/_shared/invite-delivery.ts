// Mailing the one-time password-setup link for an invitation through Supabase Auth. Shared by the account-provisioning
// Edge Functions (portal-admin-users keeps its own copy until its next deploy; keep the two in step).

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/** Finds the auth user for an email (paged, exact lower-case match). */
export async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<{ user: { id: string; email_confirmed_at?: string | null } | null; error: string | null }> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { user: null, error: error.message };
    const match = (data.users as Array<{ id: string; email?: string; email_confirmed_at?: string | null }>).find(
      (u) => (u.email ?? "").toLowerCase() === email,
    );
    if (match) return { user: match, error: null };
    if (data.users.length < 200) break;
  }
  return { user: null, error: null };
}

export interface InviteDelivery { error?: string; emailSent: boolean; existingIdentity: boolean; inviteLink: string | null }

/**
 * Mail the one-time setup link for an invitation. Existing confirmed identities are never sent a credential reset: they
 * simply sign in and the pending invitation is accepted. `inviteLink` is only produced for the fallback path and must
 * only ever be returned to organization administrators.
 */
export async function deliverInvite(admin: AdminClient, anon: AdminClient, email: string, name: string, redirectTo?: string): Promise<InviteDelivery> {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing.error) return { error: existing.error, emailSent: false, existingIdentity: false, inviteLink: null };
  if (existing.user) {
    if (existing.user.email_confirmed_at) return { emailSent: false, existingIdentity: true, inviteLink: null };
    const { error } = await anon.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    return error ? { error: error.message, emailSent: false, existingIdentity: false, inviteLink: null } : { emailSent: true, existingIdentity: false, inviteLink: null };
  }
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { data: { name }, redirectTo });
  if (!inviteErr) return { emailSent: true, existingIdentity: false, inviteLink: null };
  const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name } });
  if (createErr) return { error: createErr.message || inviteErr.message, emailSent: false, existingIdentity: false, inviteLink: null };
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "recovery", email, options: redirectTo ? { redirectTo } : undefined });
  if (linkErr) return { error: linkErr.message, emailSent: false, existingIdentity: false, inviteLink: null };
  return { emailSent: false, existingIdentity: false, inviteLink: (link?.properties?.action_link as string | undefined) ?? null };
}
