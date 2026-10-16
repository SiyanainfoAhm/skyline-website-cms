import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { usePortalAuth } from "@/pages/agency/lib/portalAuth";

function InlineNote({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-primary-200 bg-primary-50 text-primary-900"
      : "border-secondary-200 bg-secondary-50 text-secondary-900";
  const icon = tone === "error" ? "ri-error-warning-line" : "ri-mail-check-line";
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] ${cls}`} role={tone === "error" ? "alert" : "status"}>
      <i className={`${icon} mt-0.5 text-base`} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

const fieldClass =
  "w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 placeholder:text-foreground-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-700";

export default function PortalLoginPage() {
  const { authUser, authLoading, signIn, requestReset } = usePortalAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (!authLoading && authUser) return <Navigate to="/agency/dashboard" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Incorrect email or password.");
      return;
    }
    navigate("/agency/dashboard");
  };

  const handleForgot = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your email address first, then choose “Forgot password”.");
      return;
    }
    const result = await requestReset(email);
    if (!result.ok) {
      setError(result.error ?? "We couldn’t send the reset email.");
      return;
    }
    setNotice("If that email belongs to a portal account, a password reset link is on its way.");
  };

  return (
    <div className="flex min-h-screen bg-background-100">
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-primary-500 p-10 text-background-50 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-background-50/20">
            <i className="ri-graduation-cap-line text-xl" aria-hidden="true" />
          </span>
          <span className="font-heading text-lg font-bold">Skyline Institute of Technology</span>
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold leading-tight">
            Agency Portal
            <br />
            for student enrolment
          </h1>
          <p className="mt-4 max-w-md text-sm text-background-50/85">
            Education agents and agency administrators prepare and submit international student applications on behalf
            of students, manage documents, and track enrolment progress. SLIT administrators review and manage
            admissions.
          </p>
        </div>
        <p className="text-xs text-background-50/70">RTO 45989 &middot; CRICOS 04114B</p>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-background-50/10" />
        <div className="pointer-events-none absolute -bottom-24 right-10 h-72 w-72 rounded-full bg-background-50/10" />
      </div>

      <div className="flex w-full flex-1 items-center justify-center px-5 py-10 lg:w-[54%]">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-500 text-background-50">
              <i className="ri-graduation-cap-line text-xl" aria-hidden="true" />
            </span>
          </div>

          <h2 className="font-heading text-2xl font-bold text-foreground-950">Sign in</h2>
          <p className="mt-1.5 text-sm text-foreground-600">
            One sign-in for SLIT admins, agency admins and agents. Your role is detected automatically.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4" autoComplete="on">
            <div>
              <label htmlFor="portal-email" className={labelClass}>
                Email address
              </label>
              <input
                id="portal-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@agency.com"
                autoComplete="username"
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="portal-password" className={labelClass}>
                Password
              </label>
              <div className="relative">
                <input
                  id="portal-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className={`${fieldClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-foreground-500 hover:bg-background-100"
                >
                  <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="text-right">
              <button
                type="button"
                onClick={handleForgot}
                className="cursor-pointer text-xs font-medium text-primary-700 hover:text-primary-800"
              >
                Forgot password?
              </button>
            </div>

            {error ? <InlineNote tone="error">{error}</InlineNote> : null}
            {notice ? <InlineNote tone="success">{notice}</InlineNote> : null}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-5 py-3 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? <i className="ri-loader-4-line animate-spin text-base" aria-hidden="true" /> : <i className="ri-login-circle-line" aria-hidden="true" />}
              {busy ? "Signing in\u2026" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs leading-relaxed text-foreground-500">
            Accounts are provisioned by SLIT Administration. Need access?{" "}
            <Link to="/contact" className="font-medium text-primary-700 hover:text-primary-800">
              Contact us
            </Link>
            .
          </p>

          <div className="mt-4 border-t border-background-200 pt-4 text-center">
            <p className="text-xs text-foreground-500">
              Students applying directly?{" "}
              <a
                href="https://submissions.slit.edu.au"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary-700 hover:text-primary-800"
              >
                Use the student submissions portal
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}