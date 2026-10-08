// Test data for watching reminders, overdue handling and the calendar.
// Run with: node prisma/seed-today-tasks.cjs
//
// Safe to run repeatedly: it first deletes every task whose title starts
// with "[TEST] " (comments, checklist items and attachments cascade), the
// notifications pointing at those tasks, all "[TEST]" sample notifications,
// and today's daily-summary notifications for the test workers. Reminder
// de-duplication lives in Notification.dedupeKey, so removing those rows
// lets the 24h/2h reminders, overdue alerts and the summary fire again.
//
// All times are computed from "now", so start the backend afterwards (or
// leave it running) and the reminder job picks the tasks up within ~5 min.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TEST_PREFIX = '[TEST] ';
const ADMIN_EMAIL = 'admin@taskflow.local';
const WORKER_EMAIL = 'worker@taskflow.local';
const WORKER2_EMAIL = 'worker2@taskflow.local';
const REQUIRED_MIGRATION = 'notification_kinds_reassigned_daily_summary';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function requireMigration() {
  const rows = await prisma.$queryRaw`
    SELECT migration_name FROM _prisma_migrations
    WHERE migration_name LIKE ${'%' + REQUIRED_MIGRATION} AND finished_at IS NOT NULL`.catch(
    () => [],
  );
  if (rows.length === 0) {
    throw new Error(
      `Migration "${REQUIRED_MIGRATION}" is not applied. Run "npx prisma migrate dev" first.`,
    );
  }
}

async function requireUser(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`User ${email} does not exist. Run "node prisma/seed.cjs" first.`);
  }
  return user;
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Local time on the day `daysFromToday` away, e.g. atLocal(3, 10, 0). */
function atLocal(now, daysFromToday, hours, minutes) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, hours, minutes);
}

