import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalystRating {
  @ApiProperty({ example: 12 })
  strongBuy!: number;

  @ApiProperty({ example: 8 })
  buy!: number;

  @ApiProperty({ example: 5 })
  hold!: number;

  @ApiProperty({ example: 1 })
  sell!: number;

  @ApiProperty({ example: 0 })
  strongSell!: number;

  @ApiProperty({ example: 26 })
  analystCount!: number;

  @ApiPropertyOptional({ example: 210.5, nullable: true })
  priceTarget!: number | null;

  @ApiPropertyOptional({
    enum: ['strongBuy', 'buy', 'hold', 'sell', 'strongSell'],
    example: 'buy',
    nullable: true,
  })
  consensus!: 'strongBuy' | 'buy' | 'hold' | 'sell' | 'strongSell' | null;

  @ApiPropertyOptional({ example: '2024-06-01', nullable: true })
  asOf!: string | null;
}
