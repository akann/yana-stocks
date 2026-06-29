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
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AddStockDto, CreatePortfolioDto } from '@yana-stocks/shared-dto';
import { AuthUser, CurrentUser, UserFromTokenGuard } from '../common/current-user.decorator';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';
import { Portfolio } from './schemas/portfolio.schema';
import { PortfoliosService } from './portfolios.service';

@ApiTags('portfolios')
@UseGuards(UserFromTokenGuard)
@ApiBearerAuth()
@Controller('portfolios')
export class PortfoliosController {
  constructor(private readonly portfoliosService: PortfoliosService) {}

  @Get()
  @ApiOperation({ summary: 'List portfolios for the authenticated user' })
  @ApiOkResponse({ type: [Portfolio] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  findAll(): Promise<Portfolio[]> {
    return this.portfoliosService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a portfolio by ID' })
  @ApiOkResponse({ type: Portfolio })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Portfolio not found' })
  findOne(@Param('id') id: string): Promise<Portfolio> {
    return this.portfoliosService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a portfolio' })
  @ApiOkResponse({ type: Portfolio })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  create(
    @Body(ValidationPipe) dto: CreatePortfolioDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Portfolio> {
    return this.portfoliosService.create(dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Rename a portfolio' })
  @ApiOkResponse({ type: Portfolio })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Portfolio not found' })
  update(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: UpdatePortfolioDto,
  ): Promise<Portfolio> {
    return this.portfoliosService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a portfolio' })
  @ApiNoContentResponse({ description: 'Portfolio deleted' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Portfolio not found' })
  remove(@Param('id') id: string): Promise<void> {
    return this.portfoliosService.remove(id);
  }

  @Post(':id/stocks')
  @ApiOperation({ summary: 'Add a stock to a portfolio (records a buy trade)' })
  @ApiOkResponse({ type: Portfolio })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Portfolio not found' })
  addStock(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: AddStockDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Portfolio> {
    return this.portfoliosService.addStock(id, dto, user);
  }
}
