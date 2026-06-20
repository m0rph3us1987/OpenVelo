import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { Button } from '@/components/ui/button';
import { FileText, Loader2 } from 'lucide-react';

interface ChatRequirementUploadProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

export function ChatRequirementUpload({ chat, onHeaderInfo, viewOnly = false, overrideSubStage }: ChatRequirementUploadProps) {
  const { subStage: wsSubStage, isConnected } = useStageWebSocket({ chatId: chat.id, stage: 'verify', enabled: !viewOnly });

  const subStage = viewOnly ? (overrideSubStage ?? chat.sub_stage) : (wsSubStage || chat.sub_stage);

  React.useEffect(() => {
    onHeaderInfo?.({
      title: `${chat.name} - Upload Requirement`,
      showSpinner: false,
    });
  }, [chat.id, chat.name, onHeaderInfo]);

  if (!viewOnly && wsSubStage && wsSubStage !== 'upload') {
    return null;
  }

  if (subStage && subStage !== 'upload') {
    return null;
  }

  const reconnectBanner = !isConnected;

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-6">
      {reconnectBanner && (
        <div className="absolute top-0 left-0 right-0 z-10 bg-yellow-500/90 text-black text-sm py-2 px-4 text-center">
          Reconnecting...
        </div>
      )}
      <RequirementUploadInner chat={chat} />
    </div>
  );
}

function RequirementUploadInner({ chat }: { chat: ChatSession }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setErrorMessage(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('requirement', file);
      const res = await fetch(`/api/chats/${chat.id}/upload-requirement`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        if (res.status === 400) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Only .md and .txt files are accepted');
        }
        if (res.status === 403) {
          throw new Error('Access denied');
        }
        if (res.status === 404) {
          throw new Error('Chat not found');
        }
        if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Upload is only supported in verify or requirement mode');
        }
        if (res.status === 413) {
          throw new Error('File size limit exceeded');
        }
        throw new Error('Upload failed - please try again');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed - please try again';
      setErrorMessage(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          Upload the requirement document to plan from
        </p>
      </div>
      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
      {uploading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Uploading...</span>
        </div>
      ) : (
        <Button
          variant="default"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Requirement
        </Button>
      )}
    </>
  );
}
