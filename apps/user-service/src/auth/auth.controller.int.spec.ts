import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthentikService } from './authentik.service';

interface RegisterResponse {
  message: string;
}

interface ProfileResponse {
  id: string;
  authentikId: string;
  email: string;
  name: string | null;
}

const FAKE_SUB = '00000000-0000-0000-0000-000000000001';
const FAKE_EMAIL = 'int-test@example.com';

function buildFakeJwt(sub: string, email: string, name?: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      email,
      name,
      iss: 'https://authentik.yanatech.co.uk/application/o/yana-stocks/',
      aud: 'yana-stocks',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  // Signature is not verified by user-service (Kong handles that upstream)
  return `${header}.${payload}.fakesig`;
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mockAuthentik: jest.Mocked<Pick<AuthentikService, 'createUser' | 'triggerEmailVerification'>>;

  beforeAll(async () => {
    mockAuthentik = {
      createUser: jest.fn(),
      triggerEmailVerification: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthentikService)
      .useValue(mockAuthentik)
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthentik.triggerEmailVerification.mockResolvedValue(undefined);
  });

  describe('POST /auth/register', () => {
    it('returns 201 with message when Authentik creates the user', async () => {
      mockAuthentik.createUser.mockResolvedValue({
        pk: 'ak-uuid-1',
        username: FAKE_EMAIL,
        email: FAKE_EMAIL,
        name: 'Int Test',
        is_active: false,
      });

      const body = (
        await request(server)
          .post('/auth/register')
          .send({ email: FAKE_EMAIL, name: 'Int Test' })
          .expect(201)
      ).body as RegisterResponse;

      expect(body).toHaveProperty('message');
      expect(mockAuthentik.createUser).toHaveBeenCalledWith(FAKE_EMAIL, 'Int Test');
      expect(mockAuthentik.triggerEmailVerification).toHaveBeenCalledWith('ak-uuid-1');
    });

    it('derives name from email when omitted', async () => {
      mockAuthentik.createUser.mockResolvedValue({
        pk: 'ak-uuid-2',
        username: 'alice@example.com',
        email: 'alice@example.com',
        name: 'alice',
        is_active: false,
      });

      await request(server).post('/auth/register').send({ email: 'alice@example.com' }).expect(201);
      expect(mockAuthentik.createUser).toHaveBeenCalledWith('alice@example.com', 'alice');
    });

    it('returns 400 for invalid payload', async () => {
      await request(server).post('/auth/register').send({ email: 'not-an-email' }).expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('lazy-creates and returns profile on first call', async () => {
      const token = buildFakeJwt(FAKE_SUB, FAKE_EMAIL, 'Int Test');

      const profile = (
        await request(server).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200)
      ).body as ProfileResponse;

      expect(profile.authentikId).toBe(FAKE_SUB);
      expect(profile.email).toBe(FAKE_EMAIL);
      expect(profile).not.toHaveProperty('password');
    });

    it('returns the same profile on subsequent calls (idempotent)', async () => {
      const token = buildFakeJwt(FAKE_SUB, FAKE_EMAIL, 'Int Test');

      const first = (
        await request(server).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200)
      ).body as ProfileResponse;

      const second = (
        await request(server).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200)
      ).body as ProfileResponse;

      expect(first.id).toBe(second.id);
    });

    it('returns 401 without an Authorization header', async () => {
      await request(server).get('/auth/me').expect(401);
    });

    it('returns 401 for a malformed token', async () => {
      await request(server)
        .get('/auth/me')
        .set('Authorization', 'Bearer notavalidtoken')
        .expect(401);
    });
  });
});
