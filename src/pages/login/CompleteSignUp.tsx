import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import CompleteStudentProfile from "@/pages/login/CompleteStudentProfile";
import CompleteAgentProfile from "@/pages/login/CompleteAgentProfile";
import { readSignUpIntent, rememberSignUpIntent, type SignUpIntent } from "@/lib/authProviders";

/**
 * A Google / Facebook / phone account that is not set up yet: student or agent (remembered from where they started,
 * changeable here), then that form. A student goes straight in; an agent's business waits for review.
 */
export default function CompleteSignUp({ user, onStudentDone, onAgentDone, onCancel }: {
  user: User; onStudentDone: () => void; onAgentDone: (businessName: string) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<SignUpIntent>(readSignUpIntent);
  const pick = (next: SignUpIntent) => { setKind(next); rememberSignUpIntent(next); };
  const tab = (value: SignUpIntent, label: string) => (
    <button type="button" role="tab" aria-selected={kind === value} onClick={() => pick(value)}
      className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-center text-sm font-semibold transition-colors ${kind === value ? "bg-background-50 text-foreground-950 shadow-sm" : "text-foreground-600 hover:text-foreground-900"}`}>
      {label}
    </button>
  );
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Almost done</p>
      <h2 className="mt-1 font-heading text-2xl font-bold text-foreground-950">{kind === "agent" ? "Agency details" : "Your details"}</h2>
      <p className="mt-1.5 text-sm text-foreground-600">You're signed in{user.email ? ` as ${user.email}` : user.phone ? ` with +${String(user.phone).replace(/^\+/, "")}` : ""}. Tell us who you are.</p>
      <div role="tablist" aria-label="Account type" className="mt-5 flex rounded-lg border border-background-300 bg-background-200 p-1">
        {tab("student", "Student")}
        {tab("agent", "Agent")}
      </div>
      <div className="mt-5">
        {kind === "agent"
          ? <CompleteAgentProfile user={user} onDone={(name) => { rememberSignUpIntent(null); onAgentDone(name); }} />
          : <CompleteStudentProfile user={user} onDone={() => { rememberSignUpIntent(null); onStudentDone(); }} onCancel={onCancel} embedded />}
      </div>
      {kind === "agent" ? <button type="button" onClick={onCancel} className="mt-3 w-full cursor-pointer text-center text-xs text-foreground-600 hover:text-foreground-900">Not you? Sign out</button> : null}
    </div>
  );
}
