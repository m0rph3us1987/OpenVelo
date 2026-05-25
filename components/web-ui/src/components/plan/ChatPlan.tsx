import * as React from 'react';
import type { ChatSession } from '@/lib/types';
import { useStageWebSocket } from '@/hooks/useStageWebSocket';
import { TextLog } from '@/components/ui/text-log';
import { Button } from '@/components/ui/button';
import { Check, ChevronRight, X, Plus, AlertCircle } from 'lucide-react';

interface ChatPlanProps {
  chat: ChatSession;
  onHeaderInfo?: (info: { title: string; showSpinner: boolean }) => void;
  viewOnly?: boolean;
  overrideSubStage?: string;
}

export function ChatPlan({ chat, onHeaderInfo, viewOnly, overrideSubStage }: ChatPlanProps) {
  const { subStage: wsSubStage, progress } = useStageWebSocket({ chatId: chat.id, stage: 'plan', enabled: !viewOnly });
  const subStage = viewOnly ? (overrideSubStage ?? 'plan') : wsSubStage;

  React.useEffect(() => {
    const titleMap: Record<string, string> = {
      'epics': 'Generating epics...',
      'features': 'Generating features...',
      'stories': 'Generating stories...',
      'dependencies': 'Resolving dependencies...',
      'plan': 'Plan',
      'error': 'Error',
    };
    let subtitle = titleMap[subStage] ?? 'Plan';

    if (progress) {
      subtitle = progress;
    }

    onHeaderInfo?.({
      title: `${chat.name} - ${subtitle}`,
      showSpinner: ['epics', 'features', 'stories', 'dependencies'].includes(subStage),
    });
  }, [chat.id, subStage, progress, chat.name, onHeaderInfo]);

  if (subStage === 'epics' || subStage === 'features' || subStage === 'stories' || subStage === 'dependencies') {
    return <TextLog key={chat.id} chatId={chat.id} />;
  }

  if (subStage === 'error') {
    const handleRetry = async () => {
      await fetch(`/api/plan/${chat.id}/retry`, { method: 'POST' });
    };
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <span>Error generating plan</span>
        <Button onClick={handleRetry} variant="outline">Retry</Button>
      </div>
    );
  }

  return <PlanView chat={chat} viewOnly={viewOnly} />;
}

interface Epic {
  id: number;
  epic_index: number;
  title: string;
  description: string;
  build_cmd: string | null;
  test_cmd: string | null;
}

interface Feature {
  id: number;
  epic_id: number;
  feature_index: number;
  title: string;
  description: string;
}

interface Story {
  id: number;
  feature_id: number;
  story_index: number;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  depends_on: string;
}

