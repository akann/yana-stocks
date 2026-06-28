import { ApiProperty } from '@nestjs/swagger';

export class PublicProfileResponseDto {
  @ApiProperty({ example: 'user-uuid-123' })
  userId!: string;

  @ApiProperty({ example: 'Jane Doe' })
  displayName!: string;

  @ApiProperty({ example: 'https://example.com/avatar.png' })
  avatar!: string;
}
