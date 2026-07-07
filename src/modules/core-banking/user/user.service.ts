import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CoreBankingUser } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(CoreBankingUser)
    private readonly userRepository: Repository<CoreBankingUser>,
  ) {}

  create(
    data: Partial<CoreBankingUser>,
    manager?: EntityManager,
  ): Promise<CoreBankingUser> {
    const repository = manager
      ? manager.getRepository(CoreBankingUser)
      : this.userRepository;
    return repository.save(repository.create(data));
  }

  findByEmail(email: string): Promise<CoreBankingUser | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  findById(id: string): Promise<CoreBankingUser | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  save(user: CoreBankingUser): Promise<CoreBankingUser> {
    return this.userRepository.save(user);
  }
}
