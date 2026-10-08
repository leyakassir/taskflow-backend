const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TASK_COUNT = 45; // creates enough for 3 pages at the default limit of 20

async function main() {
  const worker = await prisma.user.findUnique({
    where: { email: 'worker@taskflow.local' },
  });
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@taskflow.local' },
  });

  if (!worker || !admin) {
    throw new Error(
      'Run `npx prisma db seed` first so worker@taskflow.local and admin@taskflow.local exist.',
    );
  }

  for (let i = 1; i <= TASK_COUNT; i++) {
    await prisma.task.create({
      data: {
        title: `Pagination test task #${i}`,
        description: 'Created by seed-many-tasks.cjs for pagination testing',
        assigneeId: worker.id,
        createdById: admin.id,
      },
    });
  }

  console.log(`Created ${TASK_COUNT} tasks assigned to ${worker.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
