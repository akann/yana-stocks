import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { UpdateProfileDto } from '@yana-stocks/shared-dto';
import { Model } from 'mongoose';
import { Profile, ProfileDocument } from './schemas/profile.schema';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(@InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>) {}

  async findOrCreateByUserId(userId: string): Promise<ProfileDocument> {
    const existing = await this.profileModel.findOne({ userId });
    if (existing) return existing;
    return this.profileModel.create({ userId });
  }

  async getMyProfile(userId: string): Promise<ProfileDocument> {
    return this.findOrCreateByUserId(userId);
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileDocument> {
    const update: Record<string, unknown> = {};
    if (dto.displayName !== undefined) update['displayName'] = dto.displayName;
    if (dto.avatar !== undefined) update['avatar'] = dto.avatar;
    if (dto.bio !== undefined) update['bio'] = dto.bio;
    if (dto.preferences !== undefined) {
      if (dto.preferences.theme !== undefined) update['preferences.theme'] = dto.preferences.theme;
      if (dto.preferences.defaultCurrency !== undefined)
        update['preferences.defaultCurrency'] = dto.preferences.defaultCurrency;
      if (dto.preferences.emailNotifications !== undefined)
        update['preferences.emailNotifications'] = dto.preferences.emailNotifications;
    }

    const profile = await this.profileModel.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true },
    );
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async getPublicProfile(
    userId: string,
  ): Promise<{ userId: string; displayName: string; avatar: string }> {
    const profile = await this.profileModel.findOne({ userId }).select('userId displayName avatar');
    if (!profile) throw new NotFoundException('Profile not found');
    return { userId: profile.userId, displayName: profile.displayName, avatar: profile.avatar };
  }

  async createDefaultProfile(userId: string): Promise<void> {
    try {
      await this.profileModel.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });
      this.logger.log('Created default profile for user %s', userId);
    } catch (err) {
      this.logger.error('Failed to create default profile for %s: %s', userId, String(err));
    }
  }
}
