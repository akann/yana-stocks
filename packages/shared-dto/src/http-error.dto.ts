import { ApiProperty } from '@nestjs/swagger';

export class UnauthorizedDto {
  @ApiProperty({ example: 401 })
  statusCode!: number;

  @ApiProperty({ example: 'Unauthorized' })
  message!: string;

  @ApiProperty({ example: 'Unauthorized' })
  error!: string;
}

export class NotFoundDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'Not Found' })
  message!: string;

  @ApiProperty({ example: 'Not Found' })
  error!: string;
}

export class ConflictDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ example: 'Conflict' })
  message!: string;

  @ApiProperty({ example: 'Conflict' })
  error!: string;
}
