import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class Preferences {
  @Prop({ default: 'light' })
  theme!: 'light' | 'dark';

  @Prop({ default: 'USD' })
  defaultCurrency!: string;

  @Prop({ default: true })
  emailNotifications!: boolean;
}

export const PreferencesSchema = SchemaFactory.createForClass(Preferences);

export type ProfileDocument = HydratedDocument<Profile>;

@Schema({ collection: 'profiles', timestamps: true })
export class Profile {
  @Prop({ required: true, unique: true, index: true })
  userId!: string;

  @Prop({ default: '' })
  displayName!: string;

  @Prop({ default: '' })
  avatar!: string;

  @Prop({ default: '' })
  bio!: string;

  @Prop({ type: PreferencesSchema, default: () => ({}) })
  preferences!: Preferences;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
