import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePortfolioDto {
  @ApiProperty({ example: 'My ISA Portfolio' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class AddStockDto {
  @ApiProperty({ example: 'AAPL' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  symbol!: string;

  @ApiProperty({ example: 10, description: 'Number of shares purchased' })
  @IsNumber()
  @IsPositive()
  shares!: number;

  @ApiProperty({ example: 182.5, description: 'Purchase price per share' })
  @IsNumber()
  @Min(0.01)
  price!: number;
}
