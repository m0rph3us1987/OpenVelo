import * as React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Model {
  id: number;
  provider: string;
  model_name: string;
}

export function ModelsTab() {
  const [models, setModels] = React.useState<Model[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  React.useEffect(() => {
    fetchModels();
  }, []);

  async function fetchModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json() as Model[];
        setModels(data);
      }
    } catch {
      // ignore
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/models/refresh', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as Model[];
        setModels(data);
      }
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  }

  const filteredModels = models
    .filter(m =>
      m.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.model_name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const providerCmp = a.provider.localeCompare(b.provider);
      if (providerCmp !== 0) return providerCmp;
      return a.model_name.localeCompare(b.model_name);
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pb-4 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="border-b border-border pb-2 mb-2 shrink-0">
        <div className="grid grid-cols-2 gap-4 px-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Provider</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model Name</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <p className="text-sm">No models available.</p>
            <p className="text-xs">Click Refresh to fetch models from opencode.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredModels.map((model) => (
              <div
                key={model.id}
                className="grid grid-cols-2 gap-4 px-1 py-2 items-center hover:bg-muted/50 rounded-md"
              >
                <span className="text-sm">{model.provider}</span>
                <span className="text-sm">{model.model_name}</span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}