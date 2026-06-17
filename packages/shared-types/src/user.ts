export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtPayload {
  sub: string; // UserProfile.id (UUID)
  email: string;
  name?: string;
  iss?: string;
  iat: number;
  exp: number;
}
