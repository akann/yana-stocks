export interface UserProfile {
  id: string;
  authentikId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Claims present in JWTs issued by Authentik for the yana-stocks application. */
export interface JwtPayload {
  sub: string;       // Authentik user UUID (sub_mode: user_id)
  email: string;
  name?: string;
  iss: string;       // https://authentik.yanatech.co.uk/application/o/yana-stocks/
  aud: string | string[];
  iat: number;
  exp: number;
}
