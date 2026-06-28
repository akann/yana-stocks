import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PreferencesResponseDto {
  @ApiProperty({ enum: ['light', 'dark'], example: 'dark' })
  theme!: 'light' | 'dark';

  @ApiProperty({ example: 'GBP' })
  defaultCurrency!: string;

  @ApiProperty({ example: true })
  emailNotifications!: boolean;

  @ApiProperty({ enum: ['US', 'UK', 'global'], example: 'US' })
  defaultMarket!: 'US' | 'UK' | 'global';
}

export class ProfileResponseDto {
  @ApiProperty({ example: 'user-uuid-123' })
  userId!: string;

  @ApiProperty({ example: 'Jane Doe' })
  displayName!: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  avatar!: string;

  @ApiPropertyOptional({ example: 'Equity investor based in London.' })
  bio!: string;

  @ApiProperty({ type: () => PreferencesResponseDto })
  preferences!: PreferencesResponseDto;

  @ApiProperty({ type: 'string', format: 'date-time', example: '2024-01-15T10:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time', example: '2024-06-01T08:00:00.000Z' })
  updatedAt!: string;
}

export class PublicProfileResponseDto {
  @ApiProperty({ example: 'user-uuid-123' })
  userId!: string;

  @ApiProperty({ example: 'Jane Doe' })
  displayName!: string;

  @ApiProperty({ example: 'https://example.com/avatar.png' })
  avatar!: string;
}
