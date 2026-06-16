import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

interface RegisterResponse {
  message: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let capturedVerificationUrl: string | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationEmail: jest.fn().mockImplementation((_to: string, url: string) => {
          capturedVerificationUrl = url;
          return Promise.resolve();
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    server = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.userProfile.deleteMany({});
    await app.close();
  });

  beforeEach(async () => {
    await prisma.userProfile.deleteMany({});
    capturedVerificationUrl = null;
  });

  describe('POST /auth/register', () => {
    it('returns 201 with message', async () => {
      const body = (
        await request(server)
          .post('/auth/register')
          .send({ email: 'int@example.com', name: 'Int Test', password: 'password123' })
          .expect(201)
      ).body as RegisterResponse;

      expect(body).toHaveProperty('message');
      expect(capturedVerificationUrl).toContain('/verify?token=');
    });

    it('returns 409 for duplicate email', async () => {
      await request(server).post('/auth/register').send({ email: 'dup@example.com', password: 'password123' }).expect(201);
      await request(server).post('/auth/register').send({ email: 'dup@example.com', password: 'other123' }).expect(409);
    });

    it('returns 400 for invalid payload', async () => {
      await request(server).post('/auth/register').send({ email: 'not-an-email', password: 'pass' }).expect(400);
    });
  });

  describe('POST /auth/verify + POST /auth/login flow', () => {
    it('allows login only after email verification', async () => {
      await request(server)
        .post('/auth/register')
        .send({ email: 'flow@example.com', password: 'password123' })
        .expect(201);

      await request(server)
        .post('/auth/login')
        .send({ email: 'flow@example.com', password: 'password123' })
        .expect(403);

      const token = new URL(capturedVerificationUrl!).searchParams.get('token')!;
      await request(server).post('/auth/verify').send({ token }).expect(200);

      const loginRes = (
        await request(server)
          .post('/auth/login')
          .send({ email: 'flow@example.com', password: 'password123' })
          .expect(200)
      ).body as LoginResponse;

      expect(loginRes).toHaveProperty('accessToken');
      expect(loginRes).toHaveProperty('refreshToken');
    });

    it('returns 401 for wrong password', async () => {
      await request(server).post('/auth/register').send({ email: 'wrong@example.com', password: 'password123' }).expect(201);
      const token = new URL(capturedVerificationUrl!).searchParams.get('token')!;
      await request(server).post('/auth/verify').send({ token }).expect(200);
      await request(server).post('/auth/login').send({ email: 'wrong@example.com', password: 'wrongpass' }).expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 without Authorization header', async () => {
      await request(server).get('/auth/me').expect(401);
    });

    it('returns 401 for malformed token', async () => {
      await request(server).get('/auth/me').set('Authorization', 'Bearer notvalid').expect(401);
    });
  });
});
