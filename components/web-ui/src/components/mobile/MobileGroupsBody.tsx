import * as React from 'react';
import { UserPlus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileSheet } from '@/components/ui/mobile-sheet';
import { MobileConfirmDialog } from '@/components/ui/mobile-confirm-dialog';
import { useToast } from '@/context/ToastContext';

export interface MobileGroup {
  id: number;
  name: string;
  description?: string;
  members: Array<{ id: number; username: string }>;
  projects: Array<{ id: number; name: string }>;
}

interface MobileGroupUser { id: number; username: string }
interface MobileGroupProject { id: number; name: string }

export interface MobileGroupsBodyProps {
  groups: MobileGroup[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (group: MobileGroup) => void;
  onDelete: (group: MobileGroup) => void;
}

export function MobileGroupsBody({ groups, loading, onCreate, onEdit, onDelete }: MobileGroupsBodyProps) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-mobile-h2 font-semibold">Groups</h2>
        <Button onClick={onCreate} className="tap-target gap-1">
          <UserPlus className="h-4 w-4" />
          Create group
        </Button>
      </div>

      {loading ? (
        <p className="px-1 text-mobile-body text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="px-1 text-mobile-body text-muted-foreground">No groups found.</p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-mobile-body font-medium text-foreground">{group.name}</span>
                <span className="text-mobile-caption text-muted-foreground">
                  {group.members.length} members · {group.projects.length} projects
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(group)}
                  aria-label={`Edit ${group.name}`}
                  title="Edit"
                  className="tap-target"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(group)}
                  aria-label={`Delete ${group.name}`}
                  title="Delete"
                  className="tap-target"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MobileGroupsTab() {
  const { showToast } = useToast();
  const [groups, setGroups] = React.useState<MobileGroup[]>([]);
  const [users, setUsers] = React.useState<MobileGroupUser[]>([]);
  const [projects, setProjects] = React.useState<MobileGroupProject[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<MobileGroup | null>(null);
  const [formLoading, setFormLoading] = React.useState(false);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deletingGroup, setDeletingGroup] = React.useState<MobileGroup | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  const fetchGroups = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/groups');
      if (res.ok) {
        const data: MobileGroup[] = await res.json();
        setGroups(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = React.useCallback(async () => {
    const res = await fetch('/api/users');
    if (res.ok) {
      const data: MobileGroupUser[] = await res.json();
      setUsers(data);
    }
  }, []);

  const fetchProjects = React.useCallback(async () => {
    const res = await fetch('/api/projects');
    if (res.ok) {
      const data: MobileGroupProject[] = await res.json();
      setProjects(data);
    }
  }, []);

  React.useEffect(() => {
    fetchGroups();
    fetchUsers();
    fetchProjects();
  }, [fetchGroups, fetchUsers, fetchProjects]);

  function openCreate() {
    setEditingGroup(null);
    setFormOpen(true);
  }

  function openEdit(group: MobileGroup) {
    setEditingGroup(group);
    setFormOpen(true);
  }

  function requestDelete(group: MobileGroup) {
    setDeletingGroup(group);
    setDeleteOpen(true);
  }

  async function handleSave(data: { name: string; description: string; userIds: number[]; projectIds: number[] }) {
    setFormLoading(true);
    try {
      const isEdit = editingGroup !== null;
      const url = isEdit ? `/api/groups/${editingGroup!.id}` : '/api/groups';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setFormOpen(false);
        setEditingGroup(null);
        showToast(isEdit ? 'Group updated.' : 'Group created.', 'success');
        fetchGroups();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || `Failed to ${isEdit ? 'update' : 'create'} group.`, 'error');
      }
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete() {
    if (!deletingGroup) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/groups/${deletingGroup.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteOpen(false);
        setDeletingGroup(null);
        showToast('Group deleted.', 'success');
        fetchGroups();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to delete group.', 'error');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <MobileGroupsBody
        groups={groups}
        loading={loading}
        onCreate={openCreate}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      {formOpen && (
        <GroupFormSheet
          mode={editingGroup ? 'edit' : 'create'}
          group={editingGroup ?? undefined}
          users={users}
          projects={projects}
          loading={formLoading}
          onSave={handleSave}
          onClose={() => {
            setFormOpen(false);
            setEditingGroup(null);
          }}
        />
      )}

      <MobileConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete group"
        description={
          deletingGroup
            ? `Are you sure you want to delete "${deletingGroup.name}"? This action cannot be undone.`
            : 'Are you sure you want to delete this group?'
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </>
  );
}

interface GroupFormSheetProps {
  mode: 'create' | 'edit';
  group?: MobileGroup;
  users: MobileGroupUser[];
  projects: MobileGroupProject[];
  loading: boolean;
  onSave: (data: { name: string; description: string; userIds: number[]; projectIds: number[] }) => Promise<void> | void;
  onClose: () => void;
}

function GroupFormSheet({ mode, group, users, projects, loading, onSave, onClose }: GroupFormSheetProps) {
  const [name, setName] = React.useState(group?.name ?? '');
  const [description, setDescription] = React.useState(group?.description ?? '');
  const [selectedUsers, setSelectedUsers] = React.useState<number[]>(
    group?.members.map((m) => m.id) ?? []
  );
  const [selectedProjects, setSelectedProjects] = React.useState<number[]>(
    group?.projects.map((p) => p.id) ?? []
  );
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!loading) setBusy(false);
  }, [loading]);

  async function handleSubmit() {
    if (busy || loading || !name.trim()) return;
    setBusy(true);
    try {
      await onSave({ name, description, userIds: selectedUsers, projectIds: selectedProjects });
      onClose();
    } catch {
      /* caller toasts */
    } finally {
      setBusy(false);
    }
  }

  const isBusy = busy || loading;

  return (
    <MobileSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={mode === 'create' ? 'Create group' : 'Edit group'}
      description={mode === 'edit' && group ? `Editing group "${group.name}".` : undefined}
      variant="bottom"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isBusy} className="tap-target flex-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isBusy || !name.trim()} className="tap-target flex-1">
            {isBusy ? 'Working…' : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-group-name" className="text-mobile-caption font-medium text-foreground">Name *</label>
          <input
            id="mobile-group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-group-description" className="text-mobile-caption font-medium text-foreground">Description</label>
          <input
            id="mobile-group-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          />
        </div>
        <MultiSelectField
          label="Users"
          items={users.map((u) => ({ id: u.id, name: u.username }))}
          selected={selectedUsers}
          onChange={setSelectedUsers}
        />
        <MultiSelectField
          label="Projects"
          items={projects}
          selected={selectedProjects}
          onChange={setSelectedProjects}
        />
      </div>
    </MobileSheet>
  );
}

interface MultiSelectFieldProps {
  label: string;
  items: Array<{ id: number; name: string }>;
  selected: number[];
  onChange: (ids: number[]) => void;
}

function MultiSelectField({ label, items, selected, onChange }: MultiSelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-mobile-caption font-medium text-foreground">{label}</span>
      <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2">
        {items.length === 0 ? (
          <p className="text-mobile-caption text-muted-foreground py-1">No items available</p>
        ) : (
          items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <label
                key={item.id}
                className="tap-target flex items-center gap-2 rounded px-1 text-mobile-body active:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...selected, item.id]);
                    else onChange(selected.filter((id) => id !== item.id));
                  }}
                  className="h-5 w-5 accent-primary"
                />
                <span className="truncate">{item.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
