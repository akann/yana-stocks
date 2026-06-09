import { IsNumber, IsPositive, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePortfolioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class AddStockDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  symbol!: string;

  @IsNumber()
  @IsPositive()
  shares!: number;

  @IsNumber()
  @Min(0.01)
  price!: number;
}
