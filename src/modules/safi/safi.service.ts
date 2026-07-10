import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSafiConfigDto } from './dto/create-safi-config.dto';
import { UpdateSafiConfigDto } from './dto/update-safi-config.dto';
import { ConfigFrequency, SafiConfig } from './entities/safi-config.entity';

@Injectable()
export class SafiService {
  constructor(
    @InjectRepository(SafiConfig)
    private readonly safiConfigRepository: Repository<SafiConfig>,
  ) {}

  async create(dto: CreateSafiConfigDto): Promise<SafiConfig> {
    const existing = await this.findByAccountNumber(dto.accountNumber);
    if (existing) {
      throw new ConflictException(
        `A config already exists for account number ${dto.accountNumber}`,
      );
    }

    this.assertProtectedSumWithinIncome(dto.income, dto.protectedSum);

    return this.safiConfigRepository.save(
      this.safiConfigRepository.create({
        accountNumber: dto.accountNumber,
        income: String(dto.income),
        protectedSum: String(dto.protectedSum),
        governanceMode: dto.governanceMode,
        frequency: dto.frequency,
        expiresAt: this.computeExpiresAt(dto.frequency, new Date()),
      }),
    );
  }

  findByAccountNumber(accountNumber: string): Promise<SafiConfig | null> {
    return this.safiConfigRepository.findOne({ where: { accountNumber } });
  }

  async getByAccountNumber(accountNumber: string): Promise<SafiConfig> {
    const config = await this.findByAccountNumber(accountNumber);
    if (!config) {
      throw new NotFoundException(
        `No config found for account number ${accountNumber}`,
      );
    }
    return config;
  }

  async update(
    accountNumber: string,
    dto: UpdateSafiConfigDto,
  ): Promise<SafiConfig> {
    const config = await this.getByAccountNumber(accountNumber);

    const income = dto.income ?? Number(config.income);
    const protectedSum = dto.protectedSum ?? Number(config.protectedSum);
    this.assertProtectedSumWithinIncome(income, protectedSum);

    if (dto.income !== undefined) config.income = String(dto.income);
    if (dto.protectedSum !== undefined)
      config.protectedSum = String(dto.protectedSum);
    if (dto.governanceMode !== undefined)
      config.governanceMode = dto.governanceMode;
    if (dto.frequency !== undefined) {
      config.frequency = dto.frequency;
      config.expiresAt = this.computeExpiresAt(dto.frequency, new Date());
    }

    return this.safiConfigRepository.save(config);
  }

  private assertProtectedSumWithinIncome(
    income: number,
    protectedSum: number,
  ): void {
    if (protectedSum > income) {
      throw new BadRequestException(
        'protectedSum cannot be greater than income',
      );
    }
  }

  private computeExpiresAt(frequency: ConfigFrequency, from: Date): Date {
    const expiresAt = new Date(from);
    switch (frequency) {
      case ConfigFrequency.DAILY:
        expiresAt.setDate(expiresAt.getDate() + 1);
        break;
      case ConfigFrequency.WEEKLY:
        expiresAt.setDate(expiresAt.getDate() + 7);
        break;
      case ConfigFrequency.MONTHLY:
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        break;
    }
    return expiresAt;
  }
}
