
import * as React from 'react';
import { Palette } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useThemeContext } from './ThemeProvider';

const THEME_LABELS: Record<string, string> = {
  dark: 'Dark',
  light: 'Light',
  ocean: 'Ocean',
  forest: 'Forest',
  sunset: 'Sunset',
  midnight: 'Midnight',
  rose: 'Rose',
  amber: 'Amber',
  slate: 'Slate',
  nord: 'Nord',
};

export function ThemeSelector() {
  const { theme, setTheme, themes } = useThemeContext();

  const availableThemes = themes.length > 0 ? themes : Object.keys(THEME_LABELS);

  return (
    <div className="flex items-center gap-2">
      <Palette className="h-4 w-4 text-muted-foreground" />
      <Select value={theme} onValueChange={setTheme}>
        <SelectTrigger className="w-[120px] h-8 text-xs">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
        <SelectContent>
          {availableThemes.map((key) => (
            <SelectItem key={key} value={key}>
              {THEME_LABELS[key] ?? key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
