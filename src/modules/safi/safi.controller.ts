import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CreateSafiConfigDto } from './dto/create-safi-config.dto';
import { UpdateSafiConfigDto } from './dto/update-safi-config.dto';
import { SafiService } from './safi.service';

export class UpdateAdminControlsDto {
  @IsOptional()
  @IsString()
  governanceMode?: string;

  @IsOptional()
  @IsString()
  overrideAuth?: string;

  @IsOptional()
  @IsString()
  complianceReporting?: string;

  @IsOptional()
  allowedBehaviours?: string[];

  @IsOptional()
  activeModes?: string[];

  @IsOptional()
  modeConfigurations?: Record<string, any>;
}

export class CreateAdminRuleDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateAdminRuleDto {
  @IsNotEmpty()
  @IsString()
  status: string;
}

export class UpdateAdminComplianceWebhookDto {
  @IsNotEmpty()
  @IsString()
  webhookUrl: string;

  @IsNotEmpty()
  @IsString()
  webhookFreq: string;
}


@ApiTags('safi')
@Controller('safi')
export class SafiController {
  constructor(private readonly safiService: SafiService) {}

  @Post('config')
  create(@Body() dto: CreateSafiConfigDto) {
    return this.safiService.create(dto);
  }

  @Get('config/:accountNumber')
  getByAccountNumber(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getByAccountNumber(accountNumber);
  }

  @Patch('config/:accountNumber')
  update(
    @Param('accountNumber') accountNumber: string,
    @Body() dto: UpdateSafiConfigDto,
  ) {
    return this.safiService.update(accountNumber, dto);
  }

  @Get('config/:accountNumber/dashboard')
  getDashboard(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getDashboard(accountNumber);
  }

  @Get('config/:accountNumber/history')
  getHistory(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getHistory(accountNumber);
  }

  @Get('controls')
  getControls() {
    return this.safiService.getControls();
  }

  @Delete('config/:accountNumber')
  deactivate(@Param('accountNumber') accountNumber: string) {
    return this.safiService.deactivate(accountNumber);
  }

  @Post('config/:accountNumber/pause')
  pause(@Param('accountNumber') accountNumber: string) {
    return this.safiService.pause(accountNumber);
  }

  @Post('config/:accountNumber/resume')
  resume(@Param('accountNumber') accountNumber: string) {
    return this.safiService.resume(accountNumber);
  }

  @Post('config/:accountNumber/override')
  manualOverride(
    @Param('accountNumber') accountNumber: string,
    @Body() body: { reason: string; amount: string },
  ) {
    return this.safiService.manualOverride(accountNumber, body.reason, body.amount);
  }

  @Get('config/:accountNumber/projection')
  getProjection(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getProjection(accountNumber);
  }

  @Get('admin/dashboard')
  getAdminDashboard() {
    return this.safiService.getAdminDashboard();
  }

  @Get('admin/rules')
  getAdminRules() {
    return this.safiService.getAdminRules();
  }

  @Post('admin/rules')
  createAdminRule(@Body() body: CreateAdminRuleDto) {
    return this.safiService.createAdminRule(body);
  }

  @Patch('admin/rules/:id')
  updateAdminRule(
    @Param('id') id: string,
    @Body() body: UpdateAdminRuleDto
  ) {
    return this.safiService.updateAdminRule(id, body.status);
  }

  @Delete('admin/rules/:id')
  deleteAdminRule(@Param('id') id: string) {
    return this.safiService.deleteAdminRule(id);
  }

  @Get('admin/audit-logs')
  getAdminAuditLogs() {
    return this.safiService.getAdminAuditLogs();
  }

  @Patch('admin/controls')
  updateAdminControls(
    @Body() body: UpdateAdminControlsDto
  ) {
    return this.safiService.updateAdminControls(body);
  }

  @Get('admin/transactions')
  getAdminTransactions() {
    return this.safiService.getAdminTransactions();
  }

  @Get('admin/deployments')
  getAdminDeployments() {
    return this.safiService.getAdminDeployments();
  }

  @Get('admin/analytics')
  getAdminAnalytics() {
    return this.safiService.getAdminAnalytics();
  }

  @Get('admin/compliance')
  getAdminCompliance() {
    return this.safiService.getAdminCompliance();
  }

  @Patch('admin/compliance/webhook')
  updateAdminComplianceWebhook(@Body() body: UpdateAdminComplianceWebhookDto) {
    return this.safiService.updateAdminComplianceWebhook(body);
  }
}
