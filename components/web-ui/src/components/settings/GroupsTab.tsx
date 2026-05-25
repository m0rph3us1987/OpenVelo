import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/context/ToastContext';
import { UserPlus, Pencil, Trash2 } from 'lucide-react';

interface Group {
  id: number;
  name: string;
  description?: string;
  members: Array<{ id: number; username: string }>;
  projects: Array<{ id: number; name: string }>;
}

interface User {
  id: number;
  username: string;
}

interface Project {
  id: number;
  name: string;
}

function MultiSelect({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: Array<{ id: number; name: string }>;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No items available</p>
        ) : (
          items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange([...selected, item.id]);
                  } else {
                    onChange(selected.filter((id) => id !== item.id));
                  }
                }}
                className="accent-primary"
              />
              {item.name}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

interface GroupFormProps {
  mode: 'create' | 'edit';
  group?: Group;
  users: User[];
  projects: Project[];
  onSave: (data: { name: string; description: string; userIds: number[]; projectIds: number[] }) => void;
  onClose: () => void;
  loading: boolean;
}

function GroupFormDialog({ mode, group, users, projects, onSave, onClose, loading }: GroupFormProps) {
  const [name, setName] = React.useState(group?.name ?? '');
  const [description, setDescription] = React.useState(group?.description ?? '');
  const [selectedUsers, setSelectedUsers] = React.useState<number[]>(
    group?.members.map((m) => m.id) ?? []
  );
  const [selectedProjects, setSelectedProjects] = React.useState<number[]>(
    group?.projects.map((p) => p.id) ?? []
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create Group' : 'Edit Group'}</DialogTitle>
          {mode === 'edit' && group && (
            <DialogDescription>Editing group &quot;{group.name}&quot;.</DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name *</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-description">Description</Label>
            <Input
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <MultiSelect
            label="Users"
            items={users.map(u => ({ id: u.id, name: u.username }))}
            selected={selectedUsers}
            onChange={setSelectedUsers}
          />
          <MultiSelect
            label="Projects"
            items={projects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({ name, description, userIds: selectedUsers, projectIds: selectedProjects })}
            disabled={!name.trim() || loading}
          >
            {loading ? (mode === 'create' ? 'Creating...' : 'Saving...') : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupsTab() {
  const { showToast } = useToast();
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<Group | null>(null);
  const [formLoading, setFormLoading] = React.useState(false);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deletingGroup, setDeletingGroup] = React.useState<Group | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  async function fetchGroups() {
    setLoading(true);
    try {
      const res = await fetch('/api/groups');
      if (res.ok) {
        const data: Group[] = await res.json();
        setGroups(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    const res = await fetch('/api/users');
    if (res.ok) {
      const data: User[] = await res.json();
      setUsers(data);
    }
  }

  async function fetchProjects() {
    const res = await fetch('/api/projects');
    if (res.ok) {
      const data: Project[] = await res.json();
      setProjects(data);
    }
  }

  React.useEffect(() => {
    fetchGroups();
    fetchUsers();
    fetchProjects();
  }, []);

  function openCreate() {
    setEditingGroup(null);
    setFormOpen(true);
  }

  function openEdit(group: Group) {
    setEditingGroup(group);
    setFormOpen(true);
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
        const err = await res.json();
        showToast(err.error || `Failed to ${isEdit ? 'update' : 'create'} group.`, 'error');
      }
    } finally {
      setFormLoading(false);
    }
  }

  function confirmDelete(group: Group) {
    setDeletingGroup(group);
    setDeleteOpen(true);
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
        const err = await res.json();
        showToast(err.error || 'Failed to delete group.', 'error');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Groups</h3>
        <Button size="sm" onClick={openCreate}>
          <UserPlus className="h-4 w-4 mr-1" />
          Create Group
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups found.</p>
      ) : (
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium">Members</th>
                <th className="text-left px-3 py-2 font-medium">Projects</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{group.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{group.description || '—'}</td>
                  <td className="px-3 py-2">{group.members.length}</td>
                  <td className="px-3 py-2">{group.projects.length}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(group)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => confirmDelete(group)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <GroupFormDialog
          mode={editingGroup ? 'edit' : 'create'}
          group={editingGroup ?? undefined}
          users={users}
          projects={projects}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditingGroup(null); }}
          loading={formLoading}
        />
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletingGroup?.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}