function PlanView({ chat, viewOnly }: { chat: ChatSession; viewOnly?: boolean }) {
  const [epics, setEpics] = React.useState<Epic[]>([]);
  const [features, setFeatures] = React.useState<Feature[]>([]);
  const [stories, setStories] = React.useState<Story[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [buildCmd, setBuildCmd] = React.useState('');
  const [testCmd, setTestCmd] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [expandedEpics, setExpandedEpics] = React.useState<Set<number>>(new Set());
  const [expandedFeatures, setExpandedFeatures] = React.useState<Set<number>>(new Set());
  const [creatingJobs, setCreatingJobs] = React.useState(false);

  React.useEffect(() => {
    fetchPlanData();
    fetchProject();
  }, [chat.id]);

  const fetchPlanData = async () => {
    try {
      const epicsRes = await fetch(`/api/plan/epics?chatId=${chat.id}`);
      const featuresRes = await fetch(`/api/plan/features?chatId=${chat.id}`);
      const storiesRes = await fetch(`/api/plan/stories?chatId=${chat.id}`);

      if (epicsRes.ok) {
        const epicsData = await epicsRes.json();
        setEpics(epicsData);
        setExpandedEpics(new Set(epicsData.map((e: Epic) => e.id)));
      }
      if (featuresRes.ok) {
        const featuresData = await featuresRes.json();
        setFeatures(featuresData);
        setExpandedFeatures(new Set(featuresData.map((f: Feature) => f.id)));
      }
      if (storiesRes.ok) setStories(await storiesRes.json());
    } catch (err) {
      console.error('Failed to fetch plan data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/projects/${chat.project_id}`);
      if (res.ok) {
        const data = await res.json();
        setBuildCmd(data.build_cmd || '');
        setTestCmd(data.test_cmd || '');
      }
    } catch (err) {
      console.error('Failed to fetch project:', err);
    }
  };

  const handleSaveBuildTest = async (fromEpic?: Epic) => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const buildToSave = fromEpic?.build_cmd ?? buildCmd;
      const testToSave = fromEpic?.test_cmd ?? testCmd;
      await fetch(`/api/projects/${chat.project_id}/updateBuildTest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ build_cmd: buildToSave, test_cmd: testToSave }),
      });
      setSaved(true);
    } catch (err) {
      console.error('Failed to update build/test:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleEpic = (epicId: number) => {
    setExpandedEpics(prev => {
      const next = new Set(prev);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  };

  const toggleFeature = (featureId: number) => {
    setExpandedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };

  const handleCreateJobs = async () => {
    setCreatingJobs(true);
    try {
      const res = await fetch(`/api/projects/${chat.project_id}/create-jobs-from-stories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id }),
      });
      if (res.ok) {
        window.location.href = `/projects/${chat.project_id}`;
      }
    } catch (err) {
      console.error('Failed to create jobs:', err);
    } finally {
      setCreatingJobs(false);
    }
  };

  const getStoriesForFeature = (featureId: number) => stories.filter(s => s.feature_id === featureId);
  const getFeaturesForEpic = (epicId: number) => features.filter(f => f.epic_id === epicId);

  const getFeaturesWithStories = (epicId: number) =>
    getFeaturesForEpic(epicId).filter(f => getStoriesForFeature(f.id).length > 0);

  const visibleEpics = epics.filter(epic => getFeaturesWithStories(epic.id).length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  const toastEpic = epics.find(e => e.build_cmd || e.test_cmd);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-4">
          {!viewOnly && toastEpic && (toastEpic.build_cmd || toastEpic.test_cmd) && (
            <>
              <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {toastEpic.build_cmd && <span>Build: <code className="bg-muted px-1 rounded">{toastEpic.build_cmd}</code></span>}
                {toastEpic.test_cmd && <span>Test: <code className="bg-muted px-1 rounded">{toastEpic.test_cmd}</code></span>}
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2" disabled={saving || saved} onClick={() => handleSaveBuildTest(toastEpic)}>
                {saving ? '...' : saved ? <Check className="h-4 w-4" /> : 'Use commands'}
              </Button>
            </>
          )}
        </div>
        <Button variant="default" size="sm" onClick={handleCreateJobs} disabled={creatingJobs}>
          {creatingJobs ? 'Creating...' : 'Create jobs'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <h3 className="text-lg font-semibold mb-4">Plan Tree View</h3>

        <div className="space-y-2">
          {visibleEpics.map(epic => (
            <EpicCard
              key={epic.id}
              epic={epic}
              features={getFeaturesWithStories(epic.id)}
              allStories={stories}
              expandedEpics={expandedEpics}
              expandedFeatures={expandedFeatures}
              toggleEpic={toggleEpic}
              toggleFeature={toggleFeature}
              viewOnly={viewOnly}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EpicCard({
  epic,
  features,
  allStories,
  expandedEpics,
  expandedFeatures,
  toggleEpic,
  toggleFeature,
  viewOnly,
}: {
  epic: Epic;
  features: Feature[];
  allStories: Story[];
  expandedEpics: Set<number>;
  expandedFeatures: Set<number>;
  toggleEpic: (id: number) => void;
  toggleFeature: (id: number) => void;
  viewOnly?: boolean;
}) {
  const isExpanded = expandedEpics.has(epic.id);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 bg-muted hover:bg-muted/80 transition-colors text-left"
        onClick={() => toggleEpic(epic.id)}
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        <span className="font-medium">{epic.title}</span>
        <span className="text-xs text-muted-foreground">({features.length} features)</span>
      </button>

      {isExpanded && (
        <div className="p-3 space-y-2 bg-background">
          {features.map(feature => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              stories={allStories.filter(s => s.feature_id === feature.id)}
              allStories={allStories}
              expandedFeatures={expandedFeatures}
              toggleFeature={toggleFeature}
              viewOnly={viewOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureCard({
  feature,
  stories,
  allStories,
  expandedFeatures,
  toggleFeature,
  viewOnly,
}: {
  feature: Feature;
  stories: Story[];
  allStories: Story[];
  expandedFeatures: Set<number>;
  toggleFeature: (id: number) => void;
  viewOnly?: boolean;
}) {
  const isExpanded = expandedFeatures.has(feature.id);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-2 bg-muted/50 hover:bg-muted/70 transition-colors text-left text-sm"
        onClick={() => toggleFeature(feature.id)}
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        <span className="font-medium">{feature.title}</span>
        <span className="text-xs text-muted-foreground">({stories.length} stories)</span>
      </button>

      {isExpanded && (
        <div className="p-2 space-y-2 bg-background">
          {stories.map(story => (
            <StoryCard key={story.id} story={story} allStories={allStories} viewOnly={viewOnly} />
          ))}
        </div>
      )}
    </div>
  );
}

function StoryCard({
  story,
  allStories,
  viewOnly,
}: {
  story: Story;
  allStories: Story[];
  viewOnly?: boolean;
}) {
  const [title, setTitle] = React.useState(story.title);
  const [description, setDescription] = React.useState(story.description);
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState(story.acceptance_criteria || '');
  const [dependsOn, setDependsOn] = React.useState<string[]>(() => {
    try {
      return JSON.parse(story.depends_on || '[]');
    } catch {
      return [];
    }
  });
  const [addingDep, setAddingDep] = React.useState(false);
  const [selectedDep, setSelectedDep] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const saveStory = async (updates: { title?: string; description?: string; acceptance_criteria?: string; depends_on?: string }) => {
    setSaving(true);
    try {
      await fetch(`/api/plan/stories/${story.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.error('Failed to save story:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = () => {
    const updates: { title?: string; description?: string; acceptance_criteria?: string; depends_on?: string } = {};
    if (title !== story.title) updates.title = title;
    if (description !== story.description) updates.description = description;
    if (acceptanceCriteria !== story.acceptance_criteria) updates.acceptance_criteria = acceptanceCriteria;
    if (Object.keys(updates).length > 0) {
      saveStory(updates);
    }
  };

  const handleAddDep = () => {
    if (!selectedDep) return;
    const newDeps = [...dependsOn, selectedDep];
    setDependsOn(newDeps);
    saveStory({ depends_on: JSON.stringify(newDeps) });
    setSelectedDep('');
    setAddingDep(false);
  };

  const handleRemoveDep = (depId: string) => {
    const newDeps = dependsOn.filter(d => d !== depId);
    setDependsOn(newDeps);
    saveStory({ depends_on: JSON.stringify(newDeps) });
  };

  const getAvailableDeps = () => {
    return allStories.filter(s => {
      if (s.id === story.id) return false;
      if (dependsOn.includes(String(s.id))) return false;
      const sDeps = typeof s.depends_on === 'string' ? JSON.parse(s.depends_on || '[]') : [];
      if (sDeps.includes(String(story.id))) return false;
      return true;
    });
  };

  const availableForDep = getAvailableDeps();

  return (
    <div className="border border-border rounded p-2 bg-background">
      {viewOnly ? (
        <>
          <span className="block w-full font-medium text-sm px-1">{title}</span>
          <p className="w-full text-xs text-muted-foreground px-1 mt-1 whitespace-pre-wrap">{description}</p>
          {acceptanceCriteria && (
            <span className="block w-full text-xs px-1 mt-1">{acceptanceCriteria}</span>
          )}
        </>
      ) : (
        <>
          <input
            className="w-full font-medium text-sm bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-ring rounded px-1"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleBlur}
          />
          <textarea
            className="w-full text-xs text-muted-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-ring rounded px-1 mt-1 resize-none"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={handleBlur}
            rows={2}
          />
          <input
            className="w-full text-xs bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-ring rounded px-1 mt-1"
            value={acceptanceCriteria}
            onChange={e => setAcceptanceCriteria(e.target.value)}
            onBlur={handleBlur}
            placeholder="Acceptance criteria..."
          />
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
        </>
      )}
      {dependsOn.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {dependsOn.map(depId => {
            const depStory = allStories.find(s => String(s.id) === depId);
            return (
              <span key={depId} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded">
                {depStory?.title || depId}
                {!viewOnly && (
                  <button onClick={() => handleRemoveDep(depId)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {!viewOnly && (
        <>
          {dependsOn.length === 0 && (
            <div className="flex flex-wrap gap-1 mt-2" />
          )}
          {addingDep ? (
            <div className="flex items-center gap-2 mt-2">
              <select
                value={selectedDep}
                onChange={e => setSelectedDep(e.target.value)}
                className="flex-1 text-xs border rounded px-2 py-1"
              >
                <option value="">Select story...</option>
                {availableForDep.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.title}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={handleAddDep}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddingDep(false); setSelectedDep(''); }}>Cancel</Button>
            </div>
          ) : (
            <button
              onClick={() => setAddingDep(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              <Plus className="h-3 w-3" /> Add dependency
            </button>
          )}
        </>
      )}
    </div>
  );
}