import React from 'react';
import { ProfilePage } from '@/components/profile/ProfilePage';

export const metadata = { title: 'Profile' };

export default function ProfileRoute(): React.JSX.Element {
  return <ProfilePage />;
}
