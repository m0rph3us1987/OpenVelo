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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/context/ToastContext';
import { Eye, EyeOff, UserPlus, Pencil, Key, Ban, CheckCircle } from 'lucide-react';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  enabled: boolean;
  password_reset_required: boolean;
  groups?: string[];
}

interface CreateUserForm {
  username: string;
  password: string;
  role: 'admin' | 'user';
}

interface EditUserForm {
  role: 'admin' | 'user';
  enabled: boolean;
}

const PASSWORD_POLICY_HINT = 'Password must be at least 8 characters, include an uppercase letter, lowercase letter, digit, and special character (!@#$%^&*).';

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function UsersTab() {
  const { showToast } = useToast();
  const [users, setUsers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<CreateUserForm>({ username: '', password: '', role: 'user' });
  const [createLoading, setCreateLoading] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<User | null>(null);
  const [editForm, setEditForm] = React.useState<EditUserForm>({ role: 'user', enabled: true });
  const [editLoading, setEditLoading] = React.useState(false);

  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetUser, setResetUser] = React.useState<User | null>(null);
  const [resetPassword, setResetPassword] = React.useState('');
  const [resetLoading, setResetLoading] = React.useState(false);
  const [newPasswordDisplay, setNewPasswordDisplay] = React.useState('');

  async function fetchUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data: User[] = await res.json();
        setUsers(data);
      }
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchUsers();
  }, []);

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
        const err = await res.json();
        showToast(err.error || 'Failed to create user.', 'error');
      }
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(user: User) {
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
        const err = await res.json();
        showToast(err.error || 'Failed to update user.', 'error');
      }
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDisableEnable(user: User) {
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
      const err = await res.json();
      showToast(err.error || 'Failed to update user.', 'error');
    }
  }

  function openReset(user: User) {
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
        const err = await res.json();
        showToast(err.error || 'Failed to reset password.', 'error');
      }
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Users</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1" />
          Create User
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
      ) : (
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Username</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-left px-3 py-2 font-medium">Enabled</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{user.username}</td>
                  <td className="px-3 py-2 capitalize">{user.role}</td>
                  <td className="px-3 py-2">
                    {user.enabled ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Ban className="h-4 w-4 text-muted-foreground" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(user)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openReset(user)} title="Reset Password">
                        <Key className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDisableEnable(user)} title={user.enabled ? 'Disable' : 'Enable'}>
                        {user.enabled ? <Ban className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-username">Username</Label>
              <Input
                id="create-username"
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                placeholder="Username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password">Password</Label>
              <PasswordInput
                value={createForm.password}
                onChange={(v) => setCreateForm({ ...createForm, password: v })}
                placeholder="Password"
              />
              <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-role">Role</Label>
              <Select value={createForm.role} onValueChange={(v) => setCreateForm({ ...createForm, role: v as 'admin' | 'user' })}>
                <SelectTrigger id="create-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createLoading}>
              {createLoading ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Change role and enabled status for {editingUser?.username}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-role">Role</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v as 'admin' | 'user' })}>
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-enabled">Enabled</Label>
              <Switch
                id="edit-enabled"
                checked={editForm.enabled}
                onCheckedChange={(checked) => setEditForm({ ...editForm, enabled: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={editLoading}>
              {editLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for {resetUser?.username}. Leave empty to auto-generate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New Password</Label>
              <PasswordInput
                value={resetPassword}
                onChange={setResetPassword}
                placeholder="Leave empty to auto-generate"
              />
              <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
            </div>
            {newPasswordDisplay && (
              <div className="rounded-md bg-green-50 border border-green-200 p-3">
                <p className="text-sm font-medium text-green-800">New Password:</p>
                <p className="text-sm font-mono text-green-700 mt-1">{newPasswordDisplay}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Close</Button>
            <Button onClick={handleResetPassword} disabled={resetLoading}>
              {resetLoading ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}