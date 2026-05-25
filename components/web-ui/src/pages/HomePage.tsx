import * as React from 'react';
import { Header } from '@/components/layout/Header';
import { ProjectList } from '@/components/projects/ProjectList';

export function HomePage() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header />
      <main className="flex-1 max-w-screen-xl mx-auto w-full px-4 pt-8 overflow-hidden flex flex-col">
        <ProjectList />
      </main>
    </div>
  );
}
