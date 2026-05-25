import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { Model } from '@/lib/db';

interface ModelSelectProps {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  models: Model[];
  required?: boolean;
  includeDefaultOption?: boolean;
}

const USE_DEFAULT_VALUE = '__use_default__';

export function ModelSelect({ label, id, value, onChange, models = [], required, includeDefaultOption = false }: ModelSelectProps) {
  const options = models.map(m => `${m.provider}/${m.model_name}`);
  const selectValue = includeDefaultOption && value === '' ? USE_DEFAULT_VALUE : value;
  const isValid = includeDefaultOption || value === '' || options.includes(value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}{required && <span className="text-red-400 ml-1">*</span>}</Label>
      <Select value={isValid ? selectValue : undefined} onValueChange={(v) => onChange(v === USE_DEFAULT_VALUE ? '' : v)}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={required ? "Select a model *" : "Select a model"} />
        </SelectTrigger>
        <SelectContent>
          {includeDefaultOption && (
            <SelectItem value={USE_DEFAULT_VALUE}>Use default model</SelectItem>
          )}
          {options.length === 0 && (
            <SelectItem value="__no_models__" disabled>No models available - refresh models first</SelectItem>
          )}
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}