async function cleanUp(workerIds) {
  const oldTasks = await prisma.task.findMany({
    where: { title: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const oldTaskIds = oldTasks.map((t) => t.id);

  // Notification.taskId is ON DELETE SET NULL, so delete these explicitly
  // (otherwise their dedupe keys would linger and block new reminders).
  const notifications = await prisma.notification.deleteMany({
    where: {
      OR: [
        { taskId: { in: oldTaskIds } },
        { dedupeKey: { startsWith: 'test:' } },
        { userId: { in: workerIds }, dedupeKey: `daily-summary:${localDateKey(new Date())}` },
      ],
    },
  });
  // TaskComment, TaskChecklistItem and TaskAttachment cascade on delete.
  const tasks = await prisma.task.deleteMany({ where: { id: { in: oldTaskIds } } });
  return { tasks: tasks.count, notifications: notifications.count };
}

/** Four deadlines spread over what is left of today (all still today). */
function laterTodayDeadlines(now) {
  const start = now.getTime() + 30 * MINUTE;
  const end = atLocal(now, 0, 23, 50).getTime();
  const span = Math.max(end - start, 4 * MINUTE);
  return [0.15, 0.4, 0.65, 0.9].map((f) => new Date(start + span * f));
}

async function main() {
  await requireMigration();
  const admin = await requireUser(ADMIN_EMAIL);
  const worker = await requireUser(WORKER_EMAIL);
  const worker2 = await requireUser(WORKER2_EMAIL);

  const removed = await cleanUp([worker.id, worker2.id]);
  const now = new Date();
  const today = laterTodayDeadlines(now);

  const specs = [
    { title: 'Inspect loading dock lights', priority: 'LOW', deadline: today[0], location: 'Warehouse B, Dock 3', note: 'later today, has location' },
    { title: 'Restock first-aid cabinets', priority: 'MEDIUM', deadline: today[1], checklist: ['Count supplies', 'Replace expired items', 'Log refill'], note: 'later today, 3-item checklist' },
    { title: 'Photograph fire exits', priority: 'HIGH', deadline: today[2], minPhotosRequired: 2, note: 'later today, 2 photos required' },
    { title: 'Fix leaking pipe in kitchen', priority: 'URGENT', deadline: today[3], status: 'IN_PROGRESS', note: 'later today, in progress' },
    { title: 'Check generator fuel level', priority: 'HIGH', deadline: new Date(now.getTime() + 110 * MINUTE), status: 'IN_PROGRESS', note: 'due in 1h50m -> 2h reminder' },
    { title: 'Prepare weekly safety report', priority: 'MEDIUM', deadline: new Date(now.getTime() + 23 * HOUR + 50 * MINUTE), note: 'due in 23h50m -> 24h reminder' },
    { title: 'Replace air filters (late)', priority: 'MEDIUM', deadline: new Date(now.getTime() - 2 * HOUR), note: 'due 2h ago, ASSIGNED -> job marks OVERDUE' },
    { title: 'Clean storage room (overdue)', priority: 'LOW', deadline: atLocal(now, -1, 17, 0), status: 'OVERDUE', markedOverdueAt: atLocal(now, -1, 17, 5), note: 'due yesterday, already OVERDUE' },
    { title: 'Service forklift', priority: 'MEDIUM', deadline: atLocal(now, 3, 10, 0), startDate: atLocal(now, 2, 9, 0), note: 'later this week (start + due)' },
    { title: 'Audit tool inventory', priority: 'HIGH', deadline: atLocal(now, 5, 15, 0), note: 'later this week' },
    { title: 'Organize spare parts shelf', priority: 'LOW', deadline: null, note: 'no deadline -> no reminders' },
    { title: 'Repaint parking lines', priority: 'MEDIUM', deadline: today[1], assignee: worker2, note: 'worker2 only (isolation check)' },
  ];

  const created = [];
  for (const spec of specs) {
    const task = await prisma.task.create({
      data: {
        title: TEST_PREFIX + spec.title,
        description: `Test task: ${spec.note}.`,
        priority: spec.priority,
        status: spec.status ?? 'ASSIGNED',
        deadline: spec.deadline,
        startDate: spec.startDate,
        location: spec.location,
        minPhotosRequired: spec.minPhotosRequired ?? 0,
        requiresChecklist: !!spec.checklist,
        markedOverdueAt: spec.markedOverdueAt,
        assigneeId: (spec.assignee ?? worker).id,
        createdById: admin.id,
        checklistItems: spec.checklist
          ? { create: spec.checklist.map((label) => ({ label })) }
          : undefined,
      },
    });
    created.push({ task, spec });
  }

  const byTitle = (title) => created.find((c) => c.spec.title === title).task;
  const commentTask = byTitle('Restock first-aid cabinets');
  await prisma.taskComment.create({
    data: {
      taskId: commentTask.id,
      authorId: admin.id,
      body: '[TEST] Please check the burn gel stock too.',
    },
  });

  // Sample in-app notifications for the worker: different kinds, read and
  // unread, spread over today / yesterday / earlier.
  const ago = (ms) => new Date(now.getTime() - ms);
  const samples = [
    { kind: 'TASK_COMMENT', task: commentTask, title: `New comment on "${commentTask.title}"`, body: 'Demo Admin: [TEST] Please check the burn gel stock too.', createdAt: ago(5 * MINUTE) },
    { kind: 'TASK_ASSIGNED', task: byTitle('Fix leaking pipe in kitchen'), title: 'New task assigned', body: `${TEST_PREFIX}Fix leaking pipe in kitchen`, createdAt: ago(40 * MINUTE) },
    { kind: 'TASK_UPDATED', task: byTitle('Photograph fire exits'), title: 'Task updated', body: `"${TEST_PREFIX}Photograph fire exits": priority (now high) and deadline changed.`, createdAt: ago(2 * HOUR), read: true },
    { kind: 'DAILY_SUMMARY', task: null, title: 'Your day ahead', body: 'You have 5 tasks due today.', createdAt: ago(3 * HOUR) },
    { kind: 'TASK_REASSIGNED', task: byTitle('Audit tool inventory'), title: 'Task reassigned to you', body: `"${TEST_PREFIX}Audit tool inventory" was reassigned to you.`, createdAt: ago(26 * HOUR) },
    { kind: 'TASK_DUE_SOON', task: byTitle('Prepare weekly safety report'), title: `Due in 24 hours: ${TEST_PREFIX}Prepare weekly safety report`, body: `Your task "${TEST_PREFIX}Prepare weekly safety report" is due in 24 hours.`, createdAt: ago(28 * HOUR), read: true },
    { kind: 'TASK_OVERDUE', task: byTitle('Clean storage room (overdue)'), title: 'Task overdue', body: `"${TEST_PREFIX}Clean storage room (overdue)" passed its deadline and is now overdue.`, createdAt: ago(3 * DAY) },
    { kind: 'TASK_UNASSIGNED', task: byTitle('Repaint parking lines'), title: 'Task reassigned', body: `"${TEST_PREFIX}Repaint parking lines" was reassigned and is no longer on your list.`, createdAt: ago(4 * DAY), read: true },
  ];
  for (const [index, n] of samples.entries()) {
    await prisma.notification.create({
      data: {
        userId: worker.id,
        kind: n.kind,
        taskId: n.task?.id ?? null,
        title: `[TEST] ${n.title}`,
        body: n.body,
        createdAt: n.createdAt,
        readAt: n.read ? new Date(n.createdAt.getTime() + MINUTE) : null,
        dedupeKey: `test:${index}`,
      },
    });
  }

  const fmt = (d) => (d ? d.toLocaleString() : 'no deadline');
  console.log(`Removed earlier test data: ${removed.tasks} task(s), ${removed.notifications} notification(s).`);
  console.log(`\nCreated ${created.length} tasks (created by ${ADMIN_EMAIL}):`);
  for (const { task, spec } of created) {
    const who = (spec.assignee ?? worker).email.split('@')[0];
    console.log(
      `  ${task.status.padEnd(11)} ${task.priority.padEnd(6)} ${who.padEnd(7)} ${fmt(task.deadline).padEnd(24)} ${task.title}  (${spec.note})`,
    );
  }
  console.log(`\nCreated 1 test comment (admin) on "${commentTask.title}".`);
  console.log(
    `Created ${samples.length} sample notifications for ${WORKER_EMAIL} (${samples.filter((s) => !s.read).length} unread).`,
  );
  console.log('\nWithin ~5 minutes the reminder job should send:');
  console.log('  - 24h reminders for tasks due in 2h..24h, 2h reminders for tasks due within 2h');
  console.log('  - OVERDUE status + alerts (worker and admin) for "Replace air filters (late)"');
  console.log('  - a daily summary, if the backend clock is between 08:00 and 12:00');
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
