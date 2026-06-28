import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ example: 'Operation successful' })
  message!: string;
}

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 'a1b2c3d4e5f6...' })
  refreshToken!: string;
}

export class MeResponseDto {
  @ApiProperty({ example: 'user-uuid-123', description: 'User ID (JWT sub claim)' })
  sub!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  name?: string;

  @ApiProperty({ example: 'yana-stocks' })
  iss!: string;

  @ApiProperty({ example: 1705312200 })
  iat!: number;

  @ApiProperty({ example: 1705313100 })
  exp!: number;
}
