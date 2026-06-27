import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePortfolioDto {
  @ApiProperty({ example: 'Renamed Portfolio' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
