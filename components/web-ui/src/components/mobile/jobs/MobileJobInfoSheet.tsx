import * as React from 'react';
import { Info } from 'lucide-react';
import DOMPurify from 'dompurify';
import { MobileSheet } from '@/components/ui/mobile-sheet';
import type { Job } from '@/lib/types';

export interface MobileJobInfoSheetProps {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileJobInfoSheet({ job, open, onOpenChange }: MobileJobInfoSheetProps) {
  const sanitized = React.useMemo(() => {
    if (!job.description) return '';
    return DOMPurify.sanitize(job.description);
  }, [job.description]);

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" aria-hidden="true" />
          {job.title || 'Untitled Job'}
        </span>
      }
      description={`Job #${job.id} — full description`}
      variant="full"
    >
      <div className="py-2">
        {job.description ? (
          <div
            data-testid="mobile-job-info-body"
            className="text-mobile-body text-foreground/90 leading-relaxed whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4"
            dangerouslySetInnerHTML={{ __html: sanitized }}
          />
        ) : (
          <div
            data-testid="mobile-job-info-empty"
            className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground"
          >
            <Info className="h-8 w-8 opacity-40 mb-2" aria-hidden="true" />
            <span className="text-mobile-body">No description provided for this job.</span>
          </div>
        )}
      </div>
    </MobileSheet>
  );
}
