"""Deterministic field extraction. OCR text is untrusted input, never instructions."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

DocumentType = Literal["passport", "australian_licence", "international_address", "visa", "ielts", "pte", "toefl", "academic", "other"]


@dataclass
class ProposedField:
    key: str
    value: str
    method: str
    evidence: str
    warning: str | None = None


@dataclass
class Extraction:
    document_type: DocumentType
    fields: list[ProposedField] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add(self, key: str, value: str, method: str, evidence: str, warning: str | None = None) -> None:
        value = value.strip()
        if value:
            self.fields.append(ProposedField(key, value, method, evidence, warning))


WEIGHTS = (7, 3, 1)


def check_digit(value: str) -> int:
    total = 0
    for index, char in enumerate(value):
        if char.isdigit():
            number = int(char)
        elif "A" <= char <= "Z":
            number = ord(char) - 55
        else:
            number = 0
        total += number * WEIGHTS[index % 3]
    return total % 10


def _date(value: str, expiry: bool = False) -> str | None:
    if not re.fullmatch(r"\d{6}", value):
        return None
    year = int(value[:2])
    # MRZ birth dates use a rolling century; expiries are generally future dates.
    full_year = (2000 if expiry else (1900 if year > 30 else 2000)) + year
    month, day = int(value[2:4]), int(value[4:6])
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{full_year:04d}-{month:02d}-{day:02d}"


def parse_td3_mrz(text: str) -> Extraction:
    out = Extraction("passport")
    rows = [re.sub(r"[^A-Z0-9<]", "", line.upper()) for line in text.splitlines()]
    rows = [row for row in rows if len(row) >= 40]
    pair = next(((rows[i], rows[i + 1]) for i in range(len(rows) - 1) if rows[i].startswith("P<")), None)
    if not pair:
        out.warnings.append("No TD3 MRZ pair was found; review visual OCR values manually.")
        return out
    line1, line2 = pair[0][:44].ljust(44, "<"), pair[1][:44].ljust(44, "<")
    checks = [
        (line2[:9], line2[9]), (line2[13:19], line2[19]), (line2[21:27], line2[27]),
        (line2[:10] + line2[13:20] + line2[21:43], line2[43]),
    ]
    valid = [digit.isdigit() and check_digit(value) == int(digit) for value, digit in checks]
    if sum(valid[:3]) < 2:
        out.warnings.append("MRZ checksum validation failed; do not auto-apply identity fields.")
        return out
    surname, _, given = line1[5:].split("<<", 1)[0], "", ""
    if "<<" in line1[5:]:
        surname, given = line1[5:].split("<<", 1)
    surname = surname.replace("<", " ").strip()
    names = [part for part in given.replace("<", " ").split() if part]
    out.add("last_name", surname.title(), "mrz", "TD3 name row")
    if names:
        out.add("first_name", names[0].title(), "mrz", "TD3 name row")
    if len(names) > 1:
        out.add("middle_name", " ".join(names[1:]).title(), "mrz", "TD3 name row")
    out.add("passport_number", line2[:9].replace("<", ""), "mrz", "TD3 document number")
    dob, expiry = _date(line2[13:19]), _date(line2[21:27], expiry=True)
    if dob: out.add("dob", dob, "mrz", "TD3 date of birth")
    if expiry: out.add("passport_expiry", expiry, "mrz", "TD3 expiry date")
    out.add("nationality_code", line2[10:13], "mrz", "TD3 nationality")
    out.add("issuing_country_code", line1[2:5], "mrz", "TD3 issuing country")
    if line2[20] in ("M", "F", "<"):
        out.add("gender", {"M": "Male", "F": "Female", "<": "Unspecified"}[line2[20]], "mrz", "TD3 sex marker")
    if not valid[3]: out.warnings.append("MRZ composite check digit failed; review all passport values.")
    return out


def _label(text: str, labels: str) -> str:
    match = re.search(rf"(?:{labels})\s*[:#-]?\s*([^\n\r]+)", text, re.I)
    return match.group(1).strip() if match else ""


def extract(text: str, document_type: DocumentType) -> Extraction:
    if document_type == "passport":
        return parse_td3_mrz(text)
    out = Extraction(document_type)
    if document_type in ("ielts", "pte", "toefl"):
        out.add("english_type", document_type.upper() if document_type != "pte" else "PTE", "rule", "document category")
        labels = "overall(?:\\s+band)?|total(?:\\s+score)?"
        out.add("english_score", _label(text, labels), "rule", "printed overall/total score")
        out.add("english_reference", _label(text, "TRF|report(?:\\s+|-)number|registration(?:\\s+|-)number|candidate(?:\\s+|-)number"), "rule", "printed report reference")
    elif document_type == "visa":
        out.add("visa_subclass", _label(text, "visa\\s+subclass"), "rule", "printed visa subclass")
        out.add("visa_grant_number", _label(text, "visa\\s+grant\\s+number|grant\\s+number"), "rule", "printed grant number")
        out.add("passport_number", _label(text, "passport\\s+(?:number|no\\.?)"), "rule", "printed passport number", "Compare with confirmed passport before applying.")
    elif document_type == "australian_licence":
        address = _label(text, "residential\\s+address|address")
        out.add("au_street", address, "rule", "printed address", "Ask whether this is the current residential address.")
    elif document_type == "international_address":
        address = _label(text, "address|residence")
        out.add("ov_address_original", address, "rule", "printed address", "Preserve original script; do not invent romanisation.")
    elif document_type == "academic":
        out.add("academic_institution", _label(text, "university|college|institute|school"), "rule", "printed institution")
        qualification = re.search(r"\b(Bachelor|Master|Diploma|Certificate|Doctorate|PhD)[^\n\r]{0,80}", text, re.I)
        if qualification: out.add("academic_qualification", qualification.group(0), "rule", "printed qualification")
    return out
