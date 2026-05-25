import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { Button } from '@/components/ui/button';
import { CheckCircle, ShieldCheck, Loader2 } from 'lucide-react';

interface ChatVerifyProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
}

export function ChatVerify({ chat, onHeaderInfo, viewOnly = false }: ChatVerifyProps) {
  const { subStage, progress, errorType, isConnected } = useStageWebSocket({ chatId: chat.id, stage: 'verify', enabled: !viewOnly });
  const effectiveErrorType = errorType ?? chat.error_type;
  const [analysisKey, setAnalysisKey] = React.useState(0);
  const [retrying, setRetrying] = React.useState(false);
  const [retryError, setRetryError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (subStage === 'analysis') {
      setAnalysisKey(k => k + 1);
    }
  }, [subStage]);

  React.useEffect(() => {
    if (subStage === 'error') {
      setRetryError(null);
      setRetrying(false);
    }
  }, [subStage]);

  const reconnectBanner = !isConnected;

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      'upload': 'Upload Requirement',
      'analysis': 'Verifying implementation...',
      'satisfied': 'Verification complete',
      'error': 'Error',
    };
    const subtitle = titleMap[subStage] ?? 'Verify';
    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: subStage === 'analysis',
    });
  }, [chat.id, subStage, chat.name, onHeaderInfo]);

  if (subStage === '') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (subStage === 'upload') {
    return (
      <div className="relative w-full h-full">
        {reconnectBanner && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-yellow-500/90 text-black text-sm py-2 px-4 text-center">
            Reconnecting...
          </div>
        )}
        <UploadView chat={chat} />
      </div>
    );
  }

  if (subStage === 'analysis') {
    return (
      <div className="relative w-full h-full">
        {reconnectBanner && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-yellow-500/90 text-black text-sm py-2 px-4 text-center">
            Reconnecting...
          </div>
        )}
        <TextLog key={`${chat.id}-verify-${analysisKey}`} chatId={chat.id} />
      </div>
    );
  }

  if (subStage === 'satisfied') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        {reconnectBanner && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-yellow-500/90 text-black text-sm py-2 px-4 text-center">
            Reconnecting...
          </div>
        )}
        <CheckCircle className="h-16 w-16 text-green-500" />
        <p className="text-lg font-medium text-foreground">All requirements are satisfied</p>
      </div>
    );
  }

  if (subStage === 'error') {
    const isMissingRepo = effectiveErrorType === 'missing_repository';
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
        {reconnectBanner && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-yellow-500/90 text-black text-sm py-2 px-4 text-center">
            Reconnecting...
          </div>
        )}
        <p>{isMissingRepo ? 'No repository found — run implementation first' : 'An error occurred during verification'}</p>
        {!viewOnly && (
          <Button
            variant="outline"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              setRetryError(null);
              let success = true;
              try {
                const res = await fetch(`/api/chats/${chat.id}/verify/retry`, { method: 'POST' });
                if (!res.ok) {
                  setRetryError('Retry failed. Please try again.');
                  success = false;
                }
              } catch {
                setRetryError('Retry failed. Please try again.');
                success = false;
              } finally {
                if (success) {
                  setRetrying(false);
                }
              }
            }}
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </Button>
        )}
        {retryError && <p className="text-sm text-destructive">{retryError}</p>}
      </div>
    );
  }

  return <UploadView chat={chat} />;
}

function UploadView({ chat }: { chat: ChatSession }) {
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
        if (res.status === 413) {
          throw new Error('File size limit exceeded');
        }
        throw new Error('Upload failed — please try again');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed — please try again';
      setErrorMessage(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <ShieldCheck className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          Upload the original requirement document
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
    </div>
  );
}