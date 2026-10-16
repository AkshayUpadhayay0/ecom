import { Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const SEARCH_DEBOUNCE_MS = 350;

/** Row of list filters with a "Clear filters" button when any is set. */
export function FilterBar({
  children,
  active,
  onClear,
}: {
  children: ReactNode;
  active: boolean;
  onClear: () => void;
}) {
  return (
    <div role="search" className="flex flex-wrap items-end gap-3">
      {children}
      {active ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="h-10">
          <X aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/** Search box that reports its value after the admin stops typing (no request per key). */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  minLength = 2,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Shorter terms are not sent (the API requires at least this many characters). */
  minLength?: number;
}) {
  const [text, setText] = useState(value);
  // Follow outside changes (Clear filters, back button) without an effect.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  useEffect(() => {
    const trimmed = text.trim();
    const next = trimmed.length >= minLength ? trimmed : '';
    if (next === value) return;
    const timer = setTimeout(() => {
      onChange(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, value, onChange, minLength]);

  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="h-10 pl-9 text-sm"
      />
    </label>
  );
}

/** Labelled native select for a filter ("" = all). */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label className="block min-w-40">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
