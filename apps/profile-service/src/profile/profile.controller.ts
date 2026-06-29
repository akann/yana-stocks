import { Body, Controller, Get, Param, Put, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Profile } from './schemas/profile.schema';
import { PublicProfileResponseDto } from './dto/public-profile.response.dto';
import { UpdateProfileDto } from '@yana-stocks/shared-dto';
import { AuthUser, CurrentUser, UserFromTokenGuard } from '../common/current-user.decorator';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@Controller('api/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @UseGuards(UserFromTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ type: Profile })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.profileService.getMyProfile(user.id);
  }

  @Put('me')
  @UseGuards(UserFromTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiOkResponse({ type: Profile })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateProfileDto,
  ) {
    return this.profileService.updateMyProfile(user.id, dto);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get public profile (displayName + avatar only)' })
  @ApiOkResponse({ type: PublicProfileResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  getPublicProfile(@Param('userId') userId: string) {
    return this.profileService.getPublicProfile(userId);
  }
}
