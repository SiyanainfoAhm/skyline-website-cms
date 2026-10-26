// =====================================================================
// portal-admin-users — Skyline Agency Portal account provisioning
//
// All agency account creation / invitation / role changes / deactivation
// for the Agency Portal go through this function. It uses the official
// Supabase Auth Admin API (inviteUserByEmail / createUser / generateLink /
// deleteUser) with the service-role key. The `auth` schema is NEVER written
// directly from application tables and no password is ever stored.
//
// Caller must be a signed-in, Active SLIT Admin (an Active CMS Admin row in
// cms_users with role = 'Admin').
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { backendConfiguration } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRole(role: string): "agency_admin" | "agent" {
  return role === "agency_admin" ? "agency_admin" : "agent";
}

async function findAuthUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { user: null, error: error.message };
    const match = data.users.find(
      (u: { email?: string | null }) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (match) return { user: match, error: null };
    if (data.users.length < 200) break;
  }
  return { user: null, error: null };
}

async function upsertPortalProfile(
  admin: any,
  payload: { authUserId: string; email: string; name: string },
) {
  const { data: existing } = await admin
    .from("portal_profiles")
    .select("id")
    .eq("auth_user_id", payload.authUserId)
    .maybeSingle();

  if (existing && existing.id) {
    const { error } = await admin
      .from("portal_profiles")
      .update({ full_name: payload.name, email: payload.email })
      .eq("id", existing.id);
    if (error) return { profileId: null as string | null, error: error.message };
    return { profileId: String(existing.id), error: null };
  }

  const { data, error } = await admin
    .from("portal_profiles")
    .insert({
      auth_user_id: payload.authUserId,
      email: payload.email,
      full_name: payload.name,
      status: "Active",
    })
    .select("id")
    .maybeSingle();
  if (error) return { profileId: null as string | null, error: error.message };
  return { profileId: data ? String(data.id) : null, error: null };
}

