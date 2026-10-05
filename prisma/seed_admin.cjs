'use strict';
const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const [email, fullName, password] = process.argv.slice(2);
  if (!email || !fullName || !password) {
    console.error('Usage: node prisma/seed_admin.cjs <email> <fullName> <password>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log('User already exists, updating role to ADMIN and activating...');
      await prisma.user.update({
        where: { email },
        data: { role: UserRole.ADMIN, isActive: true },
      });
    } else {
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash,
          role: UserRole.ADMIN,
          isActive: true,
        },
      });
    }
    console.log('Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});