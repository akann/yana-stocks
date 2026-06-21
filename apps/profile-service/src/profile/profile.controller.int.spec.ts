/**
 * Integration tests for ProfileController.
 *
 * Uses a real NestJS test application (no real MongoDB) by replacing
 * ProfileService with a mock implementation via overrideProvider.
 * The guard runs real JWT-decode logic so tests send real Base64 payloads.
 */
import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { type Server } from 'http';
import request from 'supertest';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { UserFromTokenGuard } from '../common/current-user.decorator';

// Minimal Base64url-encoded JWT header.payload.signature where payload is {sub, email}
function fakeJwt(sub: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ sub, email })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.fakesig`;
}

const AUTH = `Bearer ${fakeJwt('user-1', 'ada@example.com')}`;

const mockProfile = {
  userId: 'user-1',
  displayName: 'Ada',
  avatar: '',
  bio: '',
  preferences: { theme: 'dark', defaultCurrency: 'USD', emailNotifications: true },
};

describe('ProfileController (integration)', () => {
  let app: INestApplication;
  let profileService: jest.Mocked<
    Pick<ProfileService, 'getMyProfile' | 'updateMyProfile' | 'getPublicProfile'>
  >;

  beforeAll(async () => {
    profileService = {
      getMyProfile: jest.fn(),
      updateMyProfile: jest.fn(),
      getPublicProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [{ provide: ProfileService, useValue: profileService }, UserFromTokenGuard],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /api/profile/me ──────────────────────────────────────────────────

  describe('GET /api/profile/me', () => {
    it('returns 200 with profile for authenticated user', async () => {
      profileService.getMyProfile.mockResolvedValue(mockProfile as never);

      const res = await request(app.getHttpServer() as Server)
        .get('/api/profile/me')
        .set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ userId: 'user-1', displayName: 'Ada' });
      expect(profileService.getMyProfile).toHaveBeenCalledWith('user-1');
    });

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app.getHttpServer() as Server).get('/api/profile/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 when token has no sub claim', async () => {
      const payload = Buffer.from(JSON.stringify({ email: 'ada@example.com' })).toString(
        'base64url',
      );
      const badToken = `Bearer eyJhbGciOiJIUzI1NiJ9.${payload}.fakesig`;
      const res = await request(app.getHttpServer() as Server)
        .get('/api/profile/me')
        .set('Authorization', badToken);
      expect(res.status).toBe(401);
    });
  });

  // ── PUT /api/profile/me ──────────────────────────────────────────────────

  describe('PUT /api/profile/me', () => {
    it('returns 200 and updated profile on valid body', async () => {
      const updated = { ...mockProfile, displayName: 'Ada Lovelace' };
      profileService.updateMyProfile.mockResolvedValue(updated as never);

      const res = await request(app.getHttpServer() as Server)
        .put('/api/profile/me')
        .set('Authorization', AUTH)
        .send({ displayName: 'Ada Lovelace' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ displayName: 'Ada Lovelace' });
      expect(profileService.updateMyProfile).toHaveBeenCalledWith('user-1', {
        displayName: 'Ada Lovelace',
      });
    });

    it('strips unknown fields (whitelist validation)', async () => {
      profileService.updateMyProfile.mockResolvedValue(mockProfile as never);

      await request(app.getHttpServer() as Server)
        .put('/api/profile/me')
        .set('Authorization', AUTH)
        .send({ displayName: 'Ada', hacked: 'payload' });

      expect(profileService.updateMyProfile).toHaveBeenCalledWith(
        'user-1',
        expect.not.objectContaining({ hacked: 'payload' }),
      );
    });

    it('returns 401 without auth header', async () => {
      const res = await request(app.getHttpServer() as Server)
        .put('/api/profile/me')
        .send({ displayName: 'Ada' });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/profile/:userId ─────────────────────────────────────────────

  describe('GET /api/profile/:userId', () => {
    it('returns 200 with public profile fields', async () => {
      profileService.getPublicProfile.mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ada',
        avatar: '',
      });

      const res = await request(app.getHttpServer() as Server).get('/api/profile/user-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'user-1', displayName: 'Ada', avatar: '' });
    });

    it('returns 404 when profile does not exist', async () => {
      profileService.getPublicProfile.mockRejectedValue(new NotFoundException('Profile not found'));

      const res = await request(app.getHttpServer() as Server).get('/api/profile/unknown-user');
      expect(res.status).toBe(404);
    });
  });
});