async function upsertMembership(
  admin: any,
  payload: { profileId: string; agencyId: string; role: string; status?: string },
) {
  const { error } = await admin
    .from("agency_memberships")
    .upsert(
      {
        user_id: payload.profileId,
        agency_id: payload.agencyId,
        role: normalizeRole(payload.role),
        status: payload.status ?? "Active",
      },
      { onConflict: "user_id" },
    );
  return error ? error.message : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const configuration = backendConfiguration(SUPABASE_URL, SERVICE_KEY, ANON_KEY);
  if (configuration) return json(configuration, 503);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Missing authorization token." }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerErr } = await anon.auth.getUser(token);
    if (callerErr || !callerData.user) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const caller = callerData.user;
    if (req.headers.has("x-tenant-domain")) return json({ error: "Use tenant membership administration for a scoped request." }, 403);
    let profile: { role?: string; must_change_password?: boolean; status?: string; name?: string } | null = null;
    const { data: byId } = await admin
      .from("cms_users")
      .select("role, status, name, must_change_password")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    profile = byId ?? null;

    if (!profile || profile.status !== "Active" || profile.role !== "Admin" || profile.must_change_password) {
      return json({ error: "SLIT Administrator access required." }, 403);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await req.json()) as Record<string, unknown>;
    } catch (_err) {
      parsed = {};
    }
    const action = String(parsed.action ?? "");
    const actorName = String(profile.name ?? caller.email ?? "SLIT Admin");

    const audit = async (
      act: string,
      targetId: string,
      agencyId: string | null,
      detail: Record<string, unknown>,
    ) => {
      await admin.from("portal_audit_log").insert({
        actor: caller.id,
        actor_name: actorName,
        actor_role: "slit_admin",
        action: act,
        target_type: "portal_user",
        target_id: targetId,
        agency_id: agencyId,
        detail,
      });
    };

    switch (action) {
      case "invite": {
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const name = String(parsed.name ?? "").trim() || email.split("@")[0];
        const role = normalizeRole(String(parsed.role ?? "agent"));
        const agencyId = String(parsed.agencyId ?? "").trim();
        const redirectTo = typeof parsed.redirectTo === "string" ? parsed.redirectTo : undefined;
        if (!email) return json({ error: "Email is required." }, 400);
        if (!agencyId) return json({ error: "An agency must be selected." }, 400);

        let authUserId = "";
        let inviteLink: string | null = null;
        let emailSent = false;

        const existing = await findAuthUserByEmail(admin, email);
        if (existing.error) return json({ error: existing.error }, 400);
        if (existing.user) {
          // Existing identities sign in normally. Never disclose a recovery
          // credential simply because another module wants to link the account.
          authUserId = existing.user.id;
        } else {
          const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { data: { name }, redirectTo });
          if (!inviteErr && invited?.user) { authUserId = invited.user.id; emailSent = true; }
          else {
            const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name } });
            const found = await findAuthUserByEmail(admin, email);
            if (!found.user) return json({ error: createErr?.message || inviteErr?.message || "Could not create user." }, 400);
            authUserId = found.user.id;
            // A concurrent registration is an existing identity, not permission
            // to reset its password. Only our successfully created account gets a link.
            if (!createErr) {
              const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "recovery", email, options: redirectTo ? { redirectTo } : undefined });
              if (linkErr) return json({ error: linkErr.message }, 400);
              inviteLink = link?.properties?.action_link || null;
            }
          }
        }

        const profRes = await upsertPortalProfile(admin, { authUserId, email, name });
        if (profRes.error || !profRes.profileId) {
          return json({ error: profRes.error ?? "Could not create the portal profile." }, 500);
        }
        const memErr = await upsertMembership(admin, { profileId: profRes.profileId, agencyId, role });
        if (memErr) return json({ error: memErr }, 500);

        await audit("provision_user", profRes.profileId, agencyId, { email, role, emailSent });
        return json({ ok: true, authUserId, emailSent, inviteLink });
      }

      case "reset": {
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const redirectTo = typeof parsed.redirectTo === "string" ? parsed.redirectTo : undefined;
        if (!email) return json({ error: "Email is required." }, 400);
        const { data: mapped } = await admin.from("portal_profiles").select("auth_user_id").ilike("email", email).eq("status", "Active").maybeSingle();
        if (!mapped?.auth_user_id) return json({ error: "Mapped active profile not found." }, 404);
        const { data: shared } = await admin.from("cms_users").select("id").eq("auth_user_id", mapped.auth_user_id).limit(1).maybeSingle();
        const { data: membership, error: membershipError } = await admin.from("tenant_memberships").select("tenant_id").eq("auth_user_id", mapped.auth_user_id).limit(1).maybeSingle();
        if (membershipError) return json({ error: "Unable to verify account scope." }, 503);
        if (shared || membership) return json({ error: "Shared accounts must use account self-service recovery." }, 403);
        const { data: targetAuth, error: targetError } = await admin.auth.admin.getUserById(mapped.auth_user_id);
        if (targetError || targetAuth?.user?.email?.toLowerCase() !== email) return json({ error: "Verified account mapping required." }, 403);
        const { data: link, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: redirectTo ? { redirectTo } : undefined,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, link: (link && link.properties && link.properties.action_link) || null });
      }

      case "update": {
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const profileId = String(parsed.profileId ?? "").trim();
        const role = parsed.role ? normalizeRole(String(parsed.role)) : undefined;
        const agencyId = parsed.agencyId ? String(parsed.agencyId).trim() : undefined;
        const status = parsed.status ? String(parsed.status) : undefined;

        let pid = profileId;
        if (!pid && email) {
          const { data } = await admin.from("portal_profiles").select("id").ilike("email", email).maybeSingle();
          pid = data ? String(data.id) : "";
        }
        if (!pid) return json({ error: "Portal user not found." }, 404);

        if (status) {
          const { error } = await admin.from("portal_profiles").update({ status }).eq("id", pid);
          if (error) return json({ error: error.message }, 500);
        }
        if (role || agencyId || status) {
          const patch: Record<string, unknown> = {};
          if (role) patch.role = role;
          if (agencyId) patch.agency_id = agencyId;
          if (status) patch.status = status;
          const { error } = await admin.from("agency_memberships").update(patch).eq("user_id", pid);
          if (error) return json({ error: error.message }, 500);
        }
        await audit("update_user", pid, agencyId ?? null, { role, status });
        return json({ ok: true });
      }

      case "delete": {
        // Removing one module's access must never delete a shared Auth identity.
        const authUserId = String(parsed.authUserId ?? "").trim();
        const email = String(parsed.email ?? "").trim().toLowerCase();
        if (!authUserId && !email) return json({ error: "Target profile is required." }, 400);
        let targetQuery = admin.from("portal_profiles").select("id, auth_user_id");
        targetQuery = authUserId ? targetQuery.eq("auth_user_id", authUserId) : targetQuery.ilike("email", email);
        const { data: target, error: targetError } = await targetQuery.maybeSingle();
        if (targetError || !target) return json({ error: "Mapped profile not found." }, 404);
        if (target.auth_user_id === caller.id) return json({ error: "Use another administrator to revoke your access." }, 403);
        const { error } = await admin.from("portal_profiles").update({ status: "Inactive" }).eq("id", target.id);
        if (error) return json({ error: error.message }, 400);
        const { error: membershipError } = await admin.from("agency_memberships").update({ status: "Inactive" }).eq("user_id", target.id);
        if (membershipError) return json({ error: membershipError.message }, 400);
        await audit("revoke_user_access", target.id, null, { identityPreserved: true });
        return json({ ok: true, identityPreserved: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
