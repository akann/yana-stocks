import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddStockDto, CreatePortfolioDto } from '@yana-stocks/shared-dto';
import type { Portfolio } from '@yana-stocks/shared-types';
import { AuthUser, CurrentUser, UserFromTokenGuard } from '../common/current-user.decorator';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';
import { PortfoliosService } from './portfolios.service';

@ApiTags('portfolios')
@UseGuards(UserFromTokenGuard)
@Controller('portfolios')
export class PortfoliosController {
  constructor(private readonly portfoliosService: PortfoliosService) {}

  @Get()
  @ApiOperation({ summary: 'List portfolios for the authenticated user' })
  findAll(@CurrentUser() user: AuthUser): Promise<Portfolio[]> {
    return this.portfoliosService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a portfolio by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<Portfolio> {
    return this.portfoliosService.findOne(id, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a portfolio' })
  create(
    @Body(ValidationPipe) dto: CreatePortfolioDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Portfolio> {
    return this.portfoliosService.create(dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Rename a portfolio' })
  update(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: UpdatePortfolioDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Portfolio> {
    return this.portfoliosService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a portfolio' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.portfoliosService.remove(id, user.id);
  }

  @Post(':id/stocks')
  @ApiOperation({ summary: 'Add a stock to a portfolio (records a buy trade)' })
  addStock(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: AddStockDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Portfolio> {
    return this.portfoliosService.addStock(id, dto, user);
  }
}
