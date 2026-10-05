const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const USERS = [
  {
    email: 'worker@taskflow.local',
    password: 'Pass1234!',
    fullName: 'Demo Worker',
    role: 'WORKER',
  },
  {
    email: 'worker2@taskflow.local',
    password: 'Pass1234!',
    fullName: 'Demo Worker 2',
    role: 'WORKER',
  },
  {
    email: 'admin@taskflow.local',
    password: 'Pass1234!',
    fullName: 'Demo Admin',
    role: 'ADMIN',
  },
];

async function main() {
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 12);

    await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName, passwordHash, role: u.role, isActive: true },
      create: { email: u.email, fullName: u.fullName, passwordHash, role: u.role, isActive: true },
    });

    console.log('Seeded:', u.role, u.email, '/', u.password);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
