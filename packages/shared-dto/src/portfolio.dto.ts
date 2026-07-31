import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

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

export class AddStocksBatchDto {
  @ApiProperty({ type: [AddStockDto], description: 'Buy trades to record, 1-50 per request' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddStockDto)
  items!: AddStockDto[];
}
