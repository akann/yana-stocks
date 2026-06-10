import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWatchlistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  symbols!: string[];
}
