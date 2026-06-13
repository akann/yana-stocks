import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({});
    await app.close();
  });

  const uid = () =>
    `int+${Date.now()}+${Math.random().toString(36).slice(2, 7)}@example.com`;
  const PASSWORD = 'TestPass1!';

  describe('POST /auth/register', () => {
    it('creates a user and returns access + refresh tokens', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uid(), name: 'Test User', password: PASSWORD })
        .expect(201);

      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('refreshToken');
      expect(typeof body.accessToken).toBe('string');
    });

    it('returns 409 when email is already registered', async () => {
      const email = uid();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'First', password: PASSWORD });

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'Dupe', password: PASSWORD })
        .expect(409);
    });

    it('returns 400 for an invalid payload', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', name: '', password: 'x' })
        .expect(400);
    });

    it('persists the user to Postgres', async () => {
      const email = uid();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'Persist Check', password: PASSWORD })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user!.name).toBe('Persist Check');
      expect(user!.password).not.toBe(PASSWORD); // stored as bcrypt hash
    });
  });

  describe('POST /auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      const email = uid();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'Login User', password: PASSWORD });

      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
    });

    it('returns 401 for a wrong password', async () => {
      const email = uid();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'User', password: PASSWORD });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
    });

    it('returns 401 for an unknown email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the user profile for a valid access token', async () => {
      const email = uid();
      const { body: tokens } = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'Me User', password: PASSWORD });

      const { body } = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken as string}`)
        .expect(200);

      expect(body.email).toBe(email);
      expect(body).not.toHaveProperty('password');
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('returns 401 for a tampered token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.bad')
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('issues new tokens and rejects the consumed refresh token', async () => {
      const email = uid();
      const { body: initial } = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'Refresh User', password: PASSWORD });

      const { body: rotated } = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: initial.refreshToken as string })
        .expect(200);

      expect(rotated.accessToken).toBeTruthy();
      expect(rotated.refreshToken).not.toBe(initial.refreshToken);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: initial.refreshToken as string })
        .expect(401);
    });

    it('returns 401 for a made-up refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'totally-fake-token' })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('invalidates the refresh token so it cannot be reused', async () => {
      const email = uid();
      const { body: tokens } = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, name: 'Logout User', password: PASSWORD });

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken as string}`)
        .send({ refreshToken: tokens.refreshToken as string })
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken as string })
        .expect(401);
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: 'any' })
        .expect(401);
    });
  });
});
