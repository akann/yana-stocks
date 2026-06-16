import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.userProfile.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.userProfile.findUnique({ where: { id } });
  }

  findByVerificationToken(token: string) {
    return this.prisma.userProfile.findUnique({ where: { verificationToken: token } });
  }

  create(data: {
    email: string;
    name: string | null;
    passwordHash: string;
    verificationToken: string;
    verificationTokenExpiry: Date;
  }) {
    return this.prisma.userProfile.create({ data: { ...data, isVerified: false } });
  }

  verifyEmail(id: string) {
    return this.prisma.userProfile.update({
      where: { id },
      data: { isVerified: true, verificationToken: null, verificationTokenExpiry: null },
    });
  }
}
