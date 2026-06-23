import { Injectable, NotFoundException } from '@nestjs/common';
import { TasksRepository } from './tasks.repository';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';
import { SessionContext } from '../../database/rls.helper';

@Injectable()
export class TasksService {
  constructor(private readonly repo: TasksRepository) {}

  async findAll(ctx: SessionContext, filters: any) {
    const { data, total } = await this.repo.findAll(ctx, filters);
    return {
      data,
      pagination: {
        page: filters.page, limit: filters.limit,
        total, totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  async findById(ctx: SessionContext, id: string) {
    const row = await this.repo.findById(ctx, id);
    if (!row) throw new NotFoundException(`Task ${id} não encontrada`);
    return row;
  }

  async create(ctx: SessionContext, dto: CreateTaskDto) {
    return this.repo.create(ctx, dto);
  }

  async update(ctx: SessionContext, id: string, dto: UpdateTaskDto) {
    await this.findById(ctx, id);
    const row = await this.repo.update(ctx, id, dto);
    if (!row) throw new NotFoundException(`Task ${id} não encontrada`);
    return row;
  }
}
