import { PhoneInput } from "@/components/feature/applicationInputs";
import { nextIntakes } from "@/pages/agency/lib/portalSections";
import { ENGLISH_ONLY, OTHER_LANGUAGE, type WizardQuestion } from "@/pages/agency/lib/wizardConfig";

const INPUT = "w-full rounded-md border border-background-300 bg-background-50 px-3.5 py-2.5 text-sm text-foreground-950 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400/40";
const LABEL = "mb-1.5 block text-[13px] font-medium text-foreground-800";

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return <label htmlFor={htmlFor} className={LABEL}>{children} <span className="text-primary-600">*</span></label>;
}

function FieldError({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{text}</p> : null;
}

/**
 * One answer screen. Inputs are plain form controls named after the application fields; the wizard reads them from the
 * surrounding form when Next is pressed, so the phone control keeps its own formatting and validation.
 */
export default function WizardQuestionStep({ question, answers, errors, courseOptions, onChange }: {
  question: WizardQuestion;
  answers: Record<string, string>;
  errors: Record<string, string>;
  /** Course labels ("CODE - Title") the student can apply for. */
  courseOptions: string[];
  onChange: (name: string, value: string) => void;
}) {
  const text = (name: string, label: string, props: { placeholder?: string; maxLength?: number; upper?: boolean } = {}) => (
    <div>
      <Label htmlFor={`wizard-${name}`}>{label}</Label>
      <input id={`wizard-${name}`} name={name} value={answers[name] ?? ""} maxLength={props.maxLength ?? 200} placeholder={props.placeholder} autoComplete="off"
        aria-invalid={Boolean(errors[name])} className={INPUT}
        onChange={(e) => onChange(name, props.upper ? e.target.value.toUpperCase() : e.target.value)} />
      <FieldError text={errors[name]} />
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-heading text-base font-semibold text-foreground-950">{question.title}</h3>
        <p className="mt-1 text-sm text-foreground-600">{question.subtitle}</p>
      </div>

      {question.id === "language" ? (
        <div className="space-y-4">
          <fieldset>
            <legend className={LABEL}>Language spoken at home <span className="text-primary-600">*</span></legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {[[OTHER_LANGUAGE, "Yes, another language"], [ENGLISH_ONLY, "No, English only"]].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input type="radio" name="language_home" value={value} checked={answers.language_home === value} onChange={() => onChange("language_home", value)} /> {label}
                </label>
              ))}
            </div>
            <FieldError text={errors.language_home} />
          </fieldset>
          {answers.language_home === OTHER_LANGUAGE ? text("language_other", "Which language does the student speak?", { placeholder: "e.g. Hindi", maxLength: 100 }) : null}
        </div>
      ) : null}

      {question.id === "usi" ? text("usi_number", "USI number", { placeholder: "10 characters, e.g. ABC234DEF5", maxLength: 10, upper: true }) : null}

      {question.id === "emergency" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{text("ec_name", "Full name", { maxLength: 120 })}</div>
          <div>
            <Label htmlFor="wizard-ec_phone">Phone number</Label>
            <PhoneInput id="wizard-ec_phone" name="ec_phone" value={answers.ec_phone ?? ""} required placeholder="041 234 5678" />
            <FieldError text={errors.ec_phone} />
          </div>
          {text("ec_relationship", "Relationship to the student", { placeholder: "e.g. Father", maxLength: 60 })}
        </div>
      ) : null}

      {question.id === "course" ? (
        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label htmlFor="wizard-course">Course</Label>
            <select id="wizard-course" name="course" value={answers.course ?? ""} aria-invalid={Boolean(errors.course)} className={INPUT} onChange={(e) => onChange("course", e.target.value)}>
              <option value="">Select a course</option>
              {(answers.course && !courseOptions.includes(answers.course) ? [answers.course, ...courseOptions] : courseOptions).map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
            <FieldError text={errors.course} />
          </div>
          <div>
            <Label htmlFor="wizard-preferred_intake">Preferred intake</Label>
            <select id="wizard-preferred_intake" name="preferred_intake" value={answers.preferred_intake ?? ""} aria-invalid={Boolean(errors.preferred_intake)} className={INPUT}
              onChange={(e) => onChange("preferred_intake", e.target.value)}>
              <option value="">Select intake</option>
              {(answers.preferred_intake && !nextIntakes().includes(answers.preferred_intake) ? [answers.preferred_intake, ...nextIntakes()] : nextIntakes()).map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
            <p className="mt-1 text-xs text-foreground-500">Intakes start every month.</p>
            <FieldError text={errors.preferred_intake} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
