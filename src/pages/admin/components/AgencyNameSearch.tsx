import { useEffect, useId, useState } from 'react';
import { Field, TextInput } from './ui';
import { queryAgencyDirectory, type DirectoryAgency } from '../../agency/lib/portalData';

export default function AgencyNameSearch({ value, disabled, error, onChange, onSelect }: {
  value: string; disabled: boolean; error?: string; onChange: (name: string) => void; onSelect: (agency: DirectoryAgency) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DirectoryAgency[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRows([]); setFailed(false);
    if (!open || value.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      queryAgencyDirectory({ search: value, limit: 8, offset: 0 })
        .then(result => { if (!cancelled) { setRows(result.rows); setActive(0); } })
        .catch(() => { if (!cancelled) setFailed(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value, open]);
  const choose = (agency: DirectoryAgency) => { onSelect(agency); setOpen(false); };
  const expanded = open && !disabled && value.trim().length >= 2;
  return <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
    <Field label="Agency name" required hint="Search the agency directory, or enter a new agency name.">
      <TextInput role="combobox" aria-label="Agency name" autoComplete="off" disabled={disabled} value={value}
        aria-expanded={expanded} aria-autocomplete="list" aria-controls={listId} aria-invalid={Boolean(error)}
        aria-activedescendant={expanded && rows[active] ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(i => Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); }
          if (e.key === 'Enter' && expanded && rows[active]) { e.preventDefault(); choose(rows[active]); }
        }} />
    </Field>
    {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
    {expanded ? <div className="absolute z-30 mt-1 w-full rounded-md border border-background-300 bg-background-50 shadow-lg">
      <p role="status" className="px-3 py-2 text-xs text-foreground-500">{loading ? 'Searching agencies…' : failed ? 'Directory unavailable. Try again or enter details manually.' : rows.length ? 'Select an agency to fill its available details.' : 'No matching agencies. You can enter new details.'}</p>
      <ul id={listId} role="listbox" aria-label="Matching agencies" className="max-h-72 overflow-y-auto">
        {rows.map((row, index) => <li key={row.id} role="none"><button id={`${listId}-${index}`} type="button" role="option" tabIndex={-1}
          aria-selected={index === active} onMouseDown={e => e.preventDefault()} onClick={() => choose(row)}
          className={`block w-full px-3 py-2 text-left text-sm hover:bg-background-100 ${index === active ? 'bg-background-100' : ''}`}>
          <span className="block font-medium">{row.name}</span>
          <span className="text-xs text-foreground-500">{row.country} · {row.status}{row.existingAgencyId ? ' · Already added' : ''}</span>
        </button></li>)}
      </ul>
    </div> : null}
  </div>;
}
