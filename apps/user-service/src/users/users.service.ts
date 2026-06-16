import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByAuthentikId(authentikId: string) {
    return this.prisma.userProfile.findUnique({ where: { authentikId } });
  }

  async findOrCreateByAuthentikId(authentikId: string, email: string, name: string | null) {
    const existing = await this.findByAuthentikId(authentikId);
    if (existing) return existing;

    return this.prisma.userProfile.create({
      data: { authentikId, email, name },
    });
  }
}
