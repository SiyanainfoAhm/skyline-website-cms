import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/pages/admin/components/ui";
import { PhoneInput } from "@/components/feature/applicationInputs";
import { mobileProblem } from "@/lib/enrolForm";
import { loadAuthProviders, sendPhoneCode, signInWithProvider, verifyPhoneCode, type AuthProviders } from "@/lib/authProviders";

/**
 * "Continue with Google / Facebook / phone". Shown only for providers switched on in Supabase Auth. `create` is true on
 * Enroll now (a new account may be made) and false on Sign in. After Google or Facebook the browser comes back to /login;
 * after a phone code `onSignedIn` routes the new session.
 */
export default function QuickSignIn({ create, onSignedIn, label }: { create: boolean; onSignedIn: (userId: string) => void; label?: string }) {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [busy, setBusy] = useState<"" | "google" | "facebook">("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { let active = true; void loadAuthProviders().then((p) => { if (active) setProviders(p); }); return () => { active = false; }; }, []);

  if (!providers || (!providers.google && !providers.facebook && !providers.phone)) return null;

  const oauth = async (provider: "google" | "facebook") => {
    setError(""); setBusy(provider);
    try { await signInWithProvider(provider); } // the browser leaves for the provider here
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); setBusy(""); }
  };

  return (
    <div className="space-y-2.5">
      {label ? <p className="text-center text-xs font-medium uppercase tracking-wide text-foreground-500">{label}</p> : null}
      {providers.google ? (
        <Button type="button" variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void oauth("google")}>
          <GoogleMark /> {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </Button>
      ) : null}
      {providers.facebook ? (
        <Button type="button" variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void oauth("facebook")}>
          <i className="ri-facebook-circle-fill text-lg text-[#1877F2]" aria-hidden="true" /> {busy === "facebook" ? "Opening Facebook…" : "Continue with Facebook"}
        </Button>
      ) : null}
      {providers.phone ? (
        phoneOpen ? <PhoneCode create={create} onSignedIn={onSignedIn} onCancel={() => setPhoneOpen(false)} /> : (
          <Button type="button" variant="outline" className="w-full" icon="ri-smartphone-line" disabled={Boolean(busy)} onClick={() => { setError(""); setPhoneOpen(true); }}>
            Continue with phone number
          </Button>
        )
      ) : null}
      {error ? <p className="text-xs text-primary-700" role="alert">{error}</p> : null}
    </div>
  );
}

function PhoneCode({ create, onSignedIn, onCancel }: { create: boolean; onSignedIn: (userId: string) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const send = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const value = event ? String(new FormData(event.currentTarget).get("quick-phone") ?? "") : phone;
    const problem = mobileProblem(value);
    if (problem) { setError(problem); return; }
    setPhone(value); setError(""); setBusy(true);
    try { await sendPhoneCode(value, create); setSent(true); setWait(60); }
    catch (e) { setError(e instanceof Error ? e.message : "We could not send a code."); }
    finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code from the text message."); return; }
    setError(""); setBusy(true);
    try { onSignedIn(await verifyPhoneCode(phone, code)); }
    catch (e) { setError(e instanceof Error ? e.message : "That code is not right."); setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-background-300 bg-background-50 p-3">
      {!sent ? (
        <form onSubmit={(e) => void send(e)} className="space-y-3" noValidate>
          <div>
            <label htmlFor="quick-phone" className="mb-1.5 block text-[13px] font-medium text-foreground-800">Mobile number</label>
            <PhoneInput id="quick-phone" name="quick-phone" value={phone} placeholder="041 234 5678" />
          </div>
          {error ? <p className="text-xs text-primary-700" role="alert">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>{busy ? "Sending…" : "Text me a code"}</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
          <p className="text-[11px] text-foreground-500">We send a 6-digit code by SMS. Standard message rates may apply.</p>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)} className="space-y-3" noValidate>
          <Field label="6-digit code" hint={`Sent to ${phone}.`}>
            <TextInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" autoFocus />
          </Field>
          {error ? <p className="text-xs text-primary-700" role="alert">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Checking…" : "Verify and continue"}</Button>
          <div className="flex justify-between text-xs">
            <button type="button" className="cursor-pointer font-medium text-primary-700 disabled:cursor-not-allowed disabled:text-foreground-400" disabled={wait > 0 || busy} onClick={() => void send()}>
              {wait > 0 ? `Send again in ${wait}s` : "Send the code again"}
            </button>
            <button type="button" className="cursor-pointer text-foreground-600" onClick={() => { setSent(false); setCode(""); setError(""); }}>Change number</button>
          </div>
        </form>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6h-4C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
