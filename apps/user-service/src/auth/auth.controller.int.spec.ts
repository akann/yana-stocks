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

interface ProfileResponse {
  id: string;
  email: string;
  name: string;
  isVerified: boolean;
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api', { exclude: ['health'] });
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

  async function registerAndVerify(email: string, password = 'password123') {
    await request(server).post('/api/auth/register').send({ email, password }).expect(201);
    const token = new URL(capturedVerificationUrl!).searchParams.get('token')!;
    await request(server).post('/api/auth/verify').send({ token }).expect(200);
    capturedVerificationUrl = null;
  }

  async function login(email: string, password = 'password123'): Promise<LoginResponse> {
    return (
      await request(server).post('/api/auth/login').send({ email, password }).expect(200)
    ).body as LoginResponse;
  }

  describe('POST /api/auth/register', () => {
    it('returns 201 with message', async () => {
      const body = (
        await request(server)
          .post('/api/auth/register')
          .send({ email: 'int@example.com', name: 'Int Test', password: 'password123' })
          .expect(201)
      ).body as RegisterResponse;

      expect(body).toHaveProperty('message');
      expect(capturedVerificationUrl).toContain('/verify?token=');
    });

    it('returns 409 for duplicate email', async () => {
      await request(server).post('/api/auth/register').send({ email: 'dup@example.com', password: 'password123' }).expect(201);
      await request(server).post('/api/auth/register').send({ email: 'dup@example.com', password: 'other123' }).expect(409);
    });

    it('returns 400 for invalid payload', async () => {
      await request(server).post('/api/auth/register').send({ email: 'not-an-email', password: 'pass' }).expect(400);
    });
  });

  describe('POST /api/auth/verify + POST /api/auth/login flow', () => {
    it('allows login only after email verification', async () => {
      await request(server)
        .post('/api/auth/register')
        .send({ email: 'flow@example.com', password: 'password123' })
        .expect(201);

      await request(server)
        .post('/api/auth/login')
        .send({ email: 'flow@example.com', password: 'password123' })
        .expect(403);

      const token = new URL(capturedVerificationUrl!).searchParams.get('token')!;
      await request(server).post('/api/auth/verify').send({ token }).expect(200);

      const loginRes = (
        await request(server)
          .post('/api/auth/login')
          .send({ email: 'flow@example.com', password: 'password123' })
          .expect(200)
      ).body as LoginResponse;

      expect(loginRes).toHaveProperty('accessToken');
      expect(loginRes).toHaveProperty('refreshToken');
    });

    it('returns 401 for wrong password', async () => {
      await request(server).post('/api/auth/register').send({ email: 'wrong@example.com', password: 'password123' }).expect(201);
      const token = new URL(capturedVerificationUrl!).searchParams.get('token')!;
      await request(server).post('/api/auth/verify').send({ token }).expect(200);
      await request(server).post('/api/auth/login').send({ email: 'wrong@example.com', password: 'wrongpass' }).expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without Authorization header', async () => {
      await request(server).get('/api/auth/me').expect(401);
    });

    it('returns 401 for malformed token', async () => {
      await request(server).get('/api/auth/me').set('Authorization', 'Bearer notvalid').expect(401);
    });

    it('returns user profile for a valid access token', async () => {
      await registerAndVerify('me@example.com');
      const { accessToken } = await login('me@example.com');

      const profile = (
        await request(server)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      ).body as ProfileResponse;

      expect(profile.email).toBe('me@example.com');
      expect(profile.isVerified).toBe(true);
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('verificationToken');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues new access and refresh tokens', async () => {
      await registerAndVerify('refresh@example.com');
      const { refreshToken } = await login('refresh@example.com');

      const refreshRes = (
        await request(server)
          .post('/api/auth/refresh')
          .send({ refreshToken })
          .expect(200)
      ).body as LoginResponse;

      expect(refreshRes).toHaveProperty('accessToken');
      expect(refreshRes).toHaveProperty('refreshToken');
      expect(refreshRes.refreshToken).not.toBe(refreshToken);
    });

    it('invalidates the old refresh token after rotation', async () => {
      await registerAndVerify('rotate@example.com');
      const { refreshToken } = await login('rotate@example.com');

      await request(server).post('/api/auth/refresh').send({ refreshToken }).expect(200);
      await request(server).post('/api/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('returns 401 for an unknown refresh token', async () => {
      await request(server).post('/api/auth/refresh').send({ refreshToken: 'bad-token' }).expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns a message and invalidates the refresh token', async () => {
      await registerAndVerify('logout@example.com');
      const { refreshToken } = await login('logout@example.com');

      const logoutRes = (
        await request(server).post('/api/auth/logout').send({ refreshToken }).expect(200)
      ).body as { message: string };
      expect(logoutRes).toHaveProperty('message');

      await request(server).post('/api/auth/refresh').send({ refreshToken }).expect(401);
    });
  });
});
