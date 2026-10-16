// =====================================================================
// cms-admin-users — Skyline Website CMS staff provisioning
//
// ALL user creation / invitation / deletion for the CMS goes through this
// function. It uses the official Supabase Auth Admin API
// (auth.admin.inviteUserByEmail / createUser / deleteUser / generateLink)
// with the service-role key. The auth schema is NEVER written directly.
//
// Caller must be a signed-in, Active Admin (checked against cms_users).
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

// The Admin API has no get-user-by-email, so page through the user list.
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

async function upsertProfile(
  admin: any,
  payload: { email: string; name: string; role: string; authUserId: string; status?: string },
) {
  const { data: existing } = await admin
    .from("cms_users")
    .select("id")
    .ilike("email", payload.email)
    .maybeSingle();

  const row = {
    name: payload.name,
    email: payload.email,
    role: payload.role === "Admin" ? "Admin" : "Editor",
    status: payload.status ?? "Active",
    auth_user_id: payload.authUserId,
  };

  if (existing && existing.id) {
    const { error } = await admin.from("cms_users").update(row).eq("id", existing.id);
    return { error: error ? error.message : null };
  }
  const { error } = await admin.from("cms_users").insert({ id: crypto.randomUUID(), ...row });
  return { error: error ? error.message : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Missing authorization token." }, 401);

    // 1) Verify the caller's JWT with a normal (anon) client.
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerErr } = await anon.auth.getUser(token);
    if (callerErr || !callerData.user) return json({ error: "Not authenticated." }, 401);

    // 2) Privileged client (service role) for auth-admin + profile writes.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const caller = callerData.user;
    let profile: { role?: string; status?: string } | null = null;
    const { data: byId } = await admin
      .from("cms_users")
      .select("role, status")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    profile = byId ?? null;
    if (!profile && caller.email) {
      const { data: byEmail } = await admin
        .from("cms_users")
        .select("role, status")
        .ilike("email", caller.email)
        .maybeSingle();
      profile = byEmail ?? null;
    }

    if (!profile || profile.status !== "Active" || profile.role !== "Admin") {
      return json({ error: "Administrator access required." }, 403);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await req.json()) as Record<string, unknown>;
    } catch (_err) {
      parsed = {};
    }
    const action = String(parsed.action ?? "");

    switch (action) {
      case "invite": {
        const email = String(parsed.email ?? "").trim().toLowerCase();
        const name = String(parsed.name ?? "").trim() || email.split("@")[0];
        const role = String(parsed.role ?? "Editor");
        const redirectTo = typeof parsed.redirectTo === "string" ? parsed.redirectTo : undefined;
        if (!email) return json({ error: "Email is required." }, 400);

        let authUserId = "";
        let inviteLink: string | null = null;
        let emailSent = false;

        // Preferred: official invitation email.
        const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { name },
          redirectTo,
        });

        if (!inviteErr && invited && invited.user) {
          authUserId = invited.user.id;
          emailSent = true;
        } else {
          // Fallback (e.g. SMTP not configured, or the account already exists):
          // create/locate the user via the Admin API and return a secure action link.
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

        const profileRes = await upsertProfile(admin, { email, name, role, authUserId, status: "Active" });
        if (profileRes.error) return json({ error: profileRes.error }, 500);

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

      case "delete": {
        const authUserId = String(parsed.authUserId ?? "").trim();
        const email = String(parsed.email ?? "").trim().toLowerCase();
        if (authUserId) {
          const { error } = await admin.auth.admin.deleteUser(authUserId);
          if (error) return json({ error: error.message }, 400);
        } else if (email) {
          const found = await findAuthUserByEmail(admin, email);
          if (found.user) await admin.auth.admin.deleteUser(found.user.id);
        }
        if (email) await admin.from("cms_users").delete().ilike("email", email);
        return json({ ok: true });
      }

      case "list": {
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (error) return json({ error: error.message }, 400);
        return json({
          ok: true,
          users: data.users.map((u: { id: string; email?: string | null; email_confirmed_at?: string | null }) => ({
            id: u.id,
            email: u.email,
            confirmed: !!u.email_confirmed_at,
          })),
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
