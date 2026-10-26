import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/pages/admin/lib/authContext";
import { AdminLoading, Button, Field, TextInput } from "@/pages/admin/components/ui";
import { requestWebsiteDomain } from "@/lib/tenantHost";

export default function AdminLoginPage() {
  const tenant = requestWebsiteDomain();
  const { user, authLoading, login, sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedFrom = (location.state as { from?: string } | null)?.from;
  // Never turn a login redirect into an external navigation or a non-CMS path.
  const from = requestedFrom && /^\/admin(?:\/|$)/.test(requestedFrom) ? requestedFrom : "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // Wait for the stored session to resolve so an authenticated staff member
  // never sees the form flash before being sent to the dashboard.
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-100">
        <AdminLoading label="Checking your session…" />
      </div>
    );
  }

  // Authenticated users revisiting the login page go straight to the CMS
  // (or to the forced password step if rotation is pending).
  if (user) return <Navigate to={user.mustChangePassword ? "/admin/set-password" : from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) {
      navigate(res.mustChangePassword ? "/admin/set-password" : from, { replace: true });
    } else {
      setError(res.error ?? "Unable to sign in.");
    }
  };

  const forgotPassword = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your email address first, then choose \u201cForgot password?\u201d.");
      return;
    }
    setResetBusy(true);
    const res = await sendPasswordReset(email);
    setResetBusy(false);
    if (res.ok) {
      setNotice("If that email belongs to a staff account, a password reset link is on its way.");
    } else {
      setError(res.error ?? "Could not send the reset email.");
    }
  };

  return (
    <div className="flex min-h-screen bg-background-100">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-primary-500 p-10 text-background-50 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-background-50/20">
            <i className="ri-building-2-line text-xl" aria-hidden="true" />
          </span>
          <span className="font-heading text-lg font-bold">{tenant || "Skyline Institute of Technology"}</span>
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight">
            Website Content
            <br />
            Management System
          </h1>
          <p className="mt-4 max-w-md text-sm text-background-50/85">
            One place for website staff to manage courses, pages, navigation, documents, forms and
            every part of the public website — without touching code.
          </p>
        </div>
        <p className="text-xs text-background-50/70">RTO 45989 &middot; CRICOS 04114B</p>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-background-50/10" />
        <div className="pointer-events-none absolute -bottom-24 right-10 h-72 w-72 rounded-full bg-background-50/10" />
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-1 items-center justify-center px-5 py-10 lg:w-[54%]">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-500 text-background-50">
              <i className="ri-building-2-line text-xl" aria-hidden="true" />
            </span>
          </div>
          <h2 className="font-heading text-2xl font-bold text-foreground-950">Admin sign in</h2>
          <p className="mt-1.5 text-sm text-foreground-600">
            Sign in to manage your website content.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field label="Email address" required>
              <TextInput
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tenant ? "you@your-institution.edu.au" : "you@slit.edu.au"}
                autoComplete="username"
              />
            </Field>

            <Field label="Password" required>
              <div className="relative">
                <TextInput
                  type={show ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-foreground-500 hover:bg-background-100"
                >
                  <i className={show ? "ri-eye-off-line" : "ri-eye-line"} aria-hidden="true" />
                </button>
              </div>
            </Field>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={forgotPassword}
                disabled={resetBusy}
                className="cursor-pointer text-[13px] font-medium text-primary-700 hover:text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resetBusy ? "Sending…" : "Forgot password?"}
              </button>
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2.5 text-[13px] text-primary-900">
                <i className="ri-error-warning-line mt-0.5 text-base" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            {notice ? (
              <div className="flex items-start gap-2 rounded-md border border-secondary-200 bg-secondary-50 px-3 py-2.5 text-[13px] text-secondary-900">
                <i className="ri-mail-check-line mt-0.5 text-base" aria-hidden="true" />
                <span>{notice}</span>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading} icon={loading ? undefined : "ri-login-circle-line"}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-foreground-500">
            Staff access is provisioned by an administrator. If you need an account or a reset,
            contact IT Support.
          </p>
        </div>
      </div>
    </div>
  );
}
