import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NewChatButtonProps {
  onClick: () => void;
}

export function NewChatButton({ onClick }: NewChatButtonProps) {
  return (
    <div className="p-3 border-b border-border h-14 flex items-center">
      <Button
        onClick={onClick}
        className="w-full justify-start gap-2"
        size="sm"
      >
        <Plus className="h-4 w-4" />
        New Chat
      </Button>
    </div>
  );
}