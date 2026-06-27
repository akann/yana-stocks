import { Body, Controller, Get, Param, Put, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Profile } from './schemas/profile.schema';
import { UpdateProfileDto } from '@yana-stocks/shared-dto';
import { AuthUser, CurrentUser, UserFromTokenGuard } from '../common/current-user.decorator';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@Controller('api/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @UseGuards(UserFromTokenGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ type: Profile })
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.profileService.getMyProfile(user.id);
  }

  @Put('me')
  @UseGuards(UserFromTokenGuard)
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiOkResponse({ type: Profile })
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateProfileDto,
  ) {
    return this.profileService.updateMyProfile(user.id, dto);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get public profile (displayName + avatar only)' })
  @ApiOkResponse({ type: Profile })
  getPublicProfile(@Param('userId') userId: string) {
    return this.profileService.getPublicProfile(userId);
  }
}
