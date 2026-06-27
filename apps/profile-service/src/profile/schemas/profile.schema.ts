import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class Preferences {
  @ApiProperty({ enum: ['light', 'dark'], example: 'dark' })
  @Prop({ default: 'light' })
  theme!: 'light' | 'dark';

  @ApiProperty({ example: 'GBP' })
  @Prop({ default: 'USD' })
  defaultCurrency!: string;

  @ApiProperty({ example: true })
  @Prop({ default: true })
  emailNotifications!: boolean;

  @ApiProperty({ enum: ['US', 'UK', 'global'], example: 'US' })
  @Prop({ default: 'US', enum: ['US', 'UK', 'global'] })
  defaultMarket!: 'US' | 'UK' | 'global';
}

export const PreferencesSchema = SchemaFactory.createForClass(Preferences);

export type ProfileDocument = HydratedDocument<Profile>;

@Schema({ collection: 'profiles', timestamps: true })
export class Profile {
  @ApiProperty({ example: 'user-uuid-123' })
  @Prop({ required: true, unique: true, index: true })
  userId!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @Prop({ default: '' })
  displayName!: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @Prop({ default: '' })
  avatar!: string;

  @ApiPropertyOptional({ example: 'Equity investor based in London.' })
  @Prop({ default: '' })
  bio!: string;

  @ApiProperty({ type: () => Preferences })
  @Prop({ type: PreferencesSchema, default: () => ({}) })
  preferences!: Preferences;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
