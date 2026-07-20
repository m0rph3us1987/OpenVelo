import * as React from 'react';
import { JobDetailContent } from '@/components/dashboard/JobDetailModal';
import type { Job, Project } from '@/lib/types';

interface MobileJobDetailStackProps {
  job: Job;
  project: Project;
  maxRetries: number;
  onBack: () => void;
  onDeleted?: () => void;
}

export function MobileJobDetailStack({
  job,
  project,
  maxRetries,
  onBack,
  onDeleted,
}: MobileJobDetailStackProps) {
  return (
    <section
      role="region"
      aria-label={`Job ${job.title || job.id} details`}
      className="flex min-h-[60vh] flex-col bg-card/30"
    >
      <JobDetailContent
        job={job}
        dockerImage={job.type === 'test' ? project.docker_image_tester : project.docker_image}
        maxRetries={maxRetries}
        onClose={onBack}
        variant="stacked"
        onDeleted={onDeleted}
      />
    </section>
  );
}
