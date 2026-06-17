import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // Pre-verified test user — password: password123
  const user = await prisma.userProfile.upsert({
    where: { email: 'test@yanatech.co.uk' },
    update: {},
    create: {
      email: 'test@yanatech.co.uk',
      name: 'Test User',
      passwordHash: '$2b$12$6.7jk7Md2zrBQQ/nSCF1xOJvNFxbFeclPbADDdhX9oNjJz1CPCCDq',
      isVerified: true,
    },
  });
  console.log(`Seeded user: ${user.email} (password: password123)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
