import * as React from 'react';
import { UserPlus, Pencil, Key, Ban, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileSheet } from '@/components/ui/mobile-sheet';
import { useToast } from '@/context/ToastContext';

export interface MobileUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  enabled: boolean;
  password_reset_required: boolean;
  groups?: string[];
}

interface MobileUserCreateForm {
  username: string;
  password: string;
  role: 'admin' | 'user';
}

interface MobileUserEditForm {
  role: 'admin' | 'user';
  enabled: boolean;
}

export interface MobileUsersBodyProps {
  users: MobileUser[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (user: MobileUser) => void;
  onReset: (user: MobileUser) => void;
  onToggleEnabled: (user: MobileUser) => void;
}

export function MobileUsersBody({ users, loading, onCreate, onEdit, onReset, onToggleEnabled }: MobileUsersBodyProps) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-mobile-h2 font-semibold">Users</h2>
        <Button onClick={onCreate} className="tap-target gap-1">
          <UserPlus className="h-4 w-4" />
          Create user
        </Button>
      </div>

      {loading ? (
        <p className="px-1 text-mobile-body text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="px-1 text-mobile-body text-muted-foreground">No users found.</p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-mobile-body font-medium text-foreground">{user.username}</span>
                <span className="text-mobile-caption text-muted-foreground">
                  {user.role} · {user.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex shrink-0 items-center">
                {user.enabled ? (
                  <CheckCircle className="h-4 w-4 text-green-500" aria-hidden="true" />
                ) : (
                  <Ban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(user)}
                  aria-label={`Edit ${user.username}`}
                  title="Edit"
                  className="tap-target"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onReset(user)}
                  aria-label={`Reset password for ${user.username}`}
                  title="Reset password"
                  className="tap-target"
                >
                  <Key className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onToggleEnabled(user)}
                  aria-label={user.enabled ? `Disable ${user.username}` : `Enable ${user.username}`}
                  title={user.enabled ? 'Disable' : 'Enable'}
                  className="tap-target"
                >
                  {user.enabled ? <Ban className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MobileUsersTab() {
  const { showToast } = useToast();
  const [users, setUsers] = React.useState<MobileUser[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<MobileUserCreateForm>({ username: '', password: '', role: 'user' });
  const [createLoading, setCreateLoading] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<MobileUser | null>(null);
  const [editForm, setEditForm] = React.useState<MobileUserEditForm>({ role: 'user', enabled: true });
  const [editLoading, setEditLoading] = React.useState(false);

  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetUser, setResetUser] = React.useState<MobileUser | null>(null);
  const [resetPassword, setResetPassword] = React.useState('');
  const [resetLoading, setResetLoading] = React.useState(false);
  const [newPasswordDisplay, setNewPasswordDisplay] = React.useState('');

  const fetchUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data: MobileUser[] = await res.json();
        setUsers(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleCreate() {
    if (!createForm.username.trim() || !createForm.password || !createForm.role) {
      showToast('Please fill in all fields.', 'error');
      return;
    }
    setCreateLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        setCreateOpen(false);
        setCreateForm({ username: '', password: '', role: 'user' });
        showToast('User created.', 'success');
        fetchUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to create user.', 'error');
      }
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(user: MobileUser) {
    setEditingUser(user);
    setEditForm({ role: user.role, enabled: user.enabled });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingUser) return;
    setEditLoading(true);
    try {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditOpen(false);
        setEditingUser(null);
        showToast('User updated.', 'success');
        fetchUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to update user.', 'error');
      }
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggleEnabled(user: MobileUser) {
    const newEnabled = !user.enabled;
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    if (res.ok) {
      showToast(newEnabled ? 'User enabled.' : 'User disabled.', 'success');
      fetchUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to update user.', 'error');
    }
  }

  function openReset(user: MobileUser) {
    setResetUser(user);
    setResetPassword('');
    setNewPasswordDisplay('');
    setResetOpen(true);
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    setResetLoading(true);
    try {
      const body = resetPassword ? { newPassword: resetPassword } : {};
      const res = await fetch(`/api/users/${resetUser.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setNewPasswordDisplay(data.newPassword || '');
        showToast('Password reset.', 'success');
        fetchUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to reset password.', 'error');
      }
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <>
      <MobileUsersBody
        users={users}
        loading={loading}
        onCreate={() => setCreateOpen(true)}
        onEdit={openEdit}
        onReset={openReset}
        onToggleEnabled={handleToggleEnabled}
      />

      <UserCreateSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        form={createForm}
        setForm={setCreateForm}
        loading={createLoading}
        onSubmit={handleCreate}
      />

      <UserEditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        user={editingUser}
        form={editForm}
        setForm={setEditForm}
        loading={editLoading}
        onSubmit={handleEdit}
      />

      <UserResetSheet
        open={resetOpen}
        onOpenChange={setResetOpen}
        user={resetUser}
        password={resetPassword}
        setPassword={setResetPassword}
        generated={newPasswordDisplay}
        loading={resetLoading}
        onSubmit={handleResetPassword}
      />
    </>
  );
}

interface UserCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: MobileUserCreateForm;
  setForm: React.Dispatch<React.SetStateAction<MobileUserCreateForm>>;
  loading: boolean;
  onSubmit: () => Promise<void> | void;
}

function UserCreateSheet({ open, onOpenChange, form, setForm, loading, onSubmit }: UserCreateSheetProps) {
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create user"
      confirmLabel="Create"
      loading={loading}
      onSubmit={onSubmit}
      confirmDisabled={!form.username.trim() || !form.password}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-create-username" className="text-mobile-caption font-medium text-foreground">Username</label>
          <input
            id="mobile-create-username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="Username"
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-create-password" className="text-mobile-caption font-medium text-foreground">Password</label>
          <input
            id="mobile-create-password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Password"
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          />
          <p className="text-mobile-caption text-muted-foreground">At least 8 chars, mixed case, digit, and special character.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-create-role" className="text-mobile-caption font-medium text-foreground">Role</label>
          <select
            id="mobile-create-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
    </FormSheet>
  );
}

interface UserEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: MobileUser | null;
  form: MobileUserEditForm;
  setForm: React.Dispatch<React.SetStateAction<MobileUserEditForm>>;
  loading: boolean;
  onSubmit: () => Promise<void> | void;
}

function UserEditSheet({ open, onOpenChange, user, form, setForm, loading, onSubmit }: UserEditSheetProps) {
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit user"
      description={user ? `Change role and enabled status for ${user.username}.` : undefined}
      confirmLabel="Save"
      loading={loading}
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-edit-role" className="text-mobile-caption font-medium text-foreground">Role</label>
          <select
            id="mobile-edit-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <label className="flex items-center justify-between gap-3 py-1">
          <span className="text-mobile-body">Enabled</span>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="tap-target h-5 w-5 accent-primary"
            aria-label="Enabled"
          />
        </label>
      </div>
    </FormSheet>
  );
}

interface UserResetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: MobileUser | null;
  password: string;
  setPassword: (v: string) => void;
  generated: string;
  loading: boolean;
  onSubmit: () => Promise<void> | void;
}

function UserResetSheet({ open, onOpenChange, user, password, setPassword, generated, loading, onSubmit }: UserResetSheetProps) {
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reset password"
      description={user ? `Set a new password for ${user.username}. Leave empty to auto-generate.` : undefined}
      confirmLabel="Reset password"
      loading={loading}
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mobile-reset-password" className="text-mobile-caption font-medium text-foreground">New password</label>
          <input
            id="mobile-reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave empty to auto-generate"
            className="tap-target rounded-md border border-input bg-background px-3 text-mobile-body"
          />
        </div>
        {generated && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3">
            <p className="text-mobile-caption font-medium text-green-800">New password</p>
            <p className="mt-1 font-mono text-mobile-caption text-green-700">{generated}</p>
          </div>
        )}
      </div>
    </FormSheet>
  );
}

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  loading: boolean;
  onSubmit: () => Promise<void> | void;
  confirmDisabled?: boolean;
  children: React.ReactNode;
}

function FormSheet({ open, onOpenChange, title, description, confirmLabel, loading, onSubmit, confirmDisabled, children }: FormSheetProps) {
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  async function handleSubmit() {
    if (busy || loading || confirmDisabled) return;
    setBusy(true);
    try {
      await onSubmit();
      onOpenChange(false);
    } catch {
      /* caller toasts */
    } finally {
      setBusy(false);
    }
  }

  const isBusy = busy || loading;

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      variant="bottom"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy} className="tap-target flex-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isBusy || !!confirmDisabled} className="tap-target flex-1">
            {isBusy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </MobileSheet>
  );
}
