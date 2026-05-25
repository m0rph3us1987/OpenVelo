import { Router, Request, Response } from 'express';
import {
  createGroup,
  getGroupById,
  getAllGroups,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  addGroupProject,
  removeGroupProject,
  getGroupMembers,
  getGroupProjects,
  getDb,
} from '@/lib/db';
import { requireAdmin } from '@/api/middleware/auth';

export const groupsRouter = Router();

function buildGroupResponse(group: { id: number; name: string; description: string | null; created_at: string; updated_at: string }) {
  return {
    ...group,
    members: getGroupMembers(group.id),
    projects: getGroupProjects(group.id),
  };
}

groupsRouter.get('/', requireAdmin, (_req: Request, res: Response) => {
  try {
    const groups = getAllGroups();
    res.json(groups.map(buildGroupResponse));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.post('/', requireAdmin, (req: Request, res: Response) => {
  const { name, description, userIds, projectIds } = req.body as {
    name?: string;
    description?: string;
    userIds?: number[];
    projectIds?: number[];
  };

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const group = createGroup({ name, description });
    if (userIds?.length) {
      userIds.forEach(uid => addGroupMember(group.id, uid));
    }
    if (projectIds?.length) {
      projectIds.forEach(pid => addGroupProject(group.id, pid));
    }
    res.status(201).json(buildGroupResponse(group));
  } catch (err) {
    if (String(err).includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Group name already exists' });
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.get('/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const group = getGroupById(parseInt(req.params.id));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json(buildGroupResponse(group));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.put('/:id', requireAdmin, (req: Request, res: Response) => {
  const { name, description, userIds, projectIds } = req.body as {
    name?: string;
    description?: string;
    userIds?: number[];
    projectIds?: number[];
  };

  try {
    const existing = getGroupById(parseInt(req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group = updateGroup(parseInt(req.params.id), { name, description });

    if (userIds !== undefined) {
      getDb().prepare('DELETE FROM group_members WHERE group_id = ?').run(req.params.id);
      userIds.forEach(uid => addGroupMember(parseInt(req.params.id), uid));
    }

    if (projectIds !== undefined) {
      getDb().prepare('DELETE FROM group_projects WHERE group_id = ?').run(req.params.id);
      projectIds.forEach(pid => addGroupProject(parseInt(req.params.id), pid));
    }

    res.json(buildGroupResponse(group!));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.delete('/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const group = getGroupById(parseInt(req.params.id));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    deleteGroup(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.post('/:id/members/:userId', requireAdmin, (req: Request, res: Response) => {
  try {
    const group = getGroupById(parseInt(req.params.id));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    addGroupMember(parseInt(req.params.id), parseInt(req.params.userId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.delete('/:id/members/:userId', requireAdmin, (req: Request, res: Response) => {
  try {
    const group = getGroupById(parseInt(req.params.id));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    removeGroupMember(parseInt(req.params.id), parseInt(req.params.userId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.post('/:id/projects/:projectId', requireAdmin, (req: Request, res: Response) => {
  try {
    const group = getGroupById(parseInt(req.params.id));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    addGroupProject(parseInt(req.params.id), parseInt(req.params.projectId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

groupsRouter.delete('/:id/projects/:projectId', requireAdmin, (req: Request, res: Response) => {
  try {
    const group = getGroupById(parseInt(req.params.id));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    removeGroupProject(parseInt(req.params.id), parseInt(req.params.projectId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});