import Database from 'better-sqlite3';
import assert from 'node:assert';
import { describe, it, after, beforeEach } from 'node:test';
import { initDb, resetTestDb, closeDb, getJob, insertLocalJob, resetJob, updateJob, updateJobCompleted } from '@/lib/db';

describe('db.ts self-healing retry mechanics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetTestDb(db);
    initDb();
    
    // Insert a mock project
    db.prepare("INSERT INTO projects (id, name, port) VALUES (1, 'Test Project', 30001)").run();
  });

  after(() => {
    closeDb();
  });

  it('correctly executes self-healing loop on test failure', () => {
    // 1. Create original Implementation Job
    const implJob = insertLocalJob(1, {
      title: 'Implement Login Screen',
      description: 'Create login page styling and controller integration.',
      type: 'implementation',
    });
    
    // 2. Create Test Job testing the original Implementation Job
    const testJob = insertLocalJob(1, {
      title: 'Test Login Screen',
      description: 'Run automated E2E tests for login screen.',
      type: 'test',
      dependsOn: [String(implJob.id)],
      implements_job_id: implJob.id,
    });

    assert.strictEqual(testJob.implements_job_id, implJob.id);
    assert.deepStrictEqual(JSON.parse(testJob.depends_on || '[]'), [String(implJob.id)]);

    // 3. Mock Test Job Completion with Negative Verdict
    updateJobCompleted(testJob.id, 'main', 15);
    updateJob(testJob.id, {
      verdict: 'fail',
      summary: 'Tested: Login flow\nExpected: Redirect to Dashboard\nActual: Stayed on Login page due to JS error.',
    });

    const completedTestJob = getJob(testJob.id)!;
    assert.strictEqual(completedTestJob.status, 'COMPLETED');
    assert.strictEqual(completedTestJob.verdict, 'fail');
    assert.strictEqual(completedTestJob.summary?.includes('Actual: Stayed on Login page'), true);

    // 4. Run Self-Healing Logic (simulating components/web-ui/server.ts check)
    if (completedTestJob.type === 'test' && completedTestJob.verdict === 'fail') {
      const parentImplJob = completedTestJob.implements_job_id ? getJob(completedTestJob.implements_job_id) : null;
      
      let newTitle = 'Implementation Fix';
      if (parentImplJob) {
        newTitle = parentImplJob.title + '-A';
      }

      // Create new Implementation Fix job
      const newImplJob = insertLocalJob(completedTestJob.project_id!, {
        title: newTitle,
        description: completedTestJob.summary,
        dependsOn: parentImplJob ? [String(parentImplJob.id)] : [],
        type: 'implementation',
      });

      assert.strictEqual(newImplJob.title, 'Implement Login Screen-A');
      assert.strictEqual(newImplJob.description, completedTestJob.summary);
      assert.strictEqual(newImplJob.status, 'PENDING');

      // Reset the original test job to depend on the new Implementation Job
      resetJob(completedTestJob.id);
      updateJob(completedTestJob.id, {
        depends_on: JSON.stringify([String(newImplJob.id)]),
        implements_job_id: newImplJob.id,
      });

      const updatedTestJob = getJob(completedTestJob.id)!;
      assert.strictEqual(updatedTestJob.status, 'PENDING');
      assert.strictEqual(updatedTestJob.implements_job_id, newImplJob.id);
      assert.deepStrictEqual(JSON.parse(updatedTestJob.depends_on || '[]'), [String(newImplJob.id)]);
      assert.strictEqual(updatedTestJob.container_id, null);
      assert.strictEqual(updatedTestJob.stage, null);
      assert.strictEqual(updatedTestJob.vnc_host_port, null);
    } else {
      assert.fail('Self-healing trigger condition failed');
    }
  });
});
