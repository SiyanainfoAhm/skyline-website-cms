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
    let profile: { role?: string; status?: string; name?: string } | null = null;
    const { data: byId } = await admin
      .from("cms_users")
      .select("role, status, name")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    profile = byId ?? null;
    if (!profile && caller.email) {
      const { data: byEmail } = await admin
        .from("cms_users")
        .select("role, status, name")
        .ilike("email", caller.email)
        .maybeSingle();
      profile = byEmail ?? null;
    }
    if (!profile || profile.status !== "Active" || profile.role !== "Admin") {
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

        const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { name },
          redirectTo,
        });

        if (!inviteErr && invited && invited.user) {
          authUserId = invited.user.id;
          emailSent = true;
        } else {
          const { error: createErr } = await admin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { name },
          });
          let found = await findAuthUserByEmail(admin, email);
          if (!found.user) found = await findAuthUserByEmail(admin, email);
          if (!found.user) {
            const msg = (createErr && createErr.message) || (inviteErr && inviteErr.message) || "Could not create user.";
            return json({ error: msg }, 400);
          }
          authUserId = found.user.id;

          const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
            type: "recovery",
            email,
            options: redirectTo ? { redirectTo } : undefined,
          });
          if (linkErr) return json({ error: linkErr.message }, 400);
          inviteLink = (link && link.properties && link.properties.action_link) || null;
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
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const authUserId = String(parsed.authUserId ?? "").trim();
        let resolvedAuthId = authUserId;
        if (!resolvedAuthId && email) {
          const found = await findAuthUserByEmail(admin, email);
          resolvedAuthId = found.user ? found.user.id : "";
        }
        if (resolvedAuthId) {
          await admin.from("portal_profiles").delete().eq("auth_user_id", resolvedAuthId);
          await admin.auth.admin.deleteUser(resolvedAuthId);
        }
        await audit("delete_user", resolvedAuthId || email, null, { email });
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
