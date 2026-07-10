import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSafiConfigDto } from './create-safi-config.dto';

export class UpdateSafiConfigDto extends PartialType(
  OmitType(CreateSafiConfigDto, ['accountNumber'] as const),
) {